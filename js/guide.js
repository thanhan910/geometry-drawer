// The construction language, explained for an AI (or a person). Generated
// from the live command table so it never drifts from what the engine
// accepts. Used by the MCP server and the app's "Copy AI prompt" button.

import { CANON, HELP } from './geom.js';
import { STATEMENTS, NAMED_COLORS } from './script.js';

const GROUPS = [
  ['Points', 'point pointin closestpoint midpoint center centroid vertex intersect secondintersection foot root extremum barycentric trilinear antipode arcmidpoint harmonicconjugate spiralcenter miquelpoint isogonalconjugate isotomicconjugate pole excenter'],
  ['Triangle centres', 'trianglecenter incenter circumcenter orthocenter ninepointcenter symmedianpoint gergonnepoint nagelpoint mittenpunkt spiekercenter feuerbachpoint fermatpoint secondfermatpoint delongchampspoint bevanpoint'],
  ['Lines and segments', 'line segment ray vector unitvector perpendicular parallel perpendicularbisector anglebisector tangent polar asymptote eulerline altitude median symmedian simsonline radicalaxis commontangent polyline'],
  ['Circles, arcs, conics', 'circle circumcircle incircle excircle ninepointcircle semicircle circulararc circularsector circumcirculararc circumcircularsector ellipse hyperbola parabola conic focus'],
  ['Polygons and triangles', 'polygon medialtriangle orthictriangle intouchtriangle pedaltriangle ceviantriangle'],
  ['Measurements', 'distance length perimeter circumference area radius slope angle orientedangle power crossratio dot cross'],
  ['Transformations', 'reflect rotate translate dilate'],
  ['Functions and curves', 'function derivative integral integralbetween curve locus'],
  ['True / false checks', 'arecollinear areconcyclic areconcurrent areparallel areperpendicular areequal aretangent ison'],
  ['Other', 'text if radicalcenter homothetycenter slider'],
];

export function commandReference() {
  const used = new Set(), out = [];
  for (const [title, names] of GROUPS) {
    const lines = [];
    for (const n of names.split(' ')) {
      if (!HELP[n] || used.has(HELP[n])) continue;
      used.add(HELP[n]);
      lines.push(`- ${HELP[n]}`);
    }
    if (lines.length) out.push(`### ${title}`, ...lines, '');
  }
  const rest = Object.entries(HELP).filter(([l, h]) => CANON[l] && CANON[l].toLowerCase() === l && !used.has(h));
  if (rest.length) out.push('### More', ...rest.map(([, h]) => `- ${h}`), '');
  return out.join('\n');
}

export function languageGuide() {
  const statements = Object.values(STATEMENTS).map(([u]) => `- ${u}`).join('\n');
  return `# Geometry Drawer construction language

A construction is a script: one statement per line. Lines starting with # or // are comments.
Each definition creates a named object; later lines can use earlier names. Everything is dynamic:
objects built from other objects update when those move.

## Defining objects
- Free point (draggable): A = (1, 2)      polar form: P = (3; 45°)
- Free number (a slider): a = 2           free angle: α = 30°
- Anything else: name = Command(args), e.g. c = Circle(A, 3) or M = Midpoint(A, B)
- Function: f(x) = x^2 - 2x               equation curve: k: x^2/9 + y^2/4 = 1   line: l: y = 2x + 1
- A point that slides on an object (draggable along it): P = Point(c, 0.25)  (t from 0 to 1 around a circle or along a segment)
- Arithmetic: B = A + (2, 0), x(A), y(A), Distance(A, B) / 2, sqrt, sin, cos (radians), 30° for degrees, pi
- Implicit multiplication works: 2x y, 3(a + 1). Text: T = Text("Area: " + Area(poly1), (1, 4))
- Names: letters, digits and _ (A_1 and I_A display with subscripts), a trailing ' is allowed (A').
  x, y, e and pi are reserved. Without a name, a fresh one is chosen.
- Redefining an existing name replaces its definition.

## Conventions
- Angle(A, B, C) is the angle ABC at B, at most 180°. OrientedAngle(A, B, C) is counter-clockwise, 0-360°.
- Commands with "(A, B, C)" for a triangle treat the FIRST point as the special vertex where it matters:
  Excenter(A, B, C) and Excircle(A, B, C) are opposite A; Altitude/Median/Symmedian(A, B, C) start at A;
  ArcMidpoint(A, B, C) is the midpoint of arc BC not containing A.
- Intersect(a, b, n) picks the n-th intersection point; SecondIntersection(a, b, P) is the one that is not P
  (use it for "line AP meets the circle again at Q").
- Prefer building from a few free points so the figure stays draggable and general.

## Styling and view statements (they change looks, they do not create objects)
${statements}
Colours: ${Object.keys(NAMED_COLORS).join(', ')}, or "#rrggbb".

## Commands
${commandReference()}
## Example: triangle with circumcircle, orthocentre and Euler line
A = (-3, -2)
B = (4, -2)
C = (-0.5, 3.2)
a = Segment(B, C)
b = Segment(C, A)
c = Segment(A, B)
ω = Circumcircle(A, B, C)
O = Circumcenter(A, B, C)
H = Orthocenter(A, B, C)
e = EulerLine(A, B, C)
SetLineStyle(e, "dashed")
SetColor(e, "red")
ShowAxes(false)
ShowGrid(false)
`;
}
