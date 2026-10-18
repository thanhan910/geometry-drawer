// Olympiad geometry: triangle centres and circles, conjugates, radical axes,
// homotheties, spiral similarities, harmonic division, and the relation
// finder behind the "Check relation" tool. Registers into geom.js's command
// table; imported for its side effect by construction.js.

import {
  def, sig, is, lin, lineV, anchor, toPt, ll, cc, lineFromCoef, tangentsConic, conicMatrix, circle3,
  polygonArea, num, pt, UNDEF, V, P, conicInfo, closest, isLinear, isPath,
} from './geom.js';

const { abs, sqrt, hypot, min, max, PI, cos, sin, atan2 } = Math;
const { add, sub, mul, dot, crs, len, unit, perp, mid, dist } = V;

// ---------- triangle machinery ----------

const sides = (A, B, C) => ({ a: dist(B, C), b: dist(C, A), c: dist(A, B) });
const bary = (A, B, C, u, v, w) => {
  const s = u + v + w;
  if (!Number.isFinite(s) || abs(s) < 1e-300) return null;
  return P((u * A.x + v * B.x + w * C.x) / s, (u * A.y + v * B.y + w * C.y) / s);
};
const area2 = (A, B, C) => crs(sub(B, A), sub(C, A));
// Barycentric coordinates of Q with respect to ABC (signed areas).
const baryOf = (Q, A, B, C) => [area2(Q, B, C), area2(A, Q, C), area2(A, B, Q)];
const degenerate = (A, B, C) => abs(area2(A, B, C)) < 1e-12 * (dist(A, B) ** 2 + dist(B, C) ** 2 + dist(C, A) ** 2);
const foot = (Q, p, d) => add(p, mul(d, dot(sub(Q, p), d) / dot(d, d)));
const footOn = (Q, X, Y) => foot(Q, X, sub(Y, X));
const rot = (v, t) => P(v.x * cos(t) - v.y * sin(t), v.x * sin(t) + v.y * cos(t));

// Kimberling's Encyclopedia of Triangle Centers, as barycentric functions of
// the side lengths. Entries with a `pt` are built geometrically instead.
const CENTERS = {
  1: ['Incenter', (a, b, c) => [a, b, c]],
  2: ['Centroid', () => [1, 1, 1]],
  3: ['Circumcenter', (a, b, c) => [a * a * (b * b + c * c - a * a), b * b * (c * c + a * a - b * b), c * c * (a * a + b * b - c * c)]],
  4: ['Orthocenter', (a, b, c) => {
    const SA = (b * b + c * c - a * a) / 2, SB = (c * c + a * a - b * b) / 2, SC = (a * a + b * b - c * c) / 2;
    return [SB * SC, SC * SA, SA * SB];
  }],
  5: ['NinePointCenter', (a, b, c) => [a * a * (b * b + c * c) - (b * b - c * c) ** 2, b * b * (c * c + a * a) - (c * c - a * a) ** 2, c * c * (a * a + b * b) - (a * a - b * b) ** 2]],
  6: ['SymmedianPoint', (a, b, c) => [a * a, b * b, c * c]],
  7: ['GergonnePoint', (a, b, c) => [1 / (b + c - a), 1 / (c + a - b), 1 / (a + b - c)]],
  8: ['NagelPoint', (a, b, c) => [b + c - a, c + a - b, a + b - c]],
  9: ['Mittenpunkt', (a, b, c) => [a * (b + c - a), b * (c + a - b), c * (a + b - c)]],
  10: ['SpiekerCenter', (a, b, c) => [b + c, c + a, a + b]],
  11: ['FeuerbachPoint', (a, b, c) => [(b + c - a) * (b - c) ** 2, (c + a - b) * (c - a) ** 2, (a + b - c) * (a - b) ** 2]],
  13: ['FermatPoint', null, (A, B, C) => fermat(A, B, C, 1)],
  14: ['SecondFermatPoint', null, (A, B, C) => fermat(A, B, C, -1)],
  20: ['DeLongchampsPoint', null, (A, B, C) => { const O = center(A, B, C, 3), H = center(A, B, C, 4); return O && H && sub(mul(O, 2), H); }],
  40: ['BevanPoint', null, (A, B, C) => { const O = center(A, B, C, 3), I = center(A, B, C, 1); return O && I && sub(mul(O, 2), I); }],
};
export const CENTER_LIST = Object.entries(CENTERS).map(([n, [name]]) => [+n, name]);

