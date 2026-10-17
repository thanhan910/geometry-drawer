// The input language: tokenizer, parser, printer, dependency walk, rename and
// symbolic derivative. Pure functions over a small AST, no DOM — the unit
// tests import this file directly under Node.
//
// AST nodes:
//   {k:'num', v}            {k:'str', v}            {k:'id', n}
//   {k:'call', f, a:[...]}  {k:'bin', op, l, r}     {k:'un', op, e}
//   {k:'pt', x, y}          {k:'polar', r, a}       {k:'deg', e}
//   {k:'fn', v, body}       {k:'eq', l, r}

const UNI = { '−': '-', '×': '*', '·': '*', '÷': '/', '≤': '<=', '≥': '>=', '≠': '!=', '∧': '&&', '∨': '||' };
const SUP = { '²': 2, '³': 3, '⁴': 4 };
const GREEK = 'αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ';

// Free variables of equations and function bodies; never object names.
export const VARS = new Set(['x', 'y']);

// Names that are called even with a space before "(" — everything else
// followed by " (" is an implicit multiplication, as in "a (x + 1)".
export const MATH_FNS = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'sec', 'csc', 'cot', 'sqrt', 'cbrt', 'abs', 'exp', 'ln',
  'log', 'lg', 'ld', 'log2', 'log10', 'floor', 'ceil', 'round', 'sign', 'sgn', 'min', 'max', 'atan2', 'mod', 'nroot']);

export class ParseError extends Error {
  constructor(msg, pos) { super(msg); this.pos = pos; }
}

const isIdStart = c => /[A-Za-z_]/.test(c) || GREEK.includes(c);
const isIdChar = c => /[A-Za-z0-9_]/.test(c) || GREEK.includes(c);

export function tokenize(src) {
  src = src.replace(/[−×·÷≤≥≠∧∨]/g, c => UNI[c]);
  const out = [];
  let i = 0, sp = false;
  const push = (type, v, start) => { out.push({ type, v, sp, pos: start }); sp = false; };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { sp = true; i++; continue; }
    const start = i;
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)(E[+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new ParseError(`Unexpected "${c}"`, i);
      i += m[0].length; push('num', parseFloat(m[0]), start); continue;
    }
    if (isIdStart(c)) {
      let s = '';
      while (i < src.length && isIdChar(src[i])) {
        if (src[i] === '_' && src[i + 1] === '{') {           // A_{12} → A_12
          const j = src.indexOf('}', i);
          if (j < 0) throw new ParseError('Missing "}"', i);
          s += '_' + src.slice(i + 2, j); i = j + 1; continue;
        }
        s += src[i++];
      }
      while (src[i] === "'") s += src[i++];
      push('id', s, start); continue;
    }
    if (c === '"') {
      const j = src.indexOf('"', i + 1);
      if (j < 0) throw new ParseError('Missing closing quote', i);
      push('str', src.slice(i + 1, j), start); i = j + 1; continue;
    }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '==', '!=', '&&', '||'].includes(two)) { push('op', two, start); i += 2; continue; }
    if ('+-*/^(),;=:<>!°{}'.includes(c)) { push('op', c, start); i++; continue; }
    if (SUP[c]) { push('sup', SUP[c], start); i++; continue; }
    throw new ParseError(`Unexpected "${c}"`, i);
  }
  out.push({ type: 'eof', v: null, sp, pos: src.length });
  return out;
}

const bin = (op, l, r) => ({ k: 'bin', op, l, r });

