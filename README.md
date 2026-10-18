# Geometry Drawer

A dynamic geometry drawer in the spirit of GeoGebra's Geometry and Graphing
apps, built to be quick: one static page, no framework, no build step, no
server. It opens instantly, and every tool has a one-key shortcut.

**URL:** `https://nbg5pc.taileeca1e.ts.net/geometry/`, **public** (operator
decision, 2026-10-18). It is a static page: constructions stay in the
visitor's browser, and nothing is stored on the server.

## What it does

- **Construct:** points, intersections, midpoints, lines, segments (also with a
  given length), rays, vectors, polylines, polygons and regular polygons,
  perpendicular and parallel lines, perpendicular and angle bisectors,
  tangents, loci, circles (centre and point, centre and radius, compass,
  three points, incircle), semicircles, arcs and sectors, ellipses,
  hyperbolas, parabolas, and conics through five points.
- **Measure:** angles (also with a given size), distances, lengths, perimeters,
  areas and slopes, drawn on the canvas and updated live.
- **Transform:** reflect in a line, a point or a circle (inversion), rotate,
  translate and dilate. This works on any object, including conics and
  function graphs.
- **Algebra:** type `f(x) = sin(x)/x`, `x^2/9 + y^2/4 = 1`, `y = 2x + 1`,
  `x^3 + y^3 = 3xy` or `Circle(A, 3)`. Equations are classified automatically
  as lines, circles, conics, functions or implicit curves. The input bar also
  handles derivatives (symbolic), integrals with shading, roots, extrema,
  parametric curves, `If`, text with live values, and implicit multiplication
  (`2x y`). Typing a command name suggests its signature.
- **Dynamic:** drag any free point, or a whole segment or polygon, and
  everything built from it follows. Points slide along paths. Sliders can be
  animated. Points can leave a trace. Loci are drawn from a point on a path or
  from a slider.
- **Work faster:** you can drag to create (press on the first point, release on
  the second). Intersections and points-on-objects are picked up
  automatically when you click. The canvas shows a live preview of what the
  tool will make. Shift-drag box-selects. Arrow keys nudge. Undo and redo are
  unlimited, and the construction autosaves in the browser.
- **Share:** save and open `.json` files, export a PNG, or copy a link that
  contains the whole construction.

### For olympiad geometry

- **Check relation (`Q`):** click 2-4 objects. It reports whether points are
  collinear or concyclic, lines concurrent, parallel or perpendicular, circles
  tangent, orthogonal or coaxal, and whether four points form a harmonic
  range or quadrilateral. It also finds equal distances, right angles, and
  simple ratios such as α = 2β. It then moves every free point through 40
  random nearby positions and tells you whether each fact holds **always**
  (likely a theorem) or **only in this picture** (a coincidence).
- **Find equal angles (`U`):** lists every class of equal angles formed at
  named points by the drawn segments and lines, keeping only those that stay
  equal in 12 random positions. For a cyclic quadrilateral it finds
  ∠BAC = ∠BDC and the rest. **Mark** draws a class with matching arcs and a
  shared colour.
- **Theorem demos** (*Menu*): Euler line, nine-point circle and Feuerbach,
  Simson line, butterfly theorem, Miquel's theorem, the incentre-excentre
  lemma, Pascal, Ptolemy, radical centre, and inscribed angles. Each is a
  live construction with a short explanation and a button that runs the
  relation check (or the angle finder) on the theorem's key objects.
- **Triangle centres:** Kimberling X(1)-X(11), X(13), X(14), X(20), X(40),
  plus excentres, excircles, the nine-point circle, the Euler line, altitudes,
  medians, symmedians, and the medial, orthic, intouch, pedal and cevian
  triangles.
- **Classical tools:** feet of perpendiculars, the Simson line, isogonal and
  isotomic conjugates, arc midpoints, antipodes, power of a point, radical
  axis and radical centre, homothety centres, all four common tangents,
  the spiral-similarity centre, the Miquel point, harmonic conjugates, cross
  ratio, pole and polar, `SecondIntersection(a, b, P)`, and points from
  barycentric or trilinear coordinates. Inversion (*Reflect about circle*)
  maps lines and circles exactly, segments, rays and arcs to exact arcs, and
  anything else (polygons, conics, graphs) as a sampled curve.
- **True/false commands for the input bar:** `AreCollinear`, `AreConcyclic`,
  `AreConcurrent`, `AreParallel`, `ArePerpendicular`, `AreEqual`,
  `AreTangent`, `IsOn`.
- **Diagram conventions:** `Angle(A, B, C)` is ∠ABC, at most 180°.
  `OrientedAngle` gives the counter-clockwise 0-360° angle. Equal segments
  get 1-3 tick marks and equal angles 1-3 arcs (set them in the properties
  panel). `I_A` and `A_{12}` draw as real subscripts.
- **Write-ups:** *Menu → Export Asymptote / TikZ* turns the visible diagram
  into code that compiles with `asy` or `pdflatex`.
- **Teaching:** *Step through construction* replays a figure one object at a
  time. *New from template* starts a triangle, a triangle with its
  circumcircle or incircle, a cyclic quadrilateral, or two circles, and turns
  on the clean diagram (no axes or grid).