function center(A, B, C, n) {
  const e = CENTERS[n];
  if (!e || degenerate(A, B, C)) return null;
  if (e[2]) return e[2](A, B, C);
  const { a, b, c } = sides(A, B, C);
  const [u, v, w] = e[1](a, b, c);
  return bary(A, B, C, u, v, w);
}

// Equilateral triangles erected on the sides, outwards (k = 1) or inwards.
function apex(X, Y, away, k) {
  const p1 = add(X, rot(sub(Y, X), PI / 3)), p2 = add(X, rot(sub(Y, X), -PI / 3));
  const s = q => Math.sign(crs(sub(Y, X), sub(q, X)));
  const out = s(p1) !== s(away) ? p1 : p2;
  return k === 1 ? out : (out === p1 ? p2 : p1);
}
function fermat(A, B, C, k) {
  const A1 = apex(B, C, A, k), B1 = apex(C, A, B, k);
  const r = ll({ t: 'line', p: A, d: sub(A1, A) }, { t: 'line', p: B, d: sub(B1, B) });
  return r[0] || null;
}

const tri = a => sig(a, 'pt', 'pt', 'pt');
const ptOrU = p => (p && Number.isFinite(p.x) && Number.isFinite(p.y) ? toPt(p) : UNDEF);
const poly = ps => (ps.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y)) ? { t: 'poly', pts: ps.map(p => P(p.x, p.y)), closed: true } : UNDEF);