class Parser {
  constructor(toks) { this.t = toks; this.i = 0; }
  peek() { return this.t[this.i]; }
  is(op) { const k = this.t[this.i]; return k.type === 'op' && k.v === op; }
  eat(op) { if (this.is(op)) { this.i++; return true; } return false; }
  expect(op) {
    if (!this.eat(op)) {
      const k = this.peek();
      throw new ParseError(k.type === 'eof' ? `Missing "${op}"` : `Expected "${op}"`, k.pos);
    }
  }
  end() {
    const k = this.peek();
    if (k.type !== 'eof') throw new ParseError(`Unexpected ${k.type === 'op' ? `"${k.v}"` : k.v}`, k.pos);
  }
  expr() { return this.or(); }
  or() { let l = this.and(); while (this.eat('||')) l = bin('||', l, this.and()); return l; }
  and() { let l = this.cmp(); while (this.eat('&&')) l = bin('&&', l, this.cmp()); return l; }
  cmp() {
    const l = this.add();
    for (const op of ['<=', '>=', '<', '>', '==', '!=']) if (this.eat(op)) return bin(op, l, this.add());
    return l;
  }
  add() {
    let l = this.mul();
    for (;;) {
      if (this.eat('+')) l = bin('+', l, this.mul());
      else if (this.eat('-')) l = bin('-', l, this.mul());
      else return l;
    }
  }
  startsPrimary() {
    const k = this.peek();
    return k.type === 'num' || k.type === 'id' || (k.type === 'op' && k.v === '(');
  }
  mul() {
    let l = this.unary();
    for (;;) {
      if (this.eat('*')) l = bin('*', l, this.unary());
      else if (this.eat('/')) l = bin('/', l, this.unary());
      else if (this.startsPrimary()) l = bin('*', l, this.pow());
      else return l;
    }
  }
  unary() {
    if (this.eat('-')) return { k: 'un', op: '-', e: this.unary() };
    if (this.eat('+')) return this.unary();
    if (this.eat('!')) return { k: 'un', op: '!', e: this.unary() };
    return this.pow();
  }
  pow() {
    const b = this.postfix();
    if (this.eat('^')) return bin('^', b, this.unary());
    return b;
  }
  postfix() {
    let e = this.primary();
    for (;;) {
      const k = this.peek();
      if (k.type === 'op' && k.v === '°') { this.i++; e = { k: 'deg', e }; }
      else if (k.type === 'sup') { this.i++; e = bin('^', e, { k: 'num', v: k.v }); }
      else return e;
    }
  }
  args() {
    const a = [];
    if (this.eat(')')) return a;
    do a.push(this.expr()); while (this.eat(','));
    this.expect(')');
    return a;
  }
  primary() {
    const k = this.peek();
    if (k.type === 'num') { this.i++; return { k: 'num', v: k.v }; }
    if (k.type === 'str') { this.i++; return { k: 'str', v: k.v }; }
    if (k.type === 'id') {
      this.i++;
      const nx = this.peek();
      if (nx.type === 'op' && nx.v === '(' && (!nx.sp || MATH_FNS.has(k.v) || COMMAND_NAMES.has(k.v.toLowerCase()))) {
        this.i++;
        return { k: 'call', f: k.v, a: this.args() };
      }
      return { k: 'id', n: k.v };
    }
    if (this.eat('(')) {
      const e = this.expr();
      if (this.eat(',')) { const y = this.expr(); this.expect(')'); return { k: 'pt', x: e, y }; }
      if (this.eat(';')) { const a = this.expr(); this.expect(')'); return { k: 'polar', r: e, a }; }
      this.expect(')');
      return e;
    }
    if (k.type === 'eof') throw new ParseError('Incomplete input', k.pos);
    throw new ParseError(`Unexpected "${k.v}"`, k.pos);
  }
}

// Filled in by geom.js so the parser knows which names are commands.
export const COMMAND_NAMES = new Set();

export function parseExpr(src) {
  const p = new Parser(tokenize(src));
  const e = p.expr(); p.end();
  return e;
}

// One line of the input bar. Returns {name|null, ast}.
//   A = (1, 2)      → name A        f(x) = x^2   → name f, fn node
//   c: x^2+y^2 = 4  → name c, eq    y = 2x + 1   → unnamed eq (y is a variable)
//   x^2 - 1         → unnamed fn of x
export function parseStatement(src) {
  const p = new Parser(tokenize(src));
  const t0 = p.t[0], t1 = p.t[1];
  if (t0.type === 'id' && t1 && t1.type === 'op' && t1.v === ':') {
    p.i = 2;
    const l = p.expr();
    let ast = l;
    if (p.eat('=')) ast = { k: 'eq', l, r: p.expr() };
    p.end();
    return { name: t0.v, ast: wrapBareFunction(ast) };
  }
  const lhs = p.expr();
  if (!p.eat('=')) { p.end(); return { name: null, ast: wrapBareFunction(lhs) }; }
  const rhs = p.expr();
  if (p.eat('=')) {
    const r2 = p.expr(); p.end();
    if (lhs.k !== 'id') throw new ParseError('Only one "=" allowed', t0.pos);
    return { name: lhs.n, ast: { k: 'eq', l: rhs, r: r2 } };
  }
  p.end();
  if (lhs.k === 'id' && !VARS.has(lhs.n)) return { name: lhs.n, ast: wrapBareFunction(rhs) };
  if (lhs.k === 'call' && lhs.a.length === 1 && lhs.a[0].k === 'id' && !VARS.has(lhs.f) &&
      (lhs.a[0].n === 'x' || !freeVars(rhs).has('x'))) {
    return { name: lhs.f, ast: { k: 'fn', v: lhs.a[0].n, body: rhs } };
  }
  return { name: null, ast: { k: 'eq', l: lhs, r: rhs } };
}

