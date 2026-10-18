// UI: toolbar, canvas interaction and the tool engine, algebra view, input
// bar, properties panel, menu, persistence and undo.

import { parseStatement, parseExpr, print, fmtNum } from './expr.js';
import { describe, toText, intersections, closest, conicInfo, isPath, isLinear, CANON, HELP, evaluate } from './geom.js';
import { Construction, kindOf, isPtLit, isNumLit } from './construction.js';
import { Renderer, THEMES, role, defaultLabelMode, fitView } from './render.js';
import { TOOLS, TOOL, GROUPS, prime } from './tools.js';
import { CENTER_LIST, relations, R as R_ } from './olympiad.js';
import { DEMOS } from './demos.js';
import { runScript, toScript, STATEMENTS } from './script.js';
import { languageGuide } from './guide.js';
import { renderSVG } from './svgctx.js';
import { connectHost } from './hostbridge.js';
import { exportDiagram } from './export.js';

const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k);
  return e;
};
// Embedded in an AI chat (MCP Apps / ChatGPT): the MCP server sets
// window.GD_EMBED. The figure then comes from the host, not from storage.
const EMBED = window.GD_EMBED || null;
const memory = new Map();
const store = EMBED ? { get: k => memory.get(k) ?? null, set: (k, v) => memory.set(k, v) } : {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
// Sandboxed chat frames block confirm(); undo is the safety net there.
const okToReplace = msg => (EMBED ? true : confirm(msg));

const FN_COLORS = ['#2457d6', '#c0392b', '#138d75', '#8e44ad', '#d35400', '#2c3e50'];
const SWATCHES = [null, '#2457d6', '#c0392b', '#138d75', '#8e44ad', '#d35400', '#a0522d', '#b8860b', '#2b2b2b', '#7f8c8d', '#e84393', '#00a8c6'];

const cons = new Construction();
const canvas = $('#cv');
const R = new Renderer(canvas);
const view = R.view;

// Saved settings. Version 2 made grid and axes off by default; settings saved
// before that held the old defaults, not a choice, so those two are dropped.
function storedSettings() {
  const s = store.get('gd:settings') || {};
  if (!(s.sv >= 2)) { delete s.grid; delete s.axes; }
  return s;
}
const S = {
  tool: 'move', tsel: [], selection: new Set(), hover: null, preview: null, rubber: null,
  settings: Object.assign({ grid: false, axes: false, snap: true, digits: 2, theme: 'auto', labeling: 'auto', showAux: false, algebra: !EMBED, sv: 2 },
    storedSettings()),
  history: [], hidx: -1, groupTool: {}, fnColor: 0, inputHist: [], inputIdx: -1,
};
R.settings = S.settings;

// ---------- theme ----------

const media = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const t = S.settings.theme === 'auto' ? (media.matches ? 'dark' : 'light') : S.settings.theme;
  document.documentElement.dataset.theme = t;
  R.theme = THEMES[t];
  render(); refreshAlgebra();
}
media.addEventListener('change', applyTheme);

// ---------- render loop ----------

let raf = 0, algebraValuesDirty = false;
function render() { if (!raf) raf = requestAnimationFrame(frame); }
function frame() {
  raf = 0;
  R.draw(cons, { selection: S.selection, hover: S.hover, preview: S.preview, toolSel: S.tsel, rubber: S.rubber, showHidden: S.tool === 'showhide', only: stepSet() });
  if (algebraValuesDirty) { algebraValuesDirty = false; updateAlgebraValues(); }
}
function viewChanged() {
  cons.bounds = view.bounds();
  cons.recompute();
  algebraValuesDirty = true;
  render();
  persistSoon();
}
function valuesChanged(from) {
  cons.recompute(from);
  algebraValuesDirty = true;
  render();
}

// ---------- history & persistence ----------

const snapshot = () => JSON.stringify(cons.toJSON());
function commit() {
  const s = snapshot();
  if (S.history[S.hidx] !== s) {
    if (S.step != null && S.history[S.hidx] !== undefined) exitSteps();
    if (EMBED && S.hidx >= 0) syncHostSoon();
    S.history = S.history.slice(0, S.hidx + 1);
    S.history.push(s);
    if (S.history.length > 400) S.history.shift();
    S.hidx = S.history.length - 1;
  }
  S.selection = new Set([...S.selection].filter(n => cons.has(n)));
  refreshAlgebra(); refreshProps(); updateUndo(); persistSoon(); render();
}
function restore(s) {
  cons.load(JSON.parse(s));
  S.selection = new Set([...S.selection].filter(n => cons.has(n)));
  resetTool();
  refreshAlgebra(); refreshProps(); updateUndo(); persistSoon(); render();
}
const undo = () => { if (S.hidx > 0) restore(S.history[--S.hidx]); };
const redo = () => { if (S.hidx < S.history.length - 1) restore(S.history[++S.hidx]); };
function updateUndo() {
  $('#btnUndo').disabled = S.hidx <= 0;
  $('#btnRedo').disabled = S.hidx >= S.history.length - 1;
}
let persistTimer = 0;
function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => store.set('gd:doc', docJSON()), 300);
}
const docJSON = () => ({ format: 'geometry-drawer', version: 1, view: view.toJSON(), settings: { grid: S.settings.grid, axes: S.settings.axes }, objects: cons.toJSON() });
function loadDoc(doc) {
  if (!doc || !Array.isArray(doc.objects)) throw new Error('Not a Geometry Drawer file');
  if (doc.view) Object.assign(view, { cx: +doc.view.cx || 0, cy: +doc.view.cy || 0, scale: +doc.view.scale || 50 });
  if (doc.settings) { for (const k of ['grid', 'axes']) if (typeof doc.settings[k] === 'boolean') S.settings[k] = doc.settings[k]; saveSettings(); }
  cons.bounds = view.bounds();
  const errs = cons.load(doc.objects);
  for (const o of cons.objs) if (o.ast.k === 'fn') S.fnColor++;
  if (errs.length) toast(`Some objects could not be loaded: ${errs.slice(0, 3).join('; ')}`, 'error');
}

// ---------- names & creation ----------

function allocator(preview) {
  const reserved = new Set();
  let i = 0;
  return (kind, hint) => {
    if (preview) return `__p${i++}`;
    const n = cons.freshName(kind, hint, reserved);
    reserved.add(n);
    return n;
  };
}

function defaultStyle(val, ast) {
  const s = {};
  if (val.t === 'fn' || (ast && ast.k === 'fn')) s.color = FN_COLORS[S.fnColor++ % FN_COLORS.length];
  if (S.settings.labeling === 'all') s.label = true;
  if (S.settings.labeling === 'none') s.label = false;
  if (val.t === 'num' && ast && isNumLit(ast)) s.slider = sliderDefaults(ast);
  return s;
}
function sliderDefaults(ast) {
  return ast.k === 'deg' ? { min: 0, max: 360, step: 1, show: false } : { min: -5, max: 5, step: 0.1, show: false };
}

function createItems(items, styleFrom) {
  const made = [];
  try {
    for (const it of items) {
      const ast = it.ast || parseExpr(it.src);
      const val = cons.tryEval(ast);
      const style = { ...defaultStyle(val, ast), ...(styleFrom || {}), ...(it.style || {}) };
      cons.add(it.name, ast, style);
      made.push(it.name);
    }
  } catch (e) {
    cons.remove(made);
    toast(e.message, 'error');
    return null;
  }
  return made;
}

function decimalsForScale() { return Math.max(0, Math.ceil(Math.log10(view.scale)) ); }
function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; }

// World position for a free point, with grid snapping.
function snapWorld(sx, sy, noSnap) {
  let x = view.wx(sx), y = view.wy(sy);
  if (S.settings.snap && S.settings.grid && !noSnap) {
    const step = niceStep(60 / view.scale);
    const gx = Math.round(x / step) * step, gy = Math.round(y / step) * step;
    if (Math.hypot(view.sx(gx) - sx, view.sy(gy) - sy) < 9) return { x: +gx.toFixed(12), y: +gy.toFixed(12), snapped: true };
  }
  const d = decimalsForScale();
  return { x: +x.toFixed(d), y: +y.toFixed(d) };
}

const tolFor = e => (e && e.pointerType === 'touch' ? 14 : 7);

// Create (or find) a point where the user clicked: intersection, point on
// path, or free point. Returns its name.
function pointAt(sx, sy, hits, e) {
  const tol = tolFor(e);
  const paths = hits.filter(h => h.pri === 2 && isPath(h.o.val));
  const N = allocator();
  if (paths.length >= 2) {
    let best = null;
    for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
      const a = paths[i].o, b = paths[j].o;
      intersections(a.val, b.val, cons.bounds).forEach((p, k) => {
        const d = Math.hypot(view.sx(p.x) - sx, view.sy(p.y) - sy);
        if (d < tol * 2 && (!best || d < best.d)) best = { a, b, k, d };
      });
    }
    if (best) {
      const made = createItems([{ name: N('pt'), src: `Intersect(${best.a.name}, ${best.b.name}, ${best.k + 1})` }]);
      return made && made[0];
    }
  }
  if (paths.length) {
    const o = paths[0].o, v = o.val;
    const c = closest(v, { x: view.wx(sx), y: view.wy(sy) }, cons.bounds);
    if (c) {
      const param = /^(line|seg|ray|vec|circle|arc|poly|fn|curve)$/.test(v.t) || (v.t === 'conic' && conicInfo(v).type === 'ellipse');
      const src = param ? `Point(${o.name}, ${c.t})` : `Point(${o.name}, (${c.p.x}, ${c.p.y}))`;
      const made = createItems([{ name: N('pt'), src }]);
      return made && made[0];
    }
  }
  const w = snapWorld(sx, sy, e && e.altKey);
  const made = createItems([{ name: N('pt'), ast: { k: 'pt', x: { k: 'num', v: w.x }, y: { k: 'num', v: w.y } } }]);
  return made && made[0];
}

// ---------- tool engine ----------

function matches(o, type) {
  if (!o) return false;
  const v = o.val;
  switch (type) {
    case 'pt': return v.t === 'pt';
    case 'path': return isPath(v);
    case 'lin': return isLinear(v);
    case 'seg': return v.t === 'seg';
    case 'carc': return v.t === 'circle' || v.t === 'arc';
    case 'circ': return v.t === 'circle';
    case 'conic': return v.t === 'conic' || v.t === 'circle';
    case 'tan': return v.t === 'conic' || v.t === 'circle' || (v.t === 'fn' && !v.M);
    case 'fn': return v.t === 'fn' && !v.M;
    case 'poly': return v.t === 'poly' && v.closed;
    case 'vec': return v.t === 'vec';
    case 'num': return v.t === 'num' && isNumLit(o.ast);
    case 'obj': return !['undef', 'num', 'bool', 'str'].includes(v.t);
    case 'any': return true;
  }
  return false;
}

function setTool(id) {
  const t = TOOL[id];
  if (!t) return;
  S.tool = id;
  S.groupTool[t.group] = id;
  resetTool();
  if (id !== 'move') S.selection.clear();
  renderToolbar();
  hint();
  canvas.style.cursor = id === 'move' ? 'default' : 'crosshair';
  showRelations();
  refreshProps();
  render();
}
function resetTool() { S.tsel = []; S.preview = null; render(); }

function hint(msg) {
  const t = TOOL[S.tool];
  const h = $('#hint');
  h.textContent = '';
  h.append(el('b', {}, t.name), ' ', msg || t.help || '');
  if (t.key) h.append(el('kbd', {}, t.key.toUpperCase()));
}

function candidates(tool, sel) {
  return tool.patterns.map((p, i) => [p, i]).filter(([p]) => p.length > sel.length && sel.every((n, k) => matches(cons.get(n), p[k])));
}

function toolClick(sx, sy, e) {
  const tool = TOOL[S.tool];
  const hits = R.hits(cons, sx, sy, tolFor(e), S.tool === 'showhide');
  if (tool.special) return SPECIAL[tool.special](tool, sx, sy, hits, e);
  const sel = S.tsel;
  let cands = candidates(tool, sel);
  if (!cands.length) { resetTool(); cands = candidates(tool, sel); }
  let picked = null;
  for (const h of hits) {
    if (sel.includes(h.o.name)) continue;
    if (cands.some(([p]) => matches(h.o, p[sel.length]))) { picked = h.o.name; break; }
  }
  if (!picked && cands.some(([p]) => p[sel.length] === 'pt')) {
    picked = pointAt(sx, sy, hits, e);
    if (picked) commit();
  }
  if (!picked) { flashHint(); return null; }
  sel.push(picked);
  const done = tool.patterns.map((p, i) => [p, i]).find(([p]) => p.length === sel.length && sel.every((n, k) => matches(cons.get(n), p[k])));
  if (done) finish(tool, sel.slice(), done[1]);
  else hint(`${tool.help} - ${sel.length} selected`);
  render();
  return picked;
}

function flashHint() {
  const h = $('#hint');
  h.classList.remove('flash'); void h.offsetWidth; h.classList.add('flash');
}

function normalizePrompt(tool, x) {
  x = x.trim();
  if (/angle/i.test(tool.prompt.label) && /^-?\d*\.?\d+$/.test(x)) x += '°';
  return x;
}

async function finish(tool, sel, pi) {
  let x = null;
  if (tool.prompt && tool.prompt.options === 'centers') {
    const r = await ask(tool.name, [{ key: 'v', label: tool.prompt.label, type: 'select', value: S.lastPrompt?.[tool.id] ?? '1',
      options: CENTER_LIST.map(([n, name]) => [String(n), `X(${n}) ${name.replace(/([a-z])([A-Z])/g, '$1 $2')}`]) }]);
    if (!r) { resetTool(); hint(); return; }
    x = r.v;
    (S.lastPrompt ||= {})[tool.id] = x;
  } else if (tool.prompt) {
    x = await ask(tool.name, [{ key: 'v', label: tool.prompt.label, value: S.lastPrompt?.[tool.id] ?? tool.prompt.def }]);
    if (!x) { resetTool(); hint(); return; }
    x = normalizePrompt(tool, x.v);
    (S.lastPrompt ||= {})[tool.id] = x;
    try { parseExpr(x); } catch (e) { toast(e.message, 'error'); resetTool(); return; }
  }
  let items, styleFrom = null;
  try { [items, styleFrom] = buildItems(tool, sel, pi, allocator(), x); } catch (e) { toast(e.message, 'error'); resetTool(); return; }
  resetTool();
  hint();
  if (!items || !items.length) return;
  const made = createItems(items, styleFrom);
  if (made) commit();
}

