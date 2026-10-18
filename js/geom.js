// Geometry engine: typed values, evaluation of ASTs, every command,
// intersections, transforms and conic analysis. No DOM.
//
// Values:
//   num {v, deg?, arc?, anchor?, shade?}  bool {v}  str {v}  undef
//   pt {x,y}   pts {pts}   vec {x,y,o}
//   line|seg|ray {p, d}     (seg runs p → p+d; ray starts at p)
//   circle {c, r}           arc {c, r, a0, sw, sector}
//   poly {pts, closed}      conic {m:[A,B,C,D,E,F]}   (Ax²+Bxy+Cy²+Dx+Ey+F=0)
//   fn {f, v, body?, M?, dom?}   curve {fx, fy, t0, t1, M?}
//   implicit {F}            locus {pts}               text {s, pos}

import { COMMAND_NAMES, MATH_FNS, VARS, derive, simplify, print, fmtNum, freeVars, walk } from './expr.js';

export class EvalError extends Error {}

const { PI, abs, sqrt, cos, sin, atan2, hypot, min, max } = Math;
const TAU = 2 * PI;
export const UNDEF = Object.freeze({ t: 'undef' });

export const num = (v, extra) => (Number.isFinite(v) ? Object.assign({ t: 'num', v }, extra) : UNDEF);
export const pt = (x, y) => (Number.isFinite(x) && Number.isFinite(y) ? { t: 'pt', x, y } : UNDEF);
const P = (x, y) => ({ x, y });
const add = (a, b) => P(a.x + b.x, a.y + b.y);
const sub = (a, b) => P(a.x - b.x, a.y - b.y);
const mul = (a, k) => P(a.x * k, a.y * k);
const dot = (a, b) => a.x * b.x + a.y * b.y;
const crs = (a, b) => a.x * b.y - a.y * b.x;
const len = a => hypot(a.x, a.y);
const unit = a => { const l = len(a); return l ? P(a.x / l, a.y / l) : P(0, 0); };
const perp = a => P(-a.y, a.x);
const ang = a => atan2(a.y, a.x);
const mid = (a, b) => P((a.x + b.x) / 2, (a.y + b.y) / 2);
const dist = (a, b) => hypot(a.x - b.x, a.y - b.y);
const normAng = a => ((a % TAU) + TAU) % TAU;
const finite = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
export const V = { add, sub, mul, dot, crs, len, unit, perp, ang, mid, dist };

const toPt = q => pt(q.x, q.y);
const LINEAR = new Set(['line', 'seg', 'ray', 'vec']);
export const isLinear = v => LINEAR.has(v.t);
const lin = v => (v.t === 'vec' ? { p: v.o || P(0, 0), d: P(v.x, v.y), kind: 'seg' } : { p: v.p, d: v.d, kind: v.t });
const PATHS = new Set(['line', 'seg', 'ray', 'vec', 'circle', 'arc', 'poly', 'conic', 'fn', 'curve', 'implicit', 'locus']);
export const isPath = v => PATHS.has(v.t);

// ---------- math ----------

const MATHF = {
  sin, cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan, sinh: Math.sinh, cosh: Math.cosh,
  tanh: Math.tanh, asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
  sec: x => 1 / cos(x), csc: x => 1 / sin(x), cot: x => 1 / Math.tan(x), sqrt, cbrt: Math.cbrt, abs,
  exp: Math.exp, ln: Math.log, lg: Math.log10, log10: Math.log10, ld: Math.log2, log2: Math.log2,
  log: (a, b) => (b === undefined ? Math.log10(a) : Math.log(b) / Math.log(a)),
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign, sgn: Math.sign,
  min: (...a) => min(...a), max: (...a) => max(...a), atan2: (y, x) => atan2(y, x),
  mod: (a, b) => ((a % b) + b) % b,
  nroot: (x, n) => (x < 0 && n % 2 === 1 ? -Math.pow(-x, 1 / n) : Math.pow(x, 1 / n)),
};

// Real cube roots etc.: (-8)^(1/3) = -2, as a student expects.
function powr(a, b) {
  if (a < 0 && !Number.isInteger(b)) {
    for (const q of [3, 5, 7, 9]) {
      const p = Math.round(b * q);
      if (abs(b * q - p) < 1e-9 && p % 2 !== 0) return -Math.pow(-a, b);
      if (abs(b * q - p) < 1e-9) return Math.pow(-a, b);
    }
  }
  return Math.pow(a, b);
}

// ---------- evaluation ----------

// ctx = {get(name) → value|undefined, vars?, bounds?, locus?(p, q)}
export function evaluate(n, ctx) {
  switch (n.k) {
    case 'num': return num(n.v);
    case 'str': return { t: 'str', v: n.v };
    case 'id': return lookup(n.n, ctx);
    case 'pt': {
      const x = evaluate(n.x, ctx), y = evaluate(n.y, ctx);
      if (x.t === 'undef' || y.t === 'undef') return UNDEF;
      if (x.t !== 'num' || y.t !== 'num') throw new EvalError('Point coordinates must be numbers');
      return pt(x.v, y.v);
    }
    case 'polar': {
      const r = evaluate(n.r, ctx), a = evaluate(n.a, ctx);
      if (r.t !== 'num' || a.t !== 'num') return UNDEF;
      return pt(r.v * cos(a.v), r.v * sin(a.v));
    }
    case 'deg': {
      const v = evaluate(n.e, ctx);
      if (v.t !== 'num') return UNDEF;
      return num(v.v * PI / 180, { deg: true });
    }
    case 'un': {
      const v = evaluate(n.e, ctx);
      if (v.t === 'undef') return UNDEF;
      if (n.op === '!') return { t: 'bool', v: !truthy(v) };
      if (v.t === 'num') return num(-v.v, v.deg ? { deg: true } : undefined);
      if (v.t === 'pt') return pt(-v.x, -v.y);
      if (v.t === 'vec') return { t: 'vec', x: -v.x, y: -v.y, o: v.o };
      throw new EvalError(`Cannot negate ${typeName(v)}`);
    }
    case 'bin': return binop(n.op, evaluate(n.l, ctx), evaluate(n.r, ctx));
    case 'call': return call(n, ctx);
    case 'fn': return makeFn(n.v, n.body, ctx);
    case 'eq': return equation(n, ctx);
  }
  throw new EvalError('Cannot evaluate');
}

const truthy = v => (v.t === 'bool' ? v.v : v.t === 'num' ? v.v !== 0 : false);

function lookup(name, ctx) {
  if (ctx.vars && name in ctx.vars) return num(ctx.vars[name]);
  const v = ctx.get(name);
  if (v) return v;
  if (name === 'pi' || name === 'π') return num(PI);
  if (name === 'e') return num(Math.E);
  if (VARS.has(name)) throw new EvalError(`"${name}" only works in an equation (y = …) or a function f(x) = …`);
  // "xy", "ax", "ab" → product of single-letter names
  if (name.length > 1 && [...name].every(ch => (ctx.vars && ch in ctx.vars) || ctx.get(ch) || ch === 'π')) {
    return [...name].map(ch => lookup(ch, ctx)).reduce((a, b) => binop('*', a, b));
  }
  throw new EvalError(`Unknown name "${name}"`);
}

export function typeName(v) {
  return { num: 'number', pt: 'point', pts: 'points', vec: 'vector', seg: 'segment', poly: 'polygon',
    fn: 'function', str: 'text', undef: 'undefined' }[v.t] || v.t;
}

function binop(op, a, b) {
  if (a.t === 'undef' || b.t === 'undef') return UNDEF;
  if (op === '&&') return { t: 'bool', v: truthy(a) && truthy(b) };
  if (op === '||') return { t: 'bool', v: truthy(a) || truthy(b) };
  if (op === '+' && (a.t === 'str' || b.t === 'str')) return { t: 'str', v: toText(a) + toText(b) };
  const pv = v => v.t === 'pt' || v.t === 'vec';
  if (a.t === 'num' && b.t === 'num') {
    const x = a.v, y = b.v;
    const keepDeg = (a.deg || b.deg) && (op === '+' || op === '-') ? { deg: true }
      : (a.deg && op === '*') || (b.deg && op === '*') || (a.deg && op === '/') ? { deg: true } : undefined;
    switch (op) {
      case '+': return num(x + y, keepDeg);
      case '-': return num(x - y, keepDeg);
      case '*': return num(x * y, keepDeg);
      case '/': return num(x / y, keepDeg);
      case '^': return num(powr(x, y));
      case '<': return { t: 'bool', v: x < y };
      case '>': return { t: 'bool', v: x > y };
      case '<=': return { t: 'bool', v: x <= y };
      case '>=': return { t: 'bool', v: x >= y };
      case '==': return { t: 'bool', v: abs(x - y) < 1e-9 };
      case '!=': return { t: 'bool', v: abs(x - y) >= 1e-9 };
    }
  }
  if (pv(a) && pv(b)) {
    const res = (x, y) => (a.t === 'vec' && b.t === 'vec' ? { t: 'vec', x, y, o: a.o } : pt(x, y));
    switch (op) {
      case '+': return res(a.x + b.x, a.y + b.y);
      case '-': return res(a.x - b.x, a.y - b.y);
      case '*': return num(a.x * b.x + a.y * b.y);
      case '==': return { t: 'bool', v: abs(a.x - b.x) < 1e-9 && abs(a.y - b.y) < 1e-9 };
      case '!=': return { t: 'bool', v: !(abs(a.x - b.x) < 1e-9 && abs(a.y - b.y) < 1e-9) };
    }
  }
  if (pv(a) && b.t === 'num' && (op === '*' || op === '/')) {
    const k = op === '*' ? b.v : 1 / b.v;
    return a.t === 'vec' ? { t: 'vec', x: a.x * k, y: a.y * k, o: a.o } : pt(a.x * k, a.y * k);
  }
  if (a.t === 'num' && pv(b) && op === '*') return b.t === 'vec' ? { t: 'vec', x: a.v * b.x, y: a.v * b.y, o: b.o } : pt(a.v * b.x, a.v * b.y);
  throw new EvalError(`Cannot compute ${typeName(a)} ${op} ${typeName(b)}`);
}

function call(n, ctx) {
  const name = n.f, lname = name.toLowerCase();
  const bound = ctx.vars && name in ctx.vars;
  const obj = bound ? null : ctx.get(name);
  if (bound) return binop('*', lookup(name, ctx), evaluate(n.a[0], ctx));
  if (obj) {
    if (obj.t === 'undef') return UNDEF;
    if (obj.t === 'fn') {
      const a = evaluate(n.a[0], ctx);
      return a.t === 'num' ? num(callFn(obj, a.v)) : UNDEF;
    }
    if (obj.t === 'num' && n.a.length === 1) return binop('*', obj, evaluate(n.a[0], ctx));
    throw new EvalError(`${name} is not a function`);
  }
  if ((lname === 'x' || lname === 'y') && n.a.length === 1) {
    const a = evaluate(n.a[0], ctx);
    if (a.t === 'pt' || a.t === 'vec') return num(lname === 'x' ? a.x : a.y);
    if (a.t === 'undef') return UNDEF;
    throw new EvalError(`${name}( ) needs a point`);
  }
  if (MATH_FNS.has(lname) && MATHF[lname]) {
    const args = n.a.map(a => evaluate(a, ctx));
    if (args.some(a => a.t === 'undef')) return UNDEF;
    if (lname === 'abs' && args[0] && (args[0].t === 'vec' || args[0].t === 'pt')) return num(len(args[0]));
    if (args.some(a => a.t !== 'num')) throw new EvalError(`${name}( ) needs numbers`);
    return num(MATHF[lname](...args.map(a => a.v)));
  }
  const cmd = COMMANDS[lname];
  if (!cmd) throw new EvalError(`Unknown command "${name}"`);
  if (cmd.raw) return cmd(n.a, ctx);
  const args = n.a.map(a => evaluate(a, ctx));
  if (args.some(a => a.t === 'undef')) return UNDEF;
  const r = cmd(args, ctx);
  if (r === null || r === undefined) throw new EvalError(`${CANON[lname] || name}(${args.map(typeName).join(', ')}) is not supported. ${HELP[lname] ? 'Use ' + HELP[lname] : ''}`);
  return r;
}

