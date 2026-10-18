// Classic olympiad theorems as live constructions. Each demo lists its
// definitions (input-bar syntax), optional styles, a caption, and the
// objects whose relation the "Check" button verifies.

const TRI = ['A = (-3, -2)', 'B = (4, -2)', 'C = (-0.4, 3.4)', 'a = Segment(B, C)', 'b = Segment(C, A)', 'c = Segment(A, B)'];
const thin = { width: 1, color: '#7f8c8d' };
const accent = { color: '#c0392b', width: 2.5 };
const helper = { dash: 1, width: 1.2, color: '#7f8c8d' };

export const DEMOS = [
  {
    title: 'Euler line',
    caption: 'In every triangle the circumcentre O, the centroid G and the orthocentre H lie on one line, and HG = 2·GO. Drag A, B or C and the line follows.',
    lines: [...TRI, 'ω = Circumcircle(A, B, C)', 'O = Circumcenter(A, B, C)', 'G = Centroid(A, B, C)', 'H = Orthocenter(A, B, C)', 'e = EulerLine(A, B, C)'],
    style: { ω: thin, e: { ...accent, dash: 1 } },
    check: ['O', 'G', 'H'],
  },
  {
    title: 'Nine-point circle and Feuerbach',
    caption: 'The midpoints of the sides, the feet of the altitudes and the midpoints of AH, BH and CH all lie on one circle. Feuerbach: that circle touches the incircle, at the point F.',
    lines: [...TRI, 'H = Orthocenter(A, B, C)', 'M_a = Midpoint(B, C)', 'M_b = Midpoint(C, A)', 'M_c = Midpoint(A, B)',
      'H_a = Foot(A, a)', 'H_b = Foot(B, b)', 'H_c = Foot(C, c)', 'P_a = Midpoint(A, H)', 'P_b = Midpoint(B, H)', 'P_c = Midpoint(C, H)',
      'n = NinePointCircle(A, B, C)', 'i = Incircle(A, B, C)', 'F = FeuerbachPoint(A, B, C)',
      'h_1 = Segment(A, H_a)', 'h_2 = Segment(B, H_b)', 'h_3 = Segment(C, H_c)'],
    style: { n: accent, i: { color: '#2457d6' }, h_1: helper, h_2: helper, h_3: helper },
    check: ['n', 'i'],
  },
  {
    title: 'Simson line',
    caption: 'Drop perpendiculars from a point P on the circumcircle to the three side lines: the feet D, E, F are collinear. Drag P around the circle. Redefine P as a free point, say P = (1, 1), and the feet stop being collinear.',
    lines: [...TRI, 'ω = Circumcircle(A, B, C)', 'l_a = Line(B, C)', 'l_b = Line(C, A)', 'l_c = Line(A, B)', 'P = Point(ω, 0.18)',
      'D = Foot(P, l_a)', 'E = Foot(P, l_b)', 'F = Foot(P, l_c)', 'p_1 = Segment(P, D)', 'p_2 = Segment(P, E)', 'p_3 = Segment(P, F)', 's = Line(D, E)'],
    style: { l_a: thin, l_b: thin, l_c: thin, p_1: helper, p_2: helper, p_3: helper, s: accent },
    check: ['D', 'E', 'F'],
  },
  {
    title: 'Butterfly theorem',
    caption: 'M is the midpoint of chord PQ. Draw any two chords AB and CD through M; AD and BC cut PQ at X and Y. Then M is also the midpoint of XY. Drag A or C.',
    lines: ['ω = Circle((0, 0), 4)', 'P = Point(ω, 0.58)', 'Q = Point(ω, 0.95)', 'pq = Segment(P, Q)', 'M = Midpoint(P, Q)',
      'A = Point(ω, 0.3)', 'B = SecondIntersection(Line(A, M), ω, A)', 'C = Point(ω, 0.14)', 'D = SecondIntersection(Line(C, M), ω, C)',
      'ab = Segment(A, B)', 'cd = Segment(C, D)', 'ad = Segment(A, D)', 'bc = Segment(B, C)',
      'X = Intersect(Line(A, D), Line(P, Q), 1)', 'Y = Intersect(Line(B, C), Line(P, Q), 1)', 'mx = Segment(M, X)', 'my = Segment(M, Y)'],
    style: { ab: thin, cd: thin, mx: { ...accent, ticks: 1 }, my: { ...accent, ticks: 1 } },
    check: ['M', 'X', 'Y'],
  },
  {
    title: "Miquel's theorem",
    caption: 'Pick a point on each side of triangle ABC: D on BC, E on CA, F on AB. The circles AEF, BFD and CDE always pass through one point M. Slide D, E or F along their sides.',
    lines: [...TRI, 'D = Point(a, 0.4)', 'E = Point(b, 0.55)', 'F = Point(c, 0.35)', 'k_1 = Circle(A, E, F)', 'k_2 = Circle(B, F, D)', 'k_3 = Circle(C, D, E)',
      'M = SecondIntersection(k_1, k_2, F)'],
    style: { k_1: { color: '#2457d6' }, k_2: { color: '#138d75' }, k_3: { color: '#8e44ad' }, M: { color: '#c0392b', size: 5 } },
    check: ['k_1', 'k_2', 'k_3'],
  },
  {
    title: 'Incentre–excentre lemma',
    caption: 'The bisector from A meets the circumcircle again at M, the midpoint of arc BC. Then MB = MC = MI = MI_A: B, C, the incentre I and the excentre I_A all lie on a circle centred at M.',
    lines: [...TRI, 'ω = Circumcircle(A, B, C)', 'I = Incenter(A, B, C)', 'I_A = Excenter(A, B, C)', 'M = ArcMidpoint(A, B, C)', 'd = Segment(A, I_A)',
      'k = Circle(M, B)', 'mb = Segment(M, B)', 'mi = Segment(M, I)', 'mc = Segment(M, C)'],
    style: { ω: thin, d: helper, k: accent, mb: { ticks: 1 }, mi: { ticks: 1 }, mc: { ticks: 1 } },
    check: ['M', 'B', 'I'],
  },
  {
    title: "Pascal's theorem",
    caption: 'For six points on a circle (or any conic), the three meeting points of opposite sides of hexagon ABCDEF are collinear: the Pascal line. Drag the points, even into a self-crossing order.',
    lines: ['ω = Circle((0, 0), 3)', 'A = Point(ω, 0.05)', 'B = Point(ω, 0.47)', 'C = Point(ω, 0.2)', 'D = Point(ω, 0.62)', 'E = Point(ω, 0.33)', 'F = Point(ω, 0.83)',
      'ab = Line(A, B)', 'de = Line(D, E)', 'bc = Line(B, C)', 'ef = Line(E, F)', 'cd = Line(C, D)', 'fa = Line(F, A)',
      'X = Intersect(ab, de, 1)', 'Y = Intersect(bc, ef, 1)', 'Z = Intersect(cd, fa, 1)', 'p = Line(X, Y)'],
    style: { ab: thin, de: thin, bc: thin, ef: thin, cd: thin, fa: thin, p: accent },
    check: ['X', 'Y', 'Z'],
  },
  {
    title: "Ptolemy's theorem",
    caption: 'For a cyclic quadrilateral, AB·CD + BC·DA = AC·BD. The two sides of the equation are shown live. Drag the vertices around the circle.',
    lines: ['ω = Circle((0, 0), 3)', 'A = Point(ω, 0.08)', 'B = Point(ω, 0.3)', 'C = Point(ω, 0.55)', 'D = Point(ω, 0.78)',
      'ab = Segment(A, B)', 'bc = Segment(B, C)', 'cd = Segment(C, D)', 'da = Segment(D, A)', 'ac = Segment(A, C)', 'bd = Segment(B, D)',
      'lhs = Distance(A, B) Distance(C, D) + Distance(B, C) Distance(D, A)', 'rhs = Distance(A, C) Distance(B, D)',
      'T_1 = Text("AB·CD + BC·DA = " + lhs, (-3.4, 4.2))', 'T_2 = Text("AC·BD = " + rhs, (-3.4, 3.6))'],
    style: { ac: helper, bd: helper },
    check: ['lhs', 'rhs'],
  },
  {
    title: 'Radical centre',
    caption: 'The radical axes of three circles (taken in pairs) are concurrent, at the radical centre X, which has the same power with respect to all three circles. Drag the centres or the points that set the radii.',
    lines: ['O_1 = (-2.5, -1)', 'O_2 = (2.5, -1.5)', 'O_3 = (0.3, 2.6)', 'R_1 = (-0.4, -1.4)', 'R_2 = (4.5, -1)', 'R_3 = (1.7, 3.4)',
      'k_1 = Circle(O_1, R_1)', 'k_2 = Circle(O_2, R_2)', 'k_3 = Circle(O_3, R_3)',
      'r_1 = RadicalAxis(k_1, k_2)', 'r_2 = RadicalAxis(k_2, k_3)', 'r_3 = RadicalAxis(k_3, k_1)', 'X = RadicalCenter(k_1, k_2, k_3)'],
    style: { k_1: { color: '#2457d6' }, k_2: { color: '#138d75' }, k_3: { color: '#8e44ad' }, r_1: helper, r_2: helper, r_3: helper, X: { color: '#c0392b', size: 5 } },
    check: ['r_1', 'r_2', 'r_3'],
  },
  {
    title: 'Inscribed angles (angle chasing)',
    caption: 'Angles subtending the same chord of a circle are equal. Press "Find equal angles" to list every pair of equal angles in this figure; it finds ∠BAC = ∠BDC, ∠ABD = ∠ACD and more. Then mark them with matching arcs.',
    lines: ['ω = Circle((0, 0), 3)', 'A = Point(ω, 0.6)', 'B = Point(ω, 0.88)', 'C = Point(ω, 0.07)', 'D = Point(ω, 0.33)',
      'ab = Segment(A, B)', 'bc = Segment(B, C)', 'cd = Segment(C, D)', 'da = Segment(D, A)', 'ac = Segment(A, C)', 'bd = Segment(B, D)'],
    style: { ω: thin },
    chase: true,
  },
];