// "x^2 + 1" with no "=" becomes a function of x.
function wrapBareFunction(ast) {
  if (ast.k === 'eq' || ast.k === 'fn') return ast;
  const fv = freeVars(ast);
  if (fv.has('x') && !fv.has('y')) return { k: 'fn', v: 'x', body: ast };
  return ast;
}

// Which of x / y appear free (not as x(A) coordinate calls).
export function freeVars(ast) {
  const s = new Set();
  walk(ast, n => { if (n.k === 'id' && VARS.has(n.n)) s.add(n.n); });
  return s;
}

export function walk(n, fn) {
  if (!n || typeof n !== 'object') return;
  fn(n);
  switch (n.k) {
    case 'bin': walk(n.l, fn); walk(n.r, fn); break;
    case 'un': case 'deg': walk(n.e, fn); break;
    case 'call': n.a.forEach(a => walk(a, fn)); break;
    case 'pt': walk(n.x, fn); walk(n.y, fn); break;
    case 'polar': walk(n.r, fn); walk(n.a, fn); break;
    case 'fn': walk(n.body, fn); break;
    case 'eq': walk(n.l, fn); walk(n.r, fn); break;
  }
}

// Every identifier or call name that might be an object, minus bound
// variables. The construction intersects this with its object names.
export function names(ast) {
  const out = new Set();
  const rec = (n, bound) => {
    if (!n || typeof n !== 'object') return;
    switch (n.k) {
      case 'id': if (!bound.has(n.n)) out.add(n.n); return;
      case 'fn': rec(n.body, new Set([...bound, n.v])); return;
      case 'call': {
        out.add(n.f);
        const lf = n.f.toLowerCase();
        if ((lf === 'curve' || lf === 'sum' || lf === 'sequence') && n.a[2] && n.a[2].k === 'id') {
          const b2 = new Set([...bound, n.a[2].n]);
          n.a.forEach((a, i) => (i === 2 ? null : rec(a, i < 2 ? b2 : bound)));
          return;
        }
        n.a.forEach(a => rec(a, bound));
        return;
      }
      case 'bin': rec(n.l, bound); rec(n.r, bound); return;
      case 'un': case 'deg': rec(n.e, bound); return;
      case 'pt': rec(n.x, bound); rec(n.y, bound); return;
      case 'polar': rec(n.r, bound); rec(n.a, bound); return;
      case 'eq': rec(n.l, bound); rec(n.r, bound); return;
    }
  };
  rec(ast, VARS);
  return out;
}

export function rename(ast, from, to) {
  walk(ast, n => {
    if (n.k === 'id' && n.n === from) n.n = to;
    if (n.k === 'call' && n.f === from) n.f = to;
  });
  return ast;
}

export const clone = ast => JSON.parse(JSON.stringify(ast));

// ---------- printing ----------

const PREC = { '||': 1, '&&': 2, '<': 3, '>': 3, '<=': 3, '>=': 3, '==': 3, '!=': 3, '+': 4, '-': 4, '*': 5, '/': 5, '^': 7 };
const PRETTY_OP = { '-': '−', '*': '·', '<=': '≤', '>=': '≥', '!=': '≠' };

export function fmtNum(v, digits) {
  if (!isFinite(v)) return isNaN(v) ? '?' : v > 0 ? '∞' : '-∞';
  if (digits == null) {
    let s = String(v);
    if (s.includes('e')) s = v.toFixed(15).replace(/\.?0+$/, '');
    return s;
  }
  let s = v.toFixed(digits);
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  if (s === '-0') s = '0';
  return s;
}