def('TriangleCenter', 'TriangleCenter(A, B, C, n) — Kimberling X(n), n = ' + CENTER_LIST.map(c => c[0]).join(', '), a => {
  if (!sig(a, 'pt', 'pt', 'pt', 'num')) return null;
  const n = Math.round(a[3].v);
  if (!CENTERS[n]) return null;
  return ptOrU(center(a[0], a[1], a[2], n));
});
for (const [n, [name]] of Object.entries(CENTERS)) {
  if (name === 'Centroid') continue; // Centroid(polygon or points) already exists
  def(name + (name === 'SymmedianPoint' ? ' LemoinePoint' : name === 'Incenter' ? ' Incentre' : name === 'Circumcenter' ? ' Circumcentre' : name === 'Orthocenter' ? ' Orthocentre' : ''),
    `${name}(A, B, C) — X(${n})`, a => (tri(a) ? ptOrU(center(a[0], a[1], a[2], +n)) : null));
}
def('Excenter Excentre', 'Excenter(A, B, C) — the excentre opposite A', a => {
  if (!tri(a) || degenerate(...a)) return tri(a) ? UNDEF : null;
  const { a: x, b: y, c: z } = sides(...a);
  return ptOrU(bary(...a, -x, y, z));
});
def('Excircle', 'Excircle(A, B, C) — the excircle opposite A', a => {
  if (!tri(a)) return null;
  if (degenerate(...a)) return UNDEF;
  const { a: x, b: y, c: z } = sides(...a);
  const I = bary(...a, -x, y, z), s = (x + y + z) / 2, area = abs(area2(...a)) / 2;
  return { t: 'circle', c: I, r: area / (s - x) };
});
def('Circumcircle', 'Circumcircle(A, B, C)', a => (tri(a) ? circle3(...a) || UNDEF : null));
def('NinePointCircle', 'NinePointCircle(A, B, C)', a => {
  if (!tri(a)) return null;
  const c = circle3(...a), N = center(...a, 5);
  return c && N ? { t: 'circle', c: N, r: c.r / 2 } : UNDEF;
});
def('EulerLine', 'EulerLine(A, B, C)', a => {
  if (!tri(a)) return null;
  const O = center(...a, 3), H = center(...a, 4);
  if (!O || !H || dist(O, H) < 1e-12 * (1 + len(O))) return UNDEF;
  return lineV('line', O, sub(H, O));
});
const cevianSeg = (A, F) => (F && dist(A, F) > 0 ? { t: 'seg', p: P(A.x, A.y), d: sub(F, A) } : UNDEF);
def('Altitude', 'Altitude(A, B, C) — segment from A to its foot on BC', a => (tri(a) ? cevianSeg(a[0], footOn(a[0], a[1], a[2])) : null));
def('Median', 'Median(A, B, C) — segment from A to the midpoint of BC', a => (tri(a) ? cevianSeg(a[0], mid(a[1], a[2])) : null));
def('Symmedian', 'Symmedian(A, B, C) — segment from A to the symmedian foot on BC', a => {
  if (!tri(a)) return null;
  const { b, c } = sides(...a);
  return cevianSeg(a[0], bary(...a, 0, b * b, c * c));
});
def('Foot Projection', 'Foot(P, line) — foot of the perpendicular from P', a => {
  const [Q, l] = a[0] && a[0].t === 'pt' ? a : [a[1], a[0]];
  if (a.length !== 2 || !Q || Q.t !== 'pt' || !l || !isLinear(l)) return null;
  const L = lin(l);
  return ptOrU(foot(Q, L.p, L.d));
});
def('MedialTriangle', 'MedialTriangle(A, B, C)', a => (tri(a) ? poly([mid(a[1], a[2]), mid(a[2], a[0]), mid(a[0], a[1])]) : null));
def('OrthicTriangle', 'OrthicTriangle(A, B, C)', a => (tri(a) ? poly([footOn(a[0], a[1], a[2]), footOn(a[1], a[2], a[0]), footOn(a[2], a[0], a[1])]) : null));
def('IntouchTriangle ContactTriangle', 'IntouchTriangle(A, B, C) — where the incircle touches the sides', a => {
  if (!tri(a)) return null;
  const { a: x, b: y, c: z } = sides(...a), s = (x + y + z) / 2;
  return poly([bary(...a, 0, s - z, s - y), bary(...a, s - z, 0, s - x), bary(...a, s - y, s - x, 0)]);
});
def('PedalTriangle', 'PedalTriangle(P, A, B, C)', a => (sig(a, 'pt', 'pt', 'pt', 'pt') ? poly([footOn(a[0], a[2], a[3]), footOn(a[0], a[3], a[1]), footOn(a[0], a[1], a[2])]) : null));
def('CevianTriangle', 'CevianTriangle(P, A, B, C)', a => {
  if (!sig(a, 'pt', 'pt', 'pt', 'pt')) return null;
  const [Q, A, B, C] = a, [u, v, w] = baryOf(Q, A, B, C);
  return poly([bary(A, B, C, 0, v, w), bary(A, B, C, u, 0, w), bary(A, B, C, u, v, 0)]);
});
def('SimsonLine', 'SimsonLine(P, A, B, C)', a => {
  if (!sig(a, 'pt', 'pt', 'pt', 'pt')) return null;
  const [Q, A, B, C] = a;
  const fs = [footOn(Q, B, C), footOn(Q, C, A), footOn(Q, A, B)];
  const [p, q] = dist(fs[0], fs[1]) > 1e-12 ? [fs[0], fs[1]] : [fs[0], fs[2]];
  return lineV('line', p, sub(q, p));
});
function conj(a, f) {
  if (!sig(a, 'pt', 'pt', 'pt', 'pt')) return null;
  const [Q, A, B, C] = a, [u, v, w] = baryOf(Q, A, B, C);
  if ([u, v, w].some(x => abs(x) < 1e-14)) return UNDEF;
  const { a: x, b: y, c: z } = sides(A, B, C);
  const [p, q, r] = f(u, v, w, x, y, z);
  return ptOrU(bary(A, B, C, p, q, r));
}
def('IsogonalConjugate', 'IsogonalConjugate(P, A, B, C)', a => conj(a, (u, v, w, x, y, z) => [x * x / u, y * y / v, z * z / w]));
def('IsotomicConjugate', 'IsotomicConjugate(P, A, B, C)', a => conj(a, (u, v, w) => [1 / u, 1 / v, 1 / w]));
def('Barycentric', 'Barycentric(A, B, C, u, v, w)', a => (sig(a, 'pt', 'pt', 'pt', 'num', 'num', 'num') ? ptOrU(bary(a[0], a[1], a[2], a[3].v, a[4].v, a[5].v)) : null));
def('Trilinear', 'Trilinear(A, B, C, x, y, z)', a => {
  if (!sig(a, 'pt', 'pt', 'pt', 'num', 'num', 'num')) return null;
  const { a: x, b: y, c: z } = sides(a[0], a[1], a[2]);
  return ptOrU(bary(a[0], a[1], a[2], x * a[3].v, y * a[4].v, z * a[5].v));
});

