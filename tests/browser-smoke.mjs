#!/usr/bin/env node
// Drive the real page in headless Chromium: load it, build constructions with
// the mouse and keyboard the way a user would, and fail on any console error
// or wrong result. Dependency-free: Chrome DevTools Protocol over Node's
// built-in WebSocket.
//
//   node tests/browser-smoke.mjs                 # serves the repo itself
//   node tests/browser-smoke.mjs https://host/geometry/ --screenshot out.png
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const shotAt = args.indexOf('--screenshot');
const SHOT = shotAt > -1 ? args[shotAt + 1] : null;
let URL_ = args.find(a => a.startsWith('http'));
const PORT = 9400 + Math.floor(Math.random() * 400);

async function chromePath() {
  const cands = [process.env.CHROME, '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'];
  for (const c of cands) { if (!c) continue; try { await access(c); return c; } catch { /* next */ } }
  throw new Error('No Chromium found; set CHROME=/path/to/chrome');
}

// Static server for the repository when no URL is given.
let server = null;
if (!URL_) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
  server = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    try {
      const body = await readFile(join(ROOT, p));
      res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }); res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  URL_ = `http://127.0.0.1:${server.address().port}/`;
}

let nextId = 1;
function connect(ws) {
  return new Promise((resolve, reject) => {
    const s = new WebSocket(ws), pending = new Map(), on = new Map();
    s.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
      for (const h of on.get(m.method) || []) h(m.params);
    });
    s.addEventListener('error', () => reject(new Error('CDP socket failed')));
    s.addEventListener('open', () => resolve({
      send: (method, params = {}) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); s.send(JSON.stringify({ id, method, params })); }),
      on: (m, h) => on.set(m, [...(on.get(m) || []), h]),
      close: () => s.close(),
    }));
  });
}

const profile = await mkdtemp(join(tmpdir(), 'gd-chrome-'));
const chrome = spawn(await chromePath(), ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1280,860', '--disable-dev-shm-usage', 'about:blank'],
{ stdio: ['ignore', 'ignore', 'pipe'] });

const failures = [];
const ok = m => console.log(`OK   ${m}`);
const bad = m => { console.log(`FAIL ${m}`); failures.push(m); };
const check = (c, m) => (c ? ok(m) : bad(m));