export function callFn(fv, x) {
  if (fv.M) return NaN;
  if (fv.dom && (x < fv.dom[0] || x > fv.dom[1])) return NaN;
  return fv.f(x);
}

// Compile a numeric expression to a closure of up to two variables. Any
// subtree without a variable is evaluated once now and becomes a constant,
// which is what makes function graphs and implicit curves fast to draw.
export function compileNum(n, ctx, slots) {
  const usesVar = m => {
    let u = false;
    walk(m, q => {
      if (q.k === 'id' && (q.n in slots || [...q.n].some(ch => ch in slots) && !ctx.get(q.n))) u = true;
      if (q.k === 'call' && q.f in slots) u = true;
    });
    return u;
  };
  const constOf = m => { const v = evaluate(m, ctx); const c = v.t === 'num' ? v.v : v.t === 'bool' ? +v.v : NaN; return () => c; };
  const slow = m => (p, q) => {
    const vars = {};
    for (const k in slots) vars[k] = slots[k] === 0 ? p : q;
    const v = evaluate(m, { ...ctx, vars });
    return v.t === 'num' ? v.v : v.t === 'bool' ? +v.v : NaN;
  };
  const C = m => {
    if (!usesVar(m)) return constOf(m);
    switch (m.k) {
      case 'id': {
        if (m.n in slots) return slots[m.n] === 0 ? p => p : (p, q) => q;
        const parts = [...m.n].map(ch => C({ k: 'id', n: ch }));
        return (p, q) => { let s = 1; for (const f of parts) s *= f(p, q); return s; };
      }
      case 'un': { const e = C(m.e); return m.op === '-' ? (p, q) => -e(p, q) : (p, q) => (e(p, q) ? 0 : 1); }
      case 'deg': { const e = C(m.e); return (p, q) => e(p, q) * PI / 180; }
      case 'bin': {
        const l = C(m.l), r = C(m.r);
        switch (m.op) {
          case '+': return (p, q) => l(p, q) + r(p, q);
          case '-': return (p, q) => l(p, q) - r(p, q);
          case '*': return (p, q) => l(p, q) * r(p, q);
          case '/': return (p, q) => l(p, q) / r(p, q);
          case '^': {
            if (m.r.k === 'num' && m.r.v === 2) return (p, q) => { const a = l(p, q); return a * a; };
            return (p, q) => powr(l(p, q), r(p, q));
          }
          case '<': return (p, q) => +(l(p, q) < r(p, q));
          case '>': return (p, q) => +(l(p, q) > r(p, q));
          case '<=': return (p, q) => +(l(p, q) <= r(p, q));
          case '>=': return (p, q) => +(l(p, q) >= r(p, q));
          case '==': return (p, q) => +(abs(l(p, q) - r(p, q)) < 1e-9);
          case '!=': return (p, q) => +(abs(l(p, q) - r(p, q)) >= 1e-9);
          case '&&': return (p, q) => +(l(p, q) && r(p, q));
          case '||': return (p, q) => +(l(p, q) || r(p, q));
        }
        return slow(m);
      }
      case 'call': {
        const name = m.f, ln = name.toLowerCase();
        if (name in slots) { const s = C({ k: 'id', n: name }), a = C(m.a[0]); return (p, q) => s(p, q) * a(p, q); }
        const obj = ctx.get(name);
        if (obj) {
          if (obj.t === 'fn' && m.a.length === 1) { const a = C(m.a[0]); return (p, q) => callFn(obj, a(p, q)); }
          if (obj.t === 'num' && m.a.length === 1) { const c = obj.v, a = C(m.a[0]); return (p, q) => c * a(p, q); }
          return () => NaN;
        }
        if (MATHF[ln] && MATH_FNS.has(ln)) {
          const F = MATHF[ln], a = m.a.map(C);
          if (a.length === 1) { const a0 = a[0]; return (p, q) => F(a0(p, q)); }
          if (a.length === 2) { const [a0, a1] = a; return (p, q) => F(a0(p, q), a1(p, q)); }
          return (p, q) => F(...a.map(f => f(p, q)));
        }
        if (ln === 'if') {
          const [c, t, e] = m.a.map(C);
          return (p, q) => (c(p, q) ? t(p, q) : e ? e(p, q) : NaN);
        }
        return slow(m);
      }
    }
    return slow(m);
  };
  return C(n);
}

function makeFn(v, body, ctx) {
  const fv = freeVars(body);
  if (fv.has('y') && v !== 'y') throw new EvalError('A function of x cannot use y — write an equation instead');
  const f = compileNum(body, ctx, { [v]: 0 });
  return { t: 'fn', f, v, body };
}

// x² + y² = 4, y = 2x + 1, xy = 1, sin(x) = y ... decide what it is by
// fitting a quadratic and checking the fit at points it was not fitted on.
function equation(n, ctx) {
  const diff = { k: 'bin', op: '-', l: n.l, r: n.r };
  const F = compileNum(diff, ctx, { x: 0, y: 1 });
  const fit = fitConic(F);
  if (fit) {
    const [A, B, C, D, E, F0] = fit;
    const s = max(...fit.map(abs));
    if (s === 0) return UNDEF;
    const z = v => abs(v) < 1e-10 * s;
    if (z(A) && z(B) && z(C)) {
      if (z(D) && z(E)) return UNDEF;
      return lineFromCoef(D, E, F0);
    }
    if (z(B) && abs(A - C) < 1e-10 * s) {
      const cx = -D / (2 * A), cy = -E / (2 * A), r2 = cx * cx + cy * cy - F0 / A;
      return r2 > 0 ? { t: 'circle', c: P(cx, cy), r: sqrt(r2) } : UNDEF;
    }
    return conicV(fit);
  }
  if (n.l.k === 'id' && n.l.n === 'y' && !freeVars(n.r).has('y')) return makeFn('x', n.r, ctx);
  return { t: 'implicit', F };
}

function fitConic(F) {
  const F0 = F(0, 0), a1 = F(1, 0), a2 = F(-1, 0), c1 = F(0, 1), c2 = F(0, -1), b1 = F(1, 1);
  const vals = [F0, a1, a2, c1, c2, b1];
  if (!vals.every(Number.isFinite)) return null;
  const A = (a1 + a2) / 2 - F0, D = (a1 - a2) / 2, C = (c1 + c2) / 2 - F0, E = (c1 - c2) / 2;
  const B = b1 - A - C - D - E - F0;
  const m = [A, B, C, D, E, F0];
  const s = max(...m.map(abs), 1e-300);
  for (const [x, y] of [[0.37, -1.21], [2.3, 0.7], [-1.9, 3.1], [5.3, -4.7], [-7.1, -2.9]]) {
    const q = A * x * x + B * x * y + C * y * y + D * x + E * y + F0;
    const f = F(x, y);
    if (!Number.isFinite(f) || abs(f - q) > 1e-8 * (s * (1 + x * x + y * y))) return null;
  }
  return m;
}

function lineFromCoef(D, E, F) {
  const n2 = D * D + E * E;
  const p = P(-D * F / n2, -E * F / n2);
  let d = unit(P(E, -D));
  if (d.x < -1e-15 || (abs(d.x) < 1e-15 && d.y < 0)) d = mul(d, -1);
  return { t: 'line', p, d };
}

function conicV(m) {
  const s = max(...m.map(abs));
  if (!s || !m.every(Number.isFinite)) return UNDEF;
  return { t: 'conic', m: m.map(v => v / s) };
}

// ---------- conic analysis ----------

const ciCache = new WeakMap();
export function conicInfo(v) {
  let ci = ciCache.get(v);
  if (!ci) { ci = analyse(v.m); ciCache.set(v, ci); }
  return ci;
}

function analyse([A, B, C, D, E, F]) {
  const th = 0.5 * atan2(B, A - C);
  let e1 = P(cos(th), sin(th)), e2 = P(-sin(th), cos(th));
  let l1 = A * e1.x * e1.x + B * e1.x * e1.y + C * e1.y * e1.y;
  let l2 = A * e2.x * e2.x + B * e2.x * e2.y + C * e2.y * e2.y;
  const eps = 1e-9;
  if (abs(l1) > eps && abs(l2) > eps) {
    const det = 4 * A * C - B * B;
    const c = P((B * E - 2 * C * D) / det, (B * D - 2 * A * E) / det);
    const Fp = F + (D * c.x + E * c.y) / 2;
    if (l1 * l2 > 0) {
      if (-Fp / l1 <= 1e-14) return { type: abs(Fp) < 1e-12 ? 'point' : 'empty', c };
      return { type: 'ellipse', c, e1, e2, a: sqrt(-Fp / l1), b: sqrt(-Fp / l2) };
    }
    if (abs(Fp) < 1e-12) {
      const k = sqrt(-l1 / l2);
      return { type: 'lines', lines: [{ p: c, d: unit(add(e1, mul(e2, k))) }, { p: c, d: unit(sub(e1, mul(e2, k))) }] };
    }
    if (-Fp / l1 < 0) { [e1, e2] = [e2, mul(e1, -1)]; [l1, l2] = [l2, l1]; }
    return { type: 'hyperbola', c, e1, e2, a: sqrt(-Fp / l1), b: sqrt(Fp / l2) };
  }
  if (abs(l1) <= eps) { [e1, e2] = [e2, e1]; [l1, l2] = [l2, l1]; }
  if (abs(l1) <= eps) return { type: 'empty' };
  const Dp = D * e1.x + E * e1.y, Ep = D * e2.x + E * e2.y;
  if (abs(Ep) > 1e-12) {
    // λ u² + D'u + E'v + F = 0 → v(u). Orient e2 so the parabola opens along +e2.
    return { type: 'parabola', e1, e2, l: l1, Dp, Ep, F, u0: -Dp / (2 * l1) };
  }
  const disc = Dp * Dp - 4 * l1 * F;
  if (disc < 0) return { type: 'empty' };
  const r = [(-Dp + sqrt(disc)) / (2 * l1), (-Dp - sqrt(disc)) / (2 * l1)];
  return { type: 'lines', lines: r.map(u => ({ p: mul(e1, u), d: e2 })) };
}

export function parabolaAt(ci, u) {
  const v = -(ci.l * u * u + ci.Dp * u + ci.F) / ci.Ep;
  return add(mul(ci.e1, u), mul(ci.e2, v));
}
export function hyperbolaAt(ci, s, branch) {
  return add(ci.c, add(mul(ci.e1, branch * ci.a * Math.cosh(s)), mul(ci.e2, ci.b * Math.sinh(s))));
}