// ---------- circles ----------

const circ = v => v && v.t === 'circle';
def('Power PowerOfPoint', 'Power(P, circle)', a => {
  const [Q, c] = a[0] && a[0].t === 'pt' ? a : [a[1], a[0]];
  return a.length === 2 && Q && Q.t === 'pt' && circ(c) ? anchor(num(dist(Q, c.c) ** 2 - c.r * c.r), Q) : null;
});
function radicalAxis(c1, c2) {
  const D = 2 * (c2.c.x - c1.c.x), E = 2 * (c2.c.y - c1.c.y);
  if (abs(D) + abs(E) < 1e-12 * (1 + c1.r + c2.r)) return UNDEF;
  const K = (dot(c2.c, c2.c) - c2.r * c2.r) - (dot(c1.c, c1.c) - c1.r * c1.r);
  return lineFromCoef(D, E, -K);
}
def('RadicalAxis', 'RadicalAxis(circle, circle)', a => (a.length === 2 && circ(a[0]) && circ(a[1]) ? radicalAxis(a[0], a[1]) : null));
def('RadicalCenter RadicalCentre', 'RadicalCenter(circle, circle, circle)', a => {
  if (!(a.length === 3 && a.every(circ))) return null;
  const l1 = radicalAxis(a[0], a[1]), l2 = radicalAxis(a[1], a[2]);
  if (l1.t === 'undef' || l2.t === 'undef') return UNDEF;
  const r = ll(l1, l2);
  return r[0] ? toPt(r[0]) : UNDEF;
});
function homothety(c1, c2, internal) {
  if (internal) return mul(add(mul(c1.c, c2.r), mul(c2.c, c1.r)), 1 / (c1.r + c2.r));
  if (abs(c1.r - c2.r) < 1e-12 * (c1.r + c2.r)) return null;
  return mul(sub(mul(c1.c, c2.r), mul(c2.c, c1.r)), 1 / (c2.r - c1.r));
}
def('HomothetyCenter HomothetyCentre', 'HomothetyCenter(circle, circle), HomothetyCenter(circle, circle, 2) — external, or internal', a => {
  if (!(a.length >= 2 && circ(a[0]) && circ(a[1]))) return null;
  return ptOrU(homothety(a[0], a[1], a[2] && Math.round(a[2].v) === 2));
});
export function commonTangents(c1, c2) {
  const out = [];
  const He = homothety(c1, c2, false);
  if (He) out.push(...tangentsConic(He, c1));
  else {
    const u = unit(sub(c2.c, c1.c)), n = perp(u);
    if (len(sub(c2.c, c1.c)) > 0) out.push({ t: 'line', p: add(c1.c, mul(n, c1.r)), d: u }, { t: 'line', p: sub(c1.c, mul(n, c1.r)), d: u });
  }
  const Hi = homothety(c1, c2, true);
  if (dist(c1.c, c2.c) >= c1.r + c2.r - 1e-12) out.push(...tangentsConic(Hi, c1));
  return out.filter(l => l && l.t === 'line');
}
def('CommonTangent', 'CommonTangent(circle, circle, n) — n = 1, 2 external, 3, 4 internal', a => {
  if (!(a.length >= 2 && circ(a[0]) && circ(a[1]))) return null;
  return commonTangents(a[0], a[1])[a[2] ? Math.round(a[2].v) - 1 : 0] || UNDEF;
});
def('ArcMidpoint', 'ArcMidpoint(A, B, C) — midpoint of arc BC of the circumcircle not containing A', a => {
  if (!tri(a)) return null;
  const k = circle3(...a);
  if (!k) return UNDEF;
  const n = unit(perp(sub(a[2], a[1])));
  const m1 = add(k.c, mul(n, k.r)), m2 = sub(k.c, mul(n, k.r));
  const side = q => Math.sign(crs(sub(a[2], a[1]), sub(q, a[1])));
  return toPt(side(m1) !== side(a[0]) ? m1 : m2);
});
def('Antipode', 'Antipode(P, circle)', a => {
  const [Q, c] = a[0] && a[0].t === 'pt' ? a : [a[1], a[0]];
  return a.length === 2 && Q && Q.t === 'pt' && c && (c.t === 'circle' || c.t === 'arc') ? toPt(sub(mul(c.c, 2), Q)) : null;
});
def('Pole', 'Pole(line, conic)', a => {
  if (!(a.length === 2 && isLinear(a[0]) && is(a[1], 'conic'))) return null;
  const L = lin(a[0]), n = perp(L.d), l = [n.x, n.y, -dot(n, L.p)];
  const Q = conicMatrix(a[1]);
  // solve Q · X = l (homogeneous); X = (x, y, w)
  const det3 = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det3(Q);
  if (abs(D) < 1e-14) return UNDEF;
  const col = (k) => Q.map((r, i) => r.map((v, j) => (j === k ? l[i] : v)));
  const x = det3(col(0)) / D, y = det3(col(1)) / D, w = det3(col(2)) / D;
  return abs(w) < 1e-14 ? UNDEF : pt(x / w, y / w);
});

