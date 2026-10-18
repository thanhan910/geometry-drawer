// The in-chat viewer: an MCP Apps view (Claude, ChatGPT and other hosts render
// it inside the conversation) built from the app's own engine and renderer.
// mcp/server.mjs bundles this file into one self-contained HTML page.
//
// Protocol (MCP Apps, spec 2026-01-26): JSON-RPC over postMessage with the
// host. We send ui/initialize, then wait for ui/notifications/tool-result,
// whose structuredContent carries the construction. ChatGPT's older Apps SDK
// bridge (window.openai.toolOutput) is supported as a fallback.

import { Construction } from './construction.js';
import { Renderer, THEMES, fitView } from './render.js';
import { isNumLit } from './construction.js';

const $ = s => document.querySelector(s);
const cons = new Construction();
const canvas = $('#cv');
const R = new Renderer(canvas);
const view = R.view;
let doc = null, home = null, displayMode = 'inline';

// ---------- host bridge ----------

let rpcId = 0;
const pending = new Map();
const toHost = msg => window.parent !== window && window.parent.postMessage({ jsonrpc: '2.0', ...msg }, '*');
const request = (method, params) => new Promise((resolve, reject) => {
  const id = ++rpcId;
  pending.set(id, { resolve, reject });
  toHost({ id, method, params });
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`${method} timed out`)); } }, 8000);
});
const notify = (method, params) => toHost({ method, params });
// Nothing but ui/initialize may go to the host before the handshake ends.
let ready = false;
const reportSize = () => { if (ready) notify('ui/notifications/size-changed', { height: document.documentElement.scrollHeight }); };

window.addEventListener('message', e => {
  const m = e.data;
  if (!m || m.jsonrpc !== '2.0') return;
  if (m.id != null && pending.has(m.id) && ('result' in m || 'error' in m)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    return;
  }
  switch (m.method) {
    case 'ui/notifications/tool-result': show(m.params && m.params.structuredContent); break;
    case 'ui/notifications/tool-input': if (!doc) setStatus('Drawing…'); break;
    case 'ui/notifications/tool-cancelled': if (!doc) setStatus('Cancelled.'); break;
    case 'ui/notifications/host-context-changed': applyContext(m.params || {}); break;
    case 'ui/resource-teardown': toHost({ id: m.id, result: {} }); break;
    default: if (m.id != null && m.method) toHost({ id: m.id, result: {} }); // ping and anything unknown
  }
});

function applyContext(ctx) {
  if (ctx.theme) setTheme(ctx.theme);
  if (ctx.displayMode) { displayMode = ctx.displayMode; layout(); }
}
function setTheme(t) {
  const dark = t === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  R.theme = THEMES[dark ? 'dark' : 'light'];
  draw();
}

async function connect() {
  if (window.openai && window.openai.toolOutput) {             // ChatGPT Apps SDK fallback
    setTheme(window.openai.theme);
    show(window.openai.toolOutput);
    window.addEventListener('openai:set_globals', ev => {
      const g = (ev.detail && ev.detail.globals) || {};
      if (g.theme) setTheme(g.theme);
      if (g.toolOutput) show(g.toolOutput);
    });
    return;
  }
  try {
    const init = await request('ui/initialize', {
      appInfo: { name: 'geometry-drawer', version: '1.0.0' },
      appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
      protocolVersion: '2026-01-26',
    });
    applyContext((init && init.hostContext) || {});
    S.canFullscreen = !!(init && init.hostContext && (init.hostContext.availableDisplayModes || []).includes('fullscreen'));
    $('#full').hidden = !S.canFullscreen;
    notify('ui/notifications/initialized', {});
    ready = true;
    reportSize();
  } catch {
    if (window.openai) { setTheme(window.openai.theme); show(window.openai.toolOutput); }
    else setStatus('Open this figure from an AI chat that supports MCP Apps.');
  }
}
const S = { canFullscreen: false };

// ---------- showing a construction ----------

function setStatus(t) { $('#status').textContent = t; $('#status').hidden = !t; }

function show(data) {
  if (!data || !data.doc) return;
  doc = data;
  const errs = cons.load(data.doc.o || []);
  Object.assign(R.settings, { grid: !!(data.doc.s && data.doc.s.grid), axes: !!(data.doc.s && data.doc.s.axes), digits: 2 });
  $('#title').textContent = data.title || 'Geometry';
  $('#caption').textContent = data.caption || '';
  $('#caption').hidden = !data.caption;
  $('#open').hidden = !data.link;
  setStatus(errs.length ? `Some objects could not be loaded: ${errs[0]}` : '');
  layout();
  if (data.doc.v) { Object.assign(view, data.doc.v); rescaleToCanvas(data.doc.vw, data.doc.vh); }
  else fit();
  home = { ...view.toJSON() };
  recompute();
}

// The server framed the view for a 900 × 640 image; keep the same window.
function rescaleToCanvas(w, h) {
  if (!w || !h) return;
  view.scale *= Math.min(view.W / w, view.H / h);
}
function fit() { const f = fitView(cons, view.W, view.H); if (f) Object.assign(view, f); }