function conicMatrix(v) {
  if (v.t === 'circle') {
    const { c, r } = v;
    return [[1, 0, -c.x], [0, 1, -c.y], [-c.x, -c.y, c.x * c.x + c.y * c.y - r * r]];
  }
  const [A, B, C, D, E, F] = v.m;
  return [[A, B / 2, D / 2], [B / 2, C, E / 2], [D / 2, E / 2, F]];
}
const fromMatrix = Q => conicV([Q[0][0], 2 * Q[0][1], Q[1][1], 2 * Q[0][2], 2 * Q[1][2], Q[2][2]]);
const qform = (Q, a, b) => {
  let s = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s += a[i] * Q[i][j] * b[j];
  return s;
};

// Ax² + ... from centre, unit axis e1 and α u² + β v² = 1.
function conicFromAxes(c, e1, al, be) {
  const ux = e1.x, uy = e1.y;
  const A = al * ux * ux + be * uy * uy, B = 2 * (al - be) * ux * uy, C = al * uy * uy + be * ux * ux;
  const D = -(2 * A * c.x + B * c.y), E = -(B * c.x + 2 * C * c.y);
  const F = A * c.x * c.x + B * c.x * c.y + C * c.y * c.y - 1;
  return conicV([A, B, C, D, E, F]);
}

function solve(M, b) {
  const n = b.length, a = M.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (abs(a[r][c]) > abs(a[p][c])) p = r;
    if (abs(a[p][c]) < 1e-14) return null;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k];
    }
  }
  return a.map((r, i) => r[n] / r[i]);
}

function conicThrough(ps) {
  const rows = ps.map(p => [p.x * p.x, p.x * p.y, p.y * p.y, p.x, p.y, 1]);
  // Fix the coefficient with the best-conditioned solve to 1.
  let best = null;
  for (let fix = 0; fix < 6; fix++) {
    const M = rows.map(r => r.filter((_, j) => j !== fix));
    const b = rows.map(r => -r[fix]);
    const s = solve(M, b);
    if (!s) continue;
    const m = [];
    for (let j = 0, k = 0; j < 6; j++) m.push(j === fix ? 1 : s[k++]);
    const sz = max(...m.map(abs));
    if (!best || sz < best.sz) best = { m, sz };
  }
  return best ? conicV(best.m) : UNDEF;
}

// ---------- paths ----------

export const DEFAULT_BOUNDS = { xmin: -10, xmax: 10, ymin: -10, ymax: 10 };

function lineRange(p, d, b) {
  const c = P((b.xmin + b.xmax) / 2, (b.ymin + b.ymax) / 2);
  const R = hypot(b.xmax - b.xmin, b.ymax - b.ymin) * 0.75;
  const dl = len(d) || 1;
  const tc = dot(sub(c, p), d) / (dl * dl);
  return [tc - R / dl, tc + R / dl];
}

// Uniform parameterisation of anything you can put a point on.
//   at(t) → {x,y}; [t0,t1] the sampling range (view-dependent for unbounded
//   paths); imp(x,y) a function that changes sign across the path (if any).
export function pathInfo(v, b = DEFAULT_BOUNDS) {
  switch (v.t) {
    case 'line': case 'seg': case 'ray': case 'vec': {
      const { p, d, kind } = lin(v);
      const [r0, r1] = lineRange(p, d, b);
      const n = perp(d);
      return {
        at: t => add(p, mul(d, t)),
        t0: kind === 'line' ? r0 : 0, t1: kind === 'seg' ? 1 : kind === 'ray' ? max(r1, 1) : r1,
        imp: (x, y) => n.x * (x - p.x) + n.y * (y - p.y), param: true,
      };
    }
    case 'circle': {
      const { c, r } = v;
      return { at: t => P(c.x + r * cos(TAU * t), c.y + r * sin(TAU * t)), t0: 0, t1: 1, closed: true,
        imp: (x, y) => (x - c.x) ** 2 + (y - c.y) ** 2 - r * r, param: true };
    }
    case 'arc': {
      const { c, r, a0, sw } = v;
      return { at: t => P(c.x + r * cos(a0 + sw * t), c.y + r * sin(a0 + sw * t)), t0: 0, t1: 1,
        imp: (x, y) => (x - c.x) ** 2 + (y - c.y) ** 2 - r * r, param: true };
    }
    case 'poly': case 'locus': {
      const ps = v.pts, n = ps.length;
      const closed = v.t === 'poly' && v.closed;
      const segs = closed ? n : n - 1;
      return {
        at: t => {
          let i = Math.floor(t);
          if (i >= segs) i = segs - 1;
          if (i < 0) i = 0;
          const a = ps[i], q = ps[(i + 1) % n];
          if (!a || !q) return P(NaN, NaN);
          const f = t - i;
          return P(a.x + (q.x - a.x) * f, a.y + (q.y - a.y) * f);
        },
        t0: 0, t1: segs, closed, param: v.t === 'poly', samples: segs * 40,
      };
    }
    case 'conic': {
      const ci = conicInfo(v);
      const Q = conicMatrix(v);
      const imp = (x, y) => qform(Q, [x, y, 1], [x, y, 1]);
      if (ci.type === 'ellipse') {
        return { at: t => add(ci.c, add(mul(ci.e1, ci.a * cos(TAU * t)), mul(ci.e2, ci.b * sin(TAU * t)))),
          t0: 0, t1: 1, closed: true, imp, param: true };
      }
      if (ci.type === 'hyperbola') {
        const S = hyperbolaRange(ci, b);
        return { at: t => (t < 1 ? hyperbolaAt(ci, (2 * t - 1) * S, 1) : hyperbolaAt(ci, (2 * (t - 1) - 1) * S, -1)),
          t0: 0, t1: 2 - 1e-9, imp };
      }
      if (ci.type === 'parabola') {
        const [u0, u1] = parabolaRange(ci, b);
        return { at: u => parabolaAt(ci, u), t0: u0, t1: u1, imp };
      }
      return { imp };
    }
    case 'fn': {
      const [x0, x1] = fnRange(v, b);
      const at = v.M ? t => applyPt(v.M, P(t, v.f(t))) : t => P(t, v.f(t));
      const imp = v.M ? (x, y) => { const q = applyPt(v.Minv, P(x, y)); return q.y - v.f(q.x); } : (x, y) => y - v.f(x);
      return { at, t0: x0, t1: x1, imp, param: true, samples: 1500 };
    }
    case 'curve': {
      const at = v.M ? t => applyPt(v.M, P(v.fx(t), v.fy(t))) : t => P(v.fx(t), v.fy(t));
      return { at, t0: v.t0, t1: v.t1, param: true, samples: 1500 };
    }
    case 'implicit': {
      const segs = contour(v, b);
      const imp = v.Minv ? (x, y) => { const q = applyPt(v.Minv, P(x, y)); return v.F(q.x, q.y); } : v.F;
      return { segs, imp };
    }
  }
  return null;
}

export function hyperbolaRange(ci, b) {
  const R = max(...[[b.xmin, b.ymin], [b.xmax, b.ymin], [b.xmin, b.ymax], [b.xmax, b.ymax]]
    .map(([x, y]) => hypot(x - ci.c.x, y - ci.c.y)));
  return Math.asinh(R / min(ci.a, ci.b)) + 0.3;
}
export function parabolaRange(ci, b) {
  const us = [[b.xmin, b.ymin], [b.xmax, b.ymin], [b.xmin, b.ymax], [b.xmax, b.ymax]].map(([x, y]) => x * ci.e1.x + y * ci.e1.y);
  const w = max(...us) - min(...us);
  return [min(...us) - w * 0.5, max(...us) + w * 0.5];
}
export function fnRange(v, b) {
  let x0 = b.xmin, x1 = b.xmax;
  if (v.M) {
    const cs = [[b.xmin, b.ymin], [b.xmax, b.ymin], [b.xmin, b.ymax], [b.xmax, b.ymax]].map(([x, y]) => applyPt(v.Minv, P(x, y)).x);
    x0 = min(...cs); x1 = max(...cs);
  }
  if (v.dom) { x0 = max(x0, v.dom[0]); x1 = min(x1, v.dom[1]); }
  return [x0, x1];
}

// Marching squares over the bounds; cached per bounds on the value.
const contourCache = new WeakMap();
export function contour(v, b, cells = 160) {
  const key = `${b.xmin},${b.xmax},${b.ymin},${b.ymax},${cells}`;
  const hit = contourCache.get(v);
  if (hit && hit.key === key) return hit.segs;
  const F = v.Minv ? (x, y) => { const q = applyPt(v.Minv, P(x, y)); return v.F(q.x, q.y); } : v.F;
  const w = b.xmax - b.xmin, h = b.ymax - b.ymin;
  const nx = cells, ny = Math.max(4, Math.round(cells * h / w));
  const dx = w / nx, dy = h / ny;
  const g = new Float64Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) g[j * (nx + 1) + i] = F(b.xmin + i * dx + 1e-9, b.ymin + j * dy + 1e-9);
  const segs = [];
  const lerp = (x0, y0, v0, x1, y1, v1) => { const t = v0 / (v0 - v1); return P(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t); };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x0 = b.xmin + i * dx, y0 = b.ymin + j * dy, x1 = x0 + dx, y1 = y0 + dy;
    const a = g[j * (nx + 1) + i], bb = g[j * (nx + 1) + i + 1], c = g[(j + 1) * (nx + 1) + i + 1], d = g[(j + 1) * (nx + 1) + i];
    if (![a, bb, c, d].every(Number.isFinite)) continue;
    const e = [];
    if ((a < 0) !== (bb < 0)) e.push(lerp(x0, y0, a, x1, y0, bb));
    if ((bb < 0) !== (c < 0)) e.push(lerp(x1, y0, bb, x1, y1, c));
    if ((c < 0) !== (d < 0)) e.push(lerp(x1, y1, c, x0, y1, d));
    if ((d < 0) !== (a < 0)) e.push(lerp(x0, y1, d, x0, y0, a));
    // Reject sign changes across a pole (1/x): the values must be small next
    // to the cell's gradient scale.
    const big = max(abs(a), abs(bb), abs(c), abs(d));
    const spread = max(a, bb, c, d) - min(a, bb, c, d);
    if (big > 1e6 && spread > 1e6) continue;
    if (e.length === 2) segs.push([e[0], e[1]]);
    else if (e.length === 4) { segs.push([e[0], e[1]]); segs.push([e[2], e[3]]); }
  }
  contourCache.set(v, { key, segs });
  return segs;
}

