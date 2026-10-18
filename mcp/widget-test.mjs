// Browser test of the in-chat editor. A stand-in host page loads the editor
// HTML (fetched over MCP, as Claude or ChatGPT would) in a sandboxed iframe,
// answers the MCP Apps handshake and sends a real draw_geometry result. The
// test then drags a point, draws a segment with the toolbar, and checks the
// edit reaches the model context, the "Open in app" link and "Ask AI".
//   node mcp/widget-test.mjs [--screenshot out.png]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const shotAt = process.argv.indexOf('--screenshot');
const SHOT = shotAt > -1 ? process.argv[shotAt + 1] : null;
let fail = 0;
const check = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) fail++; };

// 1. get the viewer and a result from a real server
const port = 5600 + Math.floor(Math.random() * 300);
const server = spawn(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], { env: { ...process.env, PORT: String(port), SHARE_DIR: `${tmpdir()}/gd-shares-test` }, stdio: ['ignore', 'ignore', 'inherit'] });
for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) break; } catch { /* starting */ } await delay(100); }
const client = new Client({ name: 'widget-test', version: '1' });
await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
const tool = (await client.listTools()).tools.find(t => t.name === 'draw_geometry');
const uri = tool._meta && tool._meta.ui && tool._meta.ui.resourceUri;
check(uri && tool._meta['ui/resourceUri'] === uri, `draw_geometry declares its editor (${uri})`);
check(/skybridge/.test(tool._meta['openai/outputTemplate'] || ''), 'and a ChatGPT Apps SDK template');
const resList = (await client.listResources()).resources;
check(resList.some(r => r.uri === uri && r.mimeType === 'text/html;profile=mcp-app') && resList.some(r => r.mimeType === 'text/html+skybridge'), 'editor listed in both formats');
const read = await client.readResource({ uri });
const html = read.contents[0].text;
check(read.contents[0].mimeType === 'text/html;profile=mcp-app' && html.includes('GD_EMBED') && !/<script[^>]+src=|<link[^>]+stylesheet/.test(html), `editor is one self-contained page (${Math.round(html.length / 1024)} KB)`);
const result = await client.callTool({ name: 'draw_geometry', arguments: {
  title: 'Euler line', caption: 'Drag A, B or C.', image: false,
  script: 'A = (-3, -2)\nB = (4, -2)\nC = (-0.5, 3.2)\na = Segment(B, C)\nb = Segment(C, A)\nc = Segment(A, B)\nω = Circumcircle(A, B, C)\nH = Orthocenter(A, B, C)\ne = EulerLine(A, B, C)\nSetColor(e, "red")',
} });
check(result.structuredContent && result.structuredContent.doc.o.length === 9, 'tool result carries the construction for the viewer');
await client.close();
server.kill();

