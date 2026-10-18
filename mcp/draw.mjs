// The core of the MCP server: run a construction script with the app's own
// engine, check it, render a PNG and build a link that opens it in the app.
// Kept apart from server.mjs so tests can call it without HTTP.

import { deflateRawSync } from 'node:zlib';
import { existsSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { Construction } from '../js/construction.js';
import { runScript } from '../js/script.js';
import { Renderer, THEMES, fitView } from '../js/render.js';
import { renderSVG } from '../js/svgctx.js';
import { describe, typeName } from '../js/geom.js';
import { parseExpr } from '../js/expr.js';
import { isNumLit } from '../js/construction.js';

export const APP_URL = process.env.GEOMETRY_APP_URL || 'https://nbg5pc.taileeca1e.ts.net/geometry/';
const FONTS = ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf'].filter(existsSync);
const FN_COLORS = ['#2457d6', '#c0392b', '#138d75', '#8e44ad', '#d35400', '#2c3e50'];
export const LIMITS = { scriptChars: 20000, statements: 600, verify: 20, trials: 40 };

const base64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// The same share-link format as the app's "Copy share link".
export function shareLink(cons, view, settings, info) {
  const payload = { v: view, s: settings, o: cons.toJSON() };
  if (info && (info.title || info.caption)) payload.i = { t: info.title || '', c: info.caption || '' };
  return `${APP_URL}#c=z${base64url(deflateRawSync(Buffer.from(JSON.stringify(payload))))}`;
}

function rowText(o) {
  const v = o.val;
  if (v.t === 'undef') return `${o.name}: undefined (check its definition)`;
  const d = describe(v, 4);
  if (v.t === 'fn') return `${o.name}(x) = ${d ?? '(function)'}`;
  if (['line', 'ray', 'circle', 'conic'].includes(v.t)) return `${o.name}: ${d} [${typeName(v)}]`;
  return `${o.name} = ${d ?? typeName(v)} [${typeName(v)}${v.t === 'pt' && isNumLit(o.ast.x || {}) ? ', free' : ''}]`;
}

export function draw({ script, title, caption, showAxes, showGrid, verify = [], width = 900, height = 640, image = true }) {
  if (typeof script !== 'string' || !script.trim()) throw new Error('The script is empty');
  if (script.length > LIMITS.scriptChars) throw new Error(`Scripts are limited to ${LIMITS.scriptChars} characters`);
  let fn = 0;
  const cons = new Construction();
  const res = runScript(cons, script, {
    maxLines: LIMITS.statements,
    defaultStyle: (val, ast) => {
      const s = {};
      if (val.t === 'fn' || (ast && ast.k === 'fn')) s.color = FN_COLORS[fn++ % FN_COLORS.length];
      if (val.t === 'num' && ast && isNumLit(ast)) s.slider = ast.k === 'deg' ? { min: 0, max: 360, step: 1, show: false } : { min: -5, max: 5, step: 0.1, show: false };
      return s;
    },
  });
  // Graphs want axes; pure geometry looks better without them.
  const graphs = cons.objs.some(o => ['fn', 'curve', 'implicit'].includes(o.val.t));
  const settings = {
    axes: res.settings.axes ?? showAxes ?? graphs,
    grid: res.settings.grid ?? showGrid ?? graphs,
  };
  let view;
  if (res.view) {
    const v = res.view;
    view = { cx: (v.xmin + v.xmax) / 2, cy: (v.ymin + v.ymax) / 2, scale: Math.min(width / (v.xmax - v.xmin), height / (v.ymax - v.ymin)) };
  } else view = fitView(cons, width, height) || { cx: 0, cy: 0, scale: 50 };
  cons.bounds = { xmin: view.cx - width / 2 / view.scale, xmax: view.cx + width / 2 / view.scale, ymin: view.cy - height / 2 / view.scale, ymax: view.cy + height / 2 / view.scale };
  cons.recompute();

  // True/false facts: boolean objects in the script plus extra expressions.
  const checks = [];
  for (const o of cons.objs) if (o.val.t === 'bool') checks.push({ label: `${o.name} = ${o.ast.k === 'call' ? o.ast.f : 'check'}(…)`, name: o.name });
  verify.slice(0, LIMITS.verify).forEach((src, i) => {
    try { checks.push({ label: src, ast: parseExpr(src) }); } catch (e) { checks.push({ label: src, error: e.message }); }
  });
  const evalCheck = c => {
    if (c.error) return null;
    const v = c.name ? cons.get(c.name).val : cons.tryEval(c.ast);
    return v.t === 'bool' ? v.v : null;
  };
  for (const c of checks) {
    try { c.now = evalCheck(c); } catch (e) { c.error = e.message; }
    if (c.now === null && !c.error) c.error = 'not a true/false expression (use AreCollinear, AreConcyclic, IsOn, AreEqual, …)';
    c.ok = 0; c.n = 0;
  }
  const moved = cons.perturb(LIMITS.trials, () => {
    for (const c of checks) {
      if (c.error) continue;
      let r = null;
      try { r = evalCheck(c); } catch { r = null; }
      if (r === null) continue;
      c.n++; if (r) c.ok++;
    }
  });

  const link = shareLink(cons, view, settings, { title, caption });
  const lines = [];
  lines.push(`Open it in the app (interactive, draggable): ${link}`, '');
  if (res.errors.length) {
    lines.push(`ERRORS (${res.errors.length}); these lines were skipped:`);
    for (const e of res.errors.slice(0, 40)) lines.push(`- line ${e.line}: ${e.src} -> ${e.msg}`);
    lines.push('');
  }
  if (checks.length) {
    lines.push(moved ? `Checks (re-tested on ${LIMITS.trials} random positions of the free points):` : 'Checks (nothing is free to move, so only this position):');
    for (const c of checks) {
      if (c.error) { lines.push(`- ${c.label}: error, ${c.error}`); continue; }
      const gen = !moved || !c.n ? '' : c.ok === c.n ? `, always (${c.ok}/${c.n})` : c.ok === 0 ? `, never in other positions (0/${c.n})` : `, only sometimes (${c.ok}/${c.n}): probably a coincidence`;
      lines.push(`- ${c.label}: ${c.now}${gen}`);
    }
    lines.push('');
  }
  const undef = cons.objs.filter(o => o.val.t === 'undef').length;
  lines.push(`Objects (${cons.objs.length}${undef ? `, ${undef} undefined` : ''}):`);
  for (const o of cons.objs.slice(0, 150)) lines.push(`- ${rowText(o)}`);
  if (cons.objs.length > 150) lines.push(`- … and ${cons.objs.length - 150} more`);

  let png = null;
  if (image && cons.objs.length) {
    const svg = renderSVG(Renderer, cons, { view, theme: THEMES.light, settings: { ...settings, digits: 2 }, width, height });
    png = new Resvg(svg, { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans' }, background: '#ffffff' }).render().asPng();
  }
  return { link, text: lines.join('\n'), png, errors: res.errors, checks, objects: cons.objs.length };
}