// Closest point on a path to q: {t, p, d}.
export function closest(v, q, b) {
  if (v.t === 'line' || v.t === 'seg' || v.t === 'ray' || v.t === 'vec') {
    const { p, d, kind } = lin(v);
    let t = dot(sub(q, p), d) / dot(d, d);
    if (kind !== 'line') t = max(0, t);
    if (kind === 'seg') t = min(1, t);
    const r = add(p, mul(d, t));
    return { t, p: r, d: dist(r, q) };
  }
  if (v.t === 'circle') {
    const a = normAng(ang(sub(q, v.c)));
    const r = add(v.c, mul(P(cos(a), sin(a)), v.r));
    return { t: a / TAU, p: r, d: dist(r, q) };
  }
  const pi = pathInfo(v, b);
  if (!pi) return null;
  if (!pi.at) {
    let best = null;
    for (const [a, c] of pi.segs || []) {
      const r = closest({ t: 'seg', p: a, d: sub(c, a) }, q);
      if (!best || r.d < best.d) best = r;
    }
    return best && { t: 0, p: best.p, d: best.d };
  }
  const N = pi.samples || 600;
  let bi = -1, bd = Infinity;
  const h = (pi.t1 - pi.t0) / N;
  for (let i = 0; i <= N; i++) {
    const p = pi.at(pi.t0 + i * h);
    if (!finite(p)) continue;
    const dd = dist(p, q);
    if (dd < bd) { bd = dd; bi = i; }
  }
  if (bi < 0) return null;
  let lo = pi.t0 + max(0, bi - 1) * h, hi = pi.t0 + min(N, bi + 1) * h;
  const g = (sqrt(5) - 1) / 2;
  for (let k = 0; k < 50; k++) {
    const m1 = hi - g * (hi - lo), m2 = lo + g * (hi - lo);
    const d1 = dist(pi.at(m1), q), d2 = dist(pi.at(m2), q);
    if (!(d1 > d2)) hi = m2; else lo = m1;
  }
  const t = (lo + hi) / 2, p = pi.at(t);
  return finite(p) ? { t, p, d: dist(p, q) } : { t: pi.t0 + bi * h, p: pi.at(pi.t0 + bi * h), d: bd };
}

// Distance from q to the path (for "is this point on it").
function distTo(v, q, b) {
  if (v.t === 'arc') {
    const a = normAng(ang(sub(q, v.c)) - v.a0);
    if (a <= v.sw + 1e-9) return abs(dist(q, v.c) - v.r);
    return min(dist(q, arcEnd(v, 0)), dist(q, arcEnd(v, 1)));
  }
  if (v.t === 'poly') {
    let best = Infinity;
    const n = v.pts.length, segs = v.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = v.pts[i], c = v.pts[(i + 1) % n];
      best = min(best, closest({ t: 'seg', p: a, d: sub(c, a) }, q).d);
    }
    return best;
  }
  if (v.t === 'fn' && v.dom && !v.M && (q.x < v.dom[0] - 1e-9 || q.x > v.dom[1] + 1e-9)) return Infinity;
  if (v.t === 'curve' || v.t === 'locus' || v.t === 'implicit') return 0;
  const c = closest(v, q, b);
  return c ? c.d : Infinity;
}
const arcEnd = (v, k) => add(v.c, mul(P(cos(v.a0 + v.sw * k), sin(v.a0 + v.sw * k)), v.r));

// ---------- intersections ----------

const EPS = 1e-9;
function ll(a, b) {
  const A = lin(a), B = lin(b);
  const den = crs(A.d, B.d);
  if (abs(den) < 1e-14 * len(A.d) * len(B.d)) return [];
  const w = sub(B.p, A.p);
  const t = crs(w, B.d) / den, s = crs(w, A.d) / den;
  if (!inLin(A.kind, t) || !inLin(B.kind, s)) return [];
  return [add(A.p, mul(A.d, t))];
}
const inLin = (kind, t) => (kind === 'line' || (t >= -EPS && (kind === 'ray' || t <= 1 + EPS)));

function lc(a, c) {
  const A = lin(a);
  const f = sub(A.p, c.c);
  const qa = dot(A.d, A.d), qb = 2 * dot(f, A.d), qc = dot(f, f) - c.r * c.r;
  let disc = qb * qb - 4 * qa * qc;
  if (disc < -1e-12 * qb * qb) return [];
  disc = max(0, disc);
  const ts = [(-qb - sqrt(disc)) / (2 * qa), (-qb + sqrt(disc)) / (2 * qa)];
  return ts.filter(t => inLin(A.kind, t)).map(t => add(A.p, mul(A.d, t))).filter(p => onArc(c, p));
}
const onArc = (c, p) => c.t !== 'arc' || normAng(ang(sub(p, c.c)) - c.a0) <= c.sw + 1e-9;

function cc(a, b) {
  const d = sub(b.c, a.c), D = len(d);
  if (D < 1e-14 || D > a.r + b.r + 1e-12 || D < abs(a.r - b.r) - 1e-12) return [];
  const x = (a.r * a.r - b.r * b.r + D * D) / (2 * D);
  const h = sqrt(max(0, a.r * a.r - x * x));
  const u = unit(d), m = add(a.c, mul(u, x));
  return [add(m, mul(perp(u), h)), sub(m, mul(perp(u), h))].filter(p => onArc(a, p) && onArc(b, p));
}

function lq(a, q) {
  const A = lin(a), Q = conicMatrix(q);
  const p = [A.p.x, A.p.y, 1], d = [A.d.x, A.d.y, 0];
  const qa = qform(Q, d, d), qb = 2 * qform(Q, p, d), qc = qform(Q, p, p);
  let ts;
  if (abs(qa) < 1e-12 * (abs(qb) + abs(qc))) ts = abs(qb) > 1e-14 ? [-qc / qb] : [];
  else {
    let disc = qb * qb - 4 * qa * qc;
    if (disc < -1e-10 * qb * qb) return [];
    disc = max(0, disc);
    ts = [(-qb - sqrt(disc)) / (2 * qa), (-qb + sqrt(disc)) / (2 * qa)].sort((x, y) => x - y);
  }
  return ts.filter(t => inLin(A.kind, t)).map(t => add(A.p, mul(A.d, t)));
}

function edges(v) {
  const n = v.pts.length, out = [];
  const segs = v.t === 'poly' && v.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = v.pts[i], c = v.pts[(i + 1) % n];
    if (a && c) out.push({ t: 'seg', p: a, d: sub(c, a) });
  }
  return out;
}

// All intersection points, in a stable order.
export function intersections(a, b, bounds = DEFAULT_BOUNDS) {
  if (a.t === 'undef' || b.t === 'undef') return [];
  const circ = v => v.t === 'circle' || v.t === 'arc';
  if (isLinear(a) && isLinear(b)) return ll(a, b);
  if (isLinear(a) && circ(b)) return lc(a, b);
  if (circ(a) && isLinear(b)) return lc(b, a);
  if (circ(a) && circ(b)) return cc(a, b);
  if (isLinear(a) && b.t === 'conic') return lq(a, b);
  if (a.t === 'conic' && isLinear(b)) return lq(b, a);
  if (a.t === 'poly' && (isLinear(b) || circ(b) || b.t === 'conic')) return dedupe(edges(a).flatMap(e => intersections(e, b, bounds)));
  if (b.t === 'poly' && (isLinear(a) || circ(a) || a.t === 'conic')) return dedupe(edges(b).flatMap(e => intersections(a, e, bounds)));
  if (a.t === 'fn' && b.t === 'fn' && !a.M && !b.M) return fnfn(a, b, bounds);
  return generic(a, b, bounds);
}

function dedupe(ps) {
  const out = [];
  for (const p of ps) if (finite(p) && !out.some(q => dist(p, q) < 1e-9 * (1 + len(p)))) out.push(p);
  return out;
}

function fnfn(a, b, bounds) {
  const [x0, x1] = [max(fnRange(a, bounds)[0], fnRange(b, bounds)[0]), min(fnRange(a, bounds)[1], fnRange(b, bounds)[1])];
  const h = x => callFn(a, x) - callFn(b, x);
  return rootsOf(h, x0, x1, 2000).map(x => P(x, callFn(a, x)));
}

function rootsOf(h, x0, x1, N = 1000) {
  const out = [];
  const dx = (x1 - x0) / N;
  let pv = h(x0);
  if (abs(pv) < 1e-13) out.push(x0);
  for (let i = 1; i <= N; i++) {
    const x = x0 + i * dx, v = h(x);
    if (Number.isFinite(pv) && Number.isFinite(v)) {
      if (v === 0) out.push(x);
      else if ((pv < 0) !== (v < 0) && pv !== 0) {
        let lo = x - dx, hi = x, flo = pv;
        for (let k = 0; k < 80; k++) {
          const m = (lo + hi) / 2, fm = h(m);
          if ((fm < 0) === (flo < 0)) { lo = m; flo = fm; } else hi = m;
        }
        const r = (lo + hi) / 2;
        if (abs(h(r)) < 1e-6 * (1 + abs(pv) + abs(v))) out.push(r);
      }
    }
    pv = v;
  }
  return out;
}

function generic(a, b, bounds) {
  let A = pathInfo(a, bounds), B = pathInfo(b, bounds);
  if (!A || !B) return [];
  let va = a, vb = b;
  if (!(A.at && B.imp)) { [A, B, va, vb] = [B, A, vb, va]; }
  let pts = [];
  if (A.at && B.imp) {
    const N = max(A.samples || 0, 1200);
    const h = (A.t1 - A.t0) / N;
    const F = t => { const p = A.at(t); return finite(p) ? B.imp(p.x, p.y) : NaN; };
    let pt0 = A.t0, f0 = F(pt0);
    for (let i = 1; i <= N; i++) {
      const t = A.t0 + i * h, f = F(t);
      if (Number.isFinite(f0) && Number.isFinite(f) && (f0 < 0) !== (f < 0)) {
        let lo = pt0, hi = t, flo = f0;
        for (let k = 0; k < 70; k++) {
          const m = (lo + hi) / 2, fm = F(m);
          if (!Number.isFinite(fm)) break;
          if ((fm < 0) === (flo < 0)) { lo = m; flo = fm; } else hi = m;
        }
        const p = A.at((lo + hi) / 2);
        if (finite(p) && abs(B.imp(p.x, p.y)) < 1e-6 * (1 + abs(f0) + abs(f))) pts.push(p);
      }
      pt0 = t; f0 = f;
    }
    const tol = 1e-6 * (1 + (bounds.xmax - bounds.xmin));
    pts = pts.filter(p => distTo(vb, p, bounds) < tol);
  } else {
    // two polylines (locus, implicit contours, curves)
    const pl = (I, v) => (I.segs ? I.segs : I.at ? sampled(I) : v.t === 'locus' ? edges(v).map(e => [e.p, add(e.p, e.d)]) : []);
    const S1 = pl(A, va), S2 = pl(B, vb);
    for (const [p1, p2] of S1) for (const [q1, q2] of S2) {
      const r = ll({ t: 'seg', p: p1, d: sub(p2, p1) }, { t: 'seg', p: q1, d: sub(q2, q1) });
      if (r.length) pts.push(r[0]);
    }
  }
  return dedupe(pts).sort((p, q) => p.x - q.x || p.y - q.y);
}
function sampled(I) {
  const N = I.samples || 600, h = (I.t1 - I.t0) / N, out = [];
  let prev = I.at(I.t0);
  for (let i = 1; i <= N; i++) {
    const p = I.at(I.t0 + i * h);
    if (finite(prev) && finite(p)) out.push([prev, p]);
    prev = p;
  }
  return out;
}

// ---------- affine transforms ----------
// M = [a, b, c, d, e, f]: (x, y) → (a x + b y + e, c x + d y + f)

