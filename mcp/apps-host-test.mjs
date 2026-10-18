// The embedded editor against the OFFICIAL MCP Apps host implementation
// (@modelcontextprotocol/ext-apps AppBridge), not a hand-written stand-in:
// if this passes, the editor speaks the protocol the way real hosts expect.
//   node mcp/apps-host-test.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { buildSync } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

let fail = 0;
const check = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) fail++; };

const port = 5600 + Math.floor(Math.random() * 300);
const server = spawn(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], { env: { ...process.env, PORT: String(port), SHARE_DIR: `${tmpdir()}/gd-shares-test` }, stdio: ['ignore', 'ignore', 'inherit'] });
for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) break; } catch { /* starting */ } await delay(100); }
const client = new Client({ name: 'apps-host-test', version: '1' });
await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
const tool = (await client.listTools()).tools.find(t => t.name === 'draw_geometry');
const html = (await client.readResource({ uri: tool._meta.ui.resourceUri })).contents[0].text;
const result = await client.callTool({ name: 'draw_geometry', arguments: { title: 'Official host', image: false,
  script: 'A = (-3, -2)\nB = (4, -2)\nC = (-0.5, 3.2)\nk = Circumcircle(A, B, C)\nH = Orthocenter(A, B, C)' } });
await client.close();
server.kill();

// The host side, bundled from the official package.
const hostJs = buildSync({ stdin: { resolveDir: new URL('.', import.meta.url).pathname, contents: `
  import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
  window.startHost = async (iframe, result, html) => {
    window.events = [];
    const bridge = new AppBridge(null, { name: 'official-host', version: '1.0.0' },
      { openLinks: {}, message: { text: {} }, updateModelContext: { text: {} } },
      { hostContext: { theme: 'dark', displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] } });
    bridge.oninitialized = () => { events.push('initialized'); bridge.sendToolInput({ arguments: {} }); bridge.sendToolResult(result); };
    bridge.onupdatemodelcontext = async p => { window.ctx = p; return {}; };
    bridge.onmessage = async p => { window.msg = p; return {}; };
    bridge.onopenlink = async p => { window.opened = p.url; return {}; };
    bridge.onsizechange = p => { window.size = p.height; };
    bridge.onrequestdisplaymode = async ({ mode }) => { window.mode = mode; return { mode }; };
    await bridge.connect(new PostMessageTransport(iframe.contentWindow, iframe.contentWindow));
    iframe.srcdoc = html;
  };` }, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020' }).outputFiles[0].text;

const page = `<!doctype html><meta charset="utf-8"><body style="margin:0">
<iframe id="f" sandbox="allow-scripts" style="width:900px;height:640px;border:0;display:block"></iframe>
<script>${hostJs.replace(/<\//g, '<\\/')}</script>
<script>startHost(document.getElementById('f'), ${JSON.stringify(result.structuredContent ? result : {})}, ${JSON.stringify(html).replace(/<\//g, '<\\/')});</script>`;
const web = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page); });
await new Promise(r => web.listen(0, '127.0.0.1', r));

const CDP = 9500 + Math.floor(Math.random() * 300);
const profile = await mkdtemp(join(tmpdir(), 'gdh-'));
const chrome = spawn('/usr/bin/chromium-browser', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 80 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find(t => t.type === 'page'); } catch { /* starting */ } if (!target) await delay(250); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0;
const pend = new Map(), sessions = [], errors = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === 'Target.attachedToTarget') sessions.push(m.params);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
});
const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
const evalIn = async (expr, sessionId) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)).result?.result?.value;
try {
  await send('Runtime.enable');
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 920, height: 660, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${web.address().port}/` });
  await delay(3000);
  const fs = sessions.filter(t => t.targetInfo.type === 'iframe').at(-1);
  const inFrame = e => evalIn(e, fs && fs.sessionId);
  check(!!fs, 'editor loaded in a sandboxed iframe');
  check((await evalIn('window.events.join()')) === 'initialized', 'AppBridge completed the handshake with the editor');
  check(await inFrame('gd.cons.objs.length') === 5, 'editor received the tool result from AppBridge');
  check(await inFrame('document.documentElement.dataset.theme') === 'dark', 'editor took the theme from the host context');
  check((await evalIn('window.size')) >= 600, 'AppBridge received the size');
  await inFrame("gd.exec('M = Midpoint(A, H)'); true");
  await delay(1000);
  const ctx = await evalIn('window.ctx');
  check(ctx && /M = Midpoint\(A, H\)/.test(ctx.content[0].text), 'AppBridge received the edit as model context');
  await inFrame("document.querySelector('#embedOpen').click(); true");
  await delay(400);
  check(/#c=z/.test(await evalIn('window.opened') || ''), 'AppBridge received the open-link request');
  await inFrame("document.querySelector('#embedFull').click(); true");
  await delay(300);
  check(await evalIn('window.mode') === 'fullscreen' && await inFrame("document.documentElement.classList.contains('full')"), 'fullscreen request honoured');
  check(errors.length === 0, `no errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} catch (e) {
  check(false, `crashed: ${e.stack || e.message}`);
} finally {
  ws.close(); chrome.kill('SIGKILL'); web.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
console.log(fail ? `${fail} failure(s)` : 'all official-host checks passed');
process.exit(fail ? 1 : 0);
