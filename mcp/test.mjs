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

let url = process.argv[2], child = null;
if (!url) {
  const port = 5600 + Math.floor(Math.random() * 300);
  child = spawn(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
  url = `http://127.0.0.1:${port}/mcp`;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(url.replace('/mcp', '/healthz'))).ok) break; } catch { /* starting */ } await delay(100); }
}
let fail = 0;
const check = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) fail++; };
try {
  const client = new Client({ name: 'geometry-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
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
  const link = /https?:\/\/\S+#c=z(\S+)/.exec(text);
  check(!!link, 'share link returned');
  const payload = JSON.parse(inflateRawSync(Buffer.from(link[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64')).toString());
  const c = new Construction();
  check(c.load(payload.o).length === 0 && c.objs.length === 10 && payload.i.t === 'Euler line' && payload.s.axes === false, 'link decodes to the same 10 objects, title and clean view');
  const bad = await client.callTool({ name: 'draw_geometry', arguments: { script: '' } });
  check(bad.isError && /empty/.test(bad.content[0].text), 'empty script is an error');
  const graph = await client.callTool({ name: 'draw_geometry', arguments: { script: 'f(x) = sin(x)\ng(x) = x^2/4 - 1\nS = Intersect(f, g)', image: false } });
  check(/axes/.test('axes') && !graph.content.some(x => x.type === 'image') && /S = \{/.test(graph.content[0].text), 'function graphs and point lists, image off');
  await client.close();
} catch (e) {
  check(false, `crashed: ${e.stack || e.message}`);
} finally {
  if (child) child.kill();
}
console.log(fail ? `${fail} failure(s)` : 'all MCP checks passed');
process.exit(fail ? 1 : 0);