const copyStyle = s => {
  const out = {};
  for (const k of ['color', 'width', 'dash', 'size', 'fill', 'r']) if (s[k] !== undefined) out[k] = s[k];
  return out;
};

// Turn a completed selection into item definitions.
function buildItems(tool, sel, pi, N, x) {
  const val = n => (n === '__cur' ? S.cursorVal : cons.get(n).val);
  const tryVal = src => { try { return cons.tryEval(parseExpr(src), S.cursorMap); } catch { return null; } };
  if (typeof tool.make === 'function') return [tool.make(sel, N, { val }, x, pi), null];
  switch (tool.make) {
    case 'intersect': {
      const [a, b] = sel;
      const n = intersections(val(a), val(b), cons.bounds).length;
      if (!n) { toast('These objects do not intersect here'); return [[], null]; }
      return [Array.from({ length: Math.min(n, 12) }, (_, k) => ({ name: N('pt'), src: `Intersect(${a}, ${b}, ${k + 1})` })), null];
    }
    case 'center': {
      const n = +x, name = (CENTER_LIST.find(c => c[0] === n) || [])[1];
      const hint = { 1: 'I', 2: 'G', 3: 'O', 4: 'H', 5: 'N', 6: 'K', 7: 'Ge', 8: 'Na', 9: 'Mi', 10: 'Sp', 11: 'Fe', 13: 'F', 14: 'F_2', 20: 'L', 40: 'Be' }[n];
      const src = n === 2 ? `Centroid(${sel.join(', ')})` : `${name}(${sel.join(', ')})`;
      return [[{ name: N('pt', hint), src }], null];
    }
    case 'commontangent': {
      const items = [];
      for (const k of [1, 2, 3, 4]) {
        const v = tryVal(`CommonTangent(${sel[0]}, ${sel[1]}, ${k})`);
        if (v && v.t !== 'undef') items.push({ name: N('line'), src: `CommonTangent(${sel[0]}, ${sel[1]}, ${k})` });
      }
      if (!items.length) toast('These circles have no common tangent');
      return [items, null];
    }
    case 'tangent': {
      const [P, c] = val(sel[0]).t === 'pt' ? sel : [sel[1], sel[0]];
      if (val(c).t === 'fn') return [[{ name: N('line'), src: `Tangent(${P}, ${c})` }], null];
      const items = [];
      for (const k of [1, 2]) {
        const v = tryVal(`Tangent(${P}, ${c}, ${k})`);
        if (v && v.t !== 'undef') items.push({ name: N('line'), src: `Tangent(${P}, ${c}, ${k})` });
      }
      if (!items.length) toast('No tangent from a point inside');
      return [items, null];
    }
    case 'regpolygon': {
      const n = Math.round(evaluate(parseExpr(x), cons.ctx()).v);
      if (!(n >= 3 && n <= 100)) throw new Error('Enter a number of vertices from 3 to 100');
      const poly = N('poly');
      const items = [{ name: poly, src: `Polygon(${sel[0]}, ${sel[1]}, ${n})` }];
      const vs = [sel[0], sel[1]];
      for (let k = 3; k <= n; k++) { const v = N('pt'); vs.push(v); items.push({ name: v, src: `Vertex(${poly}, ${k})` }); }
      for (let k = 0; k < n; k++) items.push({ name: N('seg'), src: `Segment(${vs[k]}, ${vs[(k + 1) % n]})`, style: { r: 'poly' } });
      return [items, null];
    }
    case 'angle': {
      if (pi === 0) {
        const v = tryVal(`Angle(${sel.join(', ')})`);
        const s = v && v.v > Math.PI + 1e-12 ? [sel[2], sel[1], sel[0]] : sel;
        return [[{ name: N('angle'), src: `Angle(${s.join(', ')})` }], null];
      }
      if (pi === 1) {
        const v = tryVal(`Angle(${sel.join(', ')})`);
        const s = v && v.v > Math.PI + 1e-12 ? [sel[1], sel[0]] : sel;
        return [[{ name: N('angle'), src: `Angle(${s.join(', ')})` }], null];
      }
      const p = val(sel[0]), n = p.pts.length;
      let area = 0;
      for (let i = 0; i < n; i++) area += p.pts[i].x * p.pts[(i + 1) % n].y - p.pts[(i + 1) % n].x * p.pts[i].y;
      const V = k => `Vertex(${sel[0]}, ${((k - 1 + n) % n) + 1})`;
      return [Array.from({ length: n }, (_, i) => {
        const k = i + 1;
        return { name: N('angle'), src: area > 0 ? `OrientedAngle(${V(k + 1)}, ${V(k)}, ${V(k - 1)})` : `OrientedAngle(${V(k - 1)}, ${V(k)}, ${V(k + 1)})` };
      }), null];
    }
    case 'distance': {
      const clean = s => s.replace(/[^A-Za-z0-9]/g, '');
      if (pi === 0) return [[{ name: N('num', `dist${clean(sel[0])}${clean(sel[1])}`), src: `Distance(${sel[0]}, ${sel[1]})` }], null];
      if (pi === 1 || pi === 2) return [[{ name: N('num', `dist${clean(sel[0])}${clean(sel[1])}`), src: `Distance(${sel[0]}, ${sel[1]})` }], null];
      if (pi === 3) return [[{ name: N('num', `len${clean(sel[0])}`), src: `Length(${sel[0]})` }], null];
      if (pi === 4) return [[{ name: N('num', `perim${clean(sel[0])}`), src: `Perimeter(${sel[0]})` }], null];
      const v = val(sel[0]);
      return [[{ name: N('num', `len${clean(sel[0])}`), src: v.t === 'circle' ? `Circumference(${sel[0]})` : `Length(${sel[0]})` }], null];
    }
    case 'transform': {
      const src = tool.fmt(sel, x);
      const o = cons.get(sel[0]);
      const v = tryVal(src) || o.val;
      const kind = kindOf(v, o.ast);
      const name = kind === 'pt' ? prime(o.name, N, 'pt') : N(kind === 'pt' ? 'pt' : kind);
      return [[{ name, src }], copyStyle(o.style)];
    }
  }
  return [[], null];
}

// Tools that are not just "select N things".
const SPECIAL = {
  point(tool, sx, sy, hits, e) {
    if (hits.length && hits[0].o.val.t === 'pt') { S.selection = new Set([hits[0].o.name]); render(); return null; }
    const n = pointAt(sx, sy, hits, e);
    if (n) commit();
    return n;
  },
  polygon(tool, sx, sy, hits, e) { return multiPoint(tool, sx, sy, hits, e, true); },
  polyline(tool, sx, sy, hits, e) { return multiPoint(tool, sx, sy, hits, e, false); },
  async slider(tool, sx, sy) {
    const name = cons.freshName('num');
    const r = await ask('Slider', [
      { key: 'name', label: 'Name', value: name },
      { key: 'min', label: 'Min', value: '-5' }, { key: 'max', label: 'Max', value: '5' },
      { key: 'step', label: 'Step', value: '0.1' },
      { key: 'angle', label: 'Angle (degrees)', type: 'checkbox' },
    ]);
    if (!r) return;
    const angle = r.angle;
    const min = parseFloat(r.min), max = parseFloat(r.max), step = parseFloat(r.step);
    const lo = angle && r.min === '-5' ? 0 : min, hi = angle && r.max === '5' ? 360 : max, st = angle && r.step === '0.1' ? 1 : step;
    if (!(hi > lo) || !(st > 0)) { toast('Max must be above min, and the step positive', 'error'); return; }
    const v0 = angle ? 45 : Math.min(hi, Math.max(lo, 1));
    const ast = angle ? { k: 'deg', e: { k: 'num', v: v0 } } : { k: 'num', v: v0 };
    const made = createItems([{ name: r.name.trim() || name, ast, style: { slider: { min: lo, max: hi, step: st, show: true, sx: Math.round(sx), sy: Math.round(sy) } } }]);
    if (made) commit();
  },
  async text(tool, sx, sy) {
    const r = await ask('Text', [{ key: 't', label: 'Text (start with = for a live expression)', value: '', type: 'textarea' }]);
    if (!r || !r.t.trim()) return;
    const w = snapWorld(sx, sy, true);
    const pos = `(${w.x}, ${w.y})`;
    const src = r.t.startsWith('=') ? `Text(${r.t.slice(1)}, ${pos})` : `Text("${r.t.replace(/"/g, '”')}", ${pos})`;
    const made = createItems([{ name: cons.freshName('text'), src }]);
    if (made) commit();
  },
  showlabel(tool, sx, sy, hits) {
    if (!hits.length) return;
    const o = hits[0].o;
    o.style.label = !R.wantsLabel(o);
    commit();
  },
  showhide(tool, sx, sy, hits) {
    if (!hits.length) return;
    const o = hits[0].o;
    o.style.hidden = !o.style.hidden;
    commit();
  },
  delete(tool, sx, sy, hits) {
    if (!hits.length) return;
    cons.remove([hits[0].o.name]);
    commit();
  },
  anglechase() { showAngleChase(); },
  relation(tool, sx, sy, hits) {
    const h = hits.find(x => x.o.val.t !== 'text');
    if (!h) { S.tsel = []; showRelations(); render(); return; }
    const n = h.o.name;
    if (S.tsel.includes(n)) S.tsel = S.tsel.filter(x => x !== n);
    else { if (S.tsel.length >= 4) S.tsel = []; S.tsel.push(n); }
    showRelations(); render();
  },
  zoomin(tool, sx, sy) { view.zoomAt(sx, sy, 1.6); viewChanged(); },
  zoomout(tool, sx, sy) { view.zoomAt(sx, sy, 1 / 1.6); viewChanged(); },
};

function multiPoint(tool, sx, sy, hits, e, closed) {
  const sel = S.tsel;
  let picked = hits.find(h => h.o.val.t === 'pt');
  picked = picked && picked.o.name;
  if (picked && closed && sel.length >= 3 && picked === sel[0]) return finishPoly(sel.slice(), true);
  if (picked && !closed && sel.length >= 2 && picked === sel[sel.length - 1]) return finishPoly(sel.slice(), false);
  if (picked && sel.includes(picked)) return;
  if (!picked) { picked = pointAt(sx, sy, hits, e); if (picked) commit(); }
  if (!picked) return;
  sel.push(picked);
  hint(closed ? `${sel.length} vertices - click the first one to close` : `${sel.length} points - click the last one again to finish`);
  render();
  return picked;
}
function finishPoly(sel, closed) {
  const N = allocator();
  const items = closed ? [{ name: N('poly'), src: `Polygon(${sel.join(', ')})` }] : [{ name: N('line'), src: `Polyline(${sel.join(', ')})` }];
  if (closed) sel.forEach((p, i) => items.push({ name: N('seg'), src: `Segment(${p}, ${sel[(i + 1) % sel.length]})`, style: { r: 'poly' } }));
  resetTool(); hint();
  if (createItems(items)) commit();
}

// Preview of what the tool will create, with the cursor as the next point.
function updatePreview(sx, sy, e) {
  const tool = TOOL[S.tool];
  S.preview = null;
  if (!S.tsel.length) return;
  const hits = R.hits(cons, sx, sy, tolFor(e));
  const hp = hits.find(h => h.o.val.t === 'pt');
  const w = hp ? { x: hp.o.val.x, y: hp.o.val.y } : snapWorld(sx, sy, e.altKey);
  S.cursorVal = { t: 'pt', x: w.x, y: w.y };
  S.cursorMap = new Map([['__cur', S.cursorVal]]);
  if (tool.id === 'polygon' || tool.id === 'polyline') {
    const pts = [...S.tsel.map(n => cons.get(n).val), S.cursorVal];
    S.preview = [{ val: { t: 'poly', pts, closed: tool.id === 'polygon' }, style: { fill: tool.id === 'polygon' ? 0.12 : 0, width: 1.5 } }];
    return;
  }
  if (!tool.patterns || !tool.preview) return;
  const c = candidates(tool, S.tsel).find(([p]) => p.length === S.tsel.length + 1 && p[S.tsel.length] === 'pt');
  if (!c) return;
  try {
    const [items] = buildItems(tool, [...S.tsel, '__cur'], c[1], allocator(true), null);
    const ov = new Map(S.cursorMap);
    const out = [];
    for (const it of items) {
      const v = evaluate(it.ast || parseExpr(it.src), cons.ctx(ov));
      ov.set(it.name, v);
      if (!(it.style && it.style.hidden) && v.t !== 'undef') out.push({ val: v, style: { width: 1.5, fill: v.t === 'poly' || v.sector ? 0.12 : 0 } });
    }
    S.preview = out;
  } catch { S.preview = null; }
}

// ---------- pointer interaction ----------

const pointers = new Map();
let drag = null;
const local = e => { const r = canvas.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; };

