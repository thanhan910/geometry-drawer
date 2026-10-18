// End-to-end test: start the server, talk to it with the official MCP client
// exactly as Claude would, and check the tools' answers.
//   node mcp/test.mjs                       # spawns its own server
//   node mcp/test.mjs https://host/geometry-mcp/mcp   # a deployed one
import { spawn } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Construction } from '../js/construction.js';

const { mkdtemp } = await import('node:fs/promises'), { tmpdir } = await import('node:os');
const children = [];
// A local server with its own empty short-link store and any extra settings.
async function startServer(env = {}) {
  const port = 5600 + Math.floor(Math.random() * 300);
  const child = spawn(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], { env: { ...process.env, PORT: String(port), SHARE_DIR: await mkdtemp(tmpdir() + '/gd-shares-'), ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  children.push(child);
  const u = `http://127.0.0.1:${port}/mcp`;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(u.replace('/mcp', '/healthz'))).ok) break; } catch { /* starting */ } await delay(100); }
  return u;
}
async function connect(u) {
  const client = new Client({ name: 'geometry-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(u)));
  return client;
}
const local = !process.argv[2];
let url = process.argv[2] || await startServer();
let fail = 0;
const check = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) fail++; };
try {
  const client = await connect(url);
  const tools = (await client.listTools()).tools.map(t => t.name).sort();
  check(tools.join(',') === 'draw_geometry,geometry_language', `tools listed: ${tools}`);
  check(/geometry_language/.test(client.getInstructions() || ''), 'server instructions explain the workflow');
  const guide = await client.callTool({ name: 'geometry_language', arguments: {} });
  check(guide.content[0].text.includes('Circumcircle(A, B, C)'), 'language guide returned');
  const r = await client.callTool({ name: 'draw_geometry', arguments: {
    title: 'Euler line', caption: 'Drag A, B or C.',
    script: 'A = (-3, -2)\nB = (4, -2)\nC = (-0.5, 3.2)\na = Segment(B, C)\nb = Segment(C, A)\nc = Segment(A, B)\nO = Circumcenter(A, B, C)\nG = Centroid(A, B, C)\nH = Orthocenter(A, B, C)\ne = EulerLine(A, B, C)\nSetColor(e, "red")\nX = Midpoint(A, Nope)',
    verify: ['AreCollinear(O, G, H)', 'AreCollinear(A, G, H)', 'Distance(A, B)'],
  } });
  const text = r.content.find(c => c.type === 'text').text, img = r.content.find(c => c.type === 'image');
  check(img && img.mimeType === 'image/png' && Buffer.from(img.data, 'base64').subarray(1, 4).toString() === 'PNG', 'PNG preview returned');
  check(/line 12: X = Midpoint\(A, Nope\) -> Unknown name "Nope"/.test(text), 'error reported with its line number');
  check(/AreCollinear\(O, G, H\): true, always \(40\/40\)/.test(text), 'theorem verified on random positions');
  check(/AreCollinear\(A, G, H\): false/.test(text), 'false statement reported false');
  check(/Distance\(A, B\): error, not a true\/false/.test(text), 'non-boolean verify explained');
  const link = /https?:\/\/\S+#s=([0-9a-z]{12})\b/.exec(text);
  check(!!link, `short share link returned (${link && link[0]})`);
  const sres = await fetch(url.replace(/\/mcp$/, `/s/${link[1]}`));
  check(sres.ok && /immutable/.test(sres.headers.get('cache-control') || '') && sres.headers.get('x-content-type-options') === 'nosniff', 'short link resolves, cacheable, nosniff');
  const payload = await sres.json();
  check((await fetch(url.replace(/\/mcp$/, '/s/zzzzzzzzzzzz'))).status === 404 && (await fetch(url.replace(/\/mcp$/, '/s/..%2Fetc')).then(r => r.status)) === 404, 'unknown or malformed ids are 404');
  const long = r.structuredContent && r.structuredContent.doc;
  check(!!long && long.o.length === payload.o.length, 'structured content matches the stored figure');
  const c = new Construction();
  check(c.load(payload.o).length === 0 && c.objs.length === 10 && payload.i.t === 'Euler line' && payload.s.axes === false, 'link decodes to the same 10 objects, title and clean view');
  const bad = await client.callTool({ name: 'draw_geometry', arguments: { script: '' } });
  check(bad.isError && /empty/.test(bad.content[0].text), 'empty script is an error');
  const graph = await client.callTool({ name: 'draw_geometry', arguments: { script: 'f(x) = sin(x)\ng(x) = x^2/4 - 1\nS = Intersect(f, g)', image: false } });
  check(/axes/.test('axes') && !graph.content.some(x => x.type === 'image') && /S = \{/.test(graph.content[0].text), 'function graphs and point lists, image off');
  await client.close();
  const help = await fetch(url.replace(/\/mcp$/, '/'));
  const helpText = await help.text();
  check(/short link/.test(helpText) && !/nothing is stored/.test(helpText) && /default-src 'none'/.test(help.headers.get('content-security-policy') || ''), 'help page states what is stored and has a strict policy');

  if (local) {
    // Hourly cap on new short links: past it, a long link that needs no storage.
    const capped = await connect(await startServer({ SHARE_RATE: '1', DRAW_WORKERS: '1' }));
    const linkOf = async script => (await capped.callTool({ name: 'draw_geometry', arguments: { script, image: false } })).content[0].text.match(/#([sc])=/)?.[1];
    check(await linkOf('A = (0, 0)') === 's' && await linkOf('B = (1, 1)') === 'c' && await linkOf('A = (0, 0)') === 's',
      'past the hourly cap new figures get a long link; stored ones keep their short link');
    await capped.close();
    // Time limit per drawing: the worker is stopped and replaced.
    const slow = await connect(await startServer({ DRAW_TIMEOUT_MS: '5', DRAW_WORKERS: '1' }));
    const t = await slow.callTool({ name: 'draw_geometry', arguments: { script: 'A = (0, 0)\nB = (4, 0)\nC = (1, 3)\nk = Circumcircle(A, B, C)' } });
    check(t.isError && /longer than 0.005 seconds/.test(t.content[0].text), `a drawing over the time limit is stopped (${t.content[0].text.slice(0, 60)})`);
    const again = await slow.callTool({ name: 'draw_geometry', arguments: { script: 'A = (0, 0)' } });
    check(again.isError && /longer than/.test(again.content[0].text), 'the replacement worker takes the next drawing');
    await slow.close();
  }
} catch (e) {
  check(false, `crashed: ${e.stack || e.message}`);
} finally {
  for (const c of children) c.kill();
}
console.log(fail ? `${fail} failure(s)` : 'all MCP checks passed');
process.exit(fail ? 1 : 0);
