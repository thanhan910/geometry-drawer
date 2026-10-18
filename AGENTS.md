# Agent Brief - Geometry Drawer

A static, dependency-free dynamic geometry web app (GeoGebra-style), plus a
small Node MCP server in `mcp/` that lets AI assistants draw with it. The user
guide is in `README.md`. Host integration (Nginx, Homepage, exposure) belongs
to `server-g5-setup-01`; do not restate it here.

## Current position

Deployed at `/geometry/`, **public** since 2026-10-18 (operator decision),
from `/var/www/geometry`. 85 engine tests (including one per theorem demo), the headless browser
smoke test and the three MCP suites pass (`bash scripts/deploy.sh` runs all five). The MCP
server is public at `/geometry-mcp/mcp` since 2026-10-18 (the operator
delegated the choice), running as systemd `geometry-mcp` on :5040. The
Asymptote and TikZ exports were compiled with real `asy` and
`pdflatex` in a throwaway Debian container (2026-10-18). Neither tool is
installed on the host. Pushed to GitHub (`origin/main`).

Production readiness was reviewed on 2026-10-18 (`docs/ARCHITECTURE.md`).
Phase 0 of its plan is done: sandboxed JavaScript, page CSP and security
headers, drawing time limits, the short-link hourly cap and least-recently-used
pruning, and truthful privacy wording. Phases 1 (own domain, off this host) and
2 (public launch) wait on the open decisions listed there.

## How it works

The modules load in dependency order:

1. `js/expr.js` holds the input language: tokenizer, parser, printer,
   dependency names, rename, and the symbolic derivative.
2. `js/geom.js` holds typed values, `evaluate(ast, ctx)`, every command (the
   `def(...)` table), intersections, affine transforms, conic analysis and
   path parameterisation.
3. `js/construction.js` holds the ordered objects, with `{name, ast, deps,
   val, style}` for each. It does topological sort, recompute, rename, delete
   (which cascades), locus, and save/load, where save is `name` plus the
   printed definition.
   `js/olympiad.js` registers the olympiad commands into the same table:
   triangle centres from Kimberling barycentrics, conjugates, radical axes,
   spiral similarity, and harmonic division. It also holds `relations()`, the
   relation finder used by the Check-relation tool. In `app.js`,
   `perturbRuns()` jitters every free point and sliding point, then restores
   them. Two features build on it: `generality()` gives the "always / only
   here" verdict (40 runs), and `findEqualAngles()` does the angle chasing
   (12 runs, angles grouped by their values across the runs).
   `js/demos.js` is data: the theorem demos as input-bar lines, styles and
   the objects to check. The engine tests build every demo and assert that
   its theorem holds.
4. `js/render.js` draws to a Canvas 2D context. Each draw caches screen
   geometry in `o._g`, and hit testing reads that cache.
   `js/script.js` runs scripts: many statements, plus styling and view
   statements (`STATEMENTS`), and `toScript()`, the inverse. `js/guide.js`
   generates the language guide from the live command table. Both the
   "Copy AI prompt" button and the MCP `geometry_language` tool use it.
   `js/svgctx.js` is a Canvas-to-SVG recorder, so the same Renderer can draw
   SVG for the export and on the server.
   `js/export.js` builds Asymptote and TikZ output from that cached geometry,
   converted back to world coordinates.
5. `js/tools.js` holds the tool table. Each tool has selection patterns and a
   `make()` that returns definitions as source strings. `js/app.js` holds the
   tool engine and all of the UI. `js/palette.js` is the search box (Ctrl+K)
   UI; its entries (tools with extra search words in `TOOL_WORDS`, menu
   actions, demos, templates, commands) are built in `paletteEntries()` in
   `app.js`. Add a new menu action there too, or search will not find it.

**Every object is an AST.** Tools generate the same text a user could type,
so the input bar, save files, undo and share links all share one format.

**Free objects** are literal ASTs: a number, `(x, y)`, `45°`,
`Point(path, t)`, or `Text(s, (x, y))`. Dragging rewrites the literal and
calls `recompute(from)`.