canvas.addEventListener('pointerdown', e => {
  // Hit testing reads geometry cached by the last frame: flush a pending one
  // so a click right after a change sees what was just created.
  if (raf) { cancelAnimationFrame(raf); frame(); }
  canvas.setPointerCapture(e.pointerId);
  const p = local(e);
  pointers.set(e.pointerId, p);
  closeFlyout(); closeMenu();
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    drag = { type: 'pinch', d: Math.hypot(a.sx - b.sx, a.sy - b.sy), mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2 };
    return;
  }
  if (pointers.size > 2) return;
  const { sx, sy } = p;
  if (e.button === 1 || e.button === 2) { drag = { type: 'pan', sx, sy, moved: false }; return; }
  if (S.tool !== 'move') {
    const created = toolClick(sx, sy, e);
    const o = created && typeof created === 'string' && cons.get(created);
    drag = { type: 'tool', sx, sy, moved: false, o: o && (cons.isFreePoint(o) || cons.isOnPath(o)) ? o : null, before: S.tsel.length };
    return;
  }
  const hits = R.hits(cons, sx, sy, tolFor(e));
  const top = hits[0];
  if (!top) {
    if (e.shiftKey) { drag = { type: 'rubber', sx, sy }; S.rubber = { x: sx, y: sy, w: 0, h: 0 }; }
    else drag = { type: 'pan', sx, sy, moved: false, clear: true };
    return;
  }
  const o = top.o;
  if (e.shiftKey) { S.selection.has(o.name) ? S.selection.delete(o.name) : S.selection.add(o.name); }
  else if (!S.selection.has(o.name)) S.selection = new Set([o.name]);
  refreshProps(); highlightRows(); render();
  const w = { x: view.wx(sx), y: view.wy(sy) };
  if (top.slider) { drag = { type: 'slider', o }; dragSlider(o, sx); return; }
  // several selected free points: move them together
  const selFree = [...S.selection].map(n => cons.get(n)).filter(q => cons.isFreePoint(q));
  if (selFree.length > 1 && selFree.includes(o)) {
    drag = { type: 'multi', start: w, pts: selFree.map(q => ({ o: q, x0: q.val.x, y0: q.val.y })), moved: false };
    return;
  }
  if (cons.movable(o)) {
    const at = o.val.t === 'pt' ? o.val : o.val.pos || w;
    drag = { type: 'obj', o, dx: w.x - at.x, dy: w.y - at.y, moved: false };
    return;
  }
  const fa = cons.freeAncestors(o.name);
  if (fa) { drag = { type: 'multi', start: w, pts: fa.map(q => ({ o: q, x0: q.val.x, y0: q.val.y })), moved: false }; return; }
  drag = { type: 'none' };
});

