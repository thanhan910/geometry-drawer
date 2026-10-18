// The construction: an ordered list of named objects, each defined by an AST.
// Free objects (number or point literals) are what the user drags; everything
// else is recomputed from its definition, in dependency order.

import { parseStatement, parseExpr, print, names as astNames, rename as astRename, clone, VARS } from './expr.js';
import { evaluate, UNDEF, EvalError, pathInfo, closest, DEFAULT_BOUNDS, isPath } from './geom.js';
import './olympiad.js';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWZ';
const LOWER = 'fghpqrsklmnabcdtuvwz'.split('');
const SEGS = 'abcdijklmnopqrstuvwz'.split('');
const VEC = 'uvwabcdz'.split('');
const GREEKS = 'αβγδεζηθικμνξρστφχψω'.split('');
const NUMS = 'abcdkmnpqrstuvw'.split('');

export const isNumLit = n => n.k === 'num' || (n.k === 'un' && n.op === '-' && n.e.k === 'num') ||
  (n.k === 'deg' && (n.e.k === 'num' || (n.e.k === 'un' && n.e.op === '-' && n.e.e.k === 'num')));
const numOf = n => (n.k === 'num' ? n.v : -n.e.v);
export const isPtLit = n => n.k === 'pt' && isNumLit(n.x) && isNumLit(n.y);

export class Construction {
  constructor() {
    this.objs = [];
    this.byName = new Map();
    this.bounds = { ...DEFAULT_BOUNDS };
    this.onChange = null;
  }

  // ---------- naming ----------

  has(name) { return this.byName.has(name); }
  get(name) { return this.byName.get(name); }

  freshName(kind, hint, extra) {
    const used = n => this.byName.has(n) || (extra && extra.has(n)) || VARS.has(n) || n === 'e' || n === 'pi';
    const fromPool = pool => {
      for (let k = 0; ; k++) for (const c of pool) { const n = k ? `${c}_${k}` : c; if (!used(n)) return n; }
    };
    if (hint && !used(hint)) return hint;
    if (hint) for (let k = 1; ; k++) if (!used(`${hint}_${k}`)) return `${hint}_${k}`;
    switch (kind) {
      case 'pt': case 'pts': return fromPool(LETTERS.split(''));
      case 'vec': return fromPool(VEC);
      case 'seg': return fromPool(SEGS);
      case 'angle': return fromPool(GREEKS);
      case 'num': return fromPool(NUMS);
      case 'poly': for (let k = 1; ; k++) if (!used(`poly${k}`)) return `poly${k}`;
      case 'text': for (let k = 1; ; k++) if (!used(`text${k}`)) return `text${k}`;
      default: return fromPool(LOWER);
    }
  }

  // ---------- context for evaluation ----------

  ctx(overrides) {
    return {
      get: n => {
        if (overrides && overrides.has(n)) return overrides.get(n);
        const o = this.byName.get(n);
        return o ? o.val : undefined;
      },
      bounds: this.bounds,
      locus: (p, q) => this.locus(p, q),
    };
  }

  deps(ast) {
    const out = new Set();
    for (const n of astNames(ast)) {
      if (this.byName.has(n)) out.add(n);
      else if (n.length > 1 && !/^(pi|e)$/.test(n)) for (const ch of n) if (this.byName.has(ch)) out.add(ch);
    }
    return out;
  }

  // ---------- create / redefine / delete ----------

  // Evaluate a definition without adding it. Throws on errors.
  tryEval(ast, overrides) { return evaluate(ast, this.ctx(overrides)); }

  add(name, ast, style = {}) {
    if (!name) throw new EvalError('Missing name');
    if (this.byName.has(name)) throw new EvalError(`"${name}" already exists`);
    if (VARS.has(name)) throw new EvalError(`"${name}" is reserved`);
    const deps = this.deps(ast);
    if (deps.has(name)) throw new EvalError(`${name} cannot depend on itself`);
    const val = this.tryEval(ast);
    const o = { name, ast, deps, val, style: { ...style } };
    this.objs.push(o);
    this.byName.set(name, o);
    return o;
  }

  // Parse one input-bar line and create or redefine. Returns the object.
  exec(src, defaultStyle) {
    const { name, ast } = parseStatement(src);
    if (name && this.byName.has(name)) { this.redefine(name, ast); return this.byName.get(name); }
    const val = this.tryEval(ast);
    const kind = kindOf(val, ast);
    const n = name || this.freshName(kind);
    return this.add(n, ast, defaultStyle ? defaultStyle(val, ast, n) : {});
  }