function layout() {
  const full = displayMode === 'fullscreen';
  const w = Math.max(200, document.documentElement.clientWidth);
  const h = full ? Math.max(300, window.innerHeight - $('#top').offsetHeight - 4) : Math.round(Math.min(560, Math.max(320, w * 0.62)));
  const old = { W: view.W, H: view.H };
  R.resize(w, h, window.devicePixelRatio || 1);
  if (doc && old.W && old.W !== view.W) view.scale *= Math.min(view.W / old.W, view.H / old.H);
  recompute();
  reportSize();
}

let raf = 0;
function draw() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; R.draw(cons, { selection: new Set(), hover: hover }); }); }
function recompute(from) {
  cons.bounds = view.bounds();
  cons.recompute(from);
  draw();
}

// ---------- interaction: drag points, pan, zoom ----------

let drag = null, hover = null;
const pointers = new Map();
const local = e => { const r = canvas.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; };
const tol = e => (e.pointerType === 'touch' ? 14 : 7);

canvas.addEventListener('pointerdown', e => {
  if (raf) { cancelAnimationFrame(raf); raf = 0; R.draw(cons, { selection: new Set() }); }
  canvas.setPointerCapture(e.pointerId);
  const p = local(e);
  pointers.set(e.pointerId, p);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    drag = { type: 'pinch', d: Math.hypot(a.sx - b.sx, a.sy - b.sy), mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2 };
    return;
  }
  const h = R.hits(cons, p.sx, p.sy, tol(e))[0];
  const w = { x: view.wx(p.sx), y: view.wy(p.sy) };
  if (h && cons.movable(h.o)) {
    const at = h.o.val.t === 'pt' ? h.o.val : h.o.val.pos || w;
    drag = { type: 'obj', o: h.o, dx: w.x - at.x, dy: w.y - at.y };
  } else if (h && cons.freeAncestors(h.o.name)) {
    drag = { type: 'multi', start: w, pts: cons.freeAncestors(h.o.name).map(o => ({ o, x0: o.val.x, y0: o.val.y })) };
  } else drag = { type: 'pan', sx: p.sx, sy: p.sy };
  canvas.style.cursor = 'grabbing';
});
canvas.addEventListener('pointermove', e => {
  const p = local(e);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
  if (!drag) {
    const h = R.hits(cons, p.sx, p.sy, tol(e))[0];
    const name = h && (cons.movable(h.o) || cons.freeAncestors(h.o.name)) ? h.o.name : null;
    canvas.style.cursor = name ? 'grab' : 'default';
    if (name !== hover) { hover = name; draw(); }
    return;
  }
  if (drag.type === 'pinch') {
    if (pointers.size < 2) return;
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.sx - b.sx, a.sy - b.sy), mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
    view.cx -= (mx - drag.mx) / view.scale; view.cy += (my - drag.my) / view.scale;
    if (drag.d > 0) view.zoomAt(mx, my, d / drag.d);
    Object.assign(drag, { d, mx, my });
    recompute();
  } else if (drag.type === 'pan') {
    view.cx -= (p.sx - drag.sx) / view.scale; view.cy += (p.sy - drag.sy) / view.scale;
    drag.sx = p.sx; drag.sy = p.sy;
    recompute();
  } else if (drag.type === 'obj') {
    const o = drag.o, x = view.wx(p.sx) - drag.dx, y = view.wy(p.sy) - drag.dy;
    if (cons.isFreePoint(o)) cons.setPoint(o, x, y);
    else if (cons.isOnPath(o)) cons.slide(o, view.wx(p.sx), view.wy(p.sy));
    else if (cons.isFreeText(o)) o.ast.a[1] = { k: 'pt', x: { k: 'num', v: x }, y: { k: 'num', v: y } };
    recompute([o.name]);
  } else if (drag.type === 'multi') {
    const dx = view.wx(p.sx) - drag.start.x, dy = view.wy(p.sy) - drag.start.y;
    for (const q of drag.pts) cons.setPoint(q.o, q.x0 + dx, q.y0 + dy);
    recompute(drag.pts.map(q => q.o.name));
  }
});
const end = e => { pointers.delete(e.pointerId); if (!pointers.size) { drag = null; canvas.style.cursor = 'default'; } };
canvas.addEventListener('pointerup', end);
canvas.addEventListener('pointercancel', end);
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const p = local(e);
  view.zoomAt(p.sx, p.sy, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)));
  recompute();
}, { passive: false });

// ---------- buttons ----------

$('#fit').addEventListener('click', () => { fit(); recompute(); });
$('#reset').addEventListener('click', () => { if (doc) show(doc); });
$('#open').addEventListener('click', async () => {
  if (!doc || !doc.link) return;
  try {
    if (window.openai && window.openai.openExternal) { window.openai.openExternal({ href: doc.link }); return; }
    const r = await request('ui/open-link', { url: doc.link });
    if (r && r.isError) throw new Error('refused');
  } catch { window.open(doc.link, '_blank', 'noopener'); }
});
$('#full').addEventListener('click', async () => {
  try {
    const r = await request('ui/request-display-mode', { mode: displayMode === 'fullscreen' ? 'inline' : 'fullscreen' });
    if (r && r.mode) { displayMode = r.mode; layout(); }
  } catch { /* host said no */ }
});
window.addEventListener('resize', () => layout());

// Exposed for the widget test harness.
window.gdw = { cons, view, show, get doc() { return doc; }, isNumLit };

layout();
setStatus('Waiting for the figure…');
connect();