canvas.addEventListener('pointermove', e => {
  const p = local(e);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
  if (!drag) return hoverAt(p.sx, p.sy, e);
  const { sx, sy } = p;
  switch (drag.type) {
    case 'pinch': {
      if (pointers.size < 2) return;
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.sx - b.sx, a.sy - b.sy), mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
      view.cx -= (mx - drag.mx) / view.scale; view.cy += (my - drag.my) / view.scale;
      if (drag.d > 0) view.zoomAt(mx, my, d / drag.d);
      Object.assign(drag, { d, mx, my });
      viewChanged();
      return;
    }
    case 'pan': {
      if (!drag.moved && Math.hypot(sx - drag.sx, sy - drag.sy) < 3) return;
      drag.moved = true;
      view.cx -= (sx - drag.sx) / view.scale; view.cy += (sy - drag.sy) / view.scale;
      drag.sx = sx; drag.sy = sy;
      canvas.style.cursor = 'grabbing';
      viewChanged();
      return;
    }
    case 'rubber': S.rubber = { x: Math.min(sx, drag.sx), y: Math.min(sy, drag.sy), w: Math.abs(sx - drag.sx), h: Math.abs(sy - drag.sy) }; render(); return;
    case 'slider': dragSlider(drag.o, sx); return;
    case 'obj': {
      drag.moved = true;
      moveObj(drag.o, sx - drag.dx * view.scale, sy + drag.dy * view.scale, e);
      return;
    }
    case 'multi': {
      drag.moved = true;
      let dx = view.wx(sx) - drag.start.x, dy = view.wy(sy) - drag.start.y;
      // snap the grabbed shape by its first point
      if (S.settings.snap && S.settings.grid && !e.altKey) {
        const f = drag.pts[0], w = snapWorld(view.sx(f.x0 + dx), view.sy(f.y0 + dy));
        if (w.snapped) { dx = w.x - f.x0; dy = w.y - f.y0; }
      }
      for (const q of drag.pts) cons.setPoint(q.o, q.x0 + dx, q.y0 + dy);
      valuesChanged(drag.pts.map(q => q.o.name));
      return;
    }
    case 'tool': {
      if (Math.hypot(sx - drag.sx, sy - drag.sy) > 4) drag.moved = true;
      if (drag.moved && drag.o && S.tool === 'point') moveObj(drag.o, sx, sy, e);
      else hoverAt(sx, sy, e);
      return;
    }
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (!drag) return;
  const d = drag;
  if (d.type === 'pinch') { if (pointers.size === 0) drag = null; return; }
  drag = null;
  canvas.style.cursor = S.tool === 'move' ? 'default' : 'crosshair';
  const { sx, sy } = local(e);
  if (d.type === 'pan' && !d.moved && d.clear) { S.selection.clear(); refreshProps(); highlightRows(); render(); }
  if ((d.type === 'obj' || d.type === 'multi' || d.type === 'slider') && (d.moved || d.type === 'slider')) commit();
  if (d.type === 'rubber') {
    const r = S.rubber; S.rubber = null;
    const inR = (x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    for (const o of cons.objs) {
      const g = o._g;
      if (!g) continue;
      const pts = g.pt ? [g.pt] : g.pl ? g.pl.flatMap(pl => { const a = []; for (let i = 0; i < pl.length; i += 2) a.push([pl[i], pl[i + 1]]); return a; }) : g.box ? [[g.box[0], g.box[1]]] : [];
      if (pts.length && pts.every(([x, y]) => inR(x, y))) S.selection.add(o.name);
    }
    refreshProps(); highlightRows(); render();
  }
  if (d.type === 'tool') {
    if (d.moved && d.o && S.tool === 'point') commit();
    else if (d.moved && S.tsel.length > 0 && S.tsel.length > d.before - 1 && TOOL[S.tool].patterns) {
      // press on the first point, release on the second: drag-to-create
      const tool = TOOL[S.tool];
      if (candidates(tool, S.tsel).some(([p]) => p[S.tsel.length] === 'pt')) toolClick(sx, sy, e);
    }
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const { sx, sy } = local(e);
  const k = e.ctrlKey ? 0.01 : 0.0018;
  view.zoomAt(sx, sy, Math.exp(-e.deltaY * k * (e.deltaMode === 1 ? 30 : 1)));
  viewChanged();
}, { passive: false });

canvas.addEventListener('dblclick', e => {
  if (S.tool !== 'move') return;
  const { sx, sy } = local(e);
  const h = R.hits(cons, sx, sy, 7)[0];
  if (h) editRow(h.o.name);
});

function hoverAt(sx, sy, e) {
  const tool = TOOL[S.tool];
  const hits = R.hits(cons, sx, sy, tolFor(e), S.tool === 'showhide');
  let h = null;
  if (S.tool === 'move' || tool.special) h = hits[0];
  else if (tool.patterns) {
    const cands = candidates(tool, S.tsel.length && candidates(tool, S.tsel).length ? S.tsel : []);
    h = hits.find(x => !S.tsel.includes(x.o.name) && cands.some(([p]) => matches(x.o, p[S.tsel.length])));
  }
  const name = h ? h.o.name : null;
  if (S.tool === 'move') canvas.style.cursor = h ? (h.slider || cons.movable(h.o) || cons.freeAncestors(h.o.name) ? 'grab' : 'pointer') : 'default';
  const changed = name !== S.hover;
  S.hover = name;
  if (S.tsel.length || tool.id === 'polygon' || tool.id === 'polyline') { updatePreview(sx, sy, e); render(); }
  else if (changed) render();
}

function moveObj(o, sx, sy, e) {
  if (cons.isFreePoint(o)) { const w = snapWorld(sx, sy, e.altKey); cons.setPoint(o, w.x, w.y); }
  else if (cons.isOnPath(o)) cons.slide(o, view.wx(sx), view.wy(sy));
  else if (cons.isFreeText(o)) { const d = decimalsForScale(); o.ast.a[1] = { k: 'pt', x: { k: 'num', v: +view.wx(sx).toFixed(d) }, y: { k: 'num', v: +view.wy(sy).toFixed(d) } }; }
  valuesChanged([o.name]);
}

// ---------- sliders ----------

const sliderUnit = o => (o.ast.k === 'deg' ? o.ast.e.v : o.ast.k === 'num' ? o.ast.v : -o.ast.e.v);
function setSliderUnit(o, u) {
  const s = o.style.slider || sliderDefaults(o.ast);
  u = Math.min(s.max, Math.max(s.min, Math.round((u - s.min) / s.step) * s.step + s.min));
  u = +u.toFixed(10);
  if (o.ast.k === 'deg') o.ast = { k: 'deg', e: { k: 'num', v: u } };
  else o.ast = { k: 'num', v: u };
  valuesChanged([o.name]);
}
function dragSlider(o, sx) {
  const g = o._g && o._g.slider, s = o.style.slider;
  if (!g) return;
  setSliderUnit(o, s.min + (s.max - s.min) * Math.max(0, Math.min(1, (sx - g.x) / g.W)));
}

// Animation: sliders and points on bounded paths.
let animRaf = 0, animLast = 0;
function animate(ts) {
  animRaf = 0;
  const live = cons.objs.filter(o => o.style.anim);
  if (!live.length) return;
  const dt = animLast ? Math.min(0.05, (ts - animLast) / 1000) : 0.016;
  animLast = ts;
  const changed = [];
  for (const o of live) {
    if (isNumLit(o.ast)) {
      const s = o.style.slider || sliderDefaults(o.ast);
      let u = sliderUnit(o) + (o._dir || 1) * (s.max - s.min) * dt / (o.style.animPeriod || 6);
      if (u > s.max) { u = s.max; o._dir = -1; } else if (u < s.min) { u = s.min; o._dir = 1; }
      if (o.ast.k === 'deg') o.ast.e.v = u; else o.ast = { k: 'num', v: u };
      changed.push(o.name);
    } else if (cons.isOnPath(o) && o.ast.a[1].k === 'num') {
      o.ast.a[1].v += dt / (o.style.animPeriod || 6) * (o._dir || 1);
      const pv = cons.get(o.ast.a[0].n).val;
      if (pv.t === 'seg' && (o.ast.a[1].v > 1 || o.ast.a[1].v < 0)) { o._dir = -(o._dir || 1); o.ast.a[1].v = Math.max(0, Math.min(1, o.ast.a[1].v)); }
      if (pv.t === 'poly') o.ast.a[1].v %= pv.pts.length;
      changed.push(o.name);
    }
  }
  valuesChanged(changed);
  animRaf = requestAnimationFrame(animate);
}
function startAnim() { if (!animRaf) { animLast = 0; animRaf = requestAnimationFrame(animate); } }

// ---------- toolbar ----------

let flyGroup = null;
function renderToolbar() {
  const nav = $('#tools');
  nav.textContent = '';
  for (const [g, label] of GROUPS) {
    const tools = TOOLS.filter(t => t.group === g);
    const cur = TOOL[S.groupTool[g]] || tools[0];
    const active = TOOL[S.tool].group === g;
    const b = el('button', {
      class: 'tb' + (active ? ' on' : ''), title: `${cur.name}${cur.key ? ` (${cur.key.toUpperCase()})` : ''} - ${label}`,
      'aria-label': cur.name, 'aria-pressed': active ? 'true' : 'false',
      onclick: () => { if (active && tools.length > 1) toggleFlyout(g, b); else { setTool(cur.id); if (tools.length > 1 && cur.id === tools[0].id && !S.groupTool[g + ':seen']) {} } },
      html: cur.svg + (tools.length > 1 ? '<span class="more"></span>' : ''),
    });
    b.addEventListener('contextmenu', ev => { ev.preventDefault(); toggleFlyout(g, b); });
    let press = 0;
    b.addEventListener('pointerdown', () => { press = setTimeout(() => { press = -1; toggleFlyout(g, b); }, 450); });
    b.addEventListener('pointerup', ev => { if (press === -1) ev.stopPropagation(); clearTimeout(press); });
    nav.append(b);
  }
}
function toggleFlyout(g, anchor) {
  const f = $('#flyout');
  if (flyGroup === g && !f.hidden) return closeFlyout();
  flyGroup = g;
  f.textContent = '';
  const label = GROUPS.find(x => x[0] === g)[1];
  f.append(el('div', { class: 'flyhead' }, label));
  for (const t of TOOLS.filter(t => t.group === g)) {
    f.append(el('button', { class: 'flyitem' + (S.tool === t.id ? ' on' : ''), onclick: () => { closeFlyout(); setTool(t.id); }, html: t.svg },
      el('span', {}, t.name), t.key ? el('kbd', {}, t.key.toUpperCase()) : null));
  }
  f.hidden = false;
  const r = anchor.getBoundingClientRect();
  f.style.left = Math.max(8, Math.min(innerWidth - f.offsetWidth - 8, r.left)) + 'px';
  f.style.top = r.bottom + 4 + 'px';
}
function closeFlyout() { $('#flyout').hidden = true; flyGroup = null; }

// ---------- algebra view ----------

const rows = new Map();
function rowHead(o) {
  const v = o.val, d = S.settings.digits;
  if (v.t === 'undef') return `${o.name} undefined`;
  const val = describe(v, d);
  switch (v.t) {
    case 'line': case 'ray': case 'circle': case 'conic': return `${o.name}: ${val}`;
    case 'implicit': case 'curve': case 'locus': return `${o.name}: ${o.ast.k === 'eq' ? print(o.ast, { pretty: true, digits: d }) : print(o.ast, { pretty: true, digits: d })}`;
    case 'fn': return `${o.name}(${v.v || 'x'}) = ${val ?? print(o.ast, { pretty: true, digits: d })}`;
    case 'text': return `${o.name} = “${val}”`;
    default: return `${o.name} = ${val}`;
  }
}
function rowSub(o) {
  if (isPtLit(o.ast) || isNumLit(o.ast) || o.ast.k === 'eq' || o.ast.k === 'fn') return '';
  if (o.ast.k === 'call' && /^text$/i.test(o.ast.f) && o.ast.a[0].k === 'str') return '';
  const s = print(o.ast, { pretty: true, digits: S.settings.digits });
  return s;
}
function editString(o) {
  if (o.ast.k === 'fn') return `${o.name}(${o.ast.v}) = ${print(o.ast.body, { digits: 6 })}`;
  if (o.ast.k === 'eq') return `${o.name}: ${print(o.ast, { digits: 6 })}`;
  return `${o.name} = ${print(o.ast, { digits: 6 })}`;
}
function colorOf(o) { return R.styleOf(o, cons).color; }

function refreshAlgebra() {
  const list = $('#alist');
  list.textContent = '';
  rows.clear();
  const shown = cons.objs.filter(o => S.settings.showAux || !o.style.aux);
  if (!shown.length) {
    list.append(el('div', { class: 'empty' },
      el('p', {}, 'Pick a tool above, or type below:'),
      ...['A = (1, 2)', 'Circle(A, 3)', 'f(x) = x^2 - 2', 'y = 2x + 1', 'x^2/9 + y^2/4 = 1', 'a = 2'].map(s =>
        el('button', { class: 'ex', onclick: () => { $('#input').value = s; $('#input').focus(); } }, s))));
    return;
  }
  for (const o of shown) {
    const dotB = el('button', { class: 'vis', title: o.style.hidden ? 'Show' : 'Hide', 'aria-label': `${o.style.hidden ? 'Show' : 'Hide'} ${o.name}`,
      onclick: ev => { ev.stopPropagation(); o.style.hidden = !o.style.hidden; commit(); } });
    dotB.style.setProperty('--c', colorOf(o));
    if (o.style.hidden) dotB.classList.add('off');
    const head = el('div', { class: 'hd' }, rowHead(o));
    const sub = el('div', { class: 'sub' }, rowSub(o));
    const body = el('div', { class: 'rb' }, head, sub);
    const row = el('div', { class: 'row' + (S.selection.has(o.name) ? ' sel' : ''), tabindex: '0', 'data-name': o.name }, dotB, body);
    let slider = null;
    if (o.val.t === 'num' && isNumLit(o.ast)) {
      const s = o.style.slider || (o.style.slider = sliderDefaults(o.ast));
      slider = el('input', { type: 'range', min: s.min, max: s.max, step: s.step, value: sliderUnit(o), 'aria-label': `${o.name} slider`,
        oninput: ev => setSliderUnit(o, parseFloat(ev.target.value)), onchange: () => commit(), onclick: ev => ev.stopPropagation() });
      const play = el('button', { class: 'play' + (o.style.anim ? ' on' : ''), title: o.style.anim ? 'Stop' : 'Animate', 'aria-label': 'Animate',
        onclick: ev => { ev.stopPropagation(); o.style.anim = !o.style.anim; if (o.style.anim) startAnim(); commit(); }, html: o.style.anim ? '❚❚' : '▶' });
      body.append(el('div', { class: 'srow' }, slider, play));
    }
    row.addEventListener('click', ev => {
      if (ev.shiftKey) S.selection.has(o.name) ? S.selection.delete(o.name) : S.selection.add(o.name);
      else S.selection = new Set([o.name]);
      highlightRows(); refreshProps(); render();
    });
    row.addEventListener('dblclick', () => editRow(o.name));
    row.addEventListener('keydown', ev => { if (ev.key === 'Enter') editRow(o.name); });
    list.append(row);
    rows.set(o.name, { row, head, sub, dot: dotB, slider });
  }
  refreshAlgebraFuture();
}
function updateAlgebraValues() {
  for (const [n, r] of rows) {
    const o = cons.get(n);
    if (!o || r.editing) continue;
    const h = rowHead(o);
    if (r.head.textContent !== h) r.head.textContent = h;
    const s = rowSub(o);
    if (r.sub.textContent !== s) r.sub.textContent = s;
    if (r.slider && document.activeElement !== r.slider) r.slider.value = sliderUnit(o);
  }
  if (propsFor) refreshPropsValues();
}
function highlightRows() {
  for (const [n, r] of rows) r.row.classList.toggle('sel', S.selection.has(n));
  const first = [...S.selection][0];
  if (first && rows.get(first)) rows.get(first).row.scrollIntoView({ block: 'nearest' });
}

function editRow(name) {
  showAlgebra(true);
  const r = rows.get(name), o = cons.get(name);
  if (!r || !o) return;
  r.editing = true;
  const inp = el('input', { class: 'edit', value: editString(o), spellcheck: 'false', autocomplete: 'off', 'aria-label': `Edit ${name}` });
  const err = el('div', { class: 'err' });
  r.head.replaceWith(inp); r.sub.replaceWith(err);
  inp.focus(); inp.select();
  const done = apply => {
    if (!r.editing) return;
    r.editing = false;
    if (apply && inp.value.trim() !== editString(o)) {
      try {
        redefineFromText(o, inp.value);
        commit();
        return;
      } catch (e) { r.editing = true; err.textContent = e.message; inp.focus(); return; }
    }
    refreshAlgebra();
  };
  inp.addEventListener('keydown', ev => {
    ev.stopPropagation();
    if (ev.key === 'Enter') done(true);
    if (ev.key === 'Escape') done(false);
  });
  inp.addEventListener('blur', () => setTimeout(() => done(true), 0));
}
function redefineFromText(o, src) {
  let { name, ast } = parseStatement(src);
  if (!name) { ({ ast } = parseStatement(src)); name = o.name; }
  if (name !== o.name) cons.rename(o.name, name);
  cons.redefine(name, ast);
}

// ---------- input bar ----------

const input = $('#input');
// Chat frames may block form submission, so Enter is handled directly too.
$('#inputForm').addEventListener('submit', ev => { ev.preventDefault(); submitInput(); });
function submitInput() {
  const src = input.value.trim();
  if (!src) return;
  if (suggest.items.length && !suggest.box.hidden) return applySuggest();
  const m = /^([A-Za-z]+)\s*\(/.exec(src);
  if (m && STATEMENTS[m[1].toLowerCase()]) {
    const r = runScript(cons, src, { defaultStyle });
    if (r.errors.length) { $('#inputErr').textContent = r.errors[0].msg; return; }
    applyScriptEffects(r);
    S.inputHist.push(src); S.inputIdx = -1; input.value = ''; $('#inputErr').textContent = '';
    commit(); refreshProps();
    return;
  }
  try {
    const existed = (() => { try { const st = parseStatement(src); return st.name && cons.has(st.name); } catch { return false; } })();
    const before = existed && typeLabel(cons.get(parseStatement(src).name));
    const o = cons.exec(src, defaultStyle);
    if (existed && typeLabel(o) !== before) toast(`Redefined ${before} ${o.name} as a ${typeLabel(o)}`);
    if (!existed && isNumLit(o.ast) && !o.style.slider) o.style.slider = sliderDefaults(o.ast);
    S.inputHist.push(src); S.inputIdx = -1;
    input.value = '';
    $('#inputErr').textContent = '';
    if (!existed) S.selection = new Set([o.name]);
    commit();
  } catch (e) {
    $('#inputErr').textContent = e.message;
  }
}
input.addEventListener('keydown', ev => {
  ev.stopPropagation();
  if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); submitInput(); return; }
  if (!suggest.box.hidden && suggest.items.length) {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      suggest.i = (suggest.i + (ev.key === 'ArrowDown' ? 1 : -1) + suggest.items.length) % suggest.items.length;
      return renderSuggest();
    }
    if (ev.key === 'Tab') { ev.preventDefault(); return applySuggest(); }
    if (ev.key === 'Escape') { suggest.box.hidden = true; return; }
  }
  if (ev.key === 'Escape') { input.blur(); return; }
  if ((ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && S.inputHist.length) {
    ev.preventDefault();
    if (ev.key === 'ArrowUp') S.inputIdx = S.inputIdx < 0 ? S.inputHist.length - 1 : Math.max(0, S.inputIdx - 1);
    else S.inputIdx = S.inputIdx < 0 ? -1 : S.inputIdx + 1 >= S.inputHist.length ? -1 : S.inputIdx + 1;
    input.value = S.inputIdx < 0 ? '' : S.inputHist[S.inputIdx];
  }
});
const suggest = { box: $('#suggest'), items: [], i: 0, word: null };
input.addEventListener('input', () => {
  $('#inputErr').textContent = '';
  const pos = input.selectionStart, before = input.value.slice(0, pos);
  const m = /([A-Za-z][A-Za-z0-9]*)$/.exec(before);
  suggest.items = [];
  if (m && m[1].length >= 2) {
    const w = m[1].toLowerCase();
    const seen = new Set();
    for (const [l, name] of Object.entries(CANON)) {
      if (l.startsWith(w) && !seen.has(HELP[l])) { seen.add(HELP[l]); suggest.items.push({ name, help: HELP[l] }); }
    }
    suggest.items.sort((a, b) => a.name.length - b.name.length);
    suggest.items = suggest.items.slice(0, 8);
    suggest.word = m[1];
  }
  suggest.i = 0;
  renderSuggest();
});
input.addEventListener('blur', () => setTimeout(() => { suggest.box.hidden = true; }, 150));
function renderSuggest() {
  const b = suggest.box;
  b.textContent = '';
  if (!suggest.items.length) { b.hidden = true; return; }
  suggest.items.forEach((it, i) => b.append(el('button', { type: 'button', class: 'sg' + (i === suggest.i ? ' on' : ''),
    onmousedown: ev => { ev.preventDefault(); suggest.i = i; applySuggest(); } }, el('b', {}, it.name), el('span', {}, it.help))));
  b.hidden = false;
}
function applySuggest() {
  const it = suggest.items[suggest.i];
  if (!it) return;
  const pos = input.selectionStart;
  const before = input.value.slice(0, pos - suggest.word.length), after = input.value.slice(pos);
  const ins = after.startsWith('(') ? it.name : it.name + '(';
  input.value = before + ins + after;
  const c = before.length + ins.length;
  input.setSelectionRange(c, c);
  suggest.items = []; suggest.box.hidden = true;
  input.focus();
}

// ---------- properties ----------

let propsFor = null;
function refreshProps() {
  const box = $('#props');
  const sel = [...S.selection].filter(n => cons.has(n));
  if (!sel.length || S.tool !== 'move') { box.hidden = true; propsFor = null; return; }
  const objs = sel.map(n => cons.get(n));
  const o = objs[0];
  propsFor = o.name;
  box.textContent = '';
  const many = objs.length > 1;
  const setAll = (k, v) => { for (const q of objs) { if (v === undefined) delete q.style[k]; else q.style[k] = v; } commit(); };
  const head = el('div', { class: 'ph' });
  if (many) head.append(el('b', {}, `${objs.length} objects`));
  else {
    const nm = el('input', { class: 'pname', value: o.name, 'aria-label': 'Name', spellcheck: 'false',
      onchange: ev => { try { cons.rename(o.name, ev.target.value.trim()); S.selection = new Set([ev.target.value.trim()]); commit(); } catch (e) { toast(e.message, 'error'); ev.target.value = o.name; } } });
    head.append(nm, el('span', { class: 'ptype' }, typeLabel(o)));
  }
  head.append(el('button', { class: 'ib small', title: 'Close', 'aria-label': 'Close properties', onclick: () => { S.selection.clear(); refreshProps(); highlightRows(); render(); }, html: '✕' }));
  box.append(head);
  if (!many) {
    const def = el('input', { class: 'pdef', value: editString(o).replace(/^[^=:]*[=:]\s*/, ''), 'aria-label': 'Definition', spellcheck: 'false',
      onkeydown: ev => { ev.stopPropagation(); if (ev.key === 'Enter') ev.target.blur(); },
      onchange: ev => {
        const src = o.ast.k === 'fn' ? `${o.name}(${o.ast.v}) = ${ev.target.value}` : o.ast.k === 'eq' ? `${o.name}: ${ev.target.value}` : `${o.name} = ${ev.target.value}`;
        try { redefineFromText(o, src); commit(); } catch (e) { toast(e.message, 'error'); }
      } });
    box.append(el('label', { class: 'pl' }, el('span', {}, 'Definition'), def));
  }
  // colour
  const sw = el('div', { class: 'swatches' });
  for (const c of SWATCHES) {
    const b = el('button', { class: 'sw' + ((o.style.color || null) === c ? ' on' : ''), title: c || 'Default', 'aria-label': c ? `Colour ${c}` : 'Default colour',
      onclick: () => setAll('color', c || undefined) });
    b.style.setProperty('--c', c || R.styleOf({ ...o, style: { ...o.style, color: undefined } }, cons).color);
    if (!c) b.classList.add('def');
    sw.append(b);
  }
  const custom = el('input', { type: 'color', value: o.style.color || '#2457d6', 'aria-label': 'Custom colour', oninput: ev => { for (const q of objs) q.style.color = ev.target.value; render(); }, onchange: () => commit() });
  sw.append(custom);
  box.append(el('div', { class: 'pl' }, el('span', {}, 'Colour'), sw));
  const st = R.styleOf(o, cons);
  const isPt = o.val.t === 'pt' || o.val.t === 'pts';
  const range = (label, k, min, max, step, value) => el('label', { class: 'pl' }, el('span', {}, label),
    el('input', { type: 'range', min, max, step, value, oninput: ev => { for (const q of objs) q.style[k] = +ev.target.value; render(); }, onchange: () => commit() }));
  if (isPt) box.append(range('Size', 'size', 1.5, 9, 0.5, st.size));
  else if (!['text', 'num'].includes(o.val.t) || o.val.arc) box.append(range('Thickness', 'width', 0.5, 9, 0.5, st.width));
  if (!isPt && !['text'].includes(o.val.t) && (o.val.t !== 'num' || o.val.arc)) {
    const seg = el('div', { class: 'seg' });
    ['Solid', 'Dashed', 'Dotted'].forEach((l, i) => seg.append(el('button', { class: (st.dash || 0) === i ? 'on' : '', onclick: () => setAll('dash', i || undefined) }, l)));
    box.append(el('div', { class: 'pl' }, el('span', {}, 'Line'), seg));
    if (o.val.t === 'seg' || o.val.t === 'vec') {
      const m = el('div', { class: 'seg' });
      ['None', '|', '||', '|||'].forEach((l, i) => m.append(el('button', { class: (o.style.ticks || 0) === i ? 'on' : '', title: i ? `${i} tick mark${i > 1 ? 's' : ''} (equal lengths)` : 'No marks', onclick: () => setAll('ticks', i || undefined) }, l)));
      box.append(el('div', { class: 'pl' }, el('span', {}, 'Marks'), m));
    }
    if (o.val.t === 'num' && o.val.arc) {
      const m = el('div', { class: 'seg' });
      ['1 arc', '2', '3'].forEach((l, i) => m.append(el('button', { class: (o.style.arcs || 1) === i + 1 ? 'on' : '', title: 'Arcs mark equal angles', onclick: () => setAll('arcs', i ? i + 1 : undefined) }, l)));
      box.append(el('div', { class: 'pl' }, el('span', {}, 'Marks'), m));
    }
  }
  if (['poly', 'circle', 'arc', 'conic'].includes(o.val.t) || (o.val.t === 'num' && (o.val.arc || o.val.shade))) box.append(range('Fill', 'fill', 0, 1, 0.05, st.fill));
  if (o.val.t === 'text') box.append(range('Font size', 'fontSize', 10, 48, 1, st.fontSize));
  // label
  if (o.val.t !== 'text') {
    const lab = el('input', { type: 'checkbox', checked: R.wantsLabel(o), onchange: ev => setAll('label', ev.target.checked) });
    const mode = el('select', { 'aria-label': 'Label shows', onchange: ev => setAll('lm', ev.target.value) },
      ...[['name', 'Name'], ['value', 'Value'], ['nameValue', 'Name & value'], ['caption', 'Caption']].map(([v, l]) =>
        el('option', { value: v, selected: (o.style.lm || defaultLabelMode(o)) === v }, l)));
    const row = el('div', { class: 'pl' }, el('span', {}, 'Label'), el('label', { class: 'cb' }, lab, 'Show'), mode);
    box.append(row);
    if ((o.style.lm || '') === 'caption' && !many) {
      box.append(el('label', { class: 'pl' }, el('span', {}, 'Caption'), el('input', { value: o.style.caption || '', onkeydown: ev => ev.stopPropagation(), onchange: ev => setAll('caption', ev.target.value || undefined) })));
    }
  }
  const flags = el('div', { class: 'flags' });
  const flag = (label, k, on) => flags.append(el('label', { class: 'cb' }, el('input', { type: 'checkbox', checked: !!on, onchange: ev => setAll(k, ev.target.checked || undefined) }), label));
  if (o.val.t === 'pt') flag('Trace', 'trace', o.style.trace);
  if (objs.some(q => cons.isFreePoint(q) || cons.isFreeNum(q) || cons.isOnPath(q) || cons.isFreeText(q) || q.style.fixed)) flag('Fixed', 'fixed', o.style.fixed);
  flag('Hidden', 'hidden', o.style.hidden);
  flag('Auxiliary', 'aux', o.style.aux);
  if (o.val.t === 'num' && isNumLit(o.ast)) flag('Slider on canvas', '__slider', o.style.slider && o.style.slider.show);
  if (cons.isOnPath(o) && o.ast.a[1].k === 'num') flag('Animate', 'anim', o.style.anim);
  box.append(flags);
  flags.querySelectorAll('input').forEach(inp => {
    if (inp.parentElement.textContent === 'Slider on canvas') {
      inp.onchange = ev => {
        const s = o.style.slider || (o.style.slider = sliderDefaults(o.ast));
        s.show = ev.target.checked;
        if (s.show && s.sx == null) { s.sx = 30; s.sy = 40 + 44 * cons.objs.filter(q => q.style.slider && q.style.slider.show && q !== o).length; }
        commit();
      };
    }
    if (inp.parentElement.textContent === 'Animate') inp.addEventListener('change', () => o.style.anim && startAnim());
    if (inp.parentElement.textContent === 'Trace') inp.addEventListener('change', () => { if (!o.style.trace) o.trace = null; });
  });
  if (!many && o.val.t === 'num' && isNumLit(o.ast)) {
    const s = o.style.slider || (o.style.slider = sliderDefaults(o.ast));
    const f = (label, k) => el('label', { class: 'mini' }, label, el('input', { type: 'number', value: s[k], step: 'any', onkeydown: ev => ev.stopPropagation(),
      onchange: ev => { const v = parseFloat(ev.target.value); if (Number.isFinite(v)) { s[k] = v; if (s.max <= s.min || s.step <= 0) { toast('Check min, max and step', 'error'); return; } commit(); } } }));
    box.append(el('div', { class: 'pl' }, el('span', {}, 'Slider'), el('div', { class: 'minis' }, f('min', 'min'), f('max', 'max'), f('step', 'step'))));
  }
  if (!many && o.trace) box.append(el('button', { class: 'btn', onclick: () => { o.trace = []; render(); } }, 'Clear trace'));
  box.append(el('div', { class: 'pfoot' },
    el('button', { class: 'btn danger', onclick: () => { cons.remove(sel); S.selection.clear(); commit(); } }, many ? 'Delete all' : 'Delete'),
    !many ? el('span', { class: 'pval' }, rowHead(o)) : null));
  box.hidden = false;
}
function refreshPropsValues() {
  const o = cons.get(propsFor), pv = $('#props .pval');
  if (o && pv) pv.textContent = rowHead(o);
}
function typeLabel(o) {
  const v = o.val;
  if (v.t === 'num') return v.arc ? 'angle' : isNumLit(o.ast) ? 'slider' : 'number';
  if (v.t === 'pt') return cons.isFreePoint(o) ? 'free point' : cons.isOnPath(o) ? 'point on path' : 'point';
  if (v.t === 'conic') return conicInfo(v).type;
  return { pts: 'points', vec: 'vector', seg: 'segment', poly: v.closed ? 'polygon' : 'polyline', arc: v.sector ? 'sector' : 'arc', fn: 'function', undef: 'undefined' }[v.t] || v.t;
}

// ---------- dialogs, toast, menu ----------

function ask(title, fields) {
  return new Promise(resolve => {
    const dlg = $('#dlg');
    dlg.textContent = '';
    const form = el('form', { method: 'dialog' });
    form.append(el('h2', {}, title));
    const inputs = {};
    for (const f of fields) {
      let inp;
      if (f.type === 'checkbox') inp = el('input', { type: 'checkbox' });
      else if (f.type === 'select') inp = el('select', {}, ...f.options.map(([v, l]) => el('option', { value: v, selected: v === f.value }, l)));
      else if (f.type === 'textarea') inp = el('textarea', { rows: 3, spellcheck: 'false' }, f.value || '');
      else inp = el('input', { value: f.value ?? '', spellcheck: 'false', autocomplete: 'off' });
      inputs[f.key] = inp;
      inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter' && !ev.shiftKey && f.type !== 'select') { ev.preventDefault(); ok(); } });
      form.append(f.type === 'checkbox' ? el('label', { class: 'cb' }, inp, f.label) : el('label', { class: 'fl' }, el('span', {}, f.label), inp));
    }
    const ok = () => {
      const out = {};
      for (const [k, inp] of Object.entries(inputs)) out[k] = inp.type === 'checkbox' ? inp.checked : inp.value;
      dlg.close(); resolve(out);
    };
    form.append(el('div', { class: 'acts' },
      el('button', { type: 'button', class: 'btn', onclick: () => { dlg.close(); resolve(null); } }, 'Cancel'),
      el('button', { type: 'button', class: 'btn primary', onclick: () => ok() }, 'OK')));
    form.addEventListener('submit', ev => { ev.preventDefault(); ok(); });
    dlg.append(form);
    dlg.onclose = () => resolve(null);
    dlg.showModal();
    const first = Object.values(inputs)[0];
    first.focus(); if (first.select) first.select();
  });
}

let toastTimer = 0;
function toast(msg, kind) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (kind ? ' ' + kind : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3800);
}