let client;
try {
  let target;
  for (let i = 0; i < 80 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page'); } catch { /* not up yet */ }
    if (!target) await delay(250);
  }
  if (!target) throw new Error('Chromium did not start');
  client = await connect(target.webSocketDebuggerUrl);
  const errors = [];
  client.on('Runtime.exceptionThrown', p => errors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text));
  client.on('Runtime.consoleAPICalled', p => { if (p.type === 'error') errors.push(p.args.map(a => a.value ?? a.description).join(' ')); });
  client.on('Log.entryAdded', p => { if (p.entry.level === 'error' && !/favicon/.test(p.entry.url || '')) errors.push(`${p.entry.text} ${p.entry.url || ''}`); });
  await client.send('Runtime.enable'); await client.send('Log.enable'); await client.send('Page.enable');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  const nav = await client.send('Page.navigate', { url: URL_ });
  if (nav.errorText) console.log('     navigate:', URL_, nav.errorText);
  const ev = async (expression) => {
    const r = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  for (let i = 0; i < 80; i++) { try { if (await ev('!!window.gd')) break; } catch { /* loading */ } await delay(100); }
  if (!(await ev('!!window.gd'))) console.log('     page:', await ev('location.href + " | " + document.title'), errors);
  check(await ev('!!window.gd'), 'app loaded');
  // Grid and axes are off by default; the drawing checks below rely on grid snapping.
  check(await ev("!gd.S.settings.grid && !gd.S.settings.axes"), "grid and axes are off by default");
  await ev("localStorage.clear(); gd.S.settings.grid = true; gd.cons.load([]); gd.S.selection.clear(); gd.render(); true");

  const rect = await ev("JSON.stringify(document.querySelector('#cv').getBoundingClientRect())").then(JSON.parse);
  // world → page coordinates
  const at = async (x, y) => ev(`[gd.view.sx(${x}) + ${rect.left}, gd.view.sy(${y}) + ${rect.top}]`);
  const mouse = async (type, x, y, extra = {}) => client.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse', ...extra });
  const click = async (wx, wy) => { const [x, y] = await at(wx, wy); await mouse('mouseMoved', x, y, { buttons: 0 }); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await delay(30); };
  const dragW = async (a, b) => {
    const [x0, y0] = await at(...a), [x1, y1] = await at(...b);
    await mouse('mousePressed', x0, y0);
    for (let i = 1; i <= 8; i++) await mouse('mouseMoved', x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8);
    await mouse('mouseReleased', x1, y1); await delay(30);
  };
  const key = async (k, code) => { await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: code || `Key${k.toUpperCase()}`, text: k.length === 1 ? k : undefined }); await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: code || `Key${k.toUpperCase()}` }); };
  const count = () => ev('gd.cons.objs.length');
  const val = n => ev(`(o => o && JSON.parse(JSON.stringify(o.val)))(gd.cons.get(${JSON.stringify(n)}))`);

  // --- tools by mouse ---------------------------------------------------
  await key('s');
  check(await ev('gd.S.tool') === 'segment', 'S selects the Segment tool');
  await click(-4, -2); await click(4, -2);
  check(await count() === 3, `segment tool made 2 points + segment (${await count()})`);
  check((await val('a'))?.t === 'seg', 'segment a exists (segments are named a, b, c…)');
  await key('c');
  await click(-4, -2); await click(0, 1);
  check((await val('f'))?.t === 'circle', 'circle tool reused point A and made circle f');
  check(Math.abs((await val('f')).r - 5) < 1e-9, 'circle radius 5 (snapped to grid)');
  await key('i');
  await click(-4, -2 + 0); // clicking A first: intersect needs paths, so this is ignored
  await key('p');
  // click where segment f meets circle g: (1, -2)
  await click(1, -2);
  const P = await ev("gd.cons.objs.at(-1).name");
  check(/^Intersect/i.test(await ev(`gd.cons.get('${P}').ast.f`)), `point tool at a crossing made an intersection (${P})`);
  await key('m');
  await click(-4, -2); await click(4, -2);
  const M = await ev("gd.cons.objs.at(-1).name");
  check(JSON.stringify(await val(M)) === JSON.stringify({ t: 'pt', x: 0, y: -2 }), `midpoint tool (${M})`);
  await key('g');
  await click(-4, -2); await click(4, -2); await click(0, 4); await click(-4, -2);
  const polys = await ev("gd.cons.objs.filter(o => o.val.t === 'poly').length");
  check(polys === 1, 'polygon tool closed a triangle');
  await key('a');
  await click(4, -2); await click(-4, -2); await click(0, 4);
  const ang = await ev("gd.cons.objs.at(-1).val.v * 180 / Math.PI");
  check(ang > 0 && ang < 180, `angle tool gave ${ang.toFixed(2)}°`);
  // --- move tool drags a free point and dependents follow ------------------
  await key('Escape', 'Escape');
  check(await ev('gd.S.tool') === 'move', 'Esc returns to Move');
  await dragW([4, -2], [6, -2]);
  check(JSON.stringify(await val(M)) === JSON.stringify({ t: 'pt', x: 1, y: -2 }), 'dragging B moves the midpoint');
  // --- undo / redo -------------------------------------------------------
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: 2 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: 2 });
  check(JSON.stringify(await val(M)) === JSON.stringify({ t: 'pt', x: 0, y: -2 }), 'Ctrl+Z undoes the drag');
  // --- dialog tools ----------------------------------------------------------
  const fillDialog = async (vals) => {
    for (let i = 0; i < 30 && !(await ev("document.querySelector('#dlg').open")); i++) await delay(50);
    await ev(`(() => { const ins = [...document.querySelectorAll('#dlg input:not([type=checkbox]), #dlg textarea')]; ${JSON.stringify(vals)}.forEach((v, i) => { if (v != null) ins[i].value = v; }); document.querySelector('#dlg form').requestSubmit(); return true; })()`);
    await delay(60);
  };
  let n0 = await count();
  await key('n'); await click(6, 5); await fillDialog(['sp', '0', '10', '1']);
  check((await val('sp'))?.t === 'num' && await ev("gd.cons.get('sp').style.slider.show"), 'slider tool made a canvas slider');
  await key('t'); await click(-8, 5); await fillDialog(['Hello']);
  check(await ev("gd.cons.objs.some(o => o.val.t === 'text' && o.val.s === 'Hello')"), 'text tool placed text');
  n0 = await count();
  await click(0, 0); // still the text tool: cancel the dialog
  for (let i = 0; i < 30 && !(await ev("document.querySelector('#dlg').open")); i++) await delay(50);
  await ev("[...document.querySelectorAll('#dlg .btn')].find(b => b.textContent === 'Cancel').click(); true");
  check(await count() === n0, 'cancelling a dialog creates nothing');
  await ev("gd.setTool('regpolygon'); true");
  await click(-8, -6); await click(-6, -6); await fillDialog(['5']);
  check(await ev("gd.cons.objs.filter(o => o.val.t === 'poly' && o.val.pts.length === 5).length") === 1, 'regular pentagon with vertices and sides');
  await ev("gd.setTool('rotate'); true");
  await click(-4, -2); await click(0, -2); await fillDialog(['90']);
  const rot = await val("A'");
  check(rot && Math.abs(rot.x - 0) < 1e-9 && Math.abs(rot.y - -6) < 1e-9, "rotate tool: A' = A rotated 90° about E");
  // --- dragging a segment moves both endpoints; point on path slides --------
  await key('Escape', 'Escape');
  await ev("gd.exec('s9 = Segment((6, -6), (8, -6))'); true");
  await ev("gd.exec('G9 = (6, -6)'); gd.exec('H9 = (8, -6)'); gd.exec('s9 = Segment(G9, H9)'); true");
  await dragW([7, -6], [7, -5]);
  check(JSON.stringify(await val('G9')) === JSON.stringify({ t: 'pt', x: 6, y: -5 }), 'dragging a segment translates its free endpoints');
  await ev("gd.exec('kk = Circle((7, 3), 1)'); gd.exec('S9 = Point(kk, 0)'); true");
  await dragW([8, 3], [7, 5]);
  const s9 = await val('S9');
  check(Math.abs(s9.x - 7) < 0.05 && Math.abs(s9.y - 4) < 0.05, 'point on a circle slides along it');
  // --- performance: 300 dependent objects recompute + draw ------------------
  const ms = await ev(`(() => { for (let i = 0; i < 100; i++) { gd.cons.add('P' + i + 'z', { k: 'pt', x: { k: 'num', v: Math.cos(i) * 5 }, y: { k: 'num', v: Math.sin(i) * 3 } }, {}); }
    for (let i = 0; i < 99; i++) { gd.cons.add('s' + i + 'z', JSON.parse(JSON.stringify({ k: 'call', f: 'Segment', a: [{ k: 'id', n: 'P' + i + 'z' }, { k: 'id', n: 'P' + (i + 1) + 'z' }] })), {}); gd.cons.add('m' + i + 'z', { k: 'call', f: 'Midpoint', a: [{ k: 'id', n: 's' + i + 'z' }] }, {}); }
    const t0 = performance.now(); for (let k = 0; k < 20; k++) { gd.cons.recompute(); gd.R.draw(gd.cons, { selection: new Set() }); } const dt = (performance.now() - t0) / 20;
    gd.cons.remove(gd.cons.objs.filter(o => /z$/.test(o.name)).map(o => o.name)); return dt; })()`);
  check(ms < 16, `recompute + redraw of ~${300 + n0} objects takes ${ms.toFixed(1)} ms (< one frame)`);
  // --- input bar ---------------------------------------------------------
  await ev(`(() => { const i = document.querySelector('#input'); i.value = 'w1(x) = sin(x) + 1'; i.form.requestSubmit(); return true; })()`);
  check((await val('w1'))?.t === 'fn', 'input bar: function');
  const hc = await ev("gd.cons.get('w1').style.color + ' ' + gd.S.fnColor");
  check(hc === '#2457d6 1', `first function gets the first palette colour (${hc})`);
  await ev(`(() => { const i = document.querySelector('#input'); i.value = 'k: x^2/16 + y^2/4 = 1'; i.form.requestSubmit(); return true; })()`);
  check((await val('k'))?.t === 'conic', 'input bar: ellipse');
  await ev(`(() => { const i = document.querySelector('#input'); i.value = 'Circle(Q, 2)'; i.form.requestSubmit(); return true; })()`);
  check(/Unknown name/.test(await ev("document.querySelector('#inputErr').textContent")), 'input bar shows errors');
  const rowsN = await ev("document.querySelectorAll('#alist .row').length");
  check(rowsN >= 10, `algebra view lists objects (${rowsN})`);
  // --- every command through the input bar --------------------------------
  const script = [
    'a = 2', 'α = 40°', 'O = (0, 0)', 'U = (3, 1)', 'l1 = Line(O, U)', 'r1 = Ray(O, (1, 3))', 'v1 = Vector(O, U)',
    'pp = Perpendicular(U, l1)', 'pl = Parallel((0, 2), l1)', 'pb = PerpendicularBisector(O, U)', 'ab = AngleBisector(U, O, (0, 3))',
    'c1 = Circle(O, a)', 'c3 = Circle(O, U, (0, 3))', 'ic = Incircle(O, U, (0, 3))', 'sc = Semicircle(O, U)', 'ca = CircularArc(O, U, (0, 3))',
    'cs = CircularSector(O, U, (0, 3))', 'el = Ellipse((-2, 0), (2, 0), 3)', 'hy = Hyperbola((-2, 0), (2, 0), 1)', 'pa = Parabola((0, 1), Line((0, -1), (1, -1)))',
    'cn = Conic((1, 0), (0, 1), (-1, 0), (0, -1), (0.8, 0.6))', 'T1 = Tangent((5, 0), c1, 1)', 'rf = Reflect(c3, l1)', 'ro = Rotate(el, α, O)',
    'tr = Translate(hy, v1)', 'dl = Dilate(pa, 2, O)', 'iv = Reflect(U, c1)', 'q(x) = x^3 - 3x', 'dq = Derivative(q)', 'Iq = Integral(q, 0, 1)',
    'Rq = Root(q, 1, 2)', 'Eq = Extremum(q, -2, 2)', 'cu = Curve(cos(t), sin(2t), t, 0, 2π)', 'im: x^4 + y^4 = 4', 'Q1 = Point(c1, 0.1)',
    'M1 = Midpoint(Q1, U)', 'lo = Locus(M1, Q1)', 'ar = Area(Polygon(O, U, (0, 3)))', 'ds = Distance(U, l1)', 'sl = Slope(l1)',
    'tx = Text("a = " + a, (-5, 5))', 'pg = Polygon((5, 1), (6, 1), 5)', 'X1 = Intersect(el, c1)', 'fz = If(a > 1, 1, 0)',
  ];
  const res = await ev(`(() => { const out = []; for (const s of ${JSON.stringify(script)}) { try { const o = gd.exec(s); out.push(o.val.t === 'undef' ? 'UNDEF ' + s : ''); } catch (e) { out.push('ERR ' + s + ': ' + e.message); } } return out.filter(Boolean); })()`);
  check(res.length === 0, `all ${script.length} commands evaluate${res.length ? ': ' + res.join(' | ') : ''}`);
  await ev('gd.render(); true'); await delay(100);
  // --- canvas actually drew something ---------------------------------------
  const ink = await ev(`(() => { const c = document.querySelector('#cv'), x = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < x.length; i += 16) if (x[i] < 200 || x[i+1] < 200 || x[i+2] < 200) n++; return n; })()`);
  check(ink > 2000, `canvas has ink (${ink} sampled px)`);
  // --- save/load round trip through the share link --------------------------
  const rt = await ev(`(async () => { const n = gd.cons.objs.length; const d = await gd.decodeDoc(await gd.encodeDoc()); return [n, d.objects.length]; })()`);
  check(rt[0] === rt[1], `share link encodes all ${rt[0]} objects`);
  // --- properties panel ------------------------------------------------------
  await key('Escape', 'Escape');
  await click(-4, -2);
  check(await ev("!document.querySelector('#props').hidden"), 'selecting a point opens properties');
  // --- menu and help open without errors ---------------------------------
  await ev("document.querySelector('#btnMenu').click(); document.querySelector('#menu').hidden");
  await key('Escape', 'Escape');
  await key('?', 'Slash');
  check(await ev("!document.querySelector('#help').hidden"), 'help overlay opens');
  await key('Escape', 'Escape');
  // --- olympiad features ------------------------------------------------------
  await ev("window.confirm = () => true; gd.applyTemplate('Triangle with circumcircle'); true");
  check(await ev("gd.cons.objs.length === 7 && !gd.S.settings.axes"), 'template: triangle with circumcircle, clean diagram');
  await ev("gd.setTool('center'); true");
  await click(-3, -2); await click(4, -2); await click(-0.6, 3.2);
  for (let i = 0; i < 30 && !(await ev("document.querySelector('#dlg').open")); i++) await delay(50);
  await ev("(() => { const s = document.querySelector('#dlg select'); s.value = '4'; document.querySelector('#dlg form').requestSubmit(); return true; })()");
  await delay(60);
  check(await ev("gd.cons.get('H')?.ast.f") === 'Orthocenter', 'triangle-centre tool made the orthocentre H');
  await ev("gd.exec('O = Circumcenter(A, B, C)'); gd.exec('G = Centroid(A, B, C)'); gd.exec('P = (1, 2.5)'); true");
  await ev("gd.setTool('relation'); true");
  for (const n of ['O', 'G', 'H']) { const p = await val(n); await click(p.x, p.y); }
  const rel = await ev("[...document.querySelectorAll('#rel li')].map(li => li.className + ':' + li.textContent).join(' | ')");
  check(/^yes:.*collinear.*always/.test(rel), `relation checker: O, G, H always collinear (${rel.slice(0, 90)})`);
  await click(8, 8); // empty space clears
  const g = await val('G'), h = await val('H'), p0 = await val('P');
  await ev("gd.exec('Q = (0, 0)'); true");
  await click(g.x, g.y); await click(p0.x, p0.y); await click(0, 0);
  const rel2 = await ev("document.querySelector('#rel li').className");
  check(rel2 === 'no', 'relation checker: G, P, Q not collinear');
  await ev("gd.exec('Z = Point(Line(A, B), 0.3)'); gd.exec('W = Point(Line(A, B), 0.7)'); true");
  await click(8, 8);
  for (const n of ['A', 'Z', 'W']) { const p = await val(n); await click(p.x, p.y); }
  check(/yes:.*always/.test(await ev("document.querySelector('#rel li').className + ':' + document.querySelector('#rel li').textContent")), 'points on a line: collinear always');
  await key('Escape', 'Escape'); await key('Escape', 'Escape');
  // marks
  await ev("gd.cons.get('a').style.ticks = 2; gd.cons.get('b').style.ticks = 2; gd.exec('α = Angle(B, A, C)'); gd.cons.get('α').style.arcs = 2; gd.render(); true");
  // step-through
  await ev("gd.enterSteps(); gd.goStep(3); true"); await delay(50);
  const drawn = await ev("gd.cons.objs.filter(o => o._g).length");
  check(drawn === 3, `step mode draws only the first 3 steps (${drawn})`);
  await ev("gd.exitSteps(); true");
  // export
  const asy = await ev("gd.exportDiagram('asy')"), tikz = await ev("gd.exportDiagram('tikz')");
  check(/unitsize/.test(asy) && /dot\("\$A\$"/.test(asy) && /draw\(circle/.test(asy), 'Asymptote export has points, labels and circles');
  check(/\\begin\{tikzpicture\}/.test(tikz) && /circle \(/.test(tikz) && /\\end\{tikzpicture\}/.test(tikz), 'TikZ export is a complete picture');
  if (process.env.EXPORT_DIR) { await writeFile(join(process.env.EXPORT_DIR, 'diagram.asy'), asy); await writeFile(join(process.env.EXPORT_DIR, 'diagram.tikz'), tikz); }
  // --- theorem demos, angle chasing, inversion --------------------------------
  const ndemos = await ev("(async () => (await import('./js/demos.js')).DEMOS.length)()");
  for (let i = 0; i < ndemos; i++) {
    await ev(`gd.loadDemo(${i}); true`);
    const st = await ev("(() => { const b = document.querySelector('#info .btn.primary'); if (b) b.click(); return [document.querySelector('#info b').textContent, gd.S.tool, [...document.querySelectorAll('#rel li')].map(l => l.className).join(',')]; })()");
    if (st[1] === 'relation') check(st[2].startsWith('yes'), `demo "${st[0]}": Check confirms the theorem always holds (${st[2]})`);
    else check(st[1] === 'anglechase' && /yes/.test(st[2]), `demo "${st[0]}": Find equal angles lists classes`);
  }
  const chase = await ev("[...document.querySelectorAll('#rel li')].map(l => l.querySelector('.grow div').textContent)");
  check(chase.some(t => t.includes('∠BAC') && t.includes('∠BDC')), `angle chase finds ∠BAC = ∠BDC (${chase.slice(0, 3).join(' | ')})`);
  const n1 = await count();
  await ev("document.querySelector('#rel li .btn').click(); true");
  check(await count() > n1 && await ev("gd.cons.objs.at(-1).style.arcs >= 1"), 'Mark draws the class with matching arcs');
  await key('Escape', 'Escape');
  await ev("gd.exec('ι = Circle((0, 0), 2)'); gd.exec('sg = Segment((1, 1), (3, 1))'); true");
  await ev("gd.setTool('inversion'); true");
  await click(2, 1); const kk2 = await ev("[gd.view.sx(2) , 0]"); await click(0, 2);
  check(await ev("gd.cons.objs.at(-1).val.t") === 'arc', 'inversion tool maps a segment to an arc');
  await key('Escape', 'Escape');
  // --- script panel ------------------------------------------------------------
  await ev("gd.showTab('script'); true");
  const runPane = async (lang, text) => {
    await ev(`(() => { document.querySelector('#scriptLang').value = ${JSON.stringify(lang)}; document.querySelector('#scriptText').value = ${JSON.stringify(text)}; document.querySelector('#scriptReplace').checked = true; return true; })()`);
    await ev("gd.runScriptPane().then(() => true)");
    await delay(50);
    return ev("document.querySelector('#scriptOut').textContent");
  };
  let outp = await runPane('cmd', 'A = (0, 0)\nB = (4, 0)\n# comment\nC = (1, 3)\nk = Circumcircle(A, B, C)\nSetColor(k, "red")\nZ = Midpoint(A, Q)\nShowAxes(false)');
  check(/4 objects created, 1 error/.test(outp) && /line 7/.test(outp), `command script runs and reports line 7 (${outp.slice(0, 80)})`);
  check(await ev("gd.cons.get('k').style.color === '#c0392b' && gd.S.settings.axes === false"), 'script styling and ShowAxes applied');
  outp = await runPane('js', 'for (const k of range(6)) point("P_" + k, Math.cos(k), Math.sin(k));\ncmd("poly = Polygon(P_0, P_1, P_2, P_3, P_4, P_5)")');
  check(/7 objects created/.test(outp) && await ev("gd.cons.get('poly').val.pts.length") === 6, `JavaScript script generates a hexagon (${outp.slice(0, 60)})`);
  outp = await runPane('js', 'let x = 1;\nfoo();');
  check(/line 2/.test(outp) && /foo/.test(outp), `JavaScript errors give the line (${outp})`);
  outp = await runPane('js', 'while (true) {}');
  check(/3 seconds/.test(outp), 'endless JavaScript loop is stopped');
  outp = await runPane('js', 'cmd(typeof document, typeof localStorage)');
  check(await ev("gd.cons.objs.length") === 0 && /error/.test(outp), 'sandboxed JavaScript cannot see the page');
  outp = await runPane('js', 'const x = new XMLHttpRequest();\nx.open("GET", "/", false);\nx.send();\ncmd("A = (1, 1)")');
  check(await ev("gd.cons.objs.length") === 0 && /JavaScript error/.test(outp), `sandboxed JavaScript cannot make web requests (${outp.slice(0, 70)})`);
  check(await ev("document.querySelectorAll('iframe').length") === 0, 'the sandbox frame is removed after each run');
  const sc = await ev("gd.toScript()");
  check(sc === '', 'empty construction gives an empty script');
  await ev("gd.showTab('alg'); true");
  await ev(`(() => { const i = document.querySelector('#input'); i.value = 'A = (1, 1)'; i.form.requestSubmit(); i.value = 'SetColor(A, "green")'; i.form.requestSubmit(); return true; })()`);
  check(await ev("gd.cons.get('A').style.color") === '#138d75', 'styling statements work in the input bar');
  // --- damaged share links explain themselves -------------------------------
  await ev("location.hash = '#c=zDAMAGEDLINK'; location.reload(); true").catch(() => {});
  await delay(1200);
  for (let i = 0; i < 30; i++) { try { if (await ev('!!window.gd')) break; } catch { /* reloading */ } await delay(100); }
  const toastText = await ev("document.querySelector('#toast').textContent");
  check(/damaged or incomplete/.test(toastText), `a damaged link explains itself (${toastText})`);
  // --- phone layout -------------------------------------------------------
  await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 2, mobile: true });
  await delay(250);
  const overflow = await ev('document.documentElement.scrollWidth > innerWidth');
  check(!overflow, 'no horizontal page scroll at phone width');
  if (SHOT) {
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
    await ev("gd.S.selection.clear(); gd.render(); true"); await delay(300);
    const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(SHOT, Buffer.from(data, 'base64'));
    console.log(`     screenshot → ${SHOT}`);
  }
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''}`);
} catch (e) {
  bad(`smoke test crashed: ${e.stack || e.message}`);
} finally {
  try { client && client.close(); } catch { /* ignore */ }
  chrome.kill('SIGKILL');
  server && server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nall browser checks passed');
process.exit(failures.length ? 1 : 0);
