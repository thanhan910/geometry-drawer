// Canvas rendering and screen-space hit testing. Each draw caches the screen
// geometry of every object (o._g) so hit testing is a cheap distance query
// against exactly what is on screen.

import { conicInfo, hyperbolaAt, parabolaAt, hyperbolaRange, parabolaRange, fnRange, contour, applyPt, callFn, toText } from './geom.js';
import { fmtNum } from './expr.js';

const { PI, abs, hypot, cos, sin, min, max } = Math;

// The view {cx, cy, scale} that fits every visible object in W × H, or null.
export function fitView(cons, W, H, margin = 1.3) {
  const xs = [], ys = [];
  const add = p => { if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) { xs.push(p.x); ys.push(p.y); } };
  const box = (c, r) => { add({ x: c.x - r, y: c.y - r }); add({ x: c.x + r, y: c.y + r }); };
  for (const o of cons.objs) {
    if (o.style.hidden) continue;
    const v = o.val;
    if (v.t === 'pt') add(v);
    if (v.t === 'pts' || v.t === 'poly') v.pts.forEach(add);
    if (v.t === 'locus') v.pts.forEach(p => p && add(p));
    if (v.t === 'circle' || v.t === 'arc') box(v.c, v.r);
    if (v.t === 'text' && v.pos) add(v.pos);
    if (v.t === 'conic') { const ci = conicInfo(v); if (ci.type === 'ellipse') box(ci.c, Math.max(ci.a, ci.b)); }
  }
  if (!xs.length) return null;
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const w = Math.max(x1 - x0, 1e-3), h = Math.max(y1 - y0, 1e-3);
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale: Math.min(W / (w * margin), H / (h * margin), 1e6) };
}

export class View {
  constructor() { this.cx = 0; this.cy = 0; this.scale = 50; this.W = 800; this.H = 600; }
  sx(x) { return (x - this.cx) * this.scale + this.W / 2; }
  sy(y) { return this.H / 2 - (y - this.cy) * this.scale; }
  wx(sx) { return (sx - this.W / 2) / this.scale + this.cx; }
  wy(sy) { return (this.H / 2 - sy) / this.scale + this.cy; }
  bounds() { return { xmin: this.wx(0), xmax: this.wx(this.W), ymin: this.wy(this.H), ymax: this.wy(0) }; }
  zoomAt(sx, sy, f) {
    const x = this.wx(sx), y = this.wy(sy);
    this.scale = min(1e7, max(1e-5, this.scale * f));
    this.cx = x - (sx - this.W / 2) / this.scale;
    this.cy = y - (this.H / 2 - sy) / this.scale;
  }
  toJSON() { return { cx: this.cx, cy: this.cy, scale: this.scale }; }
}

export const THEMES = {
  light: { bg: '#ffffff', grid: '#eef0f4', gridMajor: '#dde1e8', axis: '#4b5260', free: '#2457d6', onpath: '#5d8ff0',
    dep: '#3a3a3a', line: '#2b2b2b', poly: '#a0522d', angle: '#0e8a4f', text: '#1d1d1f', fn: '#2457d6', preview: '#7d8597', halo: '#ffb000' },
  dark: { bg: '#16181d', grid: '#20242c', gridMajor: '#2c313b', axis: '#9aa3b2', free: '#78a0ff', onpath: '#a6c1ff',
    dep: '#d3d3d3', line: '#dedede', poly: '#e3955f', angle: '#43d18f', text: '#ececee', fn: '#78a0ff', preview: '#8d95a5', halo: '#ffc23d' },
};

export const defaultLabelMode = o => (o.val.t === 'num' ? (o.val.arc ? 'value' : 'nameValue') : 'name');

export function role(o, cons) {
  if (o.style && o.style.r) return o.style.r;
  const v = o.val;
  if (v.t === 'pt') return cons && cons.isFreePoint(o) ? 'free' : cons && cons.isOnPath(o) ? 'onpath' : 'dep';
  if (v.t === 'pts') return 'dep';
  if (v.t === 'num') return 'angle';
  if (v.t === 'poly' && v.closed) return 'poly';
  if (v.t === 'arc' && v.sector) return 'poly';
  if (v.t === 'text') return 'text';
  if (v.t === 'fn') return 'fn';
  return 'line';
}

const DASH = [[], [8, 6], [2, 5]];

// Short strokes across the middle of a segment (screen coordinates).
export function tickMarks(pl, n) {
  const ax = pl[0], ay = pl[1], bx = pl[pl.length - 2], by = pl[pl.length - 1];
  const L = hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / L, uy = (by - ay) / L, nx = -uy, ny = ux;
  const mx = (ax + bx) / 2, my = (ay + by) / 2, out = [];
  for (let k = 0; k < n; k++) {
    const o = (k - (n - 1) / 2) * 5;
    out.push([mx + ux * o - nx * 6, my + uy * o - ny * 6, mx + ux * o + nx * 6, my + uy * o + ny * 6]);
  }
  return out;
}