function closeMenu() { $('#menu').hidden = true; }
function openMenu() {
  const m = $('#menu');
  if (!m.hidden) return closeMenu();
  m.textContent = '';
  const item = (label, fn, kbd) => m.append(el('button', { class: 'mi', onclick: () => { closeMenu(); fn(); } }, el('span', {}, label), kbd ? el('kbd', {}, kbd) : null));
  const check = (label, k) => m.append(el('label', { class: 'mi' }, el('span', {}, label),
    el('input', { type: 'checkbox', checked: S.settings[k], onchange: ev => { S.settings[k] = ev.target.checked; saveSettings(); if (k === 'showAux') refreshAlgebra(); render(); } })));
  const choice = (label, k, opts) => m.append(el('label', { class: 'mi' }, el('span', {}, label),
    el('select', { onchange: ev => { const v = ev.target.value; if (k === '__template') { closeMenu(); if (v) applyTemplate(v); return; } if (k === '__demo') { closeMenu(); if (v) loadDemo(+v); return; } S.settings[k] = /^\d+$/.test(v) ? +v : v; saveSettings(); if (k === 'theme') applyTheme(); refreshAlgebra(); viewChanged(); } },
      ...opts.map(([v, l]) => el('option', { value: v, selected: String(S.settings[k]) === String(v) }, l)))));
  item('New', newDoc);
  if (EMBED) {
    // Downloads and file pickers are blocked inside chat frames.
    item('Open in Geometry Drawer ↗', openInApp);
    item('Asymptote / TikZ code…', () => showExport('asy'));
  } else {
    item('Open file…', () => $('#file').click(), 'Ctrl+O');
    item('Save file', saveFile, 'Ctrl+S');
    item('Export PNG', exportPng);
    item('Export SVG', exportSvg);
    item('Export Asymptote / TikZ…', () => showExport('asy'));
    item('Copy share link', shareLink);
  }
  m.append(el('hr'));
  item('Step through construction', enterSteps);
  choice('Theorem demos', '__demo', [['', 'Choose…'], ...DEMOS.map((d, i) => [String(i), d.title])]);
  choice('New from template', '__template', [['', 'Choose…'], ...Object.keys(TEMPLATES).map(k => [k, k])]);
  m.append(el('hr'));
  item('Fit all objects', fitAll, 'F');
  item('Standard view', standardView, '0');
  m.append(el('label', { class: 'mi' }, el('span', {}, 'Clean diagram (no axes or grid)'),
    el('input', { type: 'checkbox', checked: !S.settings.grid && !S.settings.axes, onchange: ev => { S.settings.grid = S.settings.axes = !ev.target.checked; saveSettings(); closeMenu(); render(); } })));
  check('Grid', 'grid');
  check('Axes', 'axes');
  check('Snap to grid', 'snap');
  check('Show auxiliary objects', 'showAux');
  choice('Labels for new objects', 'labeling', [['auto', 'Points only'], ['all', 'All'], ['none', 'None']]);
  choice('Rounding', 'digits', [0, 1, 2, 3, 4, 5, 6, 8, 10].map(d => [d, `${d} decimal${d === 1 ? '' : 's'}`]));
  choice('Theme', 'theme', [['auto', 'System'], ['light', 'Light'], ['dark', 'Dark']]);
  m.append(el('hr'));
  item('Shortcuts & commands', showHelp, '?');
  m.hidden = false;
}
function saveSettings() { store.set('gd:settings', S.settings); }

function newDoc() {
  if (cons.objs.length && !okToReplace('Start a new construction? (Undo can bring this one back.)')) return;
  cons.load([]);
  S.selection.clear(); S.fnColor = 0;
  standardView();
  commit();
}
function download(name, blob) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function saveFile() {
  download(`construction-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(docJSON(), null, 1)], { type: 'application/json' }));
}
function exportPng() {
  const off = R.png(cons, { selection: new Set() }, 2);
  render();
  off.toBlob(b => download('construction.png', b), 'image/png');
}
async function encodeDoc() {
  const json = JSON.stringify({ v: view.toJSON(), s: { grid: S.settings.grid, axes: S.settings.axes }, o: cons.toJSON() });
  const bytes = new TextEncoder().encode(json);
  let data = bytes, tag = 'u';
  if (typeof CompressionStream !== 'undefined') {
    const cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    data = new Uint8Array(await new Response(cs).arrayBuffer()); tag = 'z';
  }
  let bin = '';
  for (const b of data) bin += String.fromCharCode(b);
  return tag + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function decodeDoc(s) {
  const tag = s[0], b64 = s.slice(1).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64), bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  let text;
  if (tag === 'z') text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  else text = new TextDecoder().decode(bytes);
  return docFromPayload(JSON.parse(text));
}
const docFromPayload = d => ({ format: 'geometry-drawer', version: 1, view: d.v, settings: d.s, objects: d.o, info: d.i && { title: String(d.i.t || ''), caption: String(d.i.c || '') } });
// Short links (#s=<id>) made by the MCP server, which stores the figure.
const SHARE_API = '/geometry-mcp/s/';
async function fetchShared(id) {
  if (!/^[0-9a-z]{12}$/.test(id)) throw new Error('this figure link is incomplete. Ask for a fresh link');
  let r;
  try { r = await fetch(SHARE_API + id); } catch { throw new Error('the figure server could not be reached'); }
  if (r.status === 404) throw new Error('this figure link is unknown or has expired');
  if (!r.ok) throw new Error(`the figure server answered ${r.status}`);
  return docFromPayload(await r.json());
}
async function shareLink() {
  if (EMBED) return openInApp();
  const url = `${location.origin}${location.pathname}#c=${await encodeDoc()}`;
  try { await navigator.clipboard.writeText(url); toast('Link copied - it contains the whole construction'); }
  catch { prompt('Copy this link:', url); }
}
$('#file').addEventListener('change', async ev => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (!f) return;
  try { loadDoc(JSON.parse(await f.text())); S.selection.clear(); commit(); viewChanged(); toast(`Opened ${f.name}`); }
  catch (e) { toast(`Could not open: ${e.message}`, 'error'); }
});

