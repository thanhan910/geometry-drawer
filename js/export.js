// Asymptote and TikZ export of the visible diagram, for writing up solutions.
// Reuses the renderer's cached, clipped screen geometry (o._g) so every
// object type exports exactly as drawn, converted back to world coordinates.

import { THEMES, tickMarks } from './render.js';
import { fmtNum } from './expr.js';

const { abs, hypot, max, min, PI, cos, sin } = Math;

// Ramer-Douglas-Peucker on a flat [x0, y0, x1, y1, …] screen polyline.
function simplify(pl, tol = 0.35) {
  const n = pl.length / 2;
  if (n <= 2) return pl;
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const ax = pl[2 * i], ay = pl[2 * i + 1], bx = pl[2 * j], by = pl[2 * j + 1];
    const dx = bx - ax, dy = by - ay, L = hypot(dx, dy) || 1;
    let best = -1, bd = tol;
    for (let k = i + 1; k < j; k++) {
      const d = abs((pl[2 * k] - ax) * dy - (pl[2 * k + 1] - ay) * dx) / L;
      if (d > bd) { bd = d; best = k; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([i, best], [best, j]); }
  }
  const out = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(pl[2 * k], pl[2 * k + 1]);
  return out;
}

const GREEK = { α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'varepsilon', ζ: 'zeta', η: 'eta', θ: 'theta', ι: 'iota', κ: 'kappa',
  λ: 'lambda', μ: 'mu', ν: 'nu', ξ: 'xi', π: 'pi', ρ: 'rho', σ: 'sigma', τ: 'tau', υ: 'upsilon', φ: 'varphi', χ: 'chi', ψ: 'psi', ω: 'omega',
  Γ: 'Gamma', Δ: 'Delta', Θ: 'Theta', Λ: 'Lambda', Ξ: 'Xi', Π: 'Pi', Σ: 'Sigma', Φ: 'Phi', Ψ: 'Psi', Ω: 'Omega' };