6. `mcp/draw.mjs` runs a script, perturbs it to test checks, renders a PNG
   (svgctx, then resvg with the DejaVu fonts) and builds the share link (the
   app's `#c=z…` format, plus `i` for the title card). `mcp/server.mjs` is
   stateless Streamable HTTP: one fresh McpServer per POST, using
   `@modelcontextprotocol/sdk`. `draw()` runs in worker threads
   (`mcp/pool.mjs`, `mcp/draw-worker.mjs`): DRAW_WORKERS (2), each drawing
   stopped after DRAW_TIMEOUT_MS (10 s), at most 8 queued. A stopped worker
   is replaced.
   The in-chat editor is the whole app. At startup the server inlines
   `index.html`, `css/app.css` and `js/app.js` (bundled with esbuild) into one
   page and sets `window.GD_EMBED`, which switches the app to embed mode:
   memory-only storage, the figure comes from the host, extra buttons, and
   no file or download menu items. It is served twice, as the MCP Apps
   resource `ui://geometry-drawer/editor.html` (`text/html;profile=mcp-app`)
   and as the ChatGPT Apps SDK resource `…/editor-skybridge.html`
   (`text/html+skybridge`). `draw_geometry` points to both (`_meta.ui.resourceUri`,
   `ui/resourceUri`, `openai/outputTemplate`) and returns `structuredContent`
   = {title, caption, link, doc}.
   `js/hostbridge.js` speaks MCP Apps over postMessage (`ui/initialize`,
   then `tool-result`, `update-model-context` after each user edit,
   `ui/message` for Ask AI, `open-link`, `size-changed`,
   `request-display-mode`), or `window.openai` when that is what exists. On
   ChatGPT, `widgetState` keeps edits across remounts.

## Invariants

- **No dependencies, no build.** "Quicker than GeoGebra" is the product. The
  page must stay a handful of static files that load instantly.
- **Engine modules stay DOM-free.** `expr`, `geom` and `construction` are
  imported by the Node tests.
- **Saved definitions round-trip.** `print(ast)` with no options must re-parse
  to the same AST, and the save/load test asserts it. Display printing
  (`pretty`, `digits`) is separate.
- **Name pools:** points get `A…`, segments `a, b…`, lines, curves and
  functions `f, g…`, angles get Greek letters. `x`, `y`, `e` and `pi` are
  reserved.
- **`Angle(A, B, C)` is non-reflex (≤ 180°)**, as ∠ABC is in a proof.
  `OrientedAngle` is the counter-clockwise one. The polygon-angle and
  given-size tools use `OrientedAngle` on purpose.
- **Hit testing reads the last frame's geometry**, so `pointerdown` flushes a
  pending frame first. Without that, a click within one frame of a change
  misses new objects.
- **Commands return `null` for a wrong signature.** `call()` then raises the
  usage message from `HELP`. Return `UNDEF` only for valid input with no
  result.
- **User JavaScript only runs in a Web Worker inside `sandbox.html`**
  (`runJS` in `app.js`), framed with `sandbox="allow-scripts"`: an opaque
  origin whose CSP (meta, and an Nginx header) allows no network. This
  matters because `/geometry/` shares its origin with tailnet-only tools
  that start real work: same-origin code could read them, CSRF tokens
  included. (The host repository's exposure table lists them.)
  The page's own CSP (`worker-src 'none'`) stops a worker being started
  outside the frame. Embedded in a chat, the plain worker is used, since the
  host's frame is already a throwaway origin. 3 s kill; JavaScript is never
  saved in documents or share links. Shared links carry only the
  construction language, which cannot run code.
- **The MCP server stores only short-link figures**, content-addressed (the
  id is a hash of the figure, so they never change), at most 200 KB each
  and SHARE_MAX (20,000) in total, pruning the least recently used (storing
  or opening a figure touches its mtime). New figures are capped at
  SHARE_RATE (300) an hour per worker, then the long link is used. That, plus
  nginx throttling (60 requests a minute per client, 256 KB bodies), the
  drawing time limit and the script caps in `draw.mjs` (20,000 characters,
  600 statements), is what
  makes running it public with no auth acceptable. Do not add anything
  that stores user-chosen data beyond this.
- **Links an AI repeats must be short.** AIs retype links, and the long
  `#c=` link (the whole figure, compressed) breaks on a single wrong
  character. The tool text gives only the `#s=` short link. The long one is
  still used where code opens it (the embedded editor's Open in app).
- **Public, so nothing server-side.** The workspace exposure table is the
  authority on who can reach `/geometry/`. Adding any server storage or API
  would need a new exposure decision first.

## Gotchas

- The embedded editor must stay self-contained, with no network and no
  external files. Its CSP declares no domains, and hosts block anything not
  declared. Send nothing to the host before the `ui/initialize` reply.
- **Never rely on form submission, `confirm()`, `prompt()` or downloads.**
  Chat frames may be sandboxed without `allow-forms`, `allow-modals` or
  `allow-downloads`. Dialog OK buttons and Enter keys call their handlers
  directly; `okToReplace()` skips `confirm()` when embedded.
- `index.html` must keep its `<link rel="stylesheet" href="css/app.css">` and
  `<script type="module" src="js/app.js">` lines exactly as they are. The server
  inlines them by string match and refuses to start if they change. It also
  strips the page's `Content-Security-Policy` meta tag (the chat host sets the
  policy there) and refuses to start if that tag is missing.
- The page's CSP means no inline scripts, no `eval` and no workers on the
  page itself. Load code as files under `js/`.
- Tool groups open on hover with a mouse (220 ms pause, 300 ms grace to
  reach the list); a click or tap picks the tool and toggles the list.
  Picking re-renders the toolbar and the browser then reports a fresh
  `pointerenter` on the new button under the cursor; `hoverG` ignores it, or
  a closed list would reopen by itself. A canvas press while a list or the
  menu is open only closes it, so dismissing never draws a stray point.
- A toolbar click re-renders the toolbar, detaching the clicked button before
  the click reaches `document`. Outside-click handlers must use
  `ev.composedPath()`, not `ev.target.closest()`.
- The chat actions (Open in app, Ask AI, fullscreen) float over the canvas
  (`#embedBar`), not in the toolbar, so a narrow chat panel keeps room for the
  tools.
- `docs/ARCHITECTURE.md` is the repository copy of the Claude Docs doc
  "Geometry Drawer: Architecture and Production Plan" (the operator's
  working copy). Its diagrams are PNG renders of the doc's drawings in
  `docs/img/`; a markdown export drops them. Change both together.
- **Chat apps cache the tool list.** ChatGPT web (`openai-mcp/1.0.0`) read
  `tools/list` once, when the connector was created, and kept calling tools
  from that copy, so the editor never appeared until it was refreshed.
  Diagnose with `journalctl -u geometry-mcp`: a client that shows the editor
  sends `resources/read:ui://geometry-drawer/editor…`. The ChatGPT desktop
  app's *Plugins, then MCPs* screen is a Codex agent (`codex-mcp-client`)
  and does not render MCP Apps.
- Chromium runs a sandboxed srcdoc iframe out of process, so
  `widget-test.mjs` attaches to it as its own CDP target (`flatten`).
- `mcp/` imports `../js/*.js` from this checkout. After any engine change,
  restart `geometry-mcp`; `scripts/deploy.sh` does that.

- An identifier followed directly by `(` is a call (`f(x)`, `x(A)`). With a
  space it is a multiplication, unless it is a builtin or command name.
  Unknown multi-letter names fall back to a product of single letters, so
  `xy` means `x*y`.
- A user can redefine an object by typing its name, even into a different
  type. The input bar shows a toast when that happens.
- Intersection indices are the stable order from `intersections()`, sorted by
  line parameter or by side, then by x for numeric cases. If you change that
  order, saved constructions get reshuffled.
- Unbounded numeric results (roots, extrema, function intersections and loci
  over lines) depend on the current view (`cons.bounds`). The view triggers
  `viewChanged()`, which recomputes them.
- The smoke test uses `/usr/bin/chromium-browser`. The Playwright Chromium in
  `~/.cache` aborts with "No usable sandbox" on this host.

## Next

1. Possible additions: a construction-protocol view, SVG export,
   copy and paste of objects, label dragging, and lists and sequences.
