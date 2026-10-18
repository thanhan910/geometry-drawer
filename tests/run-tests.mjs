// Engine tests: parser, evaluation, commands, intersections, transforms,
// save/load. Run with: node tests/run-tests.mjs
import { parseStatement, parseExpr, print } from '../js/expr.js';
import { describe as desc, intersections, conicInfo } from '../js/geom.js';
import { Construction } from '../js/construction.js';
import { relations } from '../js/olympiad.js';
import { DEMOS } from '../js/demos.js';

let pass = 0, fail = 0;
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e * (1 + Math.abs(b));
function t(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`); }
}
function eq(a, b, msg = '') { if (a !== b) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function ok(c, msg = 'assertion') { if (!c) throw new Error(msg); }
function cons(lines) { const c = new Construction(); for (const l of lines) c.exec(l); return c; }
const val = (c, n) => c.get(n).val;

// ---- parser ----
t('implicit multiplication', () => eq(print(parseExpr('2x y + 3(a+1)')), '2 * x * y + 3 * (a + 1)'));
t('power right assoc and unary', () => eq(print(parseExpr('-2^2^3')), '-2^2^3'));
t('superscripts and degrees', () => eq(print(parseExpr('x² + 30°')), 'x^2 + 30°'));
t('statement kinds', () => {
  eq(parseStatement('A = (1, 2)').name, 'A');
  eq(parseStatement('f(x) = x^2').ast.k, 'fn');
  eq(parseStatement('y = 2x + 1').ast.k, 'eq');
  eq(parseStatement('c: x^2 + y^2 = 4').name, 'c');
  eq(parseStatement('x^2 - 1').ast.k, 'fn');
});
t('unicode operators', () => eq(print(parseExpr('3 × 4 − 1')), '3 * 4 - 1'));
t('call with space for commands', () => eq(parseExpr('Circle (A, 2)').k, 'call'));
t('round-trip print', () => {
  for (const s of ['(a + b) * c', 'a - (b - c)', 'a / (b * c)', '(-1)^n', 'Circle(A, B)', 'If(a < 2, 1, 0)']) {
    eq(print(parseExpr(print(parseExpr(s)))), print(parseExpr(s)), s);
  }
});

// ---- basic objects ----
t('points and midpoint', () => {
  const c = cons(['A = (1, 2)', 'B = (5, 6)', 'M = Midpoint(A, B)']);
  const m = val(c, 'M'); ok(near(m.x, 3) && near(m.y, 4));
});
t('point arithmetic', () => {
  const c = cons(['A = (1, 2)', 'B = 2A + (1, 1)']);
  eq(desc(val(c, 'B')), '(3, 5)');
});
t('line equation display', () => {
  const c = cons(['A = (0, 1)', 'B = (1, 3)', 'g = Line(A, B)']);
  eq(desc(val(c, 'g')), 'y = 2x + 1');
});
t('circle three points', () => {
  const c = cons(['A = (1, 0)', 'B = (0, 1)', 'C = (-1, 0)', 'k = Circle(A, B, C)']);
  const v = val(c, 'k'); ok(near(v.r, 1) && near(v.c.x, 0) && near(v.c.y, 0));
  eq(desc(v), 'x² + y² = 1');
});
t('perpendicular bisector / angle bisector', () => {
  const c = cons(['A = (0, 0)', 'B = (4, 0)', 'C = (0, 4)', 'p = PerpendicularBisector(A, B)', 'q = AngleBisector(B, A, C)']);
  eq(desc(val(c, 'p')), 'x = 2');
  eq(desc(val(c, 'q')), 'y = x');
});
t('angle in degrees', () => {
  const c = cons(['A = (1, 0)', 'B = (0, 0)', 'C = (0, 1)', 'α = Angle(A, B, C)']);
  eq(desc(val(c, 'α')), '90°');
});
t('distance and area', () => {
  const c = cons(['A = (0, 0)', 'B = (3, 0)', 'C = (0, 4)', 'P = Polygon(A, B, C)', 'd = Distance(B, C)', 'ar = Area(P)']);
  eq(val(c, 'd').v, 5); eq(val(c, 'ar').v, 6);
});
t('regular polygon', () => {
  const c = cons(['A = (0, 0)', 'B = (1, 0)', 'h = Polygon(A, B, 6)']);
  ok(near(val(c, 'h').pts.length, 6)); ok(near(Math.abs(desc(val(c, 'h'), 4)), 2.5981));
});

// ---- equations ----
t('equation → line', () => { const c = cons(['l: 2x + 3y = 6']); eq(val(c, 'l').t, 'line'); });
t('equation → circle', () => { const c = cons(['k: (x-1)^2 + (y+2)^2 = 9']); const v = val(c, 'k'); eq(v.t, 'circle'); ok(near(v.r, 3)); });
t('equation → ellipse', () => { const c = cons(['e1: x^2/9 + y^2/4 = 1']); const ci = conicInfo(val(c, 'e1')); eq(ci.type, 'ellipse'); ok(near(Math.max(ci.a, ci.b), 3)); });
t('equation → hyperbola', () => { const c = cons(['h: xy = 1']); eq(conicInfo(val(c, 'h')).type, 'hyperbola'); });
t('equation → parabola', () => { const c = cons(['p: y = x^2 - 2']); eq(conicInfo(val(c, 'p')).type, 'parabola'); });
t('y = sin(x) → function', () => { const c = cons(['s: y = sin(x)']); eq(val(c, 's').t, 'fn'); });
t('implicit curve', () => { const c = cons(['q: x^3 + y^3 = 3x y']); eq(val(c, 'q').t, 'implicit'); });
t('sliders in equations', () => {
  const c = cons(['a = 2', 'l: y = a x + 1']);
  eq(desc(val(c, 'l')), 'y = 2x + 1');
  c.setNum(c.get('a'), 3); c.recompute();
  eq(desc(val(c, 'l')), 'y = 3x + 1');
});

// ---- functions ----
t('function eval and derivative', () => {
  const c = cons(['f(x) = x^3 - 2x', 'g = Derivative(f)', 'v = g(2)']);
  eq(val(c, 'v').v, 10);
  eq(desc(val(c, 'g')), '3x² − 2');
});
t('integral', () => { const c = cons(['f(x) = x^2', 'I = Integral(f, 0, 3)']); ok(near(val(c, 'I').v, 9)); });
t('roots and extrema', () => {
  const c = cons(['f(x) = x^2 - 4', 'R = Root(f, 0, 5)', 'E = Extremum(f, -3, 3)']);
  ok(near(val(c, 'R').x, 2)); ok(near(val(c, 'E').y, -4));
});
t('tangent to function', () => { const c = cons(['f(x) = x^2', 't = Tangent(1, f)']); eq(desc(val(c, 't')), 'y = 2x − 1'); });

// ---- intersections ----
t('line ∩ circle', () => {
  const c = cons(['k = Circle((0,0), 5)', 'l = Line((-10, 3), (10, 3))', 'P = Intersect(k, l, 1)', 'Q = Intersect(k, l, 2)']);
  ok(near(val(c, 'P').x, -4) && near(val(c, 'Q').x, 4));
});
t('circle ∩ circle', () => {
  const c = cons(['a1 = Circle((0,0), 5)', 'a2 = Circle((8,0), 5)', 'P = Intersect(a1, a2, 1)']);
  ok(near(val(c, 'P').x, 4) && near(Math.abs(val(c, 'P').y), 3));
});
t('segment ∩ segment outside → undefined', () => {
  const c = cons(['s1 = Segment((0,0), (1,0))', 's2 = Segment((2,-1), (2,1))', 'P = Intersect(s1, s2, 1)']);
  eq(val(c, 'P').t, 'undef');
});
t('line ∩ conic', () => {
  const c = cons(['e: x^2/4 + y^2 = 1', 'l: y = 0', 'P = Intersect(e, l, 2)']);
  ok(near(Math.abs(val(c, 'P').x), 2));
});
t('function ∩ function', () => {
  const c = cons(['f(x) = x^2', 'g(x) = x + 2', 'S = Intersect(f, g)']);
  const ps = val(c, 'S').pts; eq(ps.length, 2); ok(near(ps[0].x, -1) && near(ps[1].x, 2));
});
t('function ∩ circle', () => {
  const c = cons(['f(x) = sin(x)', 'k = Circle((0, 0), 1)']);
  const ps = intersections(val(c, 'f'), val(c, 'k')); eq(ps.length, 2);
});
t('conic ∩ circle', () => {
  const c = cons(['e: x^2/9 + y^2/4 = 1', 'k = Circle((0, 0), 2.5)']);
  eq(intersections(val(c, 'e'), val(c, 'k')).length, 4);
});

// ---- transforms ----
t('reflect point in line', () => {
  const c = cons(['A = (1, 3)', 'l: y = x', "A' = Reflect(A, l)"]);
  ok(near(val(c, "A'").x, 3) && near(val(c, "A'").y, 1));
});
t('rotate polygon', () => {
  const c = cons(['A = (1, 0)', 'B = (2, 0)', 'C = (1, 1)', 'P = Polygon(A, B, C)', 'Q = Rotate(P, 90°, (0, 0))']);
  const q = val(c, 'Q').pts[0]; ok(near(q.x, 0, 1e-9) && near(q.y, 1));
});
t('translate / dilate', () => {
  const c = cons(['u = Vector((0,0), (2, 1))', 'k = Circle((0,0), 1)', 'k2 = Translate(k, u)', 'k3 = Dilate(k, 3, (1, 0))']);
  ok(near(val(c, 'k2').c.x, 2) && near(val(c, 'k3').r, 3) && near(val(c, 'k3').c.x, -2));
});
t('reflect conic', () => {
  const c = cons(['p: y = x^2', 'q = Reflect(p, Line((0,0), (1,0)))']);
  eq(conicInfo(val(c, 'q')).type, 'parabola');
  ok(desc(val(c, 'q')).includes('x²'));
});
t('circle inversion of a point', () => {
  const c = cons(['k = Circle((0,0), 2)', 'A = (1, 0)', "A' = Reflect(A, k)"]);
  ok(near(val(c, "A'").x, 4));
});

// ---- conic constructions ----
t('ellipse from foci', () => {
  const c = cons(['F = (-3, 0)', 'G = (3, 0)', 'e = Ellipse(F, G, 5)']);
  const ci = conicInfo(val(c, 'e')); ok(near(ci.a, 5) || near(ci.b, 5));
});
t('conic through five points', () => {
  const c = cons(['A = (1,0)', 'B = (0,1)', 'C = (-1,0)', 'D = (0,-1)', 'E = (0.6, 0.8)', 'k = Conic(A, B, C, D, E)']);
  eq(conicInfo(val(c, 'k')).type, 'ellipse');
});
t('tangents from a point to a circle', () => {
  const c = cons(['k = Circle((0,0), 1)', 'A = (2, 0)', 't1 = Tangent(A, k, 1)', 't2 = Tangent(A, k, 2)']);
  ok(val(c, 't1').t === 'line' && val(c, 't2').t === 'line');
  const T = intersections(val(c, 't1'), val(c, 'k')); ok(T.length >= 1 && near(T[0].x, 0.5, 1e-4));
});

// ---- dependency engine ----
t('dragging recomputes dependants', () => {
  const c = cons(['A = (0, 0)', 'B = (2, 0)', 'M = Midpoint(A, B)']);
  c.setPoint(c.get('B'), 4, 2); c.recompute();
  ok(near(val(c, 'M').x, 2) && near(val(c, 'M').y, 1));
});
t('delete cascades', () => {
  const c = cons(['A = (0, 0)', 'B = (2, 0)', 's = Segment(A, B)', 'M = Midpoint(s)']);
  c.remove(['A']); eq(c.objs.length, 1);
});
t('rename rewrites dependants', () => {
  const c = cons(['A = (0, 0)', 'B = (2, 0)', 's = Segment(A, B)']);
  c.rename('A', 'P'); eq(print(c.get('s').ast), 'Segment(P, B)');
});
t('circular definition rejected', () => {
  const c = cons(['A = (0, 0)', 'B = A + (1, 0)']);
  let threw = false; try { c.redefine('A', parseStatement('B + (1, 0)').ast); } catch { threw = true; }
  ok(threw);
});
t('point on path follows path', () => {
  const c = cons(['k = Circle((0,0), 2)', 'P = Point(k, 0.25)']);
  ok(near(val(c, 'P').y, 2));
  c.slide(c.get('P'), -5, 0); c.recompute();
  ok(near(val(c, 'P').x, -2));
});
t('locus of midpoint is a circle', () => {
  const c = cons(['k = Circle((0,0), 4)', 'Q = Point(k, 0)', 'A = (4, 0)', 'M = Midpoint(A, Q)', 'L = Locus(M, Q)']);
  const L = val(c, 'L'); eq(L.t, 'locus');
  ok(L.pts.filter(Boolean).every(p => near(Math.hypot(p.x - 2, p.y), 2, 1e-6)));
});
t('save and load round-trip', () => {
  const c = cons(['A = (0.123456789, 2)', 'f(x) = x^2', 'l: y = 2x', 'k = Circle(A, 3)', 'α = 30°', 'T = Text("Hi " + α, (1, 1))']);
  const d = new Construction();
  const errs = d.load(JSON.parse(JSON.stringify(c.toJSON())));
  eq(errs.length, 0, errs.join(';'));
  eq(d.objs.length, c.objs.length);
  for (const o of c.objs) eq(desc(d.get(o.name).val, 6), desc(o.val, 6), o.name);
});
t('text concatenation', () => {
  const c = cons(['a = 2.5', 'T = Text("a = " + a)']); eq(val(c, 'T').s, 'a = 2.5');
});
t('unknown name error', () => {
  let msg = ''; try { cons(['B = Midpoint(A, Z)']); } catch (e) { msg = e.message; }
  ok(/Unknown name/.test(msg), msg);
});
t('wrong arguments explain usage', () => {
  let msg = ''; try { cons(['A = (0,0)', 'k = Circle(A, "x")']); } catch (e) { msg = e.message; }
  ok(/Circle\(A, r\)/.test(msg), msg);
});

t('Angle is non-reflex, OrientedAngle is counter-clockwise', () => {
  const c = cons(['A = (1, 0)', 'B = (0, 0)', 'C = (0, 1)', 'p = Angle(C, B, A)', 'q = OrientedAngle(C, B, A)', 'r = OrientedAngle(A, B, C)']);
  ok(near(val(c, 'p').v, Math.PI / 2) && near(val(c, 'q').v, 3 * Math.PI / 2) && near(val(c, 'r').v, Math.PI / 2));
});
// ---- olympiad ----
const T = ['A = (0.3, 0.2)', 'B = (7, 0.9)', 'C = (2.1, 5.3)'];
const P_ = (c, n) => val(c, n);
const d2 = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
t('nine-point centre is the midpoint of O and H', () => {
  const c = cons([...T, 'O = Circumcenter(A, B, C)', 'H = Orthocenter(A, B, C)', 'N = NinePointCenter(A, B, C)', 'M = Midpoint(O, H)']);
  ok(d2(P_(c, 'N'), P_(c, 'M')) < 1e-9);
});
t('Euler line: centroid on OH, HG = 2 GO', () => {
  const c = cons([...T, 'O = TriangleCenter(A, B, C, 3)', 'H = TriangleCenter(A, B, C, 4)', 'G = Centroid(A, B, C)', 'e = EulerLine(A, B, C)', 'b = AreCollinear(O, G, H)']);
  eq(val(c, 'b').v, true); ok(near(d2(P_(c, 'H'), P_(c, 'G')), 2 * d2(P_(c, 'G'), P_(c, 'O'))));
});
t('Feuerbach point lies on incircle and nine-point circle', () => {
  const c = cons([...T, 'F = FeuerbachPoint(A, B, C)', 'i = Incircle(A, B, C)', 'n = NinePointCircle(A, B, C)', 'p = IsOn(F, i)', 'q = IsOn(F, n)', 't1 = AreTangent(i, n)']);
  eq(val(c, 'p').v, true); eq(val(c, 'q').v, true); eq(val(c, 't1').v, true);
});
t('excircle is tangent to all three side lines', () => {
  const c = cons([...T, 'ea = Excircle(A, B, C)', 'k1 = AreTangent(ea, Line(B, C))', 'k2 = AreTangent(ea, Line(A, B))', 'k3 = AreTangent(ea, Line(A, C))']);
  eq(val(c, 'k1').v && val(c, 'k2').v && val(c, 'k3').v, true);
});
t('Gergonne point: cevians to the intouch points concur', () => {
  const c = cons([...T, 'Ge = GergonnePoint(A, B, C)', 'it = IntouchTriangle(A, B, C)', 'u = AreCollinear(A, Ge, Vertex(it, 1))', 'v = AreCollinear(B, Ge, Vertex(it, 2))']);
  eq(val(c, 'u').v && val(c, 'v').v, true);
});
t('isogonal conjugate of the centroid is the symmedian point', () => {
  const c = cons([...T, 'K = SymmedianPoint(A, B, C)', 'G = Centroid(A, B, C)', 'K2 = IsogonalConjugate(G, A, B, C)']);
  ok(d2(P_(c, 'K'), P_(c, 'K2')) < 1e-9);
});
t('Simson line: feet are collinear exactly for P on the circumcircle', () => {
  const c = cons([...T, 'k = Circumcircle(A, B, C)', 'P = Point(k, 0.37)', 'pt = PedalTriangle(P, A, B, C)', 's = Area(pt)']);
  ok(Math.abs(val(c, 's').v) < 1e-9);
});
t('Fermat point sees every side at 120°', () => {
  const c = cons([...T, 'F = FermatPoint(A, B, C)', 'α = Angle(A, F, B)', 'β = Angle(B, F, C)']);
  ok(near(val(c, 'α').v * 180 / Math.PI, 120) && near(val(c, 'β').v * 180 / Math.PI, 120));
});
t('radical centre has equal power to three circles', () => {
  const c = cons(['k1 = Circle((0, 0), 2)', 'k2 = Circle((5, 1), 3)', 'k3 = Circle((2, 6), 1.5)', 'X = RadicalCenter(k1, k2, k3)', 'p1 = Power(X, k1)', 'p2 = Power(X, k2)', 'p3 = Power(X, k3)']);
  ok(near(val(c, 'p1').v, val(c, 'p2').v) && near(val(c, 'p2').v, val(c, 'p3').v));
});
t('four common tangents of disjoint circles', () => {
  const c = cons(['k1 = Circle((0, 0), 1)', 'k2 = Circle((6, 0), 2)', ...[1, 2, 3, 4].map(n => `t${n} = CommonTangent(k1, k2, ${n})`), ...[1, 2, 3, 4].map(n => `q${n} = AreTangent(t${n}, k2)`)]);
  eq([1, 2, 3, 4].every(n => val(c, `q${n}`).v === true), true);
});
t('spiral similarity centre maps A→C, B→D', () => {
  const c = cons(['A = (0, 0)', 'B = (2, 0)', 'C = (3, 1)', 'D = (3, 3)', 'S = SpiralCenter(A, B, C, D)', 'r1 = Distance(S, C) / Distance(S, A)', 'r2 = Distance(C, D) / Distance(A, B)']);
  ok(near(val(c, 'r1').v, val(c, 'r2').v));
});
t('Miquel point lies on all four circumcircles', () => {
  const c = cons(['l1 = Line((0, 0), (5, 1))', 'l2 = Line((0, 0), (1, 4))', 'l3 = Line((4, 0), (0, 3))', 'l4 = Line((6, 0), (0, 2))', 'M = MiquelPoint(l1, l2, l3, l4)',
    'k = Circle(Intersect(l1, l3, 1), Intersect(l3, l4, 1), Intersect(l1, l4, 1))', 'b = IsOn(M, k)']);
  eq(val(c, 'b').v, true);
});
t('harmonic conjugate gives cross ratio −1', () => {
  const c = cons(['A = (0, 0)', 'B = (6, 0)', 'C = (2, 0)', 'D = HarmonicConjugate(A, B, C)', 'r = CrossRatio(A, B, C, D)']);
  ok(near(val(c, 'D').x, -6) && near(val(c, 'r').v, -1));
});
t('arc midpoint is on the A-bisector', () => {
  const c = cons([...T, 'M = ArcMidpoint(A, B, C)', 'I = Incenter(A, B, C)', 'b = AreCollinear(A, I, M)', 'e = AreEqual(Distance(M, B), Distance(M, I))']);
  eq(val(c, 'b').v && val(c, 'e').v, true);
});
t('relation finder: generality test sees a theorem', () => {
  const c = cons([...T, 'G = Centroid(A, B, C)', 'H = Orthocenter(A, B, C)', 'O = Circumcenter(A, B, C)']);
  const r = relations(['O', 'G', 'H'].map(n => c.get(n)));
  ok(r[0].holds && /collinear/.test(r[0].text));
});

t('relation finder: incentre–excentre lemma MB = MI holds always', () => {
  const c = cons([...T, 'M = ArcMidpoint(A, B, C)', 'I = Incenter(A, B, C)']);
  const r = relations(['M', 'B', 'I'].map(n => c.get(n)));
  ok(r.some(x => x.holds && x.text === 'MB = MI'), JSON.stringify(r.map(x => [x.text, x.holds])));
});
t('inversion maps a segment to an arc and preserves the circle', () => {
  const c = cons(['k = Circle((0, 0), 2)', 's = Segment((1, 1), (3, 1))', 'i = Reflect(s, k)', 'g = Reflect(Polygon((1, 1), (3, 1), (2, 3)), k)', 'r = Reflect(Ray((1, -1), (2, -1)), k)']);
  eq(val(c, 'i').t, 'arc'); eq(val(c, 'g').t, 'locus'); eq(val(c, 'r').t, 'arc');
  const e = val(c, 'i'), end = { x: e.c.x + e.r * Math.cos(e.a0), y: e.c.y + e.r * Math.sin(e.a0) };
  const inv = p => { const l = p.x * p.x + p.y * p.y; return { x: 4 * p.x / l, y: 4 * p.y / l }; };
  const a = inv({ x: 1, y: 1 }), b = inv({ x: 3, y: 1 });
  ok(Math.min(d2(end, a), d2(end, b)) < 1e-9);
});
t('second intersection of a line through a point on a circle', () => {
  const c = cons(['k = Circle((0, 0), 5)', 'A = (3, 4)', 'B = SecondIntersection(Line(A, (0, 0)), k, A)']);
  ok(near(val(c, 'B').x, -3) && near(val(c, 'B').y, -4));
});
for (const d of DEMOS) t(`demo: ${d.title}`, () => {
  const c = cons(d.lines);
  for (const o of c.objs) ok(o.val.t !== 'undef', `${o.name} undefined`);
  if (d.check) {
    const r = relations(d.check.map(n => c.get(n)));
    ok(r.some(x => x.holds), `no relation holds: ${JSON.stringify(r.map(x => [x.text, x.holds]))}`);
  }
  for (const o of c.objs) if (o.val.t === 'pt') ok(Math.hypot(o.val.x, o.val.y) < 25, `${o.name} far away`);
});
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