export const applyPt = (M, p) => P(M[0] * p.x + M[1] * p.y + M[4], M[2] * p.x + M[3] * p.y + M[5]);
const applyVec = (M, p) => P(M[0] * p.x + M[1] * p.y, M[2] * p.x + M[3] * p.y);
export function invM(M) {
  const [a, b, c, d, e, f] = M, det = a * d - b * c;
  const ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
  return [ia, ib, ic, id, -(ia * e + ib * f), -(ic * e + id * f)];
}
export const compose = (M2, M1) => [ // M2 ∘ M1
  M2[0] * M1[0] + M2[1] * M1[2], M2[0] * M1[1] + M2[1] * M1[3],
  M2[2] * M1[0] + M2[3] * M1[2], M2[2] * M1[1] + M2[3] * M1[3],
  M2[0] * M1[4] + M2[1] * M1[5] + M2[4], M2[2] * M1[4] + M2[3] * M1[5] + M2[5],
];
const mTranslate = v => [1, 0, 0, 1, v.x, v.y];
const mRotate = (t, c) => { const C = cos(t), S = sin(t); return [C, -S, S, C, c.x - (C * c.x - S * c.y), c.y - (S * c.x + C * c.y)]; };
const mDilate = (k, c) => [k, 0, 0, k, c.x * (1 - k), c.y * (1 - k)];
function mReflectLine(l) {
  const { p, d } = lin(l), u = unit(d);
  const a = u.x * u.x - u.y * u.y, b = 2 * u.x * u.y;
  return [a, b, b, -a, p.x - (a * p.x + b * p.y), p.y - (b * p.x - a * p.y)];
}

export function transform(v, M) {
  const det = M[0] * M[3] - M[1] * M[2];
  const sc = sqrt(abs(det));
  const mp = p => applyPt(M, p);
  switch (v.t) {
    case 'pt': return toPt(mp(v));
    case 'pts': return { t: 'pts', pts: v.pts.map(mp) };
    case 'vec': { const w = applyVec(M, v); return { t: 'vec', x: w.x, y: w.y, o: mp(v.o || P(0, 0)) }; }
    case 'line': case 'seg': case 'ray': return { t: v.t, p: mp(v.p), d: applyVec(M, v.d) };
    case 'circle': return { t: 'circle', c: mp(v.c), r: v.r * sc };
    case 'arc': {
      const c = mp(v.c), s = mp(arcEnd(v, 0)), e = mp(arcEnd(v, 1));
      const a0 = ang(sub(det > 0 ? s : e, c));
      return { ...v, c, r: v.r * sc, a0 };
    }
    case 'poly': return { t: 'poly', pts: v.pts.map(mp), closed: v.closed };
    case 'locus': return { t: 'locus', pts: v.pts.map(p => p && mp(p)) };
    case 'conic': {
      const H = invM(M);
      const Hm = [[H[0], H[1], H[4]], [H[2], H[3], H[5]], [0, 0, 1]];
      const Q = conicMatrix(v);
      const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        let s = 0;
        for (let k = 0; k < 3; k++) for (let l = 0; l < 3; l++) s += Hm[k][i] * Q[k][l] * Hm[l][j];
        R[i][j] = s;
      }
      return fromMatrix(R);
    }
    case 'fn': case 'curve': case 'implicit': {
      const M2 = v.M ? compose(M, v.M) : M;
      return { ...v, M: M2, Minv: invM(M2) };
    }
    case 'text': return v.pos ? { ...v, pos: mp(v.pos) } : v;
    case 'num': return v;
  }
  return UNDEF;
}

// Inversion in a circle. Lines and circles map exactly to lines or circles,
// segments, rays and arcs to exact arcs (or segments through the centre);
// anything else on a path is sampled and returned as a locus.
function invert(v, circ, bounds = DEFAULT_BOUNDS) {
  const { c, r } = circ;
  const ip = p => { const d = sub(p, c), l2 = dot(d, d); return l2 < 1e-300 ? P(NaN, NaN) : add(c, mul(d, r * r / l2)); };
  const threePoint = (q, mk) => {
    if (!q.every(finite)) return null;
    const k = circle3(q[0], q[1], q[2]);
    return k ? mk(k) : null;
  };
  switch (v.t) {
    case 'pt': return toPt(ip(v));
    case 'pts': return { t: 'pts', pts: v.pts.map(ip) };
    case 'line': case 'circle': {
      const ps = v.t === 'line' ? [0.37, 1.91, -2.3].map(t => add(v.p, mul(v.d, t)))
        : [0.1, 0.43, 0.77].map(t => add(v.c, mul(P(cos(TAU * t), sin(TAU * t)), v.r)));
      const q = ps.map(ip);
      if (!q.every(finite)) {
        const good = q.filter(finite);
        return good.length >= 2 ? { t: 'line', p: good[0], d: sub(good[1], good[0]) } : UNDEF;
      }
      return circle3(q[0], q[1], q[2]) || { t: 'line', p: q[0], d: sub(q[1], q[0]) };
    }
    case 'seg': case 'ray': case 'arc': {
      // start, middle, end of the image; a ray's far end maps to the centre
      const ends = v.t === 'arc' ? [arcEnd(v, 0), arcEnd(v, 0.5), arcEnd(v, 1)].map(ip)
        : v.t === 'seg' ? [v.p, add(v.p, mul(v.d, 0.5)), add(v.p, v.d)].map(ip)
          : [ip(v.p), ip(add(v.p, v.d)), P(c.x, c.y)];
      const a = threePoint(ends, () => arc3(ends.map(q => ({ t: 'pt', x: q.x, y: q.y })), false));
      if (a && a.t === 'arc') return a;
      break; // through the centre: fall back to sampling
    }
  }
  if (!isPath(v)) return UNDEF;
  const pi = pathInfo(v, bounds);
  if (!pi || !pi.at) return UNDEF;
  const N = 800, out = [];
  let prev = null;
  const diag = hypot(bounds.xmax - bounds.xmin, bounds.ymax - bounds.ymin);
  for (let i = 0; i <= N; i++) {
    const q = ip(pi.at(pi.t0 + (pi.t1 - pi.t0) * i / N));
    if (!finite(q)) { if (prev) out.push(null); prev = null; continue; }
    if (prev && dist(prev, q) > diag * 0.3) out.push(null);
    out.push(q); prev = q;
  }
  return { t: 'locus', pts: out };
}

function circle3(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (abs(d) < 1e-12 * (1 + dot(a, a) + dot(b, b))) return null;
  const a2 = dot(a, a), b2 = dot(b, b), c2 = dot(c, c);
  const ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  const o = P(ux, uy);
  return { t: 'circle', c: o, r: dist(o, a) };
}

// ---------- commands ----------

const is = (v, t) => {
  switch (t) {
    case 'pt': return v.t === 'pt';
    case 'num': return v.t === 'num';
    case 'lin': return isLinear(v);
    case 'line': return v.t === 'line' || v.t === 'seg' || v.t === 'ray';
    case 'circ': return v.t === 'circle';
    case 'carc': return v.t === 'circle' || v.t === 'arc';
    case 'conic': return v.t === 'conic' || v.t === 'circle';
    case 'fn': return v.t === 'fn' && !v.M;
    case 'poly': return v.t === 'poly';
    case 'vec': return v.t === 'vec';
    case 'str': return v.t === 'str';
    case 'path': return isPath(v);
    case 'any': return true;
  }
  return false;
};
const sig = (a, ...ts) => a.length === ts.length && ts.every((t, i) => is(a[i], t));
const nth = (arr, k) => (arr[k] ? toPt(arr[k]) : UNDEF);
const lineV = (t, p, d) => (len(d) > 1e-300 && finite(p) ? { t, p: P(p.x, p.y), d } : UNDEF);
const anchor = (v, p) => (v.t === 'num' && p && finite(p) ? Object.assign(v, { anchor: P(p.x, p.y) }) : v);

function polygonArea(ps) {
  let s = 0;
  for (let i = 0; i < ps.length; i++) { const a = ps[i], b = ps[(i + 1) % ps.length]; s += a.x * b.y - b.x * a.y; }
  return s / 2;
}
function centroid(ps) {
  const A = polygonArea(ps);
  if (abs(A) < 1e-14) return ps.reduce((s, p) => add(s, mul(p, 1 / ps.length)), P(0, 0));
  let cx = 0, cy = 0;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i], b = ps[(i + 1) % ps.length], f = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * f; cy += (a.y + b.y) * f;
  }
  return P(cx / (6 * A), cy / (6 * A));
}
// Oriented: counter-clockwise from a0 to a1, 0–360°. Otherwise the
// non-reflex angle (≤ 180°), which is what ∠ABC means in a proof.
function angleV(c, a0, a1, oriented) {
  let sw = normAng(a1 - a0);
  if (!oriented && sw > PI + 1e-12) { a0 = a1; sw = 2 * PI - sw; }
  return num(sw, { deg: true, arc: { c: P(c.x, c.y), a0, sw } });
}
function simpson(f, a, b, n = 2000) {
  if (a === b) return 0;
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return s * h / 3;
}
function fnDeriv(fv, ctx) {
  if (fv.body) {
    const lk = name => { const o = ctx.get(name); return o && o.t === 'fn' && o.body && !o.M ? { v: o.v, body: o.body } : null; };
    const d = derive(fv.body, fv.v, lk);
    if (d) {
      const body = simplify(d);
      return { t: 'fn', f: compileNum(body, ctx, { [fv.v]: 0 }), v: fv.v, body, dom: fv.dom };
    }
  }
  const f = x => { const h = 1e-5 * max(1, abs(x)); return (callFn(fv, x + h) - callFn(fv, x - h)) / (2 * h); };
  return { t: 'fn', f, v: 'x', dom: fv.dom };
}
const D1 = (fv, x) => { const h = 1e-6 * max(1, abs(x)); return (callFn(fv, x + h) - callFn(fv, x - h)) / (2 * h); };

function extrema(fv, x0, x1) {
  const N = 1000, h = (x1 - x0) / N, out = [];
  const f = x => callFn(fv, x);
  for (let i = 1; i < N; i++) {
    const a = f(x0 + (i - 1) * h), b = f(x0 + i * h), c = f(x0 + (i + 1) * h);
    if (![a, b, c].every(Number.isFinite)) continue;
    const isMax = b > a && b >= c, isMin = b < a && b <= c;
    if (!isMax && !isMin) continue;
    let lo = x0 + (i - 1) * h, hi = x0 + (i + 1) * h;
    const g = (sqrt(5) - 1) / 2, sgn = isMax ? -1 : 1;
    for (let k = 0; k < 60; k++) {
      const m1 = hi - g * (hi - lo), m2 = lo + g * (hi - lo);
      if (sgn * f(m1) < sgn * f(m2)) hi = m2; else lo = m1;
    }
    const x = (lo + hi) / 2;
    out.push(P(x, f(x)));
  }
  return out;
}

function tangentsConic(A, q) {
  const Q = conicMatrix(q);
  const a = [A.x, A.y, 1];
  const l = [0, 1, 2].map(i => Q[i][0] * a[0] + Q[i][1] * a[1] + Q[i][2] * a[2]);
  const n2 = l[0] * l[0] + l[1] * l[1];
  if (n2 < 1e-300) return [];
  const polar = lineFromCoef(l[0], l[1], l[2]);
  const onIt = abs(qform(Q, a, a)) < 1e-9 * (1 + dot(A, A)) * max(...Q.flat().map(abs));
  if (onIt) return [polar];
  return intersections(polar, q).map(T => lineV('line', A, sub(T, A))).filter(v => v.t !== 'undef');
}

const COMMANDS = {};
export const CANON = {};   // lower → display name
export const HELP = {};    // lower → signatures
function def(names, help, fn, raw) {
  for (const n of names.split(' ')) {
    const l = n.toLowerCase();
    COMMANDS[l] = fn; CANON[l] = n; HELP[l] = help;
    COMMAND_NAMES.add(l);
    if (raw) fn.raw = true;
  }
}