function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Liang-Barsky: clip p + t d (screen coords) to the padded viewport.
function clip(view, x0, y0, dx, dy, t0, t1) {
  const m = 20, xmin = -m, ymin = -m, xmax = view.W + m, ymax = view.H + m;
  const p = [-dx, dx, -dy, dy], q = [x0 - xmin, xmax - x0, y0 - ymin, ymax - y0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; continue; }
    const r = q[i] / p[i];
    if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1];
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.view = new View();
    this.theme = THEMES.light;
    this.settings = { grid: true, axes: true, digits: 2 };
  }

  resize(w, h, dpr) {
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.view.W = w; this.view.H = h;
  }

  // ---------- frame ----------

  draw(cons, st) {
    const c = this.ctx, v = this.view, T = this.theme;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = T.bg;
    c.fillRect(0, 0, v.W, v.H);
    if (this.settings.grid) this.drawGrid();
    if (this.settings.axes) this.drawAxes();
    const objs = cons.objs.filter(o => (!o.style.hidden || st.showHidden) && o.val.t !== 'undef' && (!st.only || st.only.has(o.name)));
    for (const o of cons.objs) o._g = null;
    const layer = o => {
      const t = o.val.t;
      if (t === 'num') return o.val.shade ? 0 : 3;
      if (t === 'poly' || (t === 'arc' && o.val.sector)) return 1;
      if (t === 'pt' || t === 'pts') return 5;
      if (t === 'text') return 6;
      return 2;
    };
    const sorted = objs.map((o, i) => [layer(o), i, o]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => x[2]);
    for (const o of cons.objs) if (o.trace && o.trace.length && !o.style.hidden && (!st.only || st.only.has(o.name))) this.drawTrace(o, cons);
    for (const o of sorted) {
      const g = {};
      const style = this.styleOf(o, cons);
      const hl = st.selection.has(o.name) ? 0.35 : st.hover === o.name ? 0.2 : st.toolSel && st.toolSel.includes(o.name) ? 0.35 : 0;
      if (o.style.hidden) c.globalAlpha = 0.3;
      this.drawValue(o.val, style, g, hl, o);
      c.globalAlpha = 1;
      o._g = g;
    }
    for (const o of sorted) if (o._g && !o.style.hidden && this.wantsLabel(o)) this.drawLabel(o, this.styleOf(o, cons));
    for (const o of cons.objs) if (o.val.t === 'num' && o.style.slider && o.style.slider.show && !o.style.hidden && (!st.only || st.only.has(o.name))) this.drawSlider(o, cons, st);
    if (st.preview) for (const pv of st.preview) this.drawValue(pv.val, { ...pv.style, color: pv.style.color || T.preview, preview: true }, {}, 0, null);
    if (st.rubber) {
      const r = st.rubber;
      c.strokeStyle = T.halo; c.setLineDash([4, 4]); c.lineWidth = 1;
      c.strokeRect(r.x, r.y, r.w, r.h); c.setLineDash([]);
    }
  }

  styleOf(o, cons) {
    const s = o.style, T = this.theme;
    const r = role(o, cons);
    return {
      color: s.color || T[r] || T.line,
      width: s.width ?? (r === 'poly' ? 2 : r === 'angle' ? 1.5 : 2),
      dash: s.dash || 0,
      size: s.size ?? (r === 'free' || r === 'onpath' ? 4.5 : 3.5),
      fill: s.fill ?? (r === 'poly' ? 0.2 : r === 'angle' ? 0.25 : 0),
      fontSize: s.fontSize || 15,
      role: r,
    };
  }

  wantsLabel(o) {
    if (o.style.label === true) return true;
    if (o.style.label === false) return false;
    return o.val.t === 'pt' || (o.val.t === 'num' && (o.val.anchor || o.val.arc));
  }

  // ---------- grid & axes ----------

  drawGrid() {
    const c = this.ctx, v = this.view, T = this.theme;
    const step = niceStep(90 / v.scale), minor = step / 5;
    const b = v.bounds();
    const lines = (st, color) => {
      c.strokeStyle = color; c.lineWidth = 1; c.beginPath();
      for (let x = Math.ceil(b.xmin / st) * st; x <= b.xmax; x += st) { const s = Math.round(v.sx(x)) + 0.5; c.moveTo(s, 0); c.lineTo(s, v.H); }
      for (let y = Math.ceil(b.ymin / st) * st; y <= b.ymax; y += st) { const s = Math.round(v.sy(y)) + 0.5; c.moveTo(0, s); c.lineTo(v.W, s); }
      c.stroke();
    };
    if (minor * v.scale >= 10) lines(minor, T.grid);
    lines(step, T.gridMajor);
  }

  drawAxes() {
    const c = this.ctx, v = this.view, T = this.theme;
    const step = niceStep(90 / v.scale);
    const b = v.bounds();
    const X = Math.round(v.sx(0)) + 0.5, Y = Math.round(v.sy(0)) + 0.5;
    c.strokeStyle = T.axis; c.fillStyle = T.axis; c.lineWidth = 1.2;
    c.beginPath();
    if (Y > 0 && Y < v.H) { c.moveTo(0, Y); c.lineTo(v.W, Y); }
    if (X > 0 && X < v.W) { c.moveTo(X, 0); c.lineTo(X, v.H); }
    c.stroke();
    // arrowheads
    c.beginPath();
    if (Y > 0 && Y < v.H) { c.moveTo(v.W, Y); c.lineTo(v.W - 9, Y - 4); c.lineTo(v.W - 9, Y + 4); }
    if (X > 0 && X < v.W) { c.moveTo(X, 0); c.lineTo(X - 4, 9); c.lineTo(X + 4, 9); }
    c.fill();
    c.font = '12px system-ui, sans-serif';
    const dec = max(0, -Math.floor(Math.log10(step) + 1e-9));
    const fmt = n => { const s = Math.abs(n) < step / 1e6 ? '0' : n.toFixed(dec); return s.replace('-', '−'); };
    const ly = min(max(Y + 4, 4), v.H - 16), lx = min(max(X - 6, 30), v.W - 4);
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (let x = Math.ceil(b.xmin / step) * step; x <= b.xmax; x += step) {
      if (abs(x) < step / 2) continue;
      const s = v.sx(x);
      if (s < 12 || s > v.W - 16) continue;
      c.fillText(fmt(x), s, ly);
      if (Y > 0 && Y < v.H) { c.fillRect(s - 0.5, Y - 3, 1, 6); }
    }
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (let y = Math.ceil(b.ymin / step) * step; y <= b.ymax; y += step) {
      if (abs(y) < step / 2) continue;
      const s = v.sy(y);
      if (s < 14 || s > v.H - 8) continue;
      c.fillText(fmt(y), lx, s);
      if (X > 0 && X < v.W) c.fillRect(X - 3, s - 0.5, 6, 1);
    }
    if (X > 0 && X < v.W && Y > 0 && Y < v.H) { c.textAlign = 'right'; c.textBaseline = 'top'; c.fillText('0', X - 5, Y + 4); }
    c.font = 'italic 13px system-ui, sans-serif';
    if (Y > 0 && Y < v.H) { c.textAlign = 'right'; c.textBaseline = 'bottom'; c.fillText('x', v.W - 6, Y - 6); }
    if (X > 0 && X < v.W) { c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText('y', X + 8, 4); }
  }

  // ---------- values ----------

  stroke(st, hl, path) {
    const c = this.ctx;
    if (hl) {
      c.save(); c.strokeStyle = hexA(st.color, hl); c.lineWidth = st.width + 7; c.setLineDash([]);
      c.lineCap = 'round'; c.lineJoin = 'round'; path(); c.stroke(); c.restore();
    }
    c.strokeStyle = st.color; c.lineWidth = st.width;
    c.setLineDash(st.preview ? [6, 5] : DASH[st.dash] || []);
    c.lineCap = 'round'; c.lineJoin = 'round';
    path(); c.stroke();
    c.setLineDash([]);
  }

  polylines(pls, st, g, hl) {
    g.pl = (g.pl || []).concat(pls);
    this.stroke(st, hl, () => {
      const c = this.ctx; c.beginPath();
      for (const pl of pls) { c.moveTo(pl[0], pl[1]); for (let i = 2; i < pl.length; i += 2) c.lineTo(pl[i], pl[i + 1]); }
    });
  }

  // Sample t → world point into screen polylines, breaking at gaps and jumps.
  sample(at, t0, t1, N) {
    const v = this.view, out = [];
    let cur = [], prev = null;
    const lim = 4 * (v.W + v.H);
    for (let i = 0; i <= N; i++) {
      const p = at(t0 + (t1 - t0) * i / N);
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) { if (cur.length > 2) out.push(cur); cur = []; prev = null; continue; }
      let sx = v.sx(p.x), sy = v.sy(p.y);
      if (prev && (abs(sy - prev[1]) > v.H * 1.5 || abs(sx - prev[0]) > v.W * 1.5) &&
          (sy < -v.H || sy > 2 * v.H || prev[1] < -v.H || prev[1] > 2 * v.H || abs(sx - prev[0]) > v.W * 1.5)) {
        if (cur.length > 2) out.push(cur); cur = [];
      }
      sx = max(-lim, min(lim, sx)); sy = max(-lim, min(lim, sy));
      cur.push(sx, sy);
      prev = [sx, sy];
    }
    if (cur.length > 2) out.push(cur);
    return out;
  }

  drawValue(val, st, g, hl, o) {
    const c = this.ctx, v = this.view;
    switch (val.t) {
      case 'pt': return this.drawPoint(val.x, val.y, st, g, hl);
      case 'pts': g.pts = []; for (const p of val.pts) { const gg = {}; this.drawPoint(p.x, p.y, st, gg, hl); g.pts.push(gg.pt); } return;
      case 'line': case 'seg': case 'ray': case 'vec': {
        const p = val.t === 'vec' ? (val.o || { x: 0, y: 0 }) : val.p, d = val.t === 'vec' ? val : val.d;
        const x0 = v.sx(p.x), y0 = v.sy(p.y), dx = d.x * v.scale, dy = -d.y * v.scale;
        const r = clip(v, x0, y0, dx, dy, val.t === 'line' ? -Infinity : 0, val.t === 'line' || val.t === 'ray' ? Infinity : 1);
        if (!r) return;
        this.polylines([r], st, g, hl);
        if (o && o.style.ticks && val.t !== 'line' && val.t !== 'ray') {
          c.strokeStyle = st.color; c.lineWidth = 1.6; c.beginPath();
          for (const t of tickMarks(r, o.style.ticks)) { c.moveTo(t[0], t[1]); c.lineTo(t[2], t[3]); }
          c.stroke();
        }
        if (val.t === 'vec') {
          const ex = x0 + dx, ey = y0 + dy, L = hypot(dx, dy);
          if (L > 1) {
            const ux = dx / L, uy = dy / L, s = 7 + st.width * 2;
            c.fillStyle = st.color; c.beginPath();
            c.moveTo(ex, ey); c.lineTo(ex - ux * s - uy * s * 0.5, ey - uy * s + ux * s * 0.5);
            c.lineTo(ex - ux * s + uy * s * 0.5, ey - uy * s - ux * s * 0.5); c.fill();
          }
        }
        return;
      }
      case 'circle': {
        const sx = v.sx(val.c.x), sy = v.sy(val.c.y), R = val.r * v.scale;
        g.circ = { sx, sy, R };
        if (R > 5e5) { // effectively a line here; sample near the view
          const pls = this.sample(t => ({ x: val.c.x + val.r * cos(t), y: val.c.y + val.r * sin(t) }), 0, 2 * PI, 20000);
          this.polylines(pls, st, g, hl); g.circ = null; return;
        }
        if (st.fill) { c.fillStyle = hexA(st.color, st.fill); c.beginPath(); c.arc(sx, sy, R, 0, 2 * PI); c.fill(); g.area = 'circ'; }
        this.stroke(st, hl, () => { c.beginPath(); c.arc(sx, sy, R, 0, 2 * PI); });
        return;
      }
      case 'arc': {
        const sx = v.sx(val.c.x), sy = v.sy(val.c.y), R = val.r * v.scale;
        const path = () => {
          c.beginPath();
          if (val.sector) c.moveTo(sx, sy);
          c.arc(sx, sy, R, -val.a0, -(val.a0 + val.sw), true);
          if (val.sector) c.closePath();
        };
        if (val.sector && st.fill) { c.fillStyle = hexA(st.color, st.fill); path(); c.fill(); }
        this.stroke(st, hl, path);
        const N = max(8, Math.ceil(val.sw * 40));
        const pl = [];
        if (val.sector) pl.push(sx, sy);
        for (let i = 0; i <= N; i++) { const a = val.a0 + val.sw * i / N; pl.push(sx + R * cos(a), sy - R * sin(a)); }
        if (val.sector) pl.push(sx, sy);
        g.pl = [pl];
        if (val.sector) g.area = pl;
        return;
      }
      case 'poly': {
        const pl = [];
        for (const p of val.pts) pl.push(v.sx(p.x), v.sy(p.y));
        if (val.closed) {
          pl.push(pl[0], pl[1]);
          if (st.fill) {
            c.fillStyle = hexA(st.color, st.fill); c.beginPath();
            c.moveTo(pl[0], pl[1]); for (let i = 2; i < pl.length; i += 2) c.lineTo(pl[i], pl[i + 1]); c.fill();
          }
          g.area = pl;
        }
        this.polylines([pl], st, g, hl);
        return;
      }
      case 'conic': return this.drawConic(val, st, g, hl);
      case 'fn': {
        const b = v.bounds();
        if (!val.M) {
          const [x0, x1] = fnRange(val, b);
          if (!(x1 > x0)) return;
          const N = Math.ceil((v.sx(x1) - v.sx(x0)) / 1) + 1;
          this.polylines(this.sample(x => ({ x, y: callFn(val, x) }), x0, x1, max(2, N)), st, g, hl);
        } else {
          const [t0, t1] = fnRange(val, b);
          this.polylines(this.sample(t => applyPt(val.M, { x: t, y: val.f(t) }), t0, t1, 2 * v.W), st, g, hl);
        }
        return;
      }
      case 'curve': {
        const at = val.M ? t => applyPt(val.M, { x: val.fx(t), y: val.fy(t) }) : t => ({ x: val.fx(t), y: val.fy(t) });
        this.polylines(this.sample(at, val.t0, val.t1, 2000), st, g, hl);
        return;
      }
      case 'locus': {
        const pls = []; let cur = [];
        for (const p of val.pts) {
          if (!p) { if (cur.length > 2) pls.push(cur); cur = []; continue; }
          cur.push(v.sx(p.x), v.sy(p.y));
        }
        if (cur.length > 2) pls.push(cur);
        this.polylines(pls, st, g, hl);
        return;
      }
      case 'implicit': {
        const segs = contour(val, v.bounds(), max(60, Math.round(v.W / 4)));
        const pls = segs.map(([a, b2]) => [v.sx(a.x), v.sy(a.y), v.sx(b2.x), v.sy(b2.y)]);
        this.polylines(pls, st, g, hl);
        return;
      }
      case 'num': return this.drawNum(val, st, g, hl, o);
      case 'text': return this.drawText(val, st, g, hl, o);
    }
  }

  drawPoint(x, y, st, g, hl) {
    const c = this.ctx, v = this.view;
    const sx = v.sx(x), sy = v.sy(y);
    g.pt = [sx, sy];
    if (sx < -50 || sy < -50 || sx > v.W + 50 || sy > v.H + 50) return;
    if (hl) { c.fillStyle = hexA(st.color, hl); c.beginPath(); c.arc(sx, sy, st.size + 5, 0, 2 * PI); c.fill(); }
    c.fillStyle = st.color; c.beginPath(); c.arc(sx, sy, st.size, 0, 2 * PI); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1; c.stroke();
    if (st.role === 'free' || st.role === 'onpath') {
      c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.arc(sx - st.size * 0.3, sy - st.size * 0.3, st.size * 0.35, 0, 2 * PI); c.fill();
    }
  }

  drawConic(val, st, g, hl) {
    const v = this.view, b = v.bounds();
    const ci = conicInfo(val);
    let pls = [];
    if (ci.type === 'ellipse') {
      const N = 360;
      pls = this.sample(t => ({ x: ci.c.x + ci.a * cos(t) * ci.e1.x + ci.b * sin(t) * ci.e2.x, y: ci.c.y + ci.a * cos(t) * ci.e1.y + ci.b * sin(t) * ci.e2.y }), 0, 2 * PI, N);
      if (st.fill && pls[0]) {
        const c = this.ctx, pl = pls[0];
        c.fillStyle = hexA(st.color, st.fill); c.beginPath(); c.moveTo(pl[0], pl[1]);
        for (let i = 2; i < pl.length; i += 2) c.lineTo(pl[i], pl[i + 1]); c.fill();
        g.area = pl;
      }
    } else if (ci.type === 'hyperbola') {
      const S = hyperbolaRange(ci, b);
      for (const br of [1, -1]) pls.push(...this.sample(s => hyperbolaAt(ci, s, br), -S, S, 800));
    } else if (ci.type === 'parabola') {
      const [u0, u1] = parabolaRange(ci, b);
      pls = this.sample(u => parabolaAt(ci, u), u0, u1, 1500);
    } else if (ci.type === 'lines') {
      for (const L of ci.lines) {
        const r = clip(v, v.sx(L.p.x), v.sy(L.p.y), L.d.x * v.scale, -L.d.y * v.scale, -Infinity, Infinity);
        if (r) pls.push(r);
      }
    } else if (ci.type === 'point' && ci.c) {
      return this.drawPoint(ci.c.x, ci.c.y, st, g, hl);
    }
    this.polylines(pls, st, g, hl);
  }

  drawNum(val, st, g, hl, o) {
    const c = this.ctx, v = this.view;
    if (val.shade) {
      const { f, g: gf, a, b } = val.shade;
      const x0 = min(a, b), x1 = max(a, b);
      const N = max(2, Math.ceil((x1 - x0) * v.scale));
      const top = [], bot = [];
      for (let i = 0; i <= N; i++) {
        const x = x0 + (x1 - x0) * i / N;
        const y = callFn(f, x), y2 = gf ? callFn(gf, x) : 0;
        if (!Number.isFinite(y) || !Number.isFinite(y2)) continue;
        top.push(v.sx(x), v.sy(y)); bot.push(v.sx(x), v.sy(y2));
      }
      if (top.length < 4) return;
      const area = [...top];
      for (let i = bot.length - 2; i >= 0; i -= 2) area.push(bot[i], bot[i + 1]);
      c.fillStyle = hexA(st.color, st.fill || 0.25); c.beginPath(); c.moveTo(area[0], area[1]);
      for (let i = 2; i < area.length; i += 2) c.lineTo(area[i], area[i + 1]);
      c.closePath(); c.fill();
      if (hl) { c.strokeStyle = hexA(st.color, hl + 0.3); c.lineWidth = 3; c.stroke(); }
      g.area = area;
      return;
    }
    if (val.arc) {
      const { c: vx, a0, sw } = val.arc;
      const sx = v.sx(vx.x), sy = v.sy(vx.y), R = o && o.style.arcSize || 28;
      g.angle = { sx, sy, R, a0, sw };
      const right = abs(sw - PI / 2) < 1e-9;
      const path = () => {
        c.beginPath();
        if (right) {
          const k = R * 0.62, u0 = [cos(a0), -sin(a0)], u1 = [cos(a0 + sw), -sin(a0 + sw)];
          c.moveTo(sx, sy); c.lineTo(sx + u0[0] * k, sy + u0[1] * k);
          c.lineTo(sx + (u0[0] + u1[0]) * k, sy + (u0[1] + u1[1]) * k);
          c.lineTo(sx + u1[0] * k, sy + u1[1] * k); c.closePath();
        } else { c.moveTo(sx, sy); c.arc(sx, sy, R, -a0, -(a0 + sw), true); c.closePath(); }
      };
      c.fillStyle = hexA(st.color, st.fill); path(); c.fill();
      if (hl) { c.strokeStyle = hexA(st.color, hl + 0.2); c.lineWidth = st.width + 5; path(); c.stroke(); }
      c.strokeStyle = st.color; c.lineWidth = st.width; path(); c.stroke();
      if (!right && o && o.style.arcs > 1) {
        for (let i = 1; i < o.style.arcs; i++) { c.beginPath(); c.arc(sx, sy, R - 4 * i, -a0, -(a0 + sw), true); c.stroke(); }
      }
      if (right) { const m = a0 + sw / 2; c.fillStyle = st.color; c.beginPath(); c.arc(sx + cos(m) * R * 0.36, sy - sin(m) * R * 0.36, 1.6, 0, 2 * PI); c.fill(); }
    }
  }

  drawText(val, st, g, hl, o) {
    const c = this.ctx, v = this.view;
    let sx, sy;
    if (val.pos) { sx = v.sx(val.pos.x); sy = v.sy(val.pos.y); }
    else { sx = (o && o.style.sx) ?? 20; sy = (o && o.style.sy) ?? 40; }
    c.font = `${st.fontSize}px system-ui, sans-serif`;
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    const lines = String(val.s).split('\n');
    const lh = st.fontSize * 1.3;
    let w = 0;
    for (const l of lines) w = max(w, c.measureText(l).width);
    const h = lh * lines.length;
    const box = [sx - 3, sy - st.fontSize - 2, w + 6, h + 2];
    if (hl) { c.fillStyle = hexA(this.theme.halo, hl * 0.6); c.fillRect(...box); }
    c.fillStyle = st.color;
    lines.forEach((l, i) => c.fillText(l, sx, sy + i * lh));
    g.box = box;
  }

  labelText(o) {
    const s = o.style, mode = s.lm || defaultLabelMode(o);
    const name = s.caption || o.name;
    const value = o.val.t === 'num' ? toText(o.val, this.settings.digits) : o.val.t === 'pt' ? toText(o.val, this.settings.digits) : null;
    if (mode === 'value' && value != null) return value;
    if (mode === 'nameValue' && value != null) return o.val.t === 'pt' ? `${name} = ${value}` : `${name} = ${value}`;
    return name;
  }

  drawLabel(o, st) {
    const c = this.ctx, v = this.view, g = o._g, val = o.val;
    let x, y, align = 'left';
    const off = o.style.lo || [0, 0];
    if (val.t === 'pt') { if (!g.pt) return; x = g.pt[0] + 7; y = g.pt[1] - 8; }
    else if (val.t === 'num') {
      if (val.arc && g.angle) {
        const m = val.arc.a0 + val.arc.sw / 2, R = g.angle.R + 8;
        x = g.angle.sx + cos(m) * R; y = g.angle.sy - sin(m) * R + 5;
        align = cos(m) > 0.35 ? 'left' : cos(m) < -0.35 ? 'right' : 'center';
        if (sin(m) < -0.5) y += 8;
      } else if (val.anchor) { x = v.sx(val.anchor.x) + 8; y = v.sy(val.anchor.y) + 19; }
      else return;
    } else if (g.circ) {
      x = g.circ.sx + g.circ.R * 0.72 + 4; y = g.circ.sy - g.circ.R * 0.72 - 4;
    } else if (g.area && val.t === 'poly') {
      let sx = 0, sy = 0, n = 0;
      for (let i = 0; i < g.area.length - 2; i += 2) { sx += g.area[i]; sy += g.area[i + 1]; n++; }
      x = sx / n; y = sy / n; align = 'center';
    } else if (g.pl && g.pl.length) {
      // a point of the path near the view centre, nudged off the stroke
      let best = null, bd = Infinity;
      const cx = v.W * 0.62, cy = v.H * 0.4;
      for (const pl of g.pl) for (let i = 0; i < pl.length; i += 2) {
        if (pl[i] < 10 || pl[i] > v.W - 30 || pl[i + 1] < 16 || pl[i + 1] > v.H - 10) continue;
        const d = hypot(pl[i] - cx, pl[i + 1] - cy);
        if (d < bd) { bd = d; best = [pl[i], pl[i + 1]]; }
      }
      if (val.t === 'seg' || val.t === 'vec') { const pl = g.pl[0]; best = [(pl[0] + pl[pl.length - 2]) / 2, (pl[1] + pl[pl.length - 1]) / 2]; }
      if (!best) return;
      x = best[0] + 6; y = best[1] - 8;
    } else if (g.box) return;
    else return;
    x += off[0]; y += off[1];
    const text = this.labelText(o);
    const w = this.drawRich(text, x, y, align, o.style.fontSize || 14, st.color);
    g.label = [align === 'center' ? x - w / 2 : align === 'right' ? x - w : x, y - 14, w, 18];
  }

  // Label text with A_1 / A_{12} drawn as real subscripts. Returns the width.
  drawRich(text, x, y, align, size, color) {
    const c = this.ctx;
    const parts = [];
    let last = 0;
    for (const m of text.matchAll(/_\{([^}]*)\}|_([A-Za-z0-9α-ωΑ-Ω]+)/g)) {
      if (m.index > last) parts.push([text.slice(last, m.index), false]);
      parts.push([m[1] ?? m[2], true]);
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push([text.slice(last), false]);
    const font = sub => `${sub ? Math.round(size * 0.72) : size}px system-ui, sans-serif`;
    const widths = parts.map(([s, sub]) => { c.font = font(sub); return c.measureText(s).width; });
    const total = widths.reduce((a, b) => a + b, 0);
    let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.lineWidth = 3; c.strokeStyle = hexA(this.theme.bg, 0.85); c.lineJoin = 'round'; c.fillStyle = color;
    parts.forEach(([s, sub], i) => {
      c.font = font(sub);
      const yy = sub ? y + size * 0.28 : y;
      c.strokeText(s, cx, yy); c.fillText(s, cx, yy);
      cx += widths[i];
    });
    return total;
  }

  drawSlider(o, cons, st) {
    const c = this.ctx, s = o.style.slider, T = this.theme;
    const x = s.sx ?? 30, y = s.sy ?? 30, W = s.w || 160;
    const f = (o.val.v - s.min) / (s.max - s.min || 1);
    const kx = x + max(0, min(1, f)) * W;
    const col = o.style.color || T.free;
    c.lineCap = 'round';
    c.strokeStyle = T.gridMajor; c.lineWidth = 4; c.beginPath(); c.moveTo(x, y); c.lineTo(x + W, y); c.stroke();
    c.strokeStyle = col; c.beginPath(); c.moveTo(x, y); c.lineTo(kx, y); c.stroke();
    const sel = st.selection.has(o.name);
    if (sel || st.hover === o.name) { c.fillStyle = hexA(col, 0.25); c.beginPath(); c.arc(kx, y, 12, 0, 2 * PI); c.fill(); }
    c.fillStyle = col; c.beginPath(); c.arc(kx, y, 7, 0, 2 * PI); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.3)'; c.lineWidth = 1; c.stroke();
    c.font = '14px system-ui, sans-serif'; c.fillStyle = T.text; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.fillText(`${o.style.caption || o.name} = ${toText(o.val, this.settings.digits)}`, x, y - 12);
    o._g = o._g || {};
    o._g.slider = { x, y, W };
  }

  drawTrace(o, cons) {
    const c = this.ctx, v = this.view, st = this.styleOf(o, cons);
    c.fillStyle = hexA(st.color, 0.55);
    for (const p of o.trace) { c.beginPath(); c.arc(v.sx(p.x), v.sy(p.y), max(1.5, st.size - 1.5), 0, 2 * PI); c.fill(); }
  }

  // ---------- hit testing ----------

  // Objects under (sx, sy), best first: points, then labels/text, then
  // strokes, then filled interiors.
  hits(cons, sx, sy, tol, showHidden) {
    const out = [];
    const segD = (pl) => {
      let best = Infinity;
      for (let i = 0; i + 3 < pl.length; i += 2) {
        const ax = pl[i], ay = pl[i + 1], bx = pl[i + 2], by = pl[i + 3];
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        let t = l2 ? ((sx - ax) * dx + (sy - ay) * dy) / l2 : 0;
        t = max(0, min(1, t));
        const d = hypot(sx - ax - t * dx, sy - ay - t * dy);
        if (d < best) best = d;
      }
      return best;
    };
    const inside = pl => {
      let inn = false;
      for (let i = 0, j = pl.length - 2; i < pl.length; j = i, i += 2) {
        const xi = pl[i], yi = pl[i + 1], xj = pl[j], yj = pl[j + 1];
        if ((yi > sy) !== (yj > sy) && sx < (xj - xi) * (sy - yi) / (yj - yi) + xi) inn = !inn;
      }
      return inn;
    };
    const inBox = b => sx >= b[0] - 2 && sx <= b[0] + b[2] + 2 && sy >= b[1] - 2 && sy <= b[1] + b[3] + 2;
    for (const o of cons.objs) {
      const g = o._g;
      if (!g || (o.style.hidden && !showHidden)) continue;
      if (g.slider) {
        const { x, y, W } = g.slider;
        if (sx >= x - 10 && sx <= x + W + 10 && abs(sy - y) <= 12) out.push({ o, pri: 0, d: 0, slider: true });
        continue;
      }
      if (g.pt) { const d = hypot(sx - g.pt[0], sy - g.pt[1]); if (d <= tol + 2) out.push({ o, pri: 0, d }); continue; }
      if (g.pts) { let d = Infinity, k = -1; g.pts.forEach((p, i) => { const dd = hypot(sx - p[0], sy - p[1]); if (dd < d) { d = dd; k = i; } }); if (d <= tol + 2) out.push({ o, pri: 0, d, k }); continue; }
      if (g.box) { if (inBox(g.box)) out.push({ o, pri: 1, d: 0 }); continue; }
      if (g.label && inBox(g.label) && o.val.t === 'num') out.push({ o, pri: 1, d: 0 });
      if (g.circ) { const d = abs(hypot(sx - g.circ.sx, sy - g.circ.sy) - g.circ.R); if (d <= tol) out.push({ o, pri: 2, d }); else if (g.area === 'circ' && hypot(sx - g.circ.sx, sy - g.circ.sy) < g.circ.R) out.push({ o, pri: 4, d: 0 }); continue; }
      if (g.pl) {
        let d = Infinity;
        for (const pl of g.pl) d = min(d, segD(pl));
        if (d <= tol) { out.push({ o, pri: 2, d }); continue; }
      }
      if (g.angle) {
        const { sx: ax, sy: ay, R, a0, sw } = g.angle;
        const r = hypot(sx - ax, sy - ay);
        const a = ((Math.atan2(-(sy - ay), sx - ax) - a0) % (2 * PI) + 2 * PI) % (2 * PI);
        if (r <= R + 4 && r > 3 && a <= sw) out.push({ o, pri: 3, d: 0 });
        continue;
      }
      if (Array.isArray(g.area) && inside(g.area)) out.push({ o, pri: 4, d: 0 });
    }
    return out.sort((a, b) => a.pri - b.pri || a.d - b.d);
  }

  // ---------- export ----------

  png(cons, st, scale = 2) {
    const off = document.createElement('canvas');
    const r = new Renderer(off);
    r.theme = this.theme; r.settings = this.settings;
    r.view = Object.assign(new View(), this.view);
    r.dpr = scale;
    off.width = this.view.W * scale; off.height = this.view.H * scale;
    r.draw(cons, { ...st, preview: null, hover: null, selection: new Set() });
    for (const o of cons.objs) o._g = null;
    return off;
  }
}

export { fmtNum };