  redefine(name, ast) {
    const o = this.byName.get(name);
    const deps = this.deps(ast);
    const desc = this.descendants([name]);
    for (const d of deps) if (desc.has(d)) throw new EvalError(`Circular definition: ${name} would depend on ${d}`);
    const val = this.tryEval(ast);
    o.ast = ast; o.deps = deps; o.val = val;
    this.sort();
    this.recompute();
  }

  descendants(namesIn) {
    const set = new Set(namesIn);
    for (const o of this.objs) if ([...o.deps].some(d => set.has(d))) set.add(o.name);
    return set;
  }
  ancestors(name) {
    const set = new Set();
    const rec = n => { const o = this.byName.get(n); if (!o) return; for (const d of o.deps) if (!set.has(d)) { set.add(d); rec(d); } };
    rec(name);
    return set;
  }

  remove(namesIn) {
    // Objects created before their dependants: one pass is a full closure
    // only if the list is sorted, which sort() guarantees.
    const kill = this.descendants(namesIn);
    this.objs = this.objs.filter(o => !kill.has(o.name));
    for (const n of kill) this.byName.delete(n);
    return kill;
  }

  rename(from, to) {
    if (from === to) return;
    if (!/^[A-Za-zα-ωΑ-Ω][A-Za-z0-9_α-ωΑ-Ω]*'*$/.test(to)) throw new EvalError('Names start with a letter and use letters, digits and _');
    if (this.byName.has(to)) throw new EvalError(`"${to}" already exists`);
    if (VARS.has(to)) throw new EvalError(`"${to}" is reserved`);
    const o = this.byName.get(from);
    o.name = to;
    this.byName.delete(from); this.byName.set(to, o);
    for (const q of this.objs) {
      if (q.deps.has(from)) { astRename(q.ast, from, to); q.deps = this.deps(q.ast); }
    }
  }

  // Topological order, stable with respect to the current order.
  sort() {
    const out = [], seen = new Set(), on = new Set();
    const visit = o => {
      if (seen.has(o.name)) return;
      if (on.has(o.name)) throw new EvalError('Circular definition');
      on.add(o.name);
      for (const d of o.deps) { const q = this.byName.get(d); if (q) visit(q); }
      on.delete(o.name); seen.add(o.name); out.push(o);
    };
    this.objs.forEach(visit);
    this.objs = out;
  }

  recompute(from) {
    const ctx = this.ctx();
    const dirty = from ? this.descendants(from) : null;
    for (const o of this.objs) {
      if (dirty && !dirty.has(o.name)) continue;
      try { o.val = evaluate(o.ast, ctx); } catch { o.val = UNDEF; }
      if (o.style.trace && o.val.t === 'pt' && !this.noTrace) {
        const tr = (o.trace ||= []), last = tr[tr.length - 1];
        if (!last || last.x !== o.val.x || last.y !== o.val.y) tr.push({ x: o.val.x, y: o.val.y });
      }
    }
  }

  // ---------- free objects ----------

  isFreePoint(o) { return o && isPtLit(o.ast) && !o.style.fixed; }
  isFreeNum(o) { return o && isNumLit(o.ast) && !o.style.fixed; }
  isFreeText(o) { return o && o.ast.k === 'call' && /^text$/i.test(o.ast.f) && o.ast.a[1] && isPtLit(o.ast.a[1]) && !o.style.fixed; }
  // Point(path, t) or Point(path, (x, y)): slides along its path.
  isOnPath(o) {
    return o && o.ast.k === 'call' && /^point$/i.test(o.ast.f) && o.ast.a.length === 2 &&
      o.ast.a[0].k === 'id' && (isNumLit(o.ast.a[1]) || isPtLit(o.ast.a[1])) && !o.style.fixed;
  }
  movable(o) { return this.isFreePoint(o) || this.isOnPath(o) || this.isFreeText(o); }

  setPoint(o, x, y) {
    o.ast = { k: 'pt', x: { k: 'num', v: x }, y: { k: 'num', v: y } };
  }
  setNum(o, v) { o.ast = { k: 'num', v }; }

  // Move a point-on-path towards (x, y).
  slide(o, x, y) {
    const path = this.byName.get(o.ast.a[0].n);
    if (!path || !isPath(path.val)) return;
    if (isPtLit(o.ast.a[1])) {
      o.ast.a[1] = { k: 'pt', x: { k: 'num', v: x }, y: { k: 'num', v: y } };
      const c = closest(path.val, { x, y }, this.bounds);
      if (c) o.ast.a[1] = { k: 'pt', x: { k: 'num', v: c.p.x }, y: { k: 'num', v: c.p.y } };
      return;
    }
    const c = closest(path.val, { x, y }, this.bounds);
    if (c) o.ast.a[1] = { k: 'num', v: c.t };
  }

  // Free points an object is built from, so dragging a segment or polygon
  // moves its corners. Null when nothing (or a sliding point) is involved.
  freeAncestors(name) {
    const out = [];
    for (const n of this.ancestors(name)) {
      const o = this.byName.get(n);
      if (this.isOnPath(o)) return null;
      if (this.isFreePoint(o)) out.push(o);
    }
    return out.length ? out : null;
  }

  // ---------- locus ----------

  locus(pName, qName) {
    const Pobj = this.byName.get(pName), Q = this.byName.get(qName);
    if (!Pobj || !Q) return UNDEF;
    const anc = this.ancestors(pName);
    if (!anc.has(qName)) return UNDEF;
    const desc = this.descendants([qName]);
    const chain = this.objs.filter(o => o !== Q && desc.has(o.name) && (anc.has(o.name) || o === Pobj));
    let samples;
    if (this.isOnPath(Q) || (Q.ast.k === 'call' && /^point$/i.test(Q.ast.f))) {
      const path = this.byName.get(Q.ast.a[0].n);
      if (!path) return UNDEF;
      const pi = pathInfo(path.val, this.bounds);
      if (!pi || !pi.at) return UNDEF;
      const N = 400;
      samples = Array.from({ length: N + 1 }, (_, i) => {
        const p = pi.at(pi.t0 + (pi.t1 - pi.t0) * i / N);
        return { t: 'pt', x: p.x, y: p.y };
      });
    } else if (isNumLit(Q.ast)) {
      const s = Q.style.slider || { min: -5, max: 5 };
      const N = 300;
      samples = Array.from({ length: N + 1 }, (_, i) => ({ t: 'num', v: s.min + (s.max - s.min) * i / N, deg: Q.val.deg }));
    } else return UNDEF;
    const pts = [];
    const ov = new Map();
    const ctx = this.ctx(ov);
    const diag = Math.hypot(this.bounds.xmax - this.bounds.xmin, this.bounds.ymax - this.bounds.ymin);
    let prev = null;
    for (const s of samples) {
      ov.clear();
      ov.set(qName, s);
      let v;
      try {
        for (const o of chain) ov.set(o.name, evaluate(o.ast, ctx));
        v = ov.get(pName);
      } catch { v = UNDEF; }
      if (!v || v.t !== 'pt') { if (prev) pts.push(null); prev = null; continue; }
      const p = { x: v.x, y: v.y };
      if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) > diag * 0.25) pts.push(null);
      pts.push(p);
      prev = p;
    }
    return { t: 'locus', pts };
  }

  // ---------- serialisation ----------

  toJSON() {
    return this.objs.map(o => {
      const r = { n: o.name, d: print(o.ast) };
      if (o.ast.k === 'fn') r.d = `${o.name}(${o.ast.v}) = ${r.d}`;
      const s = { ...o.style };
      if (Object.keys(s).length) r.s = s;
      return r;
    });
  }

  load(list) {
    this.objs = []; this.byName.clear();
    const errors = [];
    for (const r of list) {
      try {
        const st = parseStatement(r.d.startsWith(r.n + '(') ? r.d : `${r.n} = ${r.d}`);
        let ast = st.ast;
        if (st.name !== r.n) {
          // equations: "y = 2x" parses as unnamed; force the saved name
          ast = parseStatement(`${r.n}: ${r.d}`).ast;
        }
        this.add(r.n, ast, r.s || {});
      } catch (e) {
        errors.push(`${r.n}: ${e.message}`);
      }
    }
    this.sort();
    this.recompute();
    return errors;
  }
}

export function kindOf(val, ast) {
  if (val.t === 'num' && (val.deg || val.arc)) return 'angle';
  if (ast && ast.k === 'call' && /^text$/i.test(ast.f)) return 'text';
  return { pt: 'pt', pts: 'pts', vec: 'vec', seg: 'seg', num: 'num', poly: val.closed ? 'poly' : 'line', text: 'text', str: 'text' }[val.t] || 'line';
}

export { parseExpr, print, clone };