def('Point', 'Point(path, t), Point(path, (x, y)), Point(A, vector)', (a, ctx) => {
  if (a.length === 2 && isPath(a[0]) && a[1].t === 'num') {
    const pi = pathInfo(a[0], ctx.bounds);
    if (!pi || !pi.at) return UNDEF;
    let t = a[1].v;
    if (a[0].t === 'circle' || (a[0].t === 'conic' && pi.closed)) t = ((t % 1) + 1) % 1;
    else if (pi.closed) t = ((t % pi.t1) + pi.t1) % pi.t1;
    else if (a[0].t !== 'line' && a[0].t !== 'fn' && a[0].t !== 'curve') t = max(pi.t0, min(pi.t1, t));
    if (a[0].t === 'ray') t = max(0, t);
    if (a[0].t === 'curve') t = max(a[0].t0, min(a[0].t1, t));
    return toPt(pi.at(t));
  }
  if (a.length === 2 && isPath(a[0]) && a[1].t === 'pt') {
    const c = closest(a[0], a[1], ctx.bounds);
    return c ? toPt(c.p) : UNDEF;
  }
  if (sig(a, 'pt', 'vec')) return pt(a[0].x + a[1].x, a[0].y + a[1].y);
  if (sig(a, 'pt')) return a[0];
  return null;
});
def('ClosestPoint', 'ClosestPoint(path, A)', (a, ctx) => {
  if (sig(a, 'path', 'pt')) { const c = closest(a[0], a[1], ctx.bounds); return c ? toPt(c.p) : UNDEF; }
  if (sig(a, 'pt', 'path')) { const c = closest(a[1], a[0], ctx.bounds); return c ? toPt(c.p) : UNDEF; }
  return null;
});
def('Midpoint', 'Midpoint(A, B), Midpoint(segment), Midpoint(circle)', a => {
  if (sig(a, 'pt', 'pt')) return toPt(mid(a[0], a[1]));
  if (sig(a, 'lin') && a[0].t !== 'line' && a[0].t !== 'ray') { const L = lin(a[0]); return toPt(add(L.p, mul(L.d, 0.5))); }
  if (a.length === 1 && (a[0].t === 'circle' || a[0].t === 'arc')) return toPt(a[0].c);
  if (sig(a, 'conic')) { const ci = conicInfo(a[0]); return ci.c ? toPt(ci.c) : UNDEF; }
  return null;
});
def('Center Centre', 'Center(circle or conic)', a => {
  if (a.length === 1 && (a[0].t === 'circle' || a[0].t === 'arc')) return toPt(a[0].c);
  if (sig(a, 'conic')) { const ci = conicInfo(a[0]); return ci.c ? toPt(ci.c) : UNDEF; }
  return null;
});
def('Centroid', 'Centroid(polygon)', a => (sig(a, 'poly') ? toPt(centroid(a[0].pts)) : a.length >= 3 && a.every(v => v.t === 'pt') ? toPt(centroid(a)) : null));
def('Vertex', 'Vertex(polygon, n)', a => {
  if (sig(a, 'poly', 'num')) return nth(a[0].pts, Math.round(a[1].v) - 1);
  if (sig(a, 'conic')) { const ci = conicInfo(a[0]); if (ci.type === 'parabola') return toPt(parabolaAt(ci, ci.u0)); return UNDEF; }
  return null;
});
def('Line', 'Line(A, B), Line(A, line) parallel, Line(A, vector)', a => {
  if (sig(a, 'pt', 'pt')) return lineV('line', a[0], sub(a[1], a[0]));
  if (sig(a, 'pt', 'lin')) return lineV('line', a[0], lin(a[1]).d);
  if (sig(a, 'lin')) { const L = lin(a[0]); return lineV('line', L.p, L.d); }
  return null;
});
def('Segment', 'Segment(A, B), Segment(A, length)', a => {
  if (sig(a, 'pt', 'pt')) return lineV('seg', a[0], sub(a[1], a[0]));
  if (sig(a, 'pt', 'num')) return lineV('seg', a[0], P(a[1].v, 0));
  return null;
});
def('Ray', 'Ray(A, B), Ray(A, vector)', a => {
  if (sig(a, 'pt', 'pt')) return lineV('ray', a[0], sub(a[1], a[0]));
  if (sig(a, 'pt', 'vec')) return lineV('ray', a[0], a[1]);
  return null;
});
def('Vector', 'Vector(A, B), Vector(A)', a => {
  if (sig(a, 'pt', 'pt')) return { t: 'vec', x: a[1].x - a[0].x, y: a[1].y - a[0].y, o: P(a[0].x, a[0].y) };
  if (sig(a, 'pt')) return { t: 'vec', x: a[0].x, y: a[0].y, o: P(0, 0) };
  if (sig(a, 'vec')) return a[0];
  if (sig(a, 'seg')) return { t: 'vec', x: a[0].d.x, y: a[0].d.y, o: a[0].p };
  return null;
});
def('UnitVector', 'UnitVector(vector or line)', a => {
  if (sig(a, 'vec')) { const u = unit(a[0]); return { t: 'vec', x: u.x, y: u.y, o: a[0].o }; }
  if (sig(a, 'lin')) { const u = unit(lin(a[0]).d); return { t: 'vec', x: u.x, y: u.y, o: P(0, 0) }; }
  return null;
});
def('Perpendicular PerpendicularLine OrthogonalLine', 'Perpendicular(A, line)', a => {
  if (sig(a, 'pt', 'lin')) return lineV('line', a[0], perp(lin(a[1]).d));
  if (sig(a, 'lin', 'pt')) return lineV('line', a[1], perp(lin(a[0]).d));
  if (sig(a, 'vec')) return { t: 'vec', x: -a[0].y, y: a[0].x, o: a[0].o };
  return null;
});
def('Parallel ParallelLine', 'Parallel(A, line)', a => {
  if (sig(a, 'pt', 'lin')) return lineV('line', a[0], lin(a[1]).d);
  if (sig(a, 'lin', 'pt')) return lineV('line', a[1], lin(a[0]).d);
  return null;
});
def('PerpendicularBisector LineBisector', 'PerpendicularBisector(A, B), PerpendicularBisector(segment)', a => {
  if (sig(a, 'pt', 'pt')) return dist(a[0], a[1]) > 0 ? lineV('line', mid(a[0], a[1]), perp(sub(a[1], a[0]))) : UNDEF;
  if (a.length === 1 && (a[0].t === 'seg' || a[0].t === 'vec')) { const L = lin(a[0]); return lineV('line', add(L.p, mul(L.d, 0.5)), perp(L.d)); }
  return null;
});
def('AngleBisector', 'AngleBisector(A, B, C), AngleBisector(line, line, n)', a => {
  if (sig(a, 'pt', 'pt', 'pt')) {
    const u = unit(sub(a[0], a[1])), w = unit(sub(a[2], a[1]));
    let d = add(u, w);
    if (len(d) < 1e-12) d = perp(u);
    return lineV('line', a[1], d);
  }
  if ((sig(a, 'lin', 'lin') || sig(a, 'lin', 'lin', 'num'))) {
    const X = ll({ ...a[0], t: 'line' }, { ...a[1], t: 'line' })[0];
    if (!X) return UNDEF;
    const u = unit(lin(a[0]).d), w = unit(lin(a[1]).d);
    const k = a[2] ? Math.round(a[2].v) : 1;
    return lineV('line', X, k === 2 ? sub(u, w) : add(u, w));
  }
  return null;
});
def('Polygon', 'Polygon(A, B, C, …), Polygon(A, B, n) regular', a => {
  if (a.length === 3 && a[0].t === 'pt' && a[1].t === 'pt' && a[2].t === 'num') {
    const n = Math.round(a[2].v);
    if (n < 3 || n > 1000) return UNDEF;
    const ps = [P(a[0].x, a[0].y), P(a[1].x, a[1].y)];
    for (let i = 2; i < n; i++) {
      const d = sub(ps[i - 1], ps[i - 2]);
      const t = TAU / n;
      ps.push(add(ps[i - 1], P(d.x * cos(t) - d.y * sin(t), d.x * sin(t) + d.y * cos(t))));
    }
    return { t: 'poly', pts: ps, closed: true };
  }
  if (a.length >= 3 && a.every(v => v.t === 'pt')) return { t: 'poly', pts: a.map(p => P(p.x, p.y)), closed: true };
  if (a.length === 1 && a[0].t === 'pts' && a[0].pts.length >= 3) return { t: 'poly', pts: a[0].pts, closed: true };
  return null;
});
def('Polyline', 'Polyline(A, B, …)', a => (a.length >= 2 && a.every(v => v.t === 'pt') ? { t: 'poly', pts: a.map(p => P(p.x, p.y)), closed: false } : null));
def('Circle', 'Circle(A, r), Circle(A, B), Circle(A, B, C), Circle(A, segment)', a => {
  if (sig(a, 'pt', 'num')) return a[1].v >= 0 ? { t: 'circle', c: P(a[0].x, a[0].y), r: abs(a[1].v) } : UNDEF;
  if (sig(a, 'pt', 'pt')) return { t: 'circle', c: P(a[0].x, a[0].y), r: dist(a[0], a[1]) };
  if (sig(a, 'pt', 'seg')) return { t: 'circle', c: P(a[0].x, a[0].y), r: len(a[1].d) };
  if (sig(a, 'pt', 'pt', 'pt')) return circle3(a[0], a[1], a[2]) || UNDEF;
  return null;
});
def('Incircle', 'Incircle(A, B, C)', a => {
  if (!sig(a, 'pt', 'pt', 'pt')) return null;
  const [A, B, C] = a, la = dist(B, C), lb = dist(A, C), lc2 = dist(A, B), s = la + lb + lc2;
  if (s === 0) return UNDEF;
  const I = P((la * A.x + lb * B.x + lc2 * C.x) / s, (la * A.y + lb * B.y + lc2 * C.y) / s);
  const r = abs(polygonArea([A, B, C])) * 2 / s;
  return r > 0 ? { t: 'circle', c: I, r } : UNDEF;
});
def('Semicircle', 'Semicircle(A, B)', a => {
  if (!sig(a, 'pt', 'pt')) return null;
  const m = mid(a[0], a[1]);
  return { t: 'arc', c: m, r: dist(a[0], a[1]) / 2, a0: ang(sub(a[0], m)), sw: PI, sector: false };
});
function arcCO(a, sector) {
  if (!sig(a, 'pt', 'pt', 'pt')) return null;
  const [O, A, B] = a;
  const r = dist(O, A);
  if (r === 0) return UNDEF;
  const a0 = ang(sub(A, O));
  return { t: 'arc', c: P(O.x, O.y), r, a0, sw: normAng(ang(sub(B, O)) - a0) || TAU, sector };
}
function arc3(a, sector) {
  if (!sig(a, 'pt', 'pt', 'pt')) return null;
  const c = circle3(a[0], a[1], a[2]);
  if (!c) return UNDEF;
  const tA = ang(sub(a[0], c.c)), tB = ang(sub(a[1], c.c)), tC = ang(sub(a[2], c.c));
  const swAC = normAng(tC - tA), swAB = normAng(tB - tA);
  if (swAB <= swAC) return { t: 'arc', c: c.c, r: c.r, a0: tA, sw: swAC, sector };
  return { t: 'arc', c: c.c, r: c.r, a0: tC, sw: TAU - swAC, sector };
}
def('CircularArc', 'CircularArc(center, A, B)', a => arcCO(a, false));
def('CircularSector', 'CircularSector(center, A, B)', a => arcCO(a, true));
def('CircumcircularArc', 'CircumcircularArc(A, B, C)', a => arc3(a, false));
def('CircumcircularSector', 'CircumcircularSector(A, B, C)', a => arc3(a, true));
function focal(a, hyper) {
  if (!(sig(a, 'pt', 'pt', 'num') || sig(a, 'pt', 'pt', 'pt'))) return null;
  const [F1, F2] = a;
  const c = dist(F1, F2) / 2;
  let A = a[2].t === 'num' ? a[2].v : (hyper ? abs(dist(a[2], F1) - dist(a[2], F2)) : dist(a[2], F1) + dist(a[2], F2)) / 2;
  A = abs(A);
  const C = mid(F1, F2);
  const e1 = c > 0 ? unit(sub(F2, F1)) : P(1, 0);
  if (!hyper) { if (A <= c) return UNDEF; return conicFromAxes(C, e1, 1 / (A * A), 1 / (A * A - c * c)); }
  if (A >= c || A === 0) return UNDEF;
  return conicFromAxes(C, e1, 1 / (A * A), -1 / (c * c - A * A));
}
def('Ellipse', 'Ellipse(F1, F2, a), Ellipse(F1, F2, P)', a => focal(a, false));
def('Hyperbola', 'Hyperbola(F1, F2, a), Hyperbola(F1, F2, P)', a => focal(a, true));
def('Parabola', 'Parabola(focus, directrix)', a => {
  if (!sig(a, 'pt', 'lin')) return null;
  const L = lin(a[1]), n = unit(perp(L.d)), k = dot(n, L.p), F = a[0];
  if (abs(dot(n, F) - k) < 1e-14) return UNDEF;
  return conicV([1 - n.x * n.x, -2 * n.x * n.y, 1 - n.y * n.y, -2 * F.x + 2 * k * n.x, -2 * F.y + 2 * k * n.y, F.x * F.x + F.y * F.y - k * k]);
});
def('Conic', 'Conic(A, B, C, D, E)', a => (a.length === 5 && a.every(v => v.t === 'pt') ? conicThrough(a) : null));
def('Intersect Intersection', 'Intersect(a, b), Intersect(a, b, n)', (a, ctx) => {
  if (a.length >= 2 && a[0].t !== 'num' && a[1].t !== 'num') {
    if ((a[0].t === 'pt' || a[1].t === 'pt')) return null;
    const ps = intersections(a[0], a[1], ctx.bounds);
    if (a.length === 3 && a[2].t === 'num') return nth(ps, Math.round(a[2].v) - 1);
    if (a.length === 2) return ps.length === 1 ? toPt(ps[0]) : { t: 'pts', pts: ps };
  }
  if (a.length === 4 && is(a[0], 'fn') && is(a[1], 'fn') && a[2].t === 'num' && a[3].t === 'num') {
    const h = x => callFn(a[0], x) - callFn(a[1], x);
    const r = rootsOf(h, a[2].v, a[3].v, 2000);
    return { t: 'pts', pts: r.map(x => P(x, callFn(a[0], x))) };
  }
  return null;
});
def('Tangent', 'Tangent(A, circle|conic|f), Tangent(x0, f)', (a, ctx) => {
  const k = a[2] && a[2].t === 'num' ? Math.round(a[2].v) - 1 : 0;
  if ((sig(a, 'pt', 'fn') || sig(a, 'num', 'fn'))) {
    const x0 = a[0].t === 'num' ? a[0].v : a[0].x;
    const y0 = callFn(a[1], x0), m = D1(a[1], x0);
    return Number.isFinite(y0) && Number.isFinite(m) ? lineV('line', P(x0, y0), unit(P(1, m))) : UNDEF;
  }
  if (a.length >= 2 && a[0].t === 'pt' && is(a[1], 'conic')) return tangentsConic(a[0], a[1])[k] || UNDEF;
  if (a.length >= 2 && is(a[0], 'conic') && a[1].t === 'pt') return tangentsConic(a[1], a[0])[k] || UNDEF;
  return null;
});
def('Polar', 'Polar(A, conic)', a => {
  if (!sig(a, 'pt', 'conic')) return null;
  const Q = conicMatrix(a[1]), v = [a[0].x, a[0].y, 1];
  const l = [0, 1, 2].map(i => Q[i][0] * v[0] + Q[i][1] * v[1] + Q[i][2] * v[2]);
  return l[0] || l[1] ? lineFromCoef(l[0], l[1], l[2]) : UNDEF;
});
def('Asymptote', 'Asymptote(hyperbola, n)', a => {
  if (!(sig(a, 'conic') || sig(a, 'conic', 'num')) || a[0].t !== 'conic') return null;
  const ci = conicInfo(a[0]);
  if (ci.type !== 'hyperbola') return UNDEF;
  const s = a[1] && Math.round(a[1].v) === 2 ? -1 : 1;
  return lineV('line', ci.c, add(mul(ci.e1, ci.a), mul(ci.e2, s * ci.b)));
});
def('Focus', 'Focus(conic, n)', a => {
  if (!(sig(a, 'conic') || sig(a, 'conic', 'num'))) return null;
  if (a[0].t === 'circle') return toPt(a[0].c);
  const ci = conicInfo(a[0]), s = a[1] && Math.round(a[1].v) === 2 ? -1 : 1;
  if (ci.type === 'ellipse') {
    const big = ci.a >= ci.b, c = sqrt(abs(ci.a * ci.a - ci.b * ci.b));
    return toPt(add(ci.c, mul(big ? ci.e1 : ci.e2, s * c)));
  }
  if (ci.type === 'hyperbola') return toPt(add(ci.c, mul(ci.e1, s * sqrt(ci.a * ci.a + ci.b * ci.b))));
  if (ci.type === 'parabola') {
    // v = -(λu² + D'u + F)/E' : vertex form v - v0 = (-λ/E')(u - u0)², p = E'/(-4λ)
    const V0 = parabolaAt(ci, ci.u0), f = -ci.Ep / (4 * ci.l);
    return toPt(add(V0, mul(ci.e2, f)));
  }
  return UNDEF;
});
function angleCmd(oriented) {
  return a => {
    if (sig(a, 'pt', 'pt', 'pt')) {
      if (dist(a[0], a[1]) === 0 || dist(a[2], a[1]) === 0) return UNDEF;
      return angleV(a[1], ang(sub(a[0], a[1])), ang(sub(a[2], a[1])), oriented);
    }
    if (sig(a, 'lin', 'lin')) {
      const X = ll({ ...a[0], t: 'line' }, { ...a[1], t: 'line' })[0];
      const A = lin(a[0]), B = lin(a[1]);
      if (!X) return num(0, { deg: true });
      return angleV(X, ang(A.d), ang(B.d), oriented);
    }
    if (sig(a, 'vec', 'vec')) return angleV(a[0].o || P(0, 0), ang(a[0]), ang(a[1]), oriented);
    if (sig(a, 'vec') || sig(a, 'pt')) return angleV(a[0].o || P(0, 0), 0, ang(a[0]), true);
    if (sig(a, 'num')) return num(a[0].v, { deg: true });
    return null;
  };
}
def('Angle', 'Angle(A, B, C) — ∠ABC, at most 180°; Angle(line, line), Angle(vector)', angleCmd(false));
def('OrientedAngle', 'OrientedAngle(A, B, C) — counter-clockwise from BA to BC, 0–360°', angleCmd(true));
def('Distance', 'Distance(A, B), Distance(A, line)', (a, ctx) => {
  if (sig(a, 'pt', 'pt')) return anchor(num(dist(a[0], a[1])), mid(a[0], a[1]));
  const pp = a[0] && a[0].t === 'pt' ? [a[0], a[1]] : [a[1], a[0]];
  if (a.length === 2 && pp[0] && pp[0].t === 'pt' && pp[1] && isPath(pp[1])) {
    const c = closest(pp[1], pp[0], ctx.bounds);
    return c ? anchor(num(c.d), mid(c.p, pp[0])) : UNDEF;
  }
  if (sig(a, 'lin', 'lin')) {
    const A = lin(a[0]), B = lin(a[1]);
    if (abs(crs(unit(A.d), unit(B.d))) > 1e-12) return num(0);
    return num(abs(crs(unit(A.d), sub(B.p, A.p))));
  }
  return null;
});
def('Length', 'Length(segment|vector|arc|polygon|circle)', (a, ctx) => {
  if (a.length !== 1) return sig(a, 'pt', 'pt') ? num(dist(a[0], a[1])) : null;
  const v = a[0];
  if (v.t === 'seg') return anchor(num(len(v.d)), add(v.p, mul(v.d, 0.5)));
  if (v.t === 'vec') return anchor(num(len(v)), add(v.o || P(0, 0), mul(v, 0.5)));
  if (v.t === 'pt') return num(len(v));
  if (v.t === 'arc') return anchor(num(v.r * v.sw), arcEnd(v, 0.5));
  if (v.t === 'circle') return anchor(num(TAU * v.r), add(v.c, P(0, v.r)));
  if (v.t === 'poly') return anchor(num(edges(v).reduce((s, e) => s + len(e.d), 0)), centroid(v.pts));
  if (v.t === 'locus') return num(edges(v).reduce((s, e) => s + len(e.d), 0));
  if (v.t === 'line' || v.t === 'ray') return num(Infinity);
  return null;
});
def('Perimeter', 'Perimeter(polygon)', a => (a.length === 1 && a[0].t === 'poly' ? anchor(num(edges({ ...a[0], closed: true }).reduce((s, e) => s + len(e.d), 0)), centroid(a[0].pts)) : sig(a, 'circ') ? num(TAU * a[0].r) : null));
def('Circumference', 'Circumference(circle)', a => (sig(a, 'circ') ? anchor(num(TAU * a[0].r), add(a[0].c, P(0, a[0].r))) : sig(a, 'conic') ? ellipseCirc(a[0]) : null));
function ellipseCirc(v) {
  const ci = conicInfo(v);
  if (ci.type !== 'ellipse') return UNDEF;
  const h = ((ci.a - ci.b) / (ci.a + ci.b)) ** 2;
  return num(PI * (ci.a + ci.b) * (1 + 3 * h / (10 + sqrt(4 - 3 * h))));
}
def('Area', 'Area(polygon|circle|ellipse|sector), Area(A, B, C, …)', a => {
  if (a.length >= 3 && a.every(v => v.t === 'pt')) return anchor(num(abs(polygonArea(a))), centroid(a));
  if (a.length !== 1) return null;
  const v = a[0];
  if (v.t === 'poly') return anchor(num(abs(polygonArea(v.pts))), centroid(v.pts));
  if (v.t === 'circle') return anchor(num(PI * v.r * v.r), v.c);
  if (v.t === 'arc') return anchor(num(v.sector ? v.r * v.r * v.sw / 2 : v.r * v.r * (v.sw - sin(v.sw)) / 2), arcEnd({ ...v, r: v.r * 0.6 }, 0.5));
  if (v.t === 'conic') { const ci = conicInfo(v); return ci.type === 'ellipse' ? anchor(num(PI * ci.a * ci.b), ci.c) : UNDEF; }
  return null;
});
def('Radius', 'Radius(circle)', a => (a.length === 1 && (a[0].t === 'circle' || a[0].t === 'arc') ? num(a[0].r) : null));
def('Slope', 'Slope(line)', a => {
  if (!sig(a, 'lin')) return null;
  const L = lin(a[0]);
  return abs(L.d.x) < 1e-14 ? UNDEF : anchor(num(L.d.y / L.d.x), add(L.p, mul(L.d, a[0].t === 'line' ? 0 : 0.5)));
});
def('Dot', 'Dot(u, v)', a => (a.length === 2 && a.every(v => v.t === 'vec' || v.t === 'pt') ? num(dot(a[0], a[1])) : null));
def('Cross', 'Cross(u, v)', a => (a.length === 2 && a.every(v => v.t === 'vec' || v.t === 'pt') ? num(crs(a[0], a[1])) : null));