// ---------- similarity and projective ----------

const cx = {
  mul: (a, b) => P(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x),
  div: (a, b) => { const d = b.x * b.x + b.y * b.y; return P((a.x * b.x + a.y * b.y) / d, (a.y * b.x - a.x * b.y) / d); },
};
def('SpiralCenter SpiralCentre SpiralSimilarityCenter', 'SpiralCenter(A, B, C, D) — centre of the spiral similarity taking A→C and B→D', a => {
  if (!sig(a, 'pt', 'pt', 'pt', 'pt')) return null;
  const [A, B, C, D] = a;
  if (dist(A, B) === 0) return UNDEF;
  const k = cx.div(sub(D, C), sub(B, A));
  const one = sub(P(1, 0), k);
  if (len(one) < 1e-12) return UNDEF;
  return ptOrU(cx.div(sub(C, cx.mul(k, A)), one));
});
def('MiquelPoint', 'MiquelPoint(l1, l2, l3, l4) — of the complete quadrilateral', a => {
  if (!(a.length === 4 && a.every(isLinear))) return null;
  const L = a.map(v => ({ ...lin(v), t: 'line' }));
  const X = (i, j) => ll(L[i], L[j])[0];
  const P12 = X(0, 1), c1 = [P12, X(1, 2), X(0, 2)], c2 = [P12, X(1, 3), X(0, 3)];
  if (![...c1, ...c2].every(Boolean)) return UNDEF;
  const k1 = circle3(...c1), k2 = circle3(...c2);
  if (!k1 || !k2) return UNDEF;
  const ps = cc(k1, k2);
  if (!ps.length) return UNDEF;
  return toPt(ps.reduce((b, p) => (dist(p, P12) > dist(b, P12) ? p : b)));
});
def('HarmonicConjugate', 'HarmonicConjugate(A, B, C) — D on AB with (A, B; C, D) = −1', a => {
  if (!tri(a)) return null;
  const [A, B, C] = a, d = sub(B, A), L2 = dot(d, d);
  if (!L2) return UNDEF;
  const t = dot(sub(C, A), d) / L2, den = 2 * t - 1;
  if (abs(den) < 1e-12) return UNDEF;
  return toPt(add(A, mul(d, t / den)));
});
// Complex cross ratio (A, B; C, D) = ((C−A)(D−B)) / ((C−B)(D−A)). Real exactly
// when the four points are collinear or concyclic.
export function crossRatio(A, B, C, D) {
  const n = cx.mul(sub(C, A), sub(D, B)), d = cx.mul(sub(C, B), sub(D, A));
  if (!len(d)) return null;
  return cx.div(n, d);
}
def('CrossRatio', 'CrossRatio(A, B, C, D) — for collinear or concyclic points', a => {
  if (!sig(a, 'pt', 'pt', 'pt', 'pt')) return null;
  const r = crossRatio(...a);
  if (!r || abs(r.y) > 1e-7 * (1 + abs(r.x))) return UNDEF;
  return num(r.x);
});

