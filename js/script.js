// Construction scripts: many input-bar lines at once, plus styling and view
// statements (SetColor, Hide, ShowAxes, ZoomIn …) that change how objects
// look rather than define new ones. Shared by the app's Script panel and the
// MCP server, so it stays DOM-free.

import { parseExpr, print, COMMAND_NAMES } from './expr.js';
import { evaluate, EvalError } from './geom.js';
import { isNumLit } from './construction.js';

export const NAMED_COLORS = {
  red: '#c0392b', blue: '#2457d6', green: '#138d75', purple: '#8e44ad', orange: '#d35400', brown: '#a0522d',
  gold: '#b8860b', yellow: '#d4ac0d', black: '#2b2b2b', gray: '#7f8c8d', grey: '#7f8c8d', pink: '#e84393', teal: '#00a8c6', cyan: '#00a8c6',
};
const color = s => {
  const c = NAMED_COLORS[String(s).toLowerCase()] || s;
  if (!/^#[0-9a-f]{6}$/i.test(c)) throw new EvalError(`Unknown colour "${s}". Use a name (${Object.keys(NAMED_COLORS).slice(0, 8).join(', ')} …) or "#rrggbb"`);
  return c;
};
const DASHES = { solid: 0, dashed: 1, dotted: 2 };

// Statements: name → [usage, (ctx, args) => void]. Arguments arrive as ASTs;
// `obj` resolves the first one to an existing object.
export const STATEMENTS = {
  setcolor: ['SetColor(obj, "red" | "#rrggbb")', (c, a) => { c.obj(a[0]).style.color = color(c.str(a[1])); }],
  setlinestyle: ['SetLineStyle(obj, "solid" | "dashed" | "dotted")', (c, a) => {
    const d = DASHES[c.str(a[1])];
    if (d === undefined) throw new EvalError('Line style is "solid", "dashed" or "dotted"');
    c.set(a[0], 'dash', d || undefined);
  }],
  setthickness: ['SetThickness(obj, 1-9)', (c, a) => { c.obj(a[0]).style.width = c.num(a[1]); }],
  setpointsize: ['SetPointSize(point, 1-9)', (c, a) => { c.obj(a[0]).style.size = c.num(a[1]); }],
  setfill: ['SetFill(obj, 0-1)', (c, a) => { c.obj(a[0]).style.fill = Math.max(0, Math.min(1, c.num(a[1]))); }],
  setmarks: ['SetMarks(segment or angle, 1-3) - tick marks or angle arcs', (c, a) => {
    const o = c.obj(a[0]), n = Math.round(c.num(a[1]));
    if (o.val.t === 'num') c.set(a[0], 'arcs', n > 1 ? n : undefined); else c.set(a[0], 'ticks', n || undefined);
  }],
  showlabel: ['ShowLabel(obj, true | false)', (c, a) => { c.obj(a[0]).style.label = a[1] ? c.bool(a[1]) : true; }],
  setcaption: ['SetCaption(obj, "text") - shown instead of the name', (c, a) => { const o = c.obj(a[0]); o.style.caption = c.str(a[1]); o.style.lm = 'caption'; o.style.label = true; }],
  setlabelmode: ['SetLabelMode(obj, "name" | "value" | "nameValue" | "caption")', (c, a) => { c.obj(a[0]).style.lm = c.str(a[1]); }],
  hide: ['Hide(obj)', (c, a) => { for (const x of a) c.obj(x).style.hidden = true; }],
  show: ['Show(obj)', (c, a) => { for (const x of a) delete c.obj(x).style.hidden; }],
  setfixed: ['SetFixed(obj, true | false)', (c, a) => { c.set(a[0], 'fixed', a[1] ? c.bool(a[1]) || undefined : true); }],
  settrace: ['SetTrace(point, true | false)', (c, a) => { c.set(a[0], 'trace', a[1] ? c.bool(a[1]) || undefined : true); }],
  setauxiliary: ['SetAuxiliary(obj) - hidden from the algebra list', (c, a) => { c.obj(a[0]).style.aux = true; }],
  setslider: ['SetSlider(number, min, max, step, onCanvas)', (c, a) => {
    const o = c.obj(a[0]);
    if (!isNumLit(o.ast)) throw new EvalError('SetSlider needs a free number, like a = 2');
    o.style.slider = { ...(o.style.slider || {}), min: c.num(a[1]), max: c.num(a[2]), step: a[3] ? c.num(a[3]) : 0.1, show: a[4] ? c.bool(a[4]) : false };
  }],
  delete: ['Delete(obj) - and everything built on it', (c, a) => { c.cons.remove([c.obj(a[0]).name]); }],
  showaxes: ['ShowAxes(true | false)', (c, a) => { c.settings.axes = a[0] ? c.bool(a[0]) : true; }],
  showgrid: ['ShowGrid(true | false)', (c, a) => { c.settings.grid = a[0] ? c.bool(a[0]) : true; }],
  zoomin: ['ZoomIn(xmin, ymin, xmax, ymax) - the visible window', (c, a) => {
    const [x0, y0, x1, y1] = a.map(x => c.num(x));
    if (!(x1 > x0 && y1 > y0)) throw new EvalError('ZoomIn(xmin, ymin, xmax, ymax) with xmax > xmin and ymax > ymin');
    c.view = { xmin: x0, ymin: y0, xmax: x1, ymax: y1 };
  }],
};

for (const k of Object.keys(STATEMENTS)) COMMAND_NAMES.add(k);

// Split a script into statements: one per line, # or // comments, blank
// lines ignored. A '#' inside a string is kept.
export function scriptLines(text) {
  const out = [];
  String(text).split(/\r?\n/).forEach((raw, i) => {
    let s = '', q = false;
    for (let k = 0; k < raw.length; k++) {
      const ch = raw[k];
      if (ch === '"') q = !q;
      if (!q && (ch === '#' || (ch === '/' && raw[k + 1] === '/'))) break;
      s += ch;
    }
    s = s.trim();
    if (s) out.push({ line: i + 1, src: s });
  });
  return out;
}

// Run a script against a construction. Errors do not stop it: every line
// that fails is reported and the rest still run.
//   → { created: [names], errors: [{line, src, msg}], settings, view }
export function runScript(cons, text, { defaultStyle, maxLines = 2000 } = {}) {
  const lines = scriptLines(text);
  const res = { created: [], errors: [], settings: {}, view: null };
  if (lines.length > maxLines) {
    res.errors.push({ line: lines[maxLines].line, src: '', msg: `Scripts are limited to ${maxLines} statements` });
    lines.length = maxLines;
  }
  const ctx = {
    cons, settings: res.settings, view: null,
    obj(a) {
      if (!a || a.k !== 'id' || !cons.has(a.n)) throw new EvalError(`Unknown object ${a && a.k === 'id' ? `"${a.n}"` : '(expected a name)'}`);
      return cons.get(a.n);
    },
    set(a, k, v) { const o = this.obj(a); if (v === undefined) delete o.style[k]; else o.style[k] = v; },
    val(a) { return evaluate(a, cons.ctx()); },
    num(a) { const v = this.val(a); if (v.t !== 'num') throw new EvalError('Expected a number'); return v.v; },
    bool(a) { const v = this.val(a); return v.t === 'bool' ? v.v : v.t === 'num' ? v.v !== 0 : !!v; },
    str(a) { if (a && a.k === 'str') return a.v; if (a && a.k === 'id') return a.n; throw new EvalError('Expected text in quotes'); },
  };
  for (const { line, src } of lines) {
    try {
      const m = /^([A-Za-z]+)\s*\(/.exec(src);
      const st = m && STATEMENTS[m[1].toLowerCase()];
      if (st) {
        const ast = parseExpr(src);
        if (ast.k !== 'call') throw new EvalError(`Use ${st[0]}`);
        st[1](ctx, ast.a);
        continue;
      }
      const before = new Set(cons.objs.map(o => o.name));
      const o = cons.exec(src, defaultStyle);
      if (!before.has(o.name)) res.created.push(o.name);
    } catch (e) {
      res.errors.push({ line, src, msg: e.message });
    }
  }
  res.view = ctx.view;
  return res;
}

// The construction as a script that rebuilds it, styles included.
export function toScript(cons) {
  const out = [];
  const q = s => `"${String(s).replace(/"/g, '”')}"`;
  for (const o of cons.objs) {
    const d = print(o.ast);
    out.push(o.ast.k === 'fn' ? `${o.name}(${o.ast.v}) = ${d}` : o.ast.k === 'eq' ? `${o.name}: ${d}` : `${o.name} = ${d}`);
    const s = o.style;
    if (s.color) out.push(`SetColor(${o.name}, ${q(s.color)})`);
    if (s.dash) out.push(`SetLineStyle(${o.name}, ${q(['solid', 'dashed', 'dotted'][s.dash])})`);
    if (s.width != null) out.push(`SetThickness(${o.name}, ${s.width})`);
    if (s.size != null) out.push(`SetPointSize(${o.name}, ${s.size})`);
    if (s.fill != null) out.push(`SetFill(${o.name}, ${s.fill})`);
    if (s.ticks) out.push(`SetMarks(${o.name}, ${s.ticks})`);
    if (s.arcs) out.push(`SetMarks(${o.name}, ${s.arcs})`);
    if (s.caption) out.push(`SetCaption(${o.name}, ${q(s.caption)})`);
    else if (s.lm) out.push(`SetLabelMode(${o.name}, ${q(s.lm)})`);
    if (s.label !== undefined && !s.caption) out.push(`ShowLabel(${o.name}, ${s.label})`);
    if (s.hidden) out.push(`Hide(${o.name})`);
    if (s.fixed) out.push(`SetFixed(${o.name})`);
    if (s.trace) out.push(`SetTrace(${o.name})`);
    if (s.aux) out.push(`SetAuxiliary(${o.name})`);
    if (s.slider && isNumLit(o.ast)) out.push(`SetSlider(${o.name}, ${s.slider.min}, ${s.slider.max}, ${s.slider.step}, ${!!s.slider.show})`);
  }
  return out.length ? out.join('\n') + '\n' : '';
}