function needsObj(v) { return v.t !== 'num' && v.t !== 'str' && v.t !== 'bool'; }
def('Reflect Mirror Invert', 'Reflect(object, line|point|circle) — a circle means inversion', (a, ctx) => {
  if (a.length !== 2 || !needsObj(a[0])) return null;
  if (isLinear(a[1]) && a[1].t !== 'vec') return transform(a[0], mReflectLine(a[1]));
  if (a[1].t === 'pt') return transform(a[0], mDilate(-1, a[1]));
  if (a[1].t === 'circle') return invert(a[0], a[1], ctx.bounds);
  return null;
});
def('Rotate', 'Rotate(object, angle), Rotate(object, angle, point)', a => {
  if (sig(a, 'any', 'num') && needsObj(a[0])) return transform(a[0], mRotate(a[1].v, P(0, 0)));
  if (sig(a, 'any', 'num', 'pt') && needsObj(a[0])) return transform(a[0], mRotate(a[1].v, a[2]));
  return null;
});
def('Translate', 'Translate(object, vector), Translate(object, A, B)', a => {
  if (sig(a, 'vec', 'pt')) return { ...a[0], o: P(a[1].x, a[1].y) };
  if (sig(a, 'any', 'vec') && needsObj(a[0])) return transform(a[0], mTranslate(a[1]));
  if (sig(a, 'any', 'pt', 'pt') && needsObj(a[0])) return transform(a[0], mTranslate(sub(a[2], a[1])));
  return null;
});
def('Dilate', 'Dilate(object, factor), Dilate(object, factor, point)', a => {
  if (sig(a, 'any', 'num') && needsObj(a[0])) return transform(a[0], mDilate(a[1].v, P(0, 0)));
  if (sig(a, 'any', 'num', 'pt') && needsObj(a[0])) return transform(a[0], mDilate(a[1].v, a[2]));
  return null;
});
def('Derivative', 'Derivative(f), Derivative(f, n)', (a, ctx) => {
  if (!(sig(a, 'fn') || sig(a, 'fn', 'num'))) return null;
  let f = a[0];
  for (let i = 0; i < (a[1] ? Math.round(a[1].v) : 1); i++) f = fnDeriv(f, ctx);
  return f;
});
def('Integral', 'Integral(f, a, b), Integral(f)', a => {
  if (sig(a, 'fn', 'num', 'num')) {
    const fv = a[0], x0 = a[1].v, x1 = a[2].v;
    const v = simpson(x => callFn(fv, x), x0, x1);
    return num(v, { shade: { f: fv, a: x0, b: x1 }, anchor: P((x0 + x1) / 2, callFn(fv, (x0 + x1) / 2) / 2) });
  }
  if (sig(a, 'fn')) { const fv = a[0]; return { t: 'fn', f: x => simpson(t => callFn(fv, t), 0, x, 200), v: 'x' }; }
  return null;
});
def('IntegralBetween', 'IntegralBetween(f, g, a, b)', a => {
  if (!sig(a, 'fn', 'fn', 'num', 'num')) return null;
  const [f, g] = a, x0 = a[2].v, x1 = a[3].v;
  const v = simpson(x => callFn(f, x) - callFn(g, x), x0, x1);
  const xm = (x0 + x1) / 2;
  return num(v, { shade: { f, g, a: x0, b: x1 }, anchor: P(xm, (callFn(f, xm) + callFn(g, xm)) / 2) });
});
def('Function', 'Function(f, a, b)', a => (sig(a, 'fn', 'num', 'num') ? { ...a[0], dom: [min(a[1].v, a[2].v), max(a[1].v, a[2].v)] } : null));
def('Root Roots Zero', 'Root(f), Root(f, x0), Root(f, a, b)', (a, ctx) => {
  if (!a.length || !is(a[0], 'fn')) return null;
  const fv = a[0], f = x => callFn(fv, x);
  if (a.length === 2 && a[1].t === 'num') {
    let x = a[1].v;
    for (let i = 0; i < 60; i++) { const d = D1(fv, x); if (!d) break; const nx = x - f(x) / d; if (!Number.isFinite(nx)) break; if (abs(nx - x) < 1e-14) { x = nx; break; } x = nx; }
    return abs(f(x)) < 1e-8 ? pt(x, 0) : UNDEF;
  }
  const [x0, x1] = a.length === 3 ? [a[1].v, a[2].v] : fnRange(fv, ctx.bounds || DEFAULT_BOUNDS);
  const r = rootsOf(f, x0, x1, 2000).map(x => P(x, 0));
  return r.length === 1 ? toPt(r[0]) : { t: 'pts', pts: r };
});
def('Extremum', 'Extremum(f), Extremum(f, a, b)', (a, ctx) => {
  if (!a.length || !is(a[0], 'fn')) return null;
  const [x0, x1] = a.length === 3 ? [a[1].v, a[2].v] : fnRange(a[0], ctx.bounds || DEFAULT_BOUNDS);
  const r = extrema(a[0], x0, x1);
  return r.length === 1 ? toPt(r[0]) : { t: 'pts', pts: r };
});
def('Text', 'Text("…"), Text("…", A)', a => {
  if (!a.length || a.length > 2) return null;
  const s = toText(a[0]);
  if (a[1] && a[1].t !== 'pt') return null;
  return { t: 'text', s, pos: a[1] ? P(a[1].x, a[1].y) : null };
});
def('If', 'If(condition, a, b)', (a, ctx) => null);
COMMANDS.if = (n, ctx) => {
  const c = evaluate(n[0], ctx);
  if (c.t === 'undef') return UNDEF;
  if (truthy(c)) return evaluate(n[1], ctx);
  return n[2] ? evaluate(n[2], ctx) : UNDEF;
};
COMMANDS.if.raw = true;
def('Curve', 'Curve(x(t), y(t), t, a, b)', (n, ctx) => {
  if (n.length !== 5 || n[2].k !== 'id') throw new EvalError('Use Curve(x(t), y(t), t, start, end)');
  const v = n[2].n, slots = { [v]: 0 };
  const t0 = evaluate(n[3], ctx), t1 = evaluate(n[4], ctx);
  if (t0.t !== 'num' || t1.t !== 'num') return UNDEF;
  return { t: 'curve', fx: compileNum(n[0], ctx, slots), fy: compileNum(n[1], ctx, slots), t0: t0.v, t1: t1.v };
}, true);
def('Locus', 'Locus(P, Q) — Q a point on a path, or a slider', (n, ctx) => {
  if (n.length !== 2 || n[0].k !== 'id' || n[1].k !== 'id') throw new EvalError('Use Locus(point, point on path or slider)');
  if (!ctx.locus) return UNDEF;
  return ctx.locus(n[0].n, n[1].n);
}, true);
def('Slider', 'Slider(min, max, step)', a => (a.length >= 2 && a.every(v => v.t === 'num') ? num((a[0].v + a[1].v) / 2) : null));