function standardView() { Object.assign(view, { cx: 0, cy: 0, scale: 50 }); viewChanged(); }
function fitAll() {
  const f = fitView(cons, view.W, view.H);
  if (!f) return standardView();
  Object.assign(view, f);
  viewChanged();
}

// ---------- relation checker ----------

const perturbRuns = (trials, fn) => cons.perturb(trials, fn);

// Drag the construction through random nearby positions and re-test each
// relation: a theorem survives, a coincidence of this picture does not.
function generality(names, tests, trials = 40) {
  const counts = tests.map(() => ({ ok: 0, n: 0 }));
  const any = perturbRuns(trials, () => {
    const vals = names.map(n => cons.get(n).val);
    if (vals.some(v => v.t === 'undef')) return;
    tests.forEach((t, k) => {
      let r = null;
      try { r = t(vals); } catch { r = null; }
      if (r === null) return;
      counts[k].n++; if (r) counts[k].ok++;
    });
  });
  return any ? counts : tests.map(() => null);
}

// ---------- angle chasing ----------

// Every angle formed at a named point by two drawn lines through other named
// points, grouped into classes that stay equal under random perturbation.
function findEqualAngles() {
  const pts = cons.objs.filter(o => o.val.t === 'pt' && !o.style.hidden && !o.style.aux).slice(0, 40);
  const lines = [];
  for (const o of cons.objs) {
    if (o.style.hidden) continue;
    if (isLinear(o.val)) lines.push(o.val);
    if (o.val.t === 'poly') o.val.pts.forEach((p, i, a) => { if (o.val.closed || i < a.length - 1) { const q = a[(i + 1) % a.length]; lines.push({ t: 'seg', p, d: { x: q.x - p.x, y: q.y - p.y } }); } });
  }
  const on = pts.map(p => lines.map(l => R_.onPath(p.val, l)));
  const joined = (i, j) => lines.some((_, k) => on[i][k] && on[j][k]);
  const angles = [], seen = new Set();
  pts.forEach((Y, yi) => {
    const rays = [];
    pts.forEach((X, xi) => {
      if (xi === yi || !joined(xi, yi)) return;
      const dx = X.val.x - Y.val.x, dy = X.val.y - Y.val.y, L = Math.hypot(dx, dy);
      if (L < 1e-12) return;
      const u = { x: dx / L, y: dy / L };
      if (rays.some(r => Math.hypot(r.u.x - u.x, r.u.y - u.y) < 1e-9)) return;
      const opp = rays.find(r => Math.hypot(r.u.x + u.x, r.u.y + u.y) < 1e-9);
      rays.push({ u, rep: X.name, line: opp ? opp.line : rays.length, sign: opp ? -opp.sign : 1 });
    });
    for (let i = 0; i < rays.length; i++) for (let j = i + 1; j < rays.length; j++) {
      const r1 = rays[i], r2 = rays[j];
      if (r1.line === r2.line) continue;
      const key = `${Y.name}|${Math.min(r1.line, r2.line)}|${Math.max(r1.line, r2.line)}|${r1.sign * r2.sign}`;
      if (seen.has(key)) continue;          // the vertical angle is the same angle
      seen.add(key);
      angles.push([r1.rep, Y.name, r2.rep]);
    }
  });
  if (angles.length > 4000) angles.length = 4000;
  const value = ([x, y, z]) => {
    const X = cons.get(x).val, Y = cons.get(y).val, Z = cons.get(z).val;
    if (X.t !== 'pt' || Y.t !== 'pt' || Z.t !== 'pt') return NaN;
    const a = Math.atan2(X.y - Y.y, X.x - Y.x), b = Math.atan2(Z.y - Y.y, Z.x - Y.x);
    let d = Math.abs(a - b) % (2 * Math.PI);
    if (d > Math.PI) d = 2 * Math.PI - d;
    return d * 180 / Math.PI;
  };
  const sig = angles.map(a => [value(a)]);
  perturbRuns(12, () => angles.forEach((a, k) => sig[k].push(value(a))));
  const same = (s, t) => {
    let n = 0;
    for (let k = 0; k < s.length; k++) {
      if (!Number.isFinite(s[k]) || !Number.isFinite(t[k])) continue;
      if (Math.abs(s[k] - t[k]) > 1e-6) return false;
      n++;
    }
    return n >= Math.min(8, s.length);
  };
  const idx = angles.map((_, k) => k).filter(k => sig[k][0] > 1e-6 && sig[k][0] < 180 - 1e-6).sort((p, q) => sig[p][0] - sig[q][0]);
  const groups = [];
  let run = [];
  const flush = () => {
    const gs = [];
    for (const k of run) { const g = gs.find(g => same(sig[g[0]], sig[k])); g ? g.push(k) : gs.push([k]); }
    groups.push(...gs);
    run = [];
  };
  for (const k of idx) { if (run.length && sig[k][0] - sig[run[0]][0] > 1e-6) flush(); run.push(k); }
  flush();
  const right = groups.filter(g => Math.abs(sig[g[0]][0] - 90) < 1e-6 && sig[g[0]].every(v => !Number.isFinite(v) || Math.abs(v - 90) < 1e-6));
  return groups.filter(g => g.length >= 2 || right.includes(g))
    .map(g => ({ angles: g.map(k => angles[k]), deg: sig[g[0]][0], right: right.includes(g) }))
    .sort((a, b) => b.angles.length - a.angles.length || a.deg - b.deg);
}

const CHASE_COLORS = ['#c0392b', '#2457d6', '#138d75', '#8e44ad', '#d35400', '#b8860b', '#e84393', '#00a8c6'];
function markAngles(group, gi) {
  const N = allocator();
  const items = group.angles.slice(0, 8).map(a => ({ name: N('angle'), src: `Angle(${a.join(', ')})`,
    style: { arcs: group.right ? undefined : (gi % 3) + 1, color: CHASE_COLORS[gi % CHASE_COLORS.length], label: false } }));
  if (createItems(items)) commit();
}
function showAngleChase() {
  const box = $('#rel');
  box.textContent = '';
  const t0 = performance.now();
  const groups = findEqualAngles();
  const ms = Math.round(performance.now() - t0);
  box.append(el('div', { class: 'relh' }, el('b', {}, 'Equal angles'), ` ${groups.length} group${groups.length === 1 ? '' : 's'}`));
  if (!groups.length) box.append(el('p', { class: 'relhint' }, 'No equal angles between drawn lines. Angles are measured at named points, between segments or lines that pass through other named points.'));
  const list = el('ul', { class: 'rels' });
  const nm = a => `∠${a.join('')}`;
  groups.slice(0, 30).forEach((g, gi) => {
    const shown = g.angles.slice(0, 6).map(nm).join(' = ') + (g.angles.length > 6 ? ` (+${g.angles.length - 6})` : '');
    const deg = `${fmtNum(g.deg, S.settings.digits)}°`;
    list.append(el('li', { class: 'yes' }, el('span', { class: 'mark', style: `background:${CHASE_COLORS[gi % CHASE_COLORS.length]}` }, g.right ? '⊾' : String(g.angles.length)),
      el('div', { class: 'grow' }, el('div', {}, g.right && g.angles.length === 1 ? `${shown} = 90°` : shown), el('small', {}, `${deg} - equal in all random positions`)),
      el('button', { class: 'btn small', title: 'Draw these angles with matching marks', onclick: () => markAngles(g, gi) }, 'Mark')));
  });
  box.append(list);
  box.append(el('p', { class: 'relhint' }, `Checked on 12 random positions (${ms} ms). Click the canvas to search again.`));
  box.hidden = false;
}

function showRelations() {
  const box = $('#rel');
  if (S.tool === 'anglechase') { showAngleChase(); return; }
  if (S.tool !== 'relation') { box.hidden = true; return; }
  box.textContent = '';
  const names = S.tsel.filter(n => cons.has(n));
  box.append(el('div', { class: 'relh' }, el('b', {}, 'Check relation'), names.length ? ` ${names.join(', ')}` : ''));
  if (names.length < 2) {
    box.append(el('p', { class: 'relhint' }, names.length ? 'Pick 1 to 3 more objects.' : 'Click 2 to 4 objects: points, lines, circles, angles or lengths. Click empty space to start over.'));
    box.hidden = false; return;
  }
  const rs = relations(names.map(n => cons.get(n)));
  // What holds first; the main question (e.g. collinear?) last if it fails.
  const shown = [...rs.filter(r => r.holds), ...rs.slice(0, 1).filter(r => !r.holds)];
  const counts = generality(names, shown.map(r => r.test));
  const list = el('ul', { class: 'rels' });
  shown.forEach((r, i) => {
    const c = counts[i];
    let cls, sub;
    if (!r.holds) { cls = 'no'; sub = 'not true here'; }
    else if (!c) { cls = 'yes'; sub = 'true (nothing free to move)'; }
    else if (c.n && c.ok >= c.n * 0.97) { cls = 'yes'; sub = `always - held in ${c.ok} of ${c.n} random positions`; }
    else { cls = 'here'; sub = `only in this picture - fails in ${c.n - c.ok} of ${c.n} random positions`; }
    list.append(el('li', { class: cls }, el('span', { class: 'mark' }, cls === 'yes' ? '✓' : cls === 'here' ? '≈' : '✗'), el('div', {}, el('div', {}, r.text), el('small', {}, sub))));
  });
  if (!shown.length) list.append(el('li', { class: 'no' }, el('span', { class: 'mark' }, '-'), el('div', {}, 'No special relation found')));
  box.append(list);
  box.hidden = false;
}

// ---------- step-through ----------

function steps() { return cons.objs.filter(o => !o.style.hidden && !o.style.aux); }
function stepSet() {
  if (S.step == null) return null;
  const st = steps();
  const last = st[S.step - 1];
  const upto = last ? cons.objs.indexOf(last) : -1;
  return new Set(cons.objs.slice(0, upto + 1).map(o => o.name));
}
function enterSteps() {
  if (!steps().length) { toast('Nothing to step through yet'); return; }
  S.step = 1; setTool('move'); renderSteps(); render();
}
function exitSteps() { S.step = null; clearInterval(S.stepTimer); S.stepTimer = 0; $('#steps').hidden = true; refreshAlgebraFuture(); render(); }
function goStep(k) {
  const n = steps().length;
  S.step = Math.max(1, Math.min(n, k));
  renderSteps(); render();
}
function renderSteps() {
  const bar = $('#steps'), st = steps(), n = st.length, o = st[S.step - 1];
  bar.textContent = '';
  const b = (label, title, fn) => el('button', { class: 'ib small', title, 'aria-label': title, onclick: fn }, label);
  bar.append(
    b('⏮', 'First step', () => goStep(1)), b('◀', 'Previous step ([)', () => goStep(S.step - 1)),
    el('div', { class: 'stxt' }, el('b', {}, `${S.step} / ${n}`), ' ', o ? `${o.name} = ${print(o.ast, { pretty: true, digits: S.settings.digits })}` : ''),
    b('▶', 'Next step (])', () => goStep(S.step + 1)), b('⏭', 'Last step', () => goStep(n)),
    b(S.stepTimer ? '❚❚' : '⏵', 'Play', () => {
      if (S.stepTimer) { clearInterval(S.stepTimer); S.stepTimer = 0; }
      else { if (S.step >= n) S.step = 0; S.stepTimer = setInterval(() => { if (S.step >= steps().length) { clearInterval(S.stepTimer); S.stepTimer = 0; renderSteps(); } else goStep(S.step + 1); }, 900); }
      renderSteps();
    }),
    b('✕', 'Leave step mode (Esc)', exitSteps));
  bar.hidden = false;
  refreshAlgebraFuture();
}
function refreshAlgebraFuture() {
  const only = stepSet();
  for (const [n, r] of rows) r.row.classList.toggle('future', !!only && !only.has(n));
}

// ---------- export ----------

function showExport(fmt) {
  const dlg = $('#dlg');
  dlg.textContent = '';
  const ta = el('textarea', { class: 'code', readonly: true, spellcheck: 'false', rows: 16 });
  const sel = el('select', { 'aria-label': 'Format', onchange: () => { ta.value = exportDiagram(cons, R, sel.value); } },
    el('option', { value: 'asy', selected: fmt === 'asy' }, 'Asymptote'), el('option', { value: 'tikz', selected: fmt === 'tikz' }, 'TikZ'));
  ta.value = exportDiagram(cons, R, fmt);
  const form = el('form', { method: 'dialog', class: 'wide' },
    el('h2', {}, 'Export diagram ', sel),
    el('p', { class: 'relhint' }, 'The visible part of the canvas, clipped to the view. Hidden objects are left out.'),
    ta,
    el('div', { class: 'acts' },
      el('button', { type: 'button', class: 'btn', onclick: () => download(`diagram.${sel.value === 'tikz' ? 'tex' : 'asy'}`, new Blob([ta.value], { type: 'text/plain' })) }, 'Download'),
      el('button', { type: 'button', class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(ta.value); toast('Copied'); } catch { ta.select(); } } }, 'Copy'),
      el('button', { type: 'button', class: 'btn primary', onclick: () => $('#dlg').close() }, 'Close')));
  dlg.append(form);
  dlg.onclose = null;
  dlg.showModal();
}

// ---------- scripts ----------

