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
- Light and dark themes, touch and pinch-zoom, and a phone layout.

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

## Commands

```bash
node tests/run-tests.mjs       # engine tests: parser, commands, intersections, save/load
node tests/browser-smoke.mjs   # drives the real page in headless Chromium
bash scripts/deploy.sh         # both tests, then rsync to /var/www/geometry
```

To develop locally, serve the folder with any static server, for example
`python3 -m http.server`, and open it. The page uses ES modules, so
`file://` will not work.

## After a reboot

Nothing to do: it is static files in `/var/www/geometry`, served by Nginx.
To check it, run
`bash ~/Documents/GitHub/server-g5-setup-01/scripts/verify-deployment.sh`,
which asserts the page and its script load, on the tailnet and publicly. If the
page is missing, run `bash scripts/deploy.sh` again.

## Not included

GeoGebra's CAS, 3D, spreadsheet, probability and exam-mode views, lists and
sequences, and its LaTeX text. User data never leaves the browser: there is no
account and no server-side storage.