export function latexName(n) {
  const m = /^([^_']+)(?:_(\w+))?('*)$/.exec(n);
  if (!m) return `\\mathrm{${n}}`;
  let base = m[1].replace(/[α-ωΑ-Ω]/g, c => (GREEK[c] ? `\\${GREEK[c]} ` : c)).trim();
  if (/^[A-Za-z]{2,}$/.test(base)) base = `\\mathrm{${base}}`;
  return base + (m[2] ? `_{${m[2]}}` : '') + m[3];
}
function latexLabel(text) {
  const [name, ...rest] = text.split(' = ');
  const val = rest.join(' = ').replace(/−/g, '-').replace(/°/g, '^\\circ');
  if (!rest.length) return /^-?[\d.]+°?$/.test(name) ? `$${name.replace(/−/g, '-').replace(/°/g, '^\\circ')}$` : `$${latexName(name)}$`;
  return `$${latexName(name)} = ${val}$`;
}

const hexRGB = h => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

// Collect drawing primitives in world coordinates.
function primitives(cons, R) {
  // Fresh geometry for exactly what is visible now (no selection halos).
  R.draw(cons, { selection: new Set() });
  const v = R.view, saved = R.theme;
  R.theme = THEMES.light;
  const W = (sx, sy) => [v.wx(sx), v.wy(sy)];
  const out = [];
  const layer = o => {
    const t = o.val.t;
    if (t === 'num') return o.val.shade ? 0 : 3;
    if (t === 'poly' || (t === 'arc' && o.val.sector)) return 1;
    if (t === 'pt' || t === 'pts') return 5;
    return t === 'text' ? 6 : 2;
  };
  const objs = cons.objs.filter(o => o._g && !o.style.hidden && o.val.t !== 'undef')
    .map((o, i) => [layer(o), i, o]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => x[2]);
  for (const o of objs) {
    const st = R.styleOf(o, cons), g = o._g, val = o.val;
    const base = { color: st.color, width: st.width, dash: st.dash || 0 };
    const label = R.wantsLabel(o) ? R.labelText(o) : null;
    switch (val.t) {
      case 'pt': out.push({ k: 'dot', p: [val.x, val.y], color: st.color, label: label && latexLabel(label) }); break;
      case 'pts': for (const p of val.pts) out.push({ k: 'dot', p: [p.x, p.y], color: st.color }); break;
      case 'circle':
        if (g.circ) out.push({ k: 'circle', c: [val.c.x, val.c.y], r: val.r, fill: st.fill, ...base });
        else for (const pl of g.pl || []) out.push({ k: 'path', pts: pts(simplify(pl), W), ...base });
        break;
      case 'arc': {
        const a0 = val.a0 * 180 / PI, a1 = (val.a0 + val.sw) * 180 / PI;
        out.push({ k: 'arc', c: [val.c.x, val.c.y], r: val.r, a0, a1, sector: val.sector, fill: val.sector ? st.fill : 0, ...base });
        break;
      }
      case 'poly':
        out.push({ k: 'path', pts: val.pts.map(p => [p.x, p.y]), closed: val.closed, fill: val.closed ? st.fill : 0, ...base });
        break;
      case 'num': {
        if (val.shade && Array.isArray(g.area)) out.push({ k: 'path', pts: pts(simplify(g.area), W), closed: true, fill: st.fill || 0.25, stroke: false, ...base });
        if (val.arc && g.angle) {
          const { c, a0, sw } = val.arc, r = g.angle.R / v.scale;
          const right = abs(sw - PI / 2) < 1e-9;
          const arcs = right ? 1 : o.style.arcs || 1;
          if (right) {
            const k = r * 0.62, u0 = [cos(a0), sin(a0)], u1 = [cos(a0 + sw), sin(a0 + sw)];
            out.push({ k: 'path', pts: [[c.x, c.y], [c.x + u0[0] * k, c.y + u0[1] * k], [c.x + (u0[0] + u1[0]) * k, c.y + (u0[1] + u1[1]) * k], [c.x + u1[0] * k, c.y + u1[1] * k]], closed: true, fill: st.fill, ...base, width: 1 });
          } else {
            for (let i = 0; i < arcs; i++) {
              out.push({ k: 'arc', c: [c.x, c.y], r: r - i * 4 / v.scale, a0: a0 * 180 / PI, a1: (a0 + sw) * 180 / PI, sector: i === 0, fill: i === 0 ? st.fill : 0, ...base, width: 1 });
            }
          }
        }
        if (label && g.label) {
          const [x, y, w] = g.label;
          out.push({ k: 'label', p: W(x + w / 2, y + 9), text: latexLabel(label), color: st.color });
        }
        break;
      }
      case 'text': if (val.pos) out.push({ k: 'label', p: [val.pos.x, val.pos.y], text: val.s, color: st.color, raw: true, align: 'NE' }); break;
      default:
        for (const pl of g.pl || []) out.push({ k: 'path', pts: pts(simplify(pl), W), arrow: val.t === 'vec', ...base });
        if (label && g.label) { const [x, y, w] = g.label; out.push({ k: 'label', p: W(x + w / 2, y + 9), text: latexLabel(label), color: st.color }); }
    }
    if ((val.t === 'seg' || val.t === 'vec') && o.style.ticks && g.pl && g.pl[0]) {
      for (const t of tickMarks(g.pl[0], o.style.ticks)) out.push({ k: 'path', pts: pts(t, W), ...base, dash: 0, width: 1 });
    }
  }
  R.theme = saved;
  return out;
}
const pts = (pl, W) => { const out = []; for (let i = 0; i < pl.length; i += 2) out.push(W(pl[i], pl[i + 1])); return out; };

const f = x => fmtNum(x, 4);
const P2 = ([x, y]) => `(${f(x)},${f(y)})`;

export function exportDiagram(cons, R, format) {
  const prims = primitives(cons, R);
  const b = R.view.bounds();
  const widthCm = 12, unit = widthCm / (b.xmax - b.xmin);
  const colors = new Map();
  const cname = hex => { if (!colors.has(hex)) colors.set(hex, `c${colors.size + 1}`); return colors.get(hex); };
  prims.forEach(p => p.color && cname(p.color));
  const lw = w => +(w * 0.4).toFixed(2);
  const lines = [];
  if (format === 'tikz') {
    lines.push('% Geometry Drawer export - needs \\usepackage{tikz}');
    for (const [hex, n] of colors) lines.push(`\\definecolor{${n}}{RGB}{${hexRGB(hex).join(',')}}`);
    lines.push(`\\begin{tikzpicture}[x=${f(unit)}cm, y=${f(unit)}cm, line cap=round, line join=round, font=\\small]`);
    lines.push(`\\clip ${P2([b.xmin, b.ymin])} rectangle ${P2([b.xmax, b.ymax])};`);
    const style = p => [cname(p.color), `line width=${lw(p.width)}pt`, p.dash === 1 ? 'dashed' : p.dash === 2 ? 'dotted' : null, p.arrow ? '-stealth' : null].filter(Boolean).join(', ');
    const fillStyle = p => `${cname(p.color)}, fill opacity=${f(p.fill)}`;
    for (const p of prims) {
      switch (p.k) {
        case 'path': {
          const path = p.pts.map(P2).join(' -- ') + (p.closed ? ' -- cycle' : '');
          if (p.fill) lines.push(`\\fill[${fillStyle(p)}] ${path};`);
          if (p.stroke !== false) lines.push(`\\draw[${style(p)}] ${path};`);
          break;
        }
        case 'circle':
          if (p.fill) lines.push(`\\fill[${fillStyle(p)}] ${P2(p.c)} circle (${f(p.r)});`);
          lines.push(`\\draw[${style(p)}] ${P2(p.c)} circle (${f(p.r)});`);
          break;
        case 'arc': {
          const s = [p.c[0] + p.r * cos(p.a0 * PI / 180), p.c[1] + p.r * sin(p.a0 * PI / 180)];
          const arc = `arc[start angle=${f(p.a0)}, end angle=${f(p.a1)}, radius=${f(p.r)}]`;
          if (p.sector) {
            const path = `${P2(p.c)} -- ${P2(s)} ${arc} -- cycle`;
            if (p.fill) lines.push(`\\fill[${fillStyle(p)}] ${path};`);
            lines.push(`\\draw[${style(p)}] ${path};`);
          } else lines.push(`\\draw[${style(p)}] ${P2(s)} ${arc};`);
          break;
        }
        case 'dot':
          lines.push(`\\fill[${cname(p.color)}] ${P2(p.p)} circle (1.5pt);`);
          if (p.label) lines.push(`\\node[above right, ${cname(p.color)}] at ${P2(p.p)} {${p.label}};`);
          break;
        case 'label': lines.push(`\\node[${p.raw ? 'above right' : ''}${p.raw ? ', ' : ''}${cname(p.color)}] at ${P2(p.p)} {${p.text}};`); break;
      }
    }
    lines.push('\\end{tikzpicture}');
  } else {
    lines.push('// Geometry Drawer export - compile with: asy -f pdf file.asy');
    lines.push(`unitsize(${f(unit)}cm);`, 'defaultpen(fontsize(10pt));');
    for (const [hex, n] of colors) lines.push(`pen ${n} = rgb(${hexRGB(hex).map(c => f(c / 255)).join(',')});`);
    const pen = p => [cname(p.color), `linewidth(${lw(p.width)})`, p.dash === 1 ? 'dashed' : p.dash === 2 ? 'dotted' : null].filter(Boolean).join('+');
    const fillPen = p => `${cname(p.color)}+opacity(${f(p.fill)})`;
    for (const p of prims) {
      switch (p.k) {
        case 'path': {
          const path = p.pts.map(P2).join('--') + (p.closed ? '--cycle' : '');
          if (p.fill) lines.push(`fill(${path}, ${fillPen(p)});`);
          if (p.stroke !== false) lines.push(`draw(${path}, ${pen(p)}${p.arrow ? ', Arrow(6)' : ''});`);
          break;
        }
        case 'circle':
          if (p.fill) lines.push(`fill(circle(${P2(p.c)}, ${f(p.r)}), ${fillPen(p)});`);
          lines.push(`draw(circle(${P2(p.c)}, ${f(p.r)}), ${pen(p)});`);
          break;
        case 'arc': {
          const arc = `arc(${P2(p.c)}, ${f(p.r)}, ${f(p.a0)}, ${f(p.a1)})`;
          const path = p.sector ? `${P2(p.c)}--${arc}--cycle` : arc;
          if (p.fill) lines.push(`fill(${path}, ${fillPen(p)});`);
          lines.push(`draw(${path}, ${pen(p)});`);
          break;
        }
        case 'dot':
          lines.push(p.label ? `dot("${p.label}", ${P2(p.p)}, NE, ${cname(p.color)});` : `dot(${P2(p.p)}, ${cname(p.color)});`);
          break;
        case 'label': lines.push(`label("${p.text.replace(/"/g, "''")}", ${P2(p.p)}${p.raw ? ', NE' : ''}, ${cname(p.color)});`); break;
      }
    }
    lines.push(`clip(box(${P2([b.xmin, b.ymin])}, ${P2([b.xmax, b.ymax])}));`);
  }
  return lines.join('\n') + '\n';
}