// ---------- text / description ----------

export function toText(v, digits = 2) {
  switch (v.t) {
    case 'num': return v.deg ? fmtNum(v.v * 180 / PI, digits) + '°' : fmtNum(v.v, digits);
    case 'str': return v.v;
    case 'bool': return String(v.v);
    case 'pt': return `(${fmtNum(v.x, digits)}, ${fmtNum(v.y, digits)})`;
    case 'undef': return '?';
  }
  return describe(v, digits) || '';
}

function terms(list, rhs, digits) {
  // list: [[coef, symbol]] → "2x − y = 3"
  let s = '';
  for (const [c0, sym] of list) {
    const c = +fmtNum(c0, digits);
    if (c === 0) continue;
    const a = abs(c), sg = c < 0 ? '−' : '+';
    const coef = sym && a === 1 ? '' : fmtNum(a, digits);
    s += s ? ` ${sg} ${coef}${sym}` : `${c < 0 ? '−' : ''}${coef}${sym}`;
  }
  const r = +fmtNum(rhs, digits);
  return `${s || '0'} = ${r < 0 ? '−' + fmtNum(-r, digits) : fmtNum(r, digits)}`;
}
const shift = (v, s, digits) => {
  const c = +fmtNum(v, digits);
  return c === 0 ? s : `(${s} ${c > 0 ? '−' : '+'} ${fmtNum(abs(c), digits)})`;
};

// Human-readable value for the algebra view. Null = show the definition.
export function describe(v, digits = 2) {
  const F = x => fmtNum(x, digits).replace(/^-/, '−');
  switch (v.t) {
    case 'undef': return 'undefined';
    case 'num': return toText(v, digits).replace(/^-/, '−');
    case 'bool': return String(v.v);
    case 'str': return v.v;
    case 'pt': return `(${F(v.x)}, ${F(v.y)})`;
    case 'vec': return `(${F(v.x)}, ${F(v.y)})`;
    case 'pts': return `{${v.pts.map(p => `(${F(p.x)}, ${F(p.y)})`).join(', ')}}`;
    case 'seg': return F(len(v.d));
    case 'line': case 'ray': {
      const { p, d } = v;
      if (abs(d.x) < 1e-12 * len(d)) return `x = ${F(p.x)}`;
      const m = d.y / d.x, b = p.y - m * p.x;
      if (abs(m) < 1e-12) return `y = ${F(b)}`;
      const mm = +fmtNum(m, digits);
      const ms = mm === 1 ? '' : mm === -1 ? '−' : F(m);
      const bb = +fmtNum(b, digits);
      return `y = ${ms}x${bb === 0 ? '' : bb > 0 ? ' + ' + F(b) : ' − ' + F(-b)}`;
    }
    case 'circle': return `${shift(v.c.x, 'x', digits)}² + ${shift(v.c.y, 'y', digits)}² = ${F(v.r * v.r)}`.replace(/\((x|y)\)/g, '$1');
    case 'arc': return F(v.sector ? v.r * v.r * v.sw / 2 : v.r * v.sw);
    case 'poly': return v.closed ? F(abs(polygonArea(v.pts))) : F(edges(v).reduce((s, e) => s + len(e.d), 0));
    case 'conic': {
      let [A, B, C, D, E, F0] = v.m;
      const lead = [A, C, B].find(x => abs(x) > 1e-12) || 1;
      const k = 1 / lead;
      [A, B, C, D, E, F0] = [A, B, C, D, E, F0].map(x => x * k);
      return terms([[A, 'x²'], [B, 'xy'], [C, 'y²'], [D, 'x'], [E, 'y']], -F0, digits);
    }
    case 'fn': return v.body && !v.M ? print(v.body, { digits, pretty: true }) : null;
    case 'text': return v.s;
    case 'locus': return 'locus';
  }
  return null;
}

// Shared with js/olympiad.js, which registers more commands into the table.
export { def, sig, is, lin, lineV, anchor, toPt, ll, cc, lc, lineFromCoef, tangentsConic, conicMatrix, qform, circle3, polygonArea, centroid, angleV, P };