function applyScriptEffects(r) {
  let changed = false;
  for (const k of ['grid', 'axes']) if (k in r.settings) { S.settings[k] = r.settings[k]; changed = true; }
  if (changed) saveSettings();
  if (r.view) {
    const v = r.view;
    view.scale = Math.min(view.W / (v.xmax - v.xmin), view.H / (v.ymax - v.ymin));
    view.cx = (v.xmin + v.xmax) / 2; view.cy = (v.ymin + v.ymax) / 2;
    viewChanged();
  }
}

const SCRIPT_EXAMPLES = {
  cmd: `# One statement per line, exactly like the input bar.
# Lines starting with # or // are comments.
A = (-3, -2)
B = (4, -2)
C = (-0.5, 3.2)
a = Segment(B, C)
b = Segment(C, A)
c = Segment(A, B)
ω = Circumcircle(A, B, C)
H = Orthocenter(A, B, C)
e = EulerLine(A, B, C)
SetLineStyle(e, "dashed")
SetColor(e, "red")
ShowAxes(false)
ShowGrid(false)
`,
  js: `// JavaScript that writes construction commands.
// cmd("...") adds one; point(name, x, y) adds a free point;
// range(n) and fmt(x) help with loops. Runs in a sandbox.
const n = 7, r = 3;
for (const k of range(n)) {
  const t = 2 * Math.PI * k / n;
  point("P_" + k, r * Math.cos(t), r * Math.sin(t));
}
// connect every vertex to the one 3 steps ahead: a star polygon {7/3}
for (const k of range(n)) cmd(\`s_\${k} = Segment(P_\${k}, P_\${(k + 3) % n})\`);
cmd("ω = Circle((0, 0), " + r + ")", "ShowAxes(false)", "ShowGrid(false)");
`,
};

const WORKER_SRC = `
self.onmessage = e => {
  const out = [], logs = [];
  const cmd = (...a) => { for (const s of a) { if (out.length >= 5000) throw new Error('more than 5000 commands'); out.push(String(s)); } };
  const range = (a, b, s = 1) => { if (b === undefined) { b = a; a = 0; } const r = []; for (let x = a; s > 0 ? x < b : x > b; x += s) r.push(x); return r; };
  const fmt = (x, d = 6) => String(+Number(x).toFixed(d));
  const point = (name, x, y) => cmd(name + ' = (' + fmt(x) + ', ' + fmt(y) + ')');
  const log = (...a) => logs.push(a.join(' '));
  try {
    new Function('cmd', 'range', 'fmt', 'point', 'log', '"use strict";\\n' + e.data)(cmd, range, fmt, point, log);
    self.postMessage({ out, logs });
  } catch (err) {
    const m = /<anonymous>:(\\d+):\\d+/.exec(String(err && err.stack));
    self.postMessage({ out, logs, error: String(err && err.message || err), line: m ? +m[1] - 3 : null });
  }
};`;

// User JavaScript runs in a Web Worker, killed after 3 s. On the website the
// worker lives inside sandbox.html, framed with sandbox="allow-scripts": an
// opaque origin with no network, so code cannot reach the site's other paths
// (the same origin hosts private tools). Embedded in a chat, the host's own
// sandbox frame already gives the editor a throwaway origin, so a plain worker
// is enough there.
function runJS(code) {
  return EMBED ? runJSWorker(code) : runJSSandboxed(code);
}
function runJSSandboxed(code) {
  return new Promise(resolve => {
    const frame = el('iframe', { sandbox: 'allow-scripts', src: 'sandbox.html', hidden: true, title: 'JavaScript sandbox' });
    let timer;
    const done = r => { clearTimeout(timer); removeEventListener('message', onMessage); frame.remove(); resolve(r); };
    // Untrusted: keep only well-formed strings and numbers.
    const clean = r => ({
      out: Array.isArray(r && r.out) ? r.out.slice(0, 5000).map(String) : [],
      logs: Array.isArray(r && r.logs) ? r.logs.slice(0, 200).map(String) : [],
      error: r && r.error != null ? String(r.error) : undefined,
      line: r && Number.isInteger(r.line) ? r.line : null,
    });
    const onMessage = e => {
      if (e.source !== frame.contentWindow || !e.data) return;
      if (e.data.gdSandbox === 'ready') {
        clearTimeout(timer);
        timer = setTimeout(() => done({ out: [], logs: [], error: 'Stopped after 3 seconds (an endless loop?)' }), 3000);
        frame.contentWindow.postMessage({ worker: WORKER_SRC, code }, '*');
      } else if (e.data.gdSandbox === 'result') done(clean(e.data.result));
    };
    addEventListener('message', onMessage);
    timer = setTimeout(() => done({ out: [], logs: [], error: 'The JavaScript sandbox did not start' }), 8000);
    document.body.append(frame);
  });
}
function runJSWorker(code) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    const w = new Worker(url);
    const done = r => { clearTimeout(timer); w.terminate(); URL.revokeObjectURL(url); resolve(r); };
    const timer = setTimeout(() => done({ out: [], logs: [], error: 'Stopped after 3 seconds (an endless loop?)' }), 3000);
    w.onmessage = e => done(e.data);
    w.onerror = e => { e.preventDefault(); done({ out: [], logs: [], error: e.message }); };
    w.postMessage(code);
  });
}