- Light and dark themes, touch and pinch-zoom, and a phone layout.

### Scripts

The **Script** tab, above the algebra list, runs whole programs.

- **Commands:** one input-bar statement per line, with `#` or `//` comments.
  Besides definitions, scripts and the input bar accept styling and view
  statements: `SetColor(k, "red")`, `SetLineStyle(e, "dashed")`,
  `SetMarks(s, 2)`, `SetCaption(P, "X")`, `Hide(O)`, `ShowAxes(false)`,
  `ZoomIn(xmin, ymin, xmax, ymax)` and more. A failing line is reported with
  its number and the rest still runs.
- **JavaScript:** code that writes commands, for loops, families and
  computed coordinates. `cmd("...")` adds a command, `point(name, x, y)` a
  free point, and `range(n)` and `fmt(x)` help with loops. It runs in a
  sandboxed Web Worker with no access to the page or saved data, and is
  stopped after 3 seconds. JavaScript is never put in share links.
- **From figure** turns the current construction into a script, styles
  included. **Copy AI prompt** copies a description of the language that
  teaches any AI chat to write scripts.

### AI assistants (MCP)

An MCP server lets Claude, ChatGPT or any MCP client draw from plain language.
In chats that support **MCP Apps** (Claude and ChatGPT do), the figure appears
**inside the conversation** as a live widget. It runs the app's own engine,
so you can drag points, zoom and pan, with buttons for Fit, Reset, Fullscreen
and *Open in app*. Other clients get the picture and the link. The
assistant writes a script, and the server runs it with the app's own engine.
It returns errors by line, a PNG preview the assistant can look at, every
object's value, and true/false checks re-tested on 40 random positions. It
also returns a link that opens the figure in the app, with the assistant's
title and explanation on a card.

- **Server URL:** `https://nbg5pc.taileeca1e.ts.net/geometry-mcp/mcp`,
  public, with no sign-in and nothing stored. A help page is at
  `/geometry-mcp/`.
- **Claude (web or desktop):** Settings, then Connectors, then *Add custom
  connector*, and paste the URL.
- **ChatGPT:** Settings, then Apps & Connectors (or Plugins, then MCPs, in
  the desktop app). Add a custom MCP of type Streamable HTTP with the URL,
  and leave the token and header fields empty.
- **Claude Code:**
  `claude mcp add --transport http geometry https://nbg5pc.taileeca1e.ts.net/geometry-mcp/mcp`
- **Tools:** `geometry_language` returns the reference, and `draw_geometry`
  takes `script`, optional `title`, `caption`, `verify` (a list of true/false
  expressions), `show_axes` and `show_grid`.

Press `?` in the app for every shortcut and command.

| Key | Tool | Key | Tool |
|---|---|---|---|
| `V` / `Esc` | Move | `C` | Circle (centre, point) |
| `P` | Point | `K` | Compass |
| `I` | Intersect | `E` | Ellipse |
| `M` | Midpoint | `A` | Angle |
| `L` / `S` / `R` / `W` | Line / segment / ray / vector | `D` | Distance |
| `H` / `J` | Perpendicular / parallel | `F` / `O` | Reflect / rotate |
| `B` | Perpendicular bisector | `N` / `T` | Slider / text |
| `G` | Polygon | `X` | Delete |
| `Q` | Check relation | `U` | Find equal angles |

## Commands

```bash
node tests/run-tests.mjs       # engine tests: parser, commands, intersections, save/load
node tests/browser-smoke.mjs   # drives the real page in headless Chromium
node mcp/test.mjs              # MCP server, end to end, through the official MCP client
node mcp/widget-test.mjs       # the in-chat viewer in a sandboxed iframe, with a stand-in host
bash scripts/deploy.sh         # all four tests, rsync to /var/www/geometry, restart geometry-mcp
sudo systemctl status geometry-mcp     # the MCP server (Node, port 5040, runs from mcp/)
sudo journalctl -u geometry-mcp -f
```

To set up the MCP server on a fresh machine, run `cd mcp && npm ci --omit=dev`,
then
`sudo cp mcp/geometry-mcp.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now geometry-mcp`.
The Nginx routes are in `server-g5-setup-01`.

To develop locally, serve the folder with any static server, for example
`python3 -m http.server`, and open it. The page uses ES modules, so
`file://` will not work.

## After a reboot

Nothing to do. The app is static files in `/var/www/geometry`, served by
Nginx, and `geometry-mcp` is an enabled systemd unit.
To check it, run
`bash ~/Documents/GitHub/server-g5-setup-01/scripts/verify-deployment.sh`,
which asserts the page, its script and the MCP health check, on the tailnet
and publicly. If the page is missing, run `bash scripts/deploy.sh` again. If
the MCP server is down, run `sudo systemctl restart geometry-mcp`.

## Not included

GeoGebra's CAS, 3D, spreadsheet, probability and exam-mode views, lists and
sequences, and its LaTeX text. User data never leaves the browser: there is no
account and no server-side storage. The MCP server only computes what an
assistant sends it and keeps nothing.
