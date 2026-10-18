// A recording stand-in for CanvasRenderingContext2D that turns the
// renderer's drawing calls into SVG. It lets the same Renderer draw in the
// browser (SVG export) and on the server (MCP previews) with no canvas.
// Only the subset render.js uses is implemented.

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = v => +v.toFixed(2);

export class SvgContext {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.out = [];
    this.d = '';
    this.st = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic',
      lineCap: 'butt', lineJoin: 'miter', globalAlpha: 1, dash: [], m: [1, 0, 0, 1, 0, 0] };
    this.stack = [];
    for (const k of ['fillStyle', 'strokeStyle', 'lineWidth', 'font', 'textAlign', 'textBaseline', 'lineCap', 'lineJoin', 'globalAlpha']) {
      Object.defineProperty(this, k, { get: () => this.st[k], set: v => { this.st[k] = v; } });
    }
    this.cx = 0; this.cy = 0;
  }
  // transform (the renderer only scales and translates)
  setTransform(a, b, c, d, e, f) { this.st.m = [a, b, c, d, e, f]; }
  P(x, y) { const m = this.st.m; return [m[0] * x + m[4], m[3] * y + m[5]]; }
  get scale() { return this.st.m[0]; }
  save() { this.stack.push({ ...this.st, dash: [...this.st.dash] }); }
  restore() { if (this.stack.length) this.st = this.stack.pop(); }
  setLineDash(a) { this.st.dash = a || []; }
  // paths
  beginPath() { this.d = ''; }
  moveTo(x, y) { const [X, Y] = this.P(x, y); this.d += `M${n(X)} ${n(Y)}`; this.cx = X; this.cy = Y; }
  lineTo(x, y) { const [X, Y] = this.P(x, y); this.d += `L${n(X)} ${n(Y)}`; this.cx = X; this.cy = Y; }
  closePath() { this.d += 'Z'; }
  rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  arc(x, y, r, a0, a1, ccw) {
    const T = 2 * Math.PI;
    let sweep = ccw ? a0 - a1 : a1 - a0;
    const full = sweep >= T - 1e-9;
    if (!full) sweep = ((sweep % T) + T) % T;
    const [X, Y] = this.P(x, y), R = r * this.scale;
    const pt = a => [X + R * Math.cos(a), Y + R * Math.sin(a)];
    const [sx, sy] = pt(a0);
    this.d += `${this.d ? 'L' : 'M'}${n(sx)} ${n(sy)}`;
    const sf = ccw ? 0 : 1;
    if (full) {
      const [mx, my] = pt(a0 + (ccw ? -Math.PI : Math.PI));
      this.d += `A${n(R)} ${n(R)} 0 0 ${sf} ${n(mx)} ${n(my)}A${n(R)} ${n(R)} 0 0 ${sf} ${n(sx)} ${n(sy)}`;
    } else {
      const [ex, ey] = pt(a0 + (ccw ? -sweep : sweep));
      this.d += `A${n(R)} ${n(R)} 0 ${sweep > Math.PI ? 1 : 0} ${sf} ${n(ex)} ${n(ey)}`;
    }
  }
  alpha() { return this.st.globalAlpha < 1 ? ` opacity="${n(this.st.globalAlpha)}"` : ''; }
  stroke() {
    if (!this.d) return;
    const s = this.st, dash = s.dash.length ? ` stroke-dasharray="${s.dash.map(v => n(v * this.scale)).join(' ')}"` : '';
    this.out.push(`<path d="${this.d}" fill="none" stroke="${esc(s.strokeStyle)}" stroke-width="${n(s.lineWidth * this.scale)}" stroke-linecap="${s.lineCap}" stroke-linejoin="${s.lineJoin}"${dash}${this.alpha()}/>`);
  }
  fill() { if (this.d) this.out.push(`<path d="${this.d}" fill="${esc(this.st.fillStyle)}"${this.alpha()}/>`); }
  fillRect(x, y, w, h) { const [X, Y] = this.P(x, y), k = this.scale; this.out.push(`<rect x="${n(X)}" y="${n(Y)}" width="${n(w * k)}" height="${n(h * k)}" fill="${esc(this.st.fillStyle)}"${this.alpha()}/>`); }
  strokeRect(x, y, w, h) { this.beginPath(); this.rect(x, y, w, h); this.stroke(); }
  clearRect() {}
  // text
  fontParts() {
    const m = /(italic\s+)?(?:(\d+)\s+)?(\d+(?:\.\d+)?)px/.exec(this.st.font) || [];
    return { italic: !!m[1], weight: m[2] || 400, size: +(m[3] || 10) };
  }
  measureText(t) { const { size } = this.fontParts(); return { width: [...String(t)].length * size * 0.58 }; }
  text(t, x, y, stroke) {
    const [X, Y] = this.P(x, y), f = this.fontParts(), s = this.st;
    const anchor = { left: 'start', start: 'start', right: 'end', end: 'end', center: 'middle' }[s.textAlign] || 'start';
    const base = { top: 'hanging', middle: 'central', bottom: 'text-after-edge', alphabetic: 'auto' }[s.textBaseline] || 'auto';
    const paint = stroke ? `fill="none" stroke="${esc(s.strokeStyle)}" stroke-width="${n(s.lineWidth * this.scale)}" stroke-linejoin="round"` : `fill="${esc(s.fillStyle)}"`;
    this.out.push(`<text x="${n(X)}" y="${n(Y)}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="${n(f.size * this.scale)}"${f.italic ? ' font-style="italic"' : ''} text-anchor="${anchor}"${base !== 'auto' ? ` dominant-baseline="${base}"` : ''} ${paint}${this.alpha()}>${esc(t)}</text>`);
  }
  fillText(t, x, y) { this.text(t, x, y, false); }
  strokeText(t, x, y) { this.text(t, x, y, true); }
  toString() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w}" height="${this.h}" viewBox="0 0 ${this.w} ${this.h}">\n${this.out.join('\n')}\n</svg>\n`;
  }
}

// Draw a construction to an SVG string with the given renderer settings.
export function renderSVG(Renderer, cons, { view, theme, settings, width = 900, height = 640 } = {}) {
  const ctx = new SvgContext(width, height);
  const canvas = { getContext: () => ctx, style: {}, width, height };
  const r = new Renderer(canvas);
  if (theme) r.theme = theme;
  if (settings) r.settings = { ...r.settings, ...settings };
  r.dpr = 1;
  r.view.W = width; r.view.H = height;
  if (view) Object.assign(r.view, { cx: view.cx, cy: view.cy, scale: view.scale });
  const saved = cons.objs.map(o => o._g);
  r.draw(cons, { selection: new Set() });
  cons.objs.forEach((o, i) => { o._g = saved[i]; });
  return ctx.toString();
}