function showTab(tab) {
  const scripting = tab === 'script';
  document.body.classList.toggle('scripting', scripting);
  $('#scriptPane').hidden = !scripting;
  for (const b of document.querySelectorAll('#atabs button')) { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-selected', b.dataset.tab === tab); }
  if (scripting) { loadScriptDraft(); $('#scriptText').focus(); }
}
function loadScriptDraft() {
  if (S.scriptLoaded) return;
  S.scriptLoaded = true;
  const d = store.get('gd:script') || {};
  $('#scriptLang').value = d.lang || 'cmd';
  $('#scriptText').value = d.text ?? SCRIPT_EXAMPLES[d.lang || 'cmd'];
}
const saveScriptDraft = () => store.set('gd:script', { lang: $('#scriptLang').value, text: $('#scriptText').value });

async function runScriptPane() {
  const lang = $('#scriptLang').value, text = $('#scriptText').value, out = $('#scriptOut');
  out.textContent = '';
  let program = text, logs = [], from = 'line';
  if (lang === 'js') {
    out.textContent = 'Running…';
    const r = await runJS(text);
    out.textContent = '';
    logs = r.logs || [];
    if (r.error) {
      out.append(el('div', { class: 'e', onclick: () => r.line && gotoLine(r.line) }, `JavaScript error${r.line ? ` on line ${r.line}` : ''}: ${r.error}`));
      return;
    }
    program = r.out.join('\n');
    from = 'command';
  }
  if ($('#scriptReplace').checked) { cons.load([]); S.selection.clear(); S.fnColor = 0; }
  const res = runScript(cons, program, { defaultStyle });
  applyScriptEffects(res);
  commit();
  if (!res.view && $('#scriptReplace').checked) fitAll();
  out.append(el('div', { class: 'ok' }, `✓ ${res.created.length} object${res.created.length === 1 ? '' : 's'} created${res.errors.length ? `, ${res.errors.length} error${res.errors.length === 1 ? '' : 's'}` : ''}`));
  for (const e of res.errors.slice(0, 50)) {
    out.append(el('div', { class: 'e', title: 'Go to line', onclick: () => from === 'line' && gotoLine(e.line) },
      `${from} ${e.line}: ${e.src ? e.src + ' - ' : ''}${e.msg}`));
  }
  for (const l of logs.slice(0, 20)) out.append(el('div', {}, `log: ${l}`));
}
function gotoLine(n) {
  const ta = $('#scriptText'), lines = ta.value.split('\n');
  const start = lines.slice(0, n - 1).reduce((s, l) => s + l.length + 1, 0);
  ta.focus(); ta.setSelectionRange(start, start + (lines[n - 1] || '').length);
}

document.querySelectorAll('#atabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
$('#scriptRun').addEventListener('click', runScriptPane);
$('#scriptText').addEventListener('keydown', e => {
  e.stopPropagation();
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runScriptPane(); }
  if (e.key === 'Tab') { e.preventDefault(); const t = e.target, p = t.selectionStart; t.setRangeText('  ', p, t.selectionEnd, 'end'); }
});
$('#scriptText').addEventListener('input', () => { clearTimeout(S.scriptSave); S.scriptSave = setTimeout(saveScriptDraft, 400); });
$('#scriptLang').addEventListener('change', () => {
  const ta = $('#scriptText'), other = $('#scriptLang').value === 'js' ? 'cmd' : 'js';
  if (!ta.value.trim() || ta.value === SCRIPT_EXAMPLES[other]) ta.value = SCRIPT_EXAMPLES[$('#scriptLang').value];
  saveScriptDraft();
});
$('#scriptFrom').addEventListener('click', () => {
  $('#scriptLang').value = 'cmd';
  $('#scriptText').value = `# The current construction as a script\n${toScript(cons)}ShowAxes(${S.settings.axes})\nShowGrid(${S.settings.grid})\n`;
  saveScriptDraft();
});
$('#scriptAI').addEventListener('click', async () => {
  const prompt = `${languageGuide()}\n---\nYou write scripts in the language above. Reply with only the script, in one code block, no explanations.\nDraw: `;
  try { await navigator.clipboard.writeText(prompt); toast('Prompt copied. Paste it into any AI chat, add what to draw, then paste the script it writes here and press Run.'); }
  catch { download('geometry-ai-prompt.txt', new Blob([prompt], { type: 'text/plain' })); }
});

function exportSvg() {
  const svg = renderSVG(Renderer, cons, { view: view.toJSON(), theme: THEMES.light, settings: { ...S.settings }, width: Math.round(view.W), height: Math.round(view.H) });
  render();
  download('construction.svg', new Blob([svg], { type: 'image/svg+xml' }));
}

// ---------- theorem demos ----------

function loadDemo(i) {
  const d = DEMOS[i];
  if (cons.objs.length && !okToReplace(`Replace the current construction with the ${d.title} demo? (Undo brings it back.)`)) return;
  cons.load([]);
  S.selection.clear();
  setTool('move');
  try {
    for (const line of d.lines) cons.exec(line, defaultStyle);
    for (const [n, st] of Object.entries(d.style || {})) if (cons.has(n)) Object.assign(cons.get(n).style, st);
  } catch (e) { toast(`Demo failed: ${e.message}`, 'error'); }
  S.settings.grid = S.settings.axes = false; saveSettings();
  commit();
  fitAll();
  showInfo(d);
}
function showInfo(d) {
  const box = $('#info');
  box.textContent = '';
  const acts = el('div', { class: 'acts' });
  if (d.check) acts.append(el('button', { class: 'btn primary small', onclick: () => {
    setTool('relation'); S.tsel = d.check.filter(n => cons.has(n)); showRelations(); render();
  } }, `Check ${d.check.join(', ')}`));
  if (d.chase) acts.append(el('button', { class: 'btn primary small', onclick: () => setTool('anglechase') }, 'Find equal angles'));
  acts.append(el('button', { class: 'btn small', onclick: () => { box.hidden = true; } }, 'Close'));
  box.append(el('b', {}, d.title), el('p', {}, d.caption), acts);
  box.hidden = false;
}

// ---------- templates ----------

const TEMPLATES = {
  'Triangle ABC': ['A = (-3, -2)', 'B = (4, -2)', 'C = (-0.6, 3.2)', 'a = Segment(B, C)', 'b = Segment(C, A)', 'c = Segment(A, B)'],
  'Triangle with circumcircle': ['A = (-3, -2)', 'B = (4, -2)', 'C = (-0.6, 3.2)', 'a = Segment(B, C)', 'b = Segment(C, A)', 'c = Segment(A, B)', 'ω = Circumcircle(A, B, C)'],
  'Triangle with incircle': ['A = (-3, -2)', 'B = (4, -2)', 'C = (-0.6, 3.2)', 'a = Segment(B, C)', 'b = Segment(C, A)', 'c = Segment(A, B)', 'I = Incenter(A, B, C)', 'ω = Incircle(A, B, C)'],
  'Cyclic quadrilateral': ['ω = Circle((0, 0), 3)', 'A = Point(ω, 0.6)', 'B = Point(ω, 0.88)', 'C = Point(ω, 0.07)', 'D = Point(ω, 0.33)',
    'a = Segment(A, B)', 'b = Segment(B, C)', 'c = Segment(C, D)', 'd = Segment(D, A)'],
  'Two circles': ['O_1 = (-2, 0)', 'O_2 = (2.2, 0.4)', 'ω_1 = Circle(O_1, 2.5)', 'ω_2 = Circle(O_2, 2)'],
};
function applyTemplate(name) {
  if (cons.objs.length && !okToReplace('Replace the current construction? (Undo brings it back.)')) return;
  cons.load([]);
  S.selection.clear();
  for (const line of TEMPLATES[name]) cons.exec(line, defaultStyle);
  S.settings.grid = S.settings.axes = false; saveSettings();
  commit();
  fitAll();
}

function showHelp() {
  const h = $('#help');
  h.textContent = '';
  const keys = TOOLS.filter(t => t.key).map(t => el('tr', {}, el('td', {}, el('kbd', {}, t.key.toUpperCase())), el('td', {}, t.name)));
  const gen = [['Esc', 'Cancel / Move tool / clear selection'], ['Del', 'Delete selection'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
    ['Enter or /', 'Jump to the input bar'], ['Arrows', 'Nudge selected points (Shift ×10, Alt ÷10)'], ['+ / −', 'Zoom'], ['0', 'Standard view'], ['F', 'Fit all'],
    ['Ctrl+A', 'Select all'], ['Shift-drag', 'Box select'], ['Alt-drag', 'Move without snapping'], ['Double-click', 'Edit an object\'s definition']];
  const cmds = Object.entries(HELP).filter(([l]) => CANON[l] && CANON[l].toLowerCase() === l)
    .map(([l, s]) => el('li', {}, el('code', {}, s)));
  h.append(el('div', { class: 'hbox' },
    el('button', { class: 'ib small close', 'aria-label': 'Close help', onclick: () => { h.hidden = true; }, html: '✕' }),
    el('h2', {}, 'Shortcuts'),
    el('div', { class: 'cols' }, el('table', {}, ...keys), el('table', {}, ...gen.map(([k, d]) => el('tr', {}, el('td', {}, el('kbd', {}, k)), el('td', {}, d))))),
    el('h2', {}, 'Input bar'),
    el('p', {}, 'Points ', el('code', {}, 'A = (1, 2)'), ' or polar ', el('code', {}, '(3; 45°)'), ' · functions ', el('code', {}, 'f(x) = sin(x)/x'),
      ' · equations ', el('code', {}, 'x^2 + y^2 = 9'), ', ', el('code', {}, 'y = 2x + 1'), ', ', el('code', {}, 'x^3 = y^2 - x'),
      ' · sliders ', el('code', {}, 'a = 1'), ', ', el('code', {}, 'α = 30°'), ' · arithmetic ', el('code', {}, 'B = A + (2, 0)'), ', ', el('code', {}, 'x(A) + y(B)'),
      ' · text ', el('code', {}, 'Text("Area: " + Area(poly1), (1, 1))'), '. Redefine by assigning to an existing name. Implicit multiplication works: ', el('code', {}, '2x y'), '.'),
    el('h2', {}, 'Olympiad geometry'),
    el('ul', { class: 'guide' },
      el('li', {}, el('b', {}, 'Check relation (Q): '), 'click 2-4 objects. You get collinear / concyclic / concurrent / tangent / equal… and whether it holds ', el('i', {}, 'always'), ' (tested on 40 random positions) or only in this picture.'),
      el('li', {}, el('b', {}, 'Find equal angles (U): '), 'lists every class of equal angles between drawn segments and lines through named points. Press Mark to draw them with matching arcs.'),
      el('li', {}, el('b', {}, 'Olympiad tools: '), 'triangle centres (incentre … X(40)), feet of perpendiculars, excircles, the nine-point circle, the Euler line, arc midpoints, antipodes, radical axes, common tangents, isogonal conjugates, spiral centres and harmonic conjugates.'),
      el('li', {}, el('b', {}, 'Menu → Theorem demos: '), 'Euler line, nine-point circle, Simson, butterfly, Miquel, the incentre-excentre lemma, Pascal, Ptolemy, radical centre and inscribed angles, each with a Check button.'),
      el('li', {}, el('b', {}, 'Menu → Export Asymptote / TikZ: '), 'the visible diagram as code for your write-up. Marks: select a segment or angle and pick ticks or arcs in its properties.'),
      el('li', {}, el('b', {}, 'Menu → Step through construction'), ' replays a figure one object at a time; ', el('b', {}, 'New from template'), ' starts a triangle, a cyclic quadrilateral and more.'),
      el('li', {}, el('b', {}, 'Input bar: '), el('code', {}, 'Orthocenter(A, B, C)'), ', ', el('code', {}, 'SecondIntersection(Line(A, P), ω, A)'), ', ', el('code', {}, 'AreConcyclic(A, B, C, D)'), ', ', el('code', {}, 'Reflect(s, ω)'), ' (inversion). Names like ', el('code', {}, 'I_A'), ' get subscripts.')),
    el('h2', {}, 'Commands'),
    el('ul', { class: 'cmds' }, ...cmds)));
  h.hidden = false;
}

function showAlgebra(on) {
  S.settings.algebra = on;
  document.body.classList.toggle('noalg', !on);
  saveSettings();
  requestAnimationFrame(resize);
}

// ---------- keyboard ----------

document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || $('#dlg').open) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key;
  if (ctrl && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (ctrl && k.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (ctrl && k.toLowerCase() === 's') { e.preventDefault(); saveFile(); return; }
  if (ctrl && k.toLowerCase() === 'o') { e.preventDefault(); $('#file').click(); return; }
  if (ctrl && k.toLowerCase() === 'a') { e.preventDefault(); S.selection = new Set(cons.objs.filter(o => !o.style.hidden).map(o => o.name)); highlightRows(); refreshProps(); render(); return; }
  if (ctrl || e.altKey && k.length === 1) return;
  if (S.step != null) {
    if (k === 'Escape') { exitSteps(); return; }
    if (k === 'ArrowRight' || k === ']' || k === 'PageDown') { e.preventDefault(); goStep(S.step + 1); return; }
    if (k === 'ArrowLeft' || k === '[' || k === 'PageUp') { e.preventDefault(); goStep(S.step - 1); return; }
  }
  if (k === 'Escape') {
    if (!$('#help').hidden) { $('#help').hidden = true; return; }
    if (!$('#menu').hidden || !$('#flyout').hidden) { closeMenu(); closeFlyout(); return; }
    if (S.tsel.length) { resetTool(); hint(); showRelations(); return; }
    if (S.tool !== 'move') { setTool('move'); return; }
    S.selection.clear(); refreshProps(); highlightRows(); render(); return;
  }
  if (k === 'Delete' || k === 'Backspace') {
    if (S.selection.size) { e.preventDefault(); cons.remove([...S.selection]); S.selection.clear(); commit(); }
    return;
  }
  if (k === 'Enter' || k === '/') { e.preventDefault(); showAlgebra(true); input.focus(); return; }
  if (k === '?') { showHelp(); return; }
  if (k === '+' || k === '=') { view.zoomAt(view.W / 2, view.H / 2, 1.25); viewChanged(); return; }
  if (k === '-' || k === '_') { view.zoomAt(view.W / 2, view.H / 2, 0.8); viewChanged(); return; }
  if (k === '0') { standardView(); return; }
  if (k.startsWith('Arrow')) {
    e.preventDefault();
    const step = (e.shiftKey ? 1 : e.altKey ? 0.01 : 0.1);
    const [dx, dy] = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[k];
    const pts = [...S.selection].map(n => cons.get(n)).filter(o => cons.isFreePoint(o));
    const nums = [...S.selection].map(n => cons.get(n)).filter(o => cons.isFreeNum(o));
    if (pts.length) {
      for (const o of pts) cons.setPoint(o, +(o.val.x + dx * step).toFixed(10), +(o.val.y + dy * step).toFixed(10));
      valuesChanged(pts.map(o => o.name)); commitSoon();
    } else if (nums.length) {
      for (const o of nums) setSliderUnit(o, sliderUnit(o) + (dx || dy) * (o.style.slider?.step || 0.1) * (e.shiftKey ? 10 : 1));
      commitSoon();
    } else {
      view.cx += dx * 40 / view.scale; view.cy += dy * 40 / view.scale; viewChanged();
    }
    return;
  }
  if (k.toLowerCase() === 'f' && e.shiftKey) { fitAll(); return; }
  const t = TOOLS.find(t => t.key === k.toLowerCase());
  if (t && !e.shiftKey) { setTool(t.id); return; }
  if (k === 'F') fitAll();
});
let commitTimer = 0;
function commitSoon() { clearTimeout(commitTimer); commitTimer = setTimeout(commit, 400); }

// ---------- wiring ----------

$('#btnUndo').addEventListener('click', undo);
$('#btnRedo').addEventListener('click', redo);
$('#btnMenu').addEventListener('click', ev => { ev.stopPropagation(); openMenu(); });
$('#btnAlgebra').addEventListener('click', () => showAlgebra(!S.settings.algebra));
$('#zin').addEventListener('click', () => { view.zoomAt(view.W / 2, view.H / 2, 1.4); viewChanged(); });
$('#zout').addEventListener('click', () => { view.zoomAt(view.W / 2, view.H / 2, 1 / 1.4); viewChanged(); });
$('#zfit').addEventListener('click', fitAll);
document.addEventListener('click', ev => {
  if (!ev.target.closest('#menu') && !ev.target.closest('#btnMenu')) closeMenu();
  if (!ev.target.closest('#flyout') && !ev.target.closest('#tools')) closeFlyout();
});
$('#help').addEventListener('click', ev => { if (ev.target.id === 'help') ev.target.hidden = true; });

function resize() {
  const st = $('#stage').getBoundingClientRect();
  R.resize(Math.max(50, st.width), Math.max(50, st.height), window.devicePixelRatio || 1);
  viewChanged();
}
new ResizeObserver(() => resize()).observe($('#stage'));

// ---------- start ----------

// ---------- embedded in an AI chat ----------

let host = null;
function embedStart() {
  document.documentElement.classList.add('embed');
  host = connectHost({ onData: embedLoad, onContext: embedContext });
  hint('Waiting for the figure from the chat…');
  host.handshake.then(() => { addEmbedButtons(); host.reportSize(Math.ceil(document.documentElement.getBoundingClientRect().height)); });
  setTimeout(addEmbedButtons, 2500);
}
function embedLoad(data) {
  const d = data.doc;
  S.embed = { link: data.link || '', title: data.title || '' };
  loadDoc({ view: d.v, settings: d.s, objects: d.o || [] });
  // The server framed the view for a vw × vh image: keep that window here.
  if (d.vw && d.vh) view.scale *= Math.min(view.W / d.vw, view.H / d.vh);
  S.history = []; S.hidx = -1; S.selection.clear();
  resetTool(); setTool('move');
  commit(); viewChanged();
  if (data.title || data.caption) showInfo({ title: data.title || 'Geometry', caption: data.caption || 'Drag the points, or add to the figure with the tools above.' });
}
function embedContext(ctx) {
  if (ctx.theme === 'dark' || ctx.theme === 'light') { S.settings.theme = ctx.theme; applyTheme(); }
  if (ctx.displayMode) {
    host && host.setDisplayMode(ctx.displayMode);
    document.documentElement.classList.toggle('full', ctx.displayMode === 'fullscreen');
    requestAnimationFrame(resize);
  }
}
function addEmbedButtons() {
  if (!host || $('#embedOpen')) return;
  const right = $('#bar .right');
  const b = (id, label, title, fn, cls = 'btn small') => el('button', { id, class: cls, title, onclick: fn }, label);
  if (host.caps.message) right.prepend(b('embedAsk', 'Ask AI', 'Ask the AI about your figure', askAI));
  if (host.caps.fullscreen) right.prepend(b('embedFull', '⤢', 'Fullscreen', () => host.toggleFullscreen()));
  right.prepend(b('embedOpen', 'Open in app ↗', 'Open in the full Geometry Drawer website, with your edits', openInApp, 'btn small primary'));
}
async function openInApp() {
  const base = (S.embed && S.embed.link ? S.embed.link.split('#')[0] : '') || (EMBED && EMBED.appUrl) || location.href.split('#')[0];
  const url = `${base}#c=${await encodeDoc()}`;
  if (host) host.openLink(url); else window.open(url, '_blank', 'noopener');
}
// Tell the AI what the figure looks like now, so it can build on the user's edits.
let syncTimer = 0;
function syncHostSoon() { clearTimeout(syncTimer); syncTimer = setTimeout(syncHost, 700); }
function syncHost() {
  if (!host) return;
  const script = `${toScript(cons)}ShowAxes(${S.settings.axes})\nShowGrid(${S.settings.grid})\n`;
  const text = `The user's current figure in the Geometry Drawer widget (they may have edited it). To build on it, call draw_geometry with this script plus your additions:\n\n${script}`;
  host.updateContext(text, { script, doc: { v: view.toJSON(), vw: view.W, vh: view.H, s: { grid: S.settings.grid, axes: S.settings.axes }, o: cons.toJSON() } });
}
async function askAI() {
  const r = await ask('Ask the AI about this figure', [{ key: 'q', label: 'Your question (your current figure is sent along)', type: 'textarea', value: '' }]);
  if (!r || !r.q.trim()) return;
  clearTimeout(syncTimer); syncHost();
  const ok = await host.sendMessage(r.q.trim());
  toast(ok ? 'Sent to the chat' : 'The chat did not accept the message', ok ? undefined : 'error');
}

async function start() {
  document.body.classList.toggle('noalg', !S.settings.algebra);
  renderToolbar();
  hint();
  const st = $('#stage').getBoundingClientRect();
  R.resize(Math.max(50, st.width), Math.max(50, st.height), window.devicePixelRatio || 1);
  try {
    if (EMBED) { /* the figure comes from the chat host */ }
    else if (location.hash.startsWith('#c=') || location.hash.startsWith('#s=')) {
      const isShort = location.hash.startsWith('#s=');
      let doc;
      try { doc = isShort ? await fetchShared(location.hash.slice(3)) : await decodeDoc(location.hash.slice(3)); }
      catch (e) {
        history.replaceState(null, '', location.pathname);
        throw new Error(isShort ? e.message : 'this link is damaged or incomplete (an AI may have retyped it). Ask for a fresh link');
      }
      loadDoc(doc);
      history.replaceState(null, '', location.pathname);
      if (doc.info && (doc.info.title || doc.info.caption)) S.pendingInfo = doc.info;
      else toast('Opened the shared construction');
    } else {
      const d = store.get('gd:doc');
      if (d) loadDoc(d);
    }
  } catch (e) { toast(`Could not open the figure: ${e.message}.`, 'error'); }
  applyTheme();
  commit();
  viewChanged();
  if (cons.objs.some(o => o.style.anim)) startAnim();
  if (S.pendingInfo) showInfo({ title: S.pendingInfo.title || 'Shared construction', caption: S.pendingInfo.caption });
  if (EMBED) embedStart();
}
start();

// Exposed for the browser smoke test and for power users in the console.
window.gd = { get host() { return host; }, showTab, runScriptPane, toScript: () => toScript(cons), loadDemo, applyTemplate, exportDiagram: f => exportDiagram(cons, R, f), enterSteps, goStep, exitSteps, cons, view, S, exec: src => { const o = cons.exec(src, defaultStyle); commit(); return o; }, setTool, undo, redo, render, R, docJSON, encodeDoc, decodeDoc };
