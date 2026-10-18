// Geometry Drawer MCP server: lets AI assistants (Claude and any other MCP
// client) draw by writing construction scripts. Stateless Streamable HTTP:
// every POST /mcp gets a fresh server, nothing is stored, nothing is private.
//
//   PORT=5040 node server.mjs      →  POST /mcp, GET /healthz, GET / (help page)

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { draw, APP_URL, LIMITS } from './draw.mjs';
import { languageGuide } from '../js/guide.js';

const PORT = +(process.env.PORT || 5040);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BODY = 256 * 1024;

// The in-chat viewer (MCP Apps): js/widget.js and the engine bundled into one
// self-contained HTML page at startup, so it always matches the engine.
const VIEWER_URI = 'ui://geometry-drawer/viewer.html';
const VIEWER_MIME = 'text/html;profile=mcp-app';
const VIEWER_HTML = (() => {
  const js = buildSync({ entryPoints: [new URL('../js/widget.js', import.meta.url).pathname], bundle: true, write: false, format: 'iife', minify: true, target: 'es2020' })
    .outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  return readFileSync(new URL('./widget.html', import.meta.url), 'utf8').replace('/*BUNDLE*/', () => js);
})();
// No network, no external files: everything the viewer needs is inline.
const VIEWER_META = { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } } };

const INSTRUCTIONS = `Geometry Drawer draws dynamic geometry (constructions, triangle centres, circles, conics, function graphs, transformations) from a short script.
Workflow: call geometry_language once to learn the syntax, write a script, call draw_geometry, look at the returned image, fix any reported errors or wrong-looking parts, and then give the user the link, which opens the figure in an interactive app where they can drag points.
Use draw_geometry's verify list (e.g. "AreConcyclic(A, B, C, D)") to test a conjecture: each check is re-tested on random positions, so "always" suggests a theorem and "only sometimes" a coincidence.`;

function buildServer() {
  const server = new McpServer({ name: 'geometry-drawer', title: 'Geometry Drawer', version: '1.0.0' }, { instructions: INSTRUCTIONS });

  server.registerResource('geometry-viewer', VIEWER_URI, {
    title: 'Geometry Drawer viewer',
    description: 'Interactive, draggable view of a figure drawn by draw_geometry.',
    mimeType: VIEWER_MIME,
    _meta: VIEWER_META,
  }, async () => ({ contents: [{ uri: VIEWER_URI, mimeType: VIEWER_MIME, text: VIEWER_HTML, _meta: VIEWER_META }] }));

  server.registerTool('geometry_language', {
    title: 'Geometry Drawer language reference',
    description: 'The construction language used by draw_geometry: syntax, conventions, styling statements and every command with its arguments. Read this before writing a script.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => ({ content: [{ type: 'text', text: languageGuide() }] }));

  server.registerTool('draw_geometry', {
    title: 'Draw a geometry construction',
    description: 'Build a figure from a script in the Geometry Drawer language (one statement per line, e.g. "A = (0, 0)", "k = Circumcircle(A, B, C)", "SetColor(k, \\"red\\")"). '
      + 'In chats that support MCP Apps the user sees the figure as an interactive widget they can drag; otherwise share the link. Returns an image of the figure, a link that opens it in the interactive app (always give the user this link), every object\'s value, errors by line number, '
      + 'and true/false checks re-tested on random positions of the free points. Call geometry_language first if you do not know the syntax.',
    inputSchema: {
      script: z.string().max(LIMITS.scriptChars).describe('The construction, one statement per line. # starts a comment.'),
      title: z.string().max(120).optional().describe('Shown on a card when the link is opened.'),
      caption: z.string().max(1500).optional().describe('A short explanation shown on that card: what the figure shows, what to drag.'),
      verify: z.array(z.string().max(300)).max(LIMITS.verify).optional().describe('True/false expressions to test, e.g. "AreCollinear(O, G, H)" or "AreEqual(Distance(M, B), Distance(M, I))".'),
      show_axes: z.boolean().optional().describe('Default: on only when there are function graphs.'),
      show_grid: z.boolean().optional().describe('Default: on only when there are function graphs.'),
      image: z.boolean().optional().describe('Return a PNG preview (default true).'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    // MCP Apps: hosts that support it show the figure as a live, draggable
    // widget in the chat (both key forms, as the spec asks for compatibility).
    _meta: { ui: { resourceUri: VIEWER_URI }, 'ui/resourceUri': VIEWER_URI,
      'openai/toolInvocation/invoking': 'Drawing the figure…', 'openai/toolInvocation/invoked': 'Figure ready' },
  }, async ({ script, title, caption, verify, show_axes, show_grid, image }) => {
    try {
      const r = draw({ script, title, caption, verify: verify || [], showAxes: show_axes, showGrid: show_grid, image: image !== false });
      const content = [{ type: 'text', text: r.text }];
      if (r.png) content.push({ type: 'image', data: r.png.toString('base64'), mimeType: 'image/png' });
      return { content, structuredContent: r.structured, isError: r.objects === 0 && r.errors.length > 0 };
    } catch (e) {
      return { content: [{ type: 'text', text: `Could not draw: ${e.message}` }], isError: true };
    }
  });
  return server;
}

const HELP_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Geometry Drawer MCP</title>
<style>body{font:15px/1.6 system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;color:#1d1f23}code{background:#eef0f4;padding:2px 5px;border-radius:4px}</style>
<h1>Geometry Drawer for AI assistants</h1>
<p>This is an <a href="https://modelcontextprotocol.io">MCP</a> server. Connect it to an AI assistant and ask it to draw geometry in plain language;
it writes a construction script, checks it, and gives you a link that opens the figure in <a href="${APP_URL}">Geometry Drawer</a>.</p>
<p><b>Server URL:</b> <code id="u"></code></p>
<ul>
<li><b>Claude (web or desktop):</b> Settings → Connectors → Add custom connector → paste the URL.</li>
<li><b>Claude Code:</b> <code>claude mcp add --transport http geometry <span class="u"></span></code></li>
<li><b>Other clients:</b> add a remote MCP server with the "Streamable HTTP" transport and the URL above.</li>
</ul>
<p>No sign-in and nothing is stored: each request is computed and forgotten.</p>
<script>const u = location.origin + location.pathname.replace(/\\/?$/, '/') + 'mcp'; document.getElementById('u').textContent = u; document.querySelectorAll('.u').forEach(e => e.textContent = u);</script>`;

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok\n'); return; }
  if (path === '/' && req.method === 'GET') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(HELP_PAGE); return; }
  if (path !== '/mcp') { json(res, 404, { error: 'not found' }); return; }
  if (req.method !== 'POST') { json(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed: this server is stateless, use POST.' }, id: null }); return; }
  let size = 0;
  const chunks = [];
  try {
    for await (const c of req) { size += c.length; if (size > MAX_BODY) throw new Error('too large'); chunks.push(c); }
  } catch { json(res, 413, { jsonrpc: '2.0', error: { code: -32600, message: 'Request too large' }, id: null }); return; }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { json(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }); return; }
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (e) {
    console.error('mcp error', e);
    if (!res.headersSent) json(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
  }
}).listen(PORT, HOST, () => console.log(`geometry-drawer MCP on http://${HOST}:${PORT}/mcp`));