// 2. a minimal host page
const hostPage = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#222">
<iframe id="f" sandbox="allow-scripts" style="width:900px;height:640px;border:0;display:block"></iframe>
<script>
const f = document.getElementById('f');
window.log = []; window.opened = null; window.size = null; window.ctx = null; window.msg = null;
const send = m => f.contentWindow.postMessage({ jsonrpc: '2.0', ...m }, '*');
addEventListener('message', e => {
  if (e.source !== f.contentWindow) return;
  const m = e.data; log.push(m.method || 'response');
  if (m.method === 'ui/initialize') send({ id: m.id, result: { protocolVersion: '2026-01-26', hostInfo: { name: 'test-host', version: '1' },
    hostCapabilities: { openLinks: {}, message: { text: {} }, updateModelContext: { text: {} } }, hostContext: { theme: 'light', displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] } } });
  if (m.method === 'ui/notifications/initialized') {
    send({ method: 'ui/notifications/tool-input', params: { arguments: {} } });
    send({ method: 'ui/notifications/tool-result', params: RESULT });
  }
  if (m.method === 'ui/open-link') { window.opened = m.params.url; send({ id: m.id, result: {} }); }
  if (m.method === 'ui/notifications/size-changed') window.size = m.params.height;
  if (m.method === 'ui/update-model-context') { window.ctx = m.params; send({ id: m.id, result: {} }); }
  if (m.method === 'ui/message') { window.msg = m.params; send({ id: m.id, result: {} }); }
});
const RESULT = ${JSON.stringify(result)};
f.srcdoc = ${JSON.stringify(html).replace(/<\//g, '<\\/')};
</script>`;
const web = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(hostPage); });
await new Promise(r => web.listen(0, '127.0.0.1', r));

// 3. drive it in Chromium
const CDP = 9500 + Math.floor(Math.random() * 300);
const profile = await mkdtemp(join(tmpdir(), 'gdw-'));
const chrome = spawn('/usr/bin/chromium-browser', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 80 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find(t => t.type === 'page'); } catch { /* starting */ } if (!target) await delay(250); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0;
const pend = new Map(), contexts = [], errors = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === 'Runtime.executionContextCreated') contexts.push(m.params.context);
  if (m.method === 'Target.attachedToTarget') sessions.push(m.params);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
});
const sessions = [];
const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
const evalIn = async (expr, sessionId) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId); return r.result?.result?.value; };
try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 920, height: 660, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${web.address().port}/` });
  await delay(2500);
  // The sandboxed iframe is an out-of-process frame: evaluate in its session.
  const frameSession = sessions.filter(t => t.targetInfo.type === 'iframe').at(-1);
  const frame = frameSession || contexts.find(c => c.origin === 'null');
  const inFrame = e => evalIn(e, frameSession && frameSession.sessionId);
  check(!!frame, 'viewer runs in a sandboxed (opaque-origin) iframe');
  const log = await evalIn('window.log.join(",")');
  check(/^ui\/initialize,ui\/notifications\/initialized/.test(log), `handshake in order: ${log}`);
  check(await inFrame('gd.cons.objs.length') === 9, 'editor loaded the 9 objects');
  check(await inFrame("document.querySelector('#info b')?.textContent") === 'Euler line', 'title card shown');
  check(await inFrame("!!document.querySelector('#tools .tb') && !!document.querySelector('#embedOpen') && !!document.querySelector('#embedAsk')"), 'full toolbar plus Open in app and Ask AI buttons');
  const ink = await inFrame(`(() => { const c = document.querySelector('#cv'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i] < 200) n++; return n; })()`);
  check(ink > 500, `canvas drew the figure (${ink} sampled dark px)`);
  check((await evalIn('window.size')) >= 600, `editor told the host its height (${await evalIn('window.size')})`);
  await inFrame("document.querySelector('#info').hidden = true; true");
  check(await evalIn('window.ctx') === null, 'nothing sent to the model before the user edits');
  // drag C upwards by 1 unit and check the orthocentre moved
  const before = await inFrame("JSON.stringify(gd.cons.get('H').val)");
  const [cx, cy, top] = await inFrame("[gd.view.sx(-0.5), gd.view.sy(3.2), document.querySelector('#cv').getBoundingClientRect().top]");
  const [tx, ty] = await inFrame("[gd.view.sx(-0.5), gd.view.sy(4.2)]");
  const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y: y + top, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  await mouse('mousePressed', cx, cy);
  for (let i = 1; i <= 6; i++) await mouse('mouseMoved', cx + (tx - cx) * i / 6, cy + (ty - cy) * i / 6);
  await mouse('mouseReleased', tx, ty);
  await delay(100);
  const c2 = await inFrame("gd.cons.get('C').val");
  check(Math.abs(c2.y - 4.2) < 0.05, `dragging C inside the chat moves it (y = ${c2.y.toFixed(3)})`);
  check(await inFrame("JSON.stringify(gd.cons.get('H').val)") !== before, 'dependent objects follow the drag');
  // draw a new segment from A to H with the Segment tool
  await inFrame("gd.setTool('segment'); true");
  const H = await inFrame("gd.cons.get('H').val");
  for (const [x, y] of [[-3, -2], [H.x, H.y]]) {
    const [px, py] = await inFrame(`[gd.view.sx(${x}), gd.view.sy(${y})]`);
    const r = await inFrame("(r => [r.left, r.top])(document.querySelector('#cv').getBoundingClientRect())");
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px + r[0], y: py + r[1], button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px + r[0], y: py + r[1], button: 'left', buttons: 0, clickCount: 1 });
    await delay(80);
  }
  check(await inFrame("gd.cons.objs.some(o => o.val.t === 'seg' && /Segment\\(A, H\\)/.test(JSON.stringify(gd.cons.toJSON().find(r => r.n === o.name))))"), 'user drew segment AH with the toolbar');
  await delay(1000);
  const ctx = await evalIn('window.ctx');
  check(ctx && /Segment\(A, H\)/.test(ctx.content[0].text) && ctx.structuredContent && ctx.structuredContent.doc, 'the edit reached the model context (ui/update-model-context)');
  await inFrame("document.querySelector('#embedOpen').click(); true");
  await delay(400);
  const opened = await evalIn('window.opened') || '';
  const m = /#c=z(.+)$/.exec(opened);
  const payload = m && JSON.parse(inflateRawSync(Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64')).toString());
  check(payload && payload.o.some(r => /Segment\(A, H\)/.test(r.d)), '"Open in app" link carries the user\'s edits');
  await inFrame("document.querySelector('#embedAsk').click(); true");
  await delay(300);
  await inFrame("(() => { document.querySelector('#dlg textarea').value = 'Why is AH perpendicular to BC?'; [...document.querySelectorAll('#dlg .btn')].find(b => b.textContent === 'OK').click(); return true; })()");
  await delay(400);
  const msg = await evalIn('window.msg');
  check(msg && msg.role === 'user' && /perpendicular/.test(msg.content[0].text), '"Ask AI" posts the question into the chat (ui/message)');
  await inFrame("document.querySelector('#btnAlgebra').click(); true");
  await delay(200);
  await inFrame("const i = document.querySelector('#input'); i.focus(); i.value = 'N = NinePointCenter(A, B, C)'; true");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await delay(150);
  check(await inFrame("!!gd.cons.get('N')"), 'typing a command + Enter works inside the sandbox');
  if (SHOT) { const r = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(SHOT, Buffer.from(r.result.data, 'base64')); console.log(`     screenshot → ${SHOT}`); }
  check(errors.length === 0, `no errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} catch (e) {
  check(false, `crashed: ${e.stack || e.message}`);
} finally {
  ws.close(); chrome.kill('SIGKILL'); web.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
console.log(fail ? `${fail} failure(s)` : 'all viewer checks passed');
process.exit(fail ? 1 : 0);