// ---------- relations ----------

const EPS = 1e-8;
const scale = ps => max(1e-9, ...ps.flatMap(p => ps.map(q => dist(p, q))));
export const R = {
  collinear: (A, B, C) => abs(area2(A, B, C)) <= EPS * scale([A, B, C]) ** 2,
  concyclic(A, B, C, D) {
    if (R.collinear(A, B, C)) return R.collinear(A, B, D);
    const k = circle3(A, B, C);
    return !!k && abs(dist(D, k.c) - k.r) <= EPS * max(k.r, scale([A, B, C, D]));
  },
  parallel: (l1, l2) => abs(crs(unit(lin(l1).d), unit(lin(l2).d))) <= EPS,
  perpendicular: (l1, l2) => abs(dot(unit(lin(l1).d), unit(lin(l2).d))) <= EPS,
  concurrent(l1, l2, l3) {
    if (R.parallel(l1, l2)) return R.parallel(l2, l3);
    const X = ll({ ...lin(l1), t: 'line' }, { ...lin(l2), t: 'line' })[0];
    if (!X) return false;
    const L = lin(l3);
    return dist(foot(X, L.p, L.d), X) <= EPS * max(1, len(X), len(L.p));
  },
  equal: (x, y) => abs(x - y) <= EPS * max(1, abs(x), abs(y)),
  onPath(Q, v) {
    if (v.t === 'pt') return dist(Q, v) <= EPS * max(1, len(Q));
    const c = closest(v, Q);
    return !!c && c.d <= 1e-6 * max(1, len(Q));
  },
};
export function lengthOf(v) {
  if (v.t === 'seg') return len(v.d);
  if (v.t === 'vec') return len(v);
  if (v.t === 'num') return v.v;
  if (v.t === 'arc') return v.r * v.sw;
  return null;
}
const simpleRatio = r => {
  for (let q = 1; q <= 6; q++) {
    const p = Math.round(r * q);
    if (p !== 0 && abs(r * q - p) <= 1e-7 * max(1, abs(r * q))) return [p, q];
  }
  return null;
};

