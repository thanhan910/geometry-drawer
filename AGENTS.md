# Agent Brief — Geometry Drawer

A static, dependency-free dynamic geometry web app (GeoGebra-style). The user
guide is in `README.md`. Host integration (Nginx, Homepage, exposure) belongs
to `server-g5-setup-01`; do not restate it here.

## Current position

Deployed at `/geometry/`, **public** since 2026-10-18 (operator decision),
from `/var/www/geometry`. 81 engine tests (including one per theorem demo) and the headless browser
smoke test pass. The Asymptote and TikZ exports were compiled with real `asy` and
`pdflatex` in a throwaway Debian container (2026-10-18). Neither tool is
installed on the host. Pushed to GitHub (`origin/main`).

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
   `js/export.js` builds Asymptote and TikZ output from that cached geometry,
   converted back to world coordinates.
5. `js/tools.js` holds the tool table. Each tool has selection patterns and a
   `make()` that returns definitions as source strings. `js/app.js` holds the
   tool engine and all of the UI.

**Every object is an AST.** Tools generate the same text a user could type,
so the input bar, save files, undo and share links all share one format.

**Free objects** are literal ASTs: a number, `(x, y)`, `45°`,
`Point(path, t)`, or `Text(s, (x, y))`. Dragging rewrites the literal and
calls `recompute(from)`.

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
- **Public, so nothing server-side.** The workspace exposure table is the
  authority on who can reach `/geometry/`. Adding any server storage or API
  would need a new exposure decision first.

## Gotchas

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