// opts.digits: round numbers (display); opts.pretty: unicode operators and
// implicit multiplication. Saving uses neither, so it round-trips exactly.
export function print(n, opts = {}, ctx = 0) {
  const P = (m, c) => print(m, opts, c);
  const wrap = (s, p) => (p < ctx ? `(${s})` : s);
  switch (n.k) {
    case 'num': {
      const s = fmtNum(n.v, opts.digits);
      return s.startsWith('-') ? wrap((opts.pretty ? '−' : '-') + s.slice(1), 6) : s;
    }
    case 'str': return `"${n.v}"`;
    case 'id': return n.n;
    case 'call': return `${n.f}(${n.a.map(a => P(a, 0)).join(', ')})`;
    case 'pt': return `(${P(n.x, 0)}, ${P(n.y, 0)})`;
    case 'polar': return `(${P(n.r, 0)}; ${P(n.a, 0)})`;
    case 'deg': return `${P(n.e, 8)}°`;
    case 'fn': return P(n.body, 0);
    case 'eq': return `${P(n.l, 0)} = ${P(n.r, 0)}`;
    case 'un':
      if (n.op === '-') return wrap((opts.pretty ? '−' : '-') + P(n.e, 6), 6);
      return wrap('!' + P(n.e, 6), 6);
    case 'bin': {
      const p = PREC[n.op];
      if (n.op === '^') {
        if (opts.pretty && n.r.k === 'num' && (n.r.v === 2 || n.r.v === 3)) return `${P(n.l, 8)}${n.r.v === 2 ? '²' : '³'}`;
        return wrap(`${P(n.l, 8)}^${P(n.r, 7)}`, p);
      }
      const rightTight = n.op === '-' || n.op === '/' || p === 3;
      const l = P(n.l, p), r = P(n.r, rightTight ? p + 1 : p);
      if (n.op === '*' && opts.pretty && n.l.k === 'num' && n.l.v >= 0 && /^[A-Za-zα-ωΑ-Ω(]/.test(r)) return wrap(l + r, p);
      const op = opts.pretty ? PRETTY_OP[n.op] || n.op : n.op;
      return wrap(`${l} ${op} ${r}`, p);
    }
  }
  return '?';
}

// ---------- symbolic derivative ----------

const N = v => ({ k: 'num', v });
const isNum = (n, v) => n.k === 'num' && (v === undefined || n.v === v);

export function simplify(n) {
  switch (n.k) {
    case 'bin': {
      const l = simplify(n.l), r = simplify(n.r);
      if (isNum(l) && isNum(r) && '+-*/^'.includes(n.op)) {
        const v = { '+': l.v + r.v, '-': l.v - r.v, '*': l.v * r.v, '/': l.v / r.v, '^': Math.pow(l.v, r.v) }[n.op];
        if (isFinite(v) && Math.abs(v - Math.round(v * 1e9) / 1e9) < 1e-12) return N(v);
      }
      switch (n.op) {
        case '+': if (isNum(l, 0)) return r; if (isNum(r, 0)) return l;
          if (r.k === 'un' && r.op === '-') return simplify(bin('-', l, r.e));
          if (isNum(r) && r.v < 0) return bin('-', l, N(-r.v));
          break;
        case '-': if (isNum(r, 0)) return l; if (isNum(l, 0)) return simplify({ k: 'un', op: '-', e: r });
          if (isNum(r) && r.v < 0) return bin('+', l, N(-r.v));
          break;
        case '*':
          if (isNum(l, 0) || isNum(r, 0)) return N(0);
          if (isNum(l, 1)) return r; if (isNum(r, 1)) return l;
          if (isNum(r) && !isNum(l)) return simplify(bin('*', r, l));
          if (isNum(l) && r.k === 'bin' && r.op === '*' && isNum(r.l)) return simplify(bin('*', N(l.v * r.l.v), r.r));
          if (isNum(l, -1)) return { k: 'un', op: '-', e: r };
          break;
        case '/': if (isNum(l, 0)) return N(0); if (isNum(r, 1)) return l; break;
        case '^': if (isNum(r, 0)) return N(1); if (isNum(r, 1)) return l; break;
      }
      return bin(n.op, l, r);
    }
    case 'un': {
      const e = simplify(n.e);
      if (n.op === '-' && isNum(e)) return N(-e.v);
      if (n.op === '-' && e.k === 'un' && e.op === '-') return e.e;
      return { k: 'un', op: n.op, e };
    }
    case 'call': return { k: 'call', f: n.f, a: n.a.map(simplify) };
    default: return n;
  }
}

// d/dv of an AST. `lookup(name)` returns {v, body} for function objects so
// calls like g(x) can be inlined. Returns null when the expression contains
// something it cannot differentiate (the caller falls back to numeric).
export function derive(n, v, lookup) {
  const D = m => derive(m, v, lookup);
  const has = m => { let f = false; walk(m, q => { if (q.k === 'id' && q.n === v) f = true; if (q.k === 'call' && lookup(q.f)) f = true; }); return f; };
  if (!has(n)) return N(0);
  switch (n.k) {
    case 'id': return N(n.n === v ? 1 : 0);
    case 'un': { if (n.op !== '-') return null; const d = D(n.e); return d && { k: 'un', op: '-', e: d }; }
    case 'deg': { const d = D(n.e); return d && bin('*', d, bin('/', { k: 'id', n: 'π' }, N(180))); }
    case 'bin': {
      const { l, r } = n;
      const dl = D(l), dr = D(r);
      if (!dl || !dr) return null;
      switch (n.op) {
        case '+': case '-': return bin(n.op, dl, dr);
        case '*': return bin('+', bin('*', dl, r), bin('*', l, dr));
        case '/': return bin('/', bin('-', bin('*', dl, r), bin('*', l, dr)), bin('^', r, N(2)));
        case '^':
          if (!has(r)) return bin('*', bin('*', r, bin('^', l, bin('-', r, N(1)))), dl);
          if (!has(l)) return bin('*', bin('*', n, { k: 'call', f: 'ln', a: [l] }), dr);
          return bin('*', n, bin('+', bin('*', dr, { k: 'call', f: 'ln', a: [l] }), bin('/', bin('*', r, dl), l)));
      }
      return null;
    }
    case 'call': {
      const fo = lookup(n.f);
      if (fo && n.a.length === 1) {
        const inner = substitute(clone(fo.body), fo.v, n.a[0]);
        return D(inner);
      }
      if (n.a.length !== 1) return null;
      const u = n.a[0], du = D(u);
      if (!du) return null;
      const c = (f, ...a) => ({ k: 'call', f, a });
      let outer;
      switch (n.f) {
        case 'sin': outer = c('cos', u); break;
        case 'cos': outer = { k: 'un', op: '-', e: c('sin', u) }; break;
        case 'tan': outer = bin('/', N(1), bin('^', c('cos', u), N(2))); break;
        case 'exp': outer = c('exp', u); break;
        case 'ln': outer = bin('/', N(1), u); break;
        case 'log': case 'log10': case 'lg': outer = bin('/', N(1), bin('*', u, c('ln', N(10)))); break;
        case 'sqrt': outer = bin('/', N(1), bin('*', N(2), c('sqrt', u))); break;
        case 'abs': outer = c('sign', u); break;
        case 'asin': case 'arcsin': outer = bin('/', N(1), c('sqrt', bin('-', N(1), bin('^', u, N(2))))); break;
        case 'acos': case 'arccos': outer = bin('/', N(-1), c('sqrt', bin('-', N(1), bin('^', u, N(2))))); break;
        case 'atan': case 'arctan': outer = bin('/', N(1), bin('+', N(1), bin('^', u, N(2)))); break;
        case 'sinh': outer = c('cosh', u); break;
        case 'cosh': outer = c('sinh', u); break;
        case 'tanh': outer = bin('/', N(1), bin('^', c('cosh', u), N(2))); break;
        default: return null;
      }
      return bin('*', outer, du);
    }
  }
  return null;
}

export function substitute(n, v, withAst) {
  if (n.k === 'id' && n.n === v) return clone(withAst);
  switch (n.k) {
    case 'bin': n.l = substitute(n.l, v, withAst); n.r = substitute(n.r, v, withAst); break;
    case 'un': case 'deg': n.e = substitute(n.e, v, withAst); break;
    case 'call': n.a = n.a.map(a => substitute(a, v, withAst)); break;
    case 'pt': n.x = substitute(n.x, v, withAst); n.y = substitute(n.y, v, withAst); break;
  }
  return n;
}