// Everything notable about 2–4 selected objects. Each result has a `test`
// that re-checks it on fresh values, so the caller can perturb the
// construction and ask "always, or only in this picture?".
//   objs: [{name, val}]   →   [{text, holds, test(vals) → bool|null}]
export function relations(objs) {
  const out = [];
  const vals = objs.map(o => o.val), N = objs.map(o => o.name);
  const types = vals.map(v => v.t);
  const all = t => vals.every(v => (typeof t === 'function' ? t(v) : v.t === t));
  const push = (text, test) => {
    let holds = null;
    try { holds = test(vals); } catch { holds = null; }
    if (holds !== null) out.push({ text, holds, test });
  };
  const fmt = ns => (ns.length === 2 ? `${ns[0]} and ${ns[1]}` : `${ns.slice(0, -1).join(', ')} and ${ns.at(-1)}`);
  const finiteLine = v => v.t === 'seg' || v.t === 'vec';
  if (vals.some(v => v.t === 'undef')) return [{ text: 'An object is undefined in this position.', holds: false, test: () => null }];

  if (all('pt')) {
    if (vals.length === 2) push(`${fmt(N)} coincide`, v => R.equal(dist(v[0], v[1]), 0));
    if (vals.length === 3) push(`${fmt(N)} are collinear`, v => R.collinear(...v));
    if (vals.length === 3) {
      for (const [i, j, k] of [[0, 1, 2], [1, 0, 2], [2, 0, 1]]) {
        push(`${N[i]}${N[j]} = ${N[i]}${N[k]}`, v => R.equal(dist(v[i], v[j]), dist(v[i], v[k])));
        push(`∠${N[j]}${N[i]}${N[k]} = 90°`, v => R.perpendicular({ t: 'line', p: v[i], d: sub(v[j], v[i]) }, { t: 'line', p: v[i], d: sub(v[k], v[i]) }));
      }
    }
    if (vals.length === 4) {
      const col = R.collinear(...vals.slice(0, 3)) && R.collinear(vals[0], vals[1], vals[3]);
      if (col) push(`${fmt(N)} are collinear`, v => R.collinear(v[0], v[1], v[2]) && R.collinear(v[0], v[1], v[3]));
      else push(`${fmt(N)} are concyclic`, v => R.concyclic(...v));
      push(`(${N[0]}, ${N[1]}; ${N[2]}, ${N[3]}) is harmonic`, v => { const r = crossRatio(...v); return !!r && abs(r.x + 1) <= 1e-7 && abs(r.y) <= 1e-7; });
      push(`${N.join('')} is a parallelogram`, v => dist(add(v[0], v[2]), add(v[1], v[3])) <= EPS * scale(v));
      for (const [i, j, k] of [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]]) {
        if (col) break;
        if (R.collinear(vals[i], vals[j], vals[k])) push(`${N[i]}, ${N[j]} and ${N[k]} are collinear`, v => R.collinear(v[i], v[j], v[k]));
      }
    }
  }
  if (all(isLinear)) {
    if (vals.length === 2) {
      push(`${fmt(N)} are parallel`, v => R.parallel(v[0], v[1]));
      push(`${fmt(N)} are perpendicular`, v => R.perpendicular(v[0], v[1]));
      if (vals.every(finiteLine)) {
        push(`${N[0]} = ${N[1]} in length`, v => R.equal(lengthOf(v[0]), lengthOf(v[1])));
      }
    }
    if (vals.length === 3) push(`${fmt(N)} are concurrent`, v => R.concurrent(...v));
  }
  if (vals.length === 2 && types.includes('pt') && vals.some(v => v.t !== 'pt' && isPath(v))) {
    const i = types.indexOf('pt'), j = 1 - i;
    push(`${N[i]} lies on ${N[j]}`, v => R.onPath(v[i], v[j]));
  }
  if (vals.length === 2 && vals.some(isLinear) && vals.some(v => v.t === 'circle')) {
    const i = vals.findIndex(isLinear), j = 1 - i;
    push(`${N[i]} is tangent to ${N[j]}`, v => { const L = lin(v[i]); return R.equal(dist(foot(v[j].c, L.p, L.d), v[j].c), v[j].r); });
    push(`${N[i]} passes through the centre of ${N[j]}`, v => { const L = lin(v[i]); return dist(foot(v[j].c, L.p, L.d), v[j].c) <= EPS * max(1, v[j].r); });
  }
  if (vals.length === 2 && all('circle')) {
    push(`${fmt(N)} are tangent`, v => { const d = dist(v[0].c, v[1].c); return R.equal(d, v[0].r + v[1].r) || R.equal(d, abs(v[0].r - v[1].r)); });
    push(`${fmt(N)} are orthogonal`, v => R.equal(dist(v[0].c, v[1].c) ** 2, v[0].r ** 2 + v[1].r ** 2));
    push(`${fmt(N)} are concentric`, v => dist(v[0].c, v[1].c) <= EPS * max(1, v[0].r, v[1].r));
    push(`${fmt(N)} are congruent`, v => R.equal(v[0].r, v[1].r));
  }
  if (vals.length === 3 && all('circle')) {
    push(`${fmt(N)} pass through a common point`, v => {
      const ps = cc(v[0], v[1]);
      return ps.some(p => abs(dist(p, v[2].c) - v[2].r) <= 1e-7 * max(1, v[2].r));
    });
    push(`${fmt(N)} are coaxal`, v => {
      const a1 = radicalAxis(v[0], v[1]), a2 = radicalAxis(v[1], v[2]);
      return a1.t === 'line' && a2.t === 'line' && R.parallel(a1, a2) && R.onPath(a1.p, a2);
    });
  }
  // two measurable quantities: numbers, angles, segments
  if (vals.length === 2 && vals.every(v => lengthOf(v) !== null) && !all(isLinear)) {
    const L = v => lengthOf(v);
    push(`${N[0]} = ${N[1]}`, v => R.equal(L(v[0]), L(v[1])));
    if (vals.every(v => v.t === 'num' && v.deg)) {
      push(`${N[0]} + ${N[1]} = 180°`, v => R.equal(v[0].v + v[1].v, PI));
      push(`${N[0]} + ${N[1]} = 90°`, v => R.equal(v[0].v + v[1].v, PI / 2));
    }
    const r = L(vals[0]) / L(vals[1]);
    const sr = Number.isFinite(r) && !R.equal(r, 1) && simpleRatio(r);
    if (sr) {
      const [p, q] = sr;
      push(`${q === 1 ? '' : q}${N[0]} = ${p === 1 ? '' : p === -1 ? '−' : p}${N[1]}`, v => R.equal(L(v[0]) * q, L(v[1]) * p));
    }
  }
  if (vals.length === 2 && vals.every(finiteLine)) {
    const r = lengthOf(vals[0]) / lengthOf(vals[1]);
    const sr = !R.equal(r, 1) && simpleRatio(r);
    if (sr) push(`${sr[1] === 1 ? '' : sr[1]}${N[0]} = ${sr[0]}${N[1]} in length`, v => R.equal(lengthOf(v[0]) * sr[1], lengthOf(v[1]) * sr[0]));
  }
  return out;
}

// The same checks as input-bar commands returning true / false.
const B = v => ({ t: 'bool', v: !!v });
def('AreCollinear', 'AreCollinear(A, B, C, …)', a => (a.length >= 3 && a.every(v => v.t === 'pt') ? B(a.slice(2).every(Q => R.collinear(a[0], a[1], Q))) : null));
def('AreConcyclic', 'AreConcyclic(A, B, C, D, …)', a => (a.length >= 4 && a.every(v => v.t === 'pt') ? B(a.slice(3).every(Q => R.concyclic(a[0], a[1], a[2], Q))) : null));
def('AreConcurrent', 'AreConcurrent(l1, l2, l3, …)', a => (a.length >= 3 && a.every(isLinear) ? B(a.slice(2).every(l => R.concurrent(a[0], a[1], l))) : null));
def('AreParallel', 'AreParallel(l1, l2)', a => (a.length === 2 && a.every(isLinear) ? B(R.parallel(a[0], a[1])) : null));
def('ArePerpendicular', 'ArePerpendicular(l1, l2)', a => (a.length === 2 && a.every(isLinear) ? B(R.perpendicular(a[0], a[1])) : null));
def('AreEqual AreCongruent', 'AreEqual(a, b) — numbers, lengths, angles or points', a => {
  if (a.length !== 2) return null;
  if (a.every(v => v.t === 'pt')) return B(dist(a[0], a[1]) <= EPS * max(1, len(a[0])));
  if (a.every(v => v.t === 'circle')) return B(R.equal(a[0].r, a[1].r));
  const x = lengthOf(a[0]), y = lengthOf(a[1]);
  return x === null || y === null ? null : B(R.equal(x, y));
});
def('AreTangent', 'AreTangent(line or circle, circle)', a => {
  if (a.length !== 2) return null;
  const [p, q] = a[0].t === 'circle' ? [a[1], a[0]] : a;
  if (q.t !== 'circle') return null;
  if (p.t === 'circle') { const d = dist(p.c, q.c); return B(R.equal(d, p.r + q.r) || R.equal(d, abs(p.r - q.r))); }
  if (!isLinear(p)) return null;
  const L = lin(p);
  return B(R.equal(dist(foot(q.c, L.p, L.d), q.c), q.r));
});
def('IsOn LiesOn', 'IsOn(P, object)', a => (a.length === 2 && a[0].t === 'pt' && (isPath(a[1]) || a[1].t === 'pt') ? B(R.onPath(a[0], a[1])) : null));
