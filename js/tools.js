// Tool definitions. A tool is a list of selection patterns (what the user
// clicks, in order) and a make() that turns the selection into definitions.
// The engine in app.js does the clicking, point creation and preview.
//
// Pattern types: pt, lin (line/segment/ray/vector), seg, carc (circle/arc),
// circ (circle), conic (circle/conic), tan (circle/conic/function), fn,
// poly, vec, obj (anything geometric), any.

const dot = (x, y, r = 2.4) => `<circle cx="${x}" cy="${y}" r="${r}" class="d"/>`;
const odot = (x, y) => `<circle cx="${x}" cy="${y}" r="2" class="o"/>`;
const ln = d => `<path d="${d}" class="s"/>`;
const dash = d => `<path d="${d}" class="s" stroke-dasharray="2.5 2.2"/>`;
const fill = d => `<path d="${d}" class="f"/>`;
const txt = (x, y, s, size = 9) => `<text x="${x}" y="${y}" font-size="${size}" class="t">${s}</text>`;
const svg = s => `<svg viewBox="0 0 24 24" class="ic" aria-hidden="true">${s}</svg>`;

const ICON = {
  move: svg('<path d="M6 3v16l4-4 3 6.5 2.6-1.2-3-6.3H18z" class="fc"/>'),
  point: svg(dot(12, 12, 3.6) + txt(15, 9, 'A')),
  intersect: svg(ln('M3 6l18 12M3 18L21 6') + dot(12, 12, 3)),
  midpoint: svg(ln('M4 17L20 7') + odot(4, 17) + odot(20, 7) + dot(12, 12, 3)),
  line: svg(ln('M1 19L23 5') + dot(7, 15.2) + dot(17, 8.8)),
  segment: svg(ln('M5 17L19 7') + dot(5, 17) + dot(19, 7)),
  segfixed: svg(ln('M4 15h16') + dot(4, 15) + dot(20, 15) + ln('M4 9v3M20 9v3M4 10.5h16') ),
  ray: svg(ln('M5 18L23 5') + dot(5, 18) + dot(13, 12.2)),
  vector: svg(ln('M5 18L18 7') + '<path d="M20 5l-6.5 1.8 4.6 4.7z" class="fc"/>' + dot(5, 18)),
  vecfrom: svg(ln('M3 13L12 5') + '<path d="M14 3.5l-5.2 1.3 3.7 3.8z" class="fc"/>' + ln('M9 21L18 13') + '<path d="M20 11.5l-5.2 1.3 3.7 3.8z" class="fc"/>' + dot(9, 21)),
  polyline: svg(ln('M3 18L9 7l6 9 6-11') + dot(3, 18) + dot(9, 7) + dot(15, 16) + dot(21, 5)),
  perpendicular: svg(ln('M2 18h20M11 2v20') + ln('M11 14h4v4') + dot(11, 7)),
  parallel: svg(ln('M2 14L16 3M8 21L22 10') + dot(15, 15.5)),
  perpbisector: svg(ln('M3 17L21 9') + dot(3, 17) + dot(21, 9) + ln('M9 3l6 20')),
  anglebisector: svg(ln('M3 20L21 20M3 20L15 4') + dash('M3 20L22 11') + dot(3, 20)),
  tangent: svg('<circle cx="10" cy="14" r="6" class="s"/>' + ln('M2 6.5L22 4') + dot(21, 4)),
  locus: svg(dash('M3 17c4-12 8-12 10-4s5 8 8-5') + dot(13, 13, 3)),
  polygon: svg(fill('M4 19L12 4l8 15z') + ln('M4 19L12 4l8 15z') + dot(4, 19) + dot(12, 4) + dot(20, 19)),
  regpolygon: svg(fill('M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z') + ln('M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z') + dot(4.2, 16.5) + dot(12, 21)),
  circle: svg('<circle cx="12" cy="12" r="8.5" class="s"/>' + dot(12, 12) + dot(18, 6)),
  circleR: svg('<circle cx="12" cy="12" r="8.5" class="s"/>' + dot(12, 12) + ln('M12 12h8.5') + txt(13.5, 10.5, 'r', 8)),
  compass: svg('<circle cx="14" cy="14" r="7.5" class="s" stroke-dasharray="2.5 2"/>' + ln('M3 4l7 3') + dot(3, 4) + dot(10, 7) + dot(14, 14)),
  circle3: svg('<circle cx="12" cy="12" r="8.5" class="s"/>' + dot(4.5, 16) + dot(15, 4) + dot(19, 16)),
  incircle: svg(ln('M2 20L12 3l10 17z') + '<circle cx="12" cy="14.2" r="5.3" class="s"/>'),
  semicircle: svg(ln('M3 15a9 9 0 0 1 18 0') + dot(3, 15) + dot(21, 15)),
  arc: svg(ln('M20 12a8 8 0 0 0-14.7-4.3') + dot(12, 12) + dot(20, 12) + dot(5.3, 7.7) + dash('M12 12h8M12 12L5.3 7.7')),
  circarc: svg(ln('M3 15a9 9 0 0 1 18 0') + dot(3, 15) + dot(12, 6) + dot(21, 15)),
  sector: svg(fill('M12 13h9a9 9 0 0 0-14-7.5z') + ln('M12 13h9a9 9 0 0 0-14-7.5z') + dot(12, 13)),
  circsector: svg(fill('M12 16L3 13a9 9 0 0 1 18 0z') + ln('M12 16L3 13a9 9 0 0 1 18 0z') + dot(3, 13) + dot(12, 4) + dot(21, 13)),
  ellipse: svg('<ellipse cx="12" cy="12" rx="10" ry="6" class="s"/>' + dot(6.5, 12) + dot(17.5, 12)),
  hyperbola: svg(ln('M3 3c6 5 6 13 0 18M21 3c-6 5-6 13 0 18') + dot(8, 12) + dot(16, 12)),
  parabola: svg(ln('M3 3c3 15 15 15 18 0') + ln('M2 21h20') + dot(12, 8)),
  conic5: svg('<ellipse cx="12" cy="12" rx="10" ry="6.5" class="s"/>' + dot(2, 12) + dot(12, 5.5) + dot(22, 12) + dot(12, 18.5) + dot(19, 7.3)),
  angle: svg(ln('M3 20h18M3 20L16 5') + fill('M3 20h9a9 9 0 0 0-3-6.8z') + ln('M12 20a9 9 0 0 0-3-6.8')),
  anglesize: svg(ln('M3 20h18M3 20L16 5') + ln('M12 20a9 9 0 0 0-3-6.8') + txt(13, 15, '°', 10)),
  distance: svg(ln('M4 15h16M4 11v8M20 11v8') + txt(7, 10, 'cm', 7)),
  area: svg(fill('M4 19L8 5h12l-3 14z') + ln('M4 19L8 5h12l-3 14z') + txt(9, 15, 'A', 8)),
  slope: svg(ln('M2 20L22 4') + ln('M7 16h10v-8') + txt(18, 15, 'm', 7)),
  reflectline: svg(fill('M3 18l5-12 3 12z') + ln('M3 18l5-12 3 12z') + dash('M12 2v20') + ln('M21 18l-5-12-3 12z')),
  reflectpoint: svg(fill('M2 4h7l-4 6z') + ln('M2 4h7l-4 6z') + ln('M22 20h-7l4-6z') + dot(12, 12)),
  inversion: svg('<circle cx="10" cy="12" r="7" class="s"/>' + ln('M10 12L23 12') + dot(10, 12) + dot(14, 12, 2) + dot(21, 12, 2)),
  rotate: svg(fill('M14 8l6 0-3 6z') + ln('M14 8l6 0-3 6z') + dot(8, 15) + ln('M4 14a5 5 0 0 0 6 6') + '<path d="M11.7 21.2l-2.9-3.4 4.1-.2z" class="fc"/>'),
  translate: svg(fill('M2 18l4-7 3 7z') + ln('M2 18l4-7 3 7z') + ln('M13 18l4-7 3 7z') + ln('M7 7h10') + '<path d="M19 7l-3.2-2v4z" class="fc"/>'),
  dilate: svg(fill('M6 18l3-5 2 5z') + ln('M2 21l9-14 7 14zM2 21L9 13M2 21h9') + dot(2, 21)),
  roots: svg(ln('M2 12h20') + ln('M4 3c3 17 13 17 16 0') + dot(5.7, 12) + dot(18.3, 12)),
  extremum: svg(ln('M3 3c3 17 15 17 18 0') + dot(12, 15.7, 3)),
  derivative: svg(txt(4, 17, 'f′', 14)),
  integral: svg(fill('M4 20V12c4-6 8-6 16-2v10z') + ln('M2 20h20M4 12c4-6 8-6 16-2')),
  slider: svg(ln('M3 13h18') + dot(14, 13, 3.4) + txt(3, 8, 'a=2', 7)),
  text: svg(txt(3, 17, 'ABC', 9.5)),
  showlabel: svg(dot(8, 16, 3) + txt(11, 11, 'A', 10) + ln('M3 21h18')),
  showhide: svg(ln('M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z') + '<circle cx="12" cy="12" r="3" class="s"/>'),
  delete: svg(ln('M5 5l14 14M19 5L5 19')),
  center: svg(ln('M3 20L12 4l9 16z') + dot(12, 14, 2.8) + dash('M3 20L12 14M21 20L12 14M12 4v10')),
  foot: svg(ln('M2 19h20') + dash('M12 5v14') + ln('M12 15h4v4') + dot(12, 5) + dot(12, 19)),
  excircle: svg(ln('M2 9L9 3l3 8z') + '<circle cx="13" cy="15.5" r="6.3" class="s"/>' + dot(13, 15.5, 1.8)),
  ninepoint: svg(ln('M3 21L11 3l10 18z') + '<circle cx="12" cy="15" r="5" class="s" stroke-dasharray="2 1.8"/>' + dot(7, 12, 1.6) + dot(16, 12, 1.6) + dot(12, 20, 1.6)),
  eulerline: svg(ln('M3 20L10 3l11 17z') + dash('M2 4L22 22') + dot(8, 9.4, 1.8) + dot(11.5, 12.6, 1.8) + dot(14.5, 15.3, 1.8)),
  radical: svg('<circle cx="7" cy="12" r="5.5" class="s"/><circle cx="16" cy="12" r="6" class="s"/>' + ln('M11.3 2v20')),
  commontangent: svg('<circle cx="6" cy="14" r="3.5" class="s"/><circle cx="16.5" cy="13" r="5.5" class="s"/>' + ln('M1 9.5l22-3.5')),
  isogonal: svg(ln('M2 21L9 3l13 18z') + dash('M9 3l2 13M9 3l3 9') + dot(11, 16, 1.9) + dot(12, 12, 1.9)),
  spiral: svg(ln('M12 12a2 2 0 0 1 4 0 4 4 0 0 1-8 0 6 6 0 0 1 12 0 8 8 0 0 1-8 8') + dot(12, 12, 1.8)),
  harmonic: svg(ln('M1 15h22') + dot(3, 15) + dot(9, 15) + dot(13, 15) + dot(21, 15) + txt(5, 9, '−1', 8)),
  arcmid: svg('<circle cx="12" cy="10" r="7.5" class="s"/>' + ln('M5 13h14') + dot(12, 17.5, 3) + dot(5, 13) + dot(19, 13)),
  antipode: svg('<circle cx="12" cy="12" r="8" class="s"/>' + dash('M6.3 6.3l11.4 11.4') + dot(6.3, 6.3) + dot(17.7, 17.7) + dot(12, 12, 1.5)),
  relation: svg(ln('M4 7h7M4 12h7') + ln('M14 12l3 3 5-7') + txt(4, 21, '≟', 9)),
  marks: svg(ln('M3 18L21 6M10 10l2 3M12.5 8.5l2 3')),
  zoomin: svg('<circle cx="10" cy="10" r="6.5" class="s"/>' + ln('M15 15l6 6M7 10h6M10 7v6')),
  zoomout: svg('<circle cx="10" cy="10" r="6.5" class="s"/>' + ln('M15 15l6 6M7 10h6')),
};

// make(sel, N, ctx): sel = selected object names in pattern order, pi =
// pattern index, N(kind, hint) allocates a name, ctx.val(name) its value.
// Returns [{name, src, style?, kind?}].
const one = (kind, f) => (sel, N, ctx) => [{ name: N(kind), src: f(sel, ctx) }];
const PT2 = [['pt', 'pt']];
const PT3 = [['pt', 'pt', 'pt']];
const prime = (name, N, kind) => N(kind, /^[A-Z]/.test(name) ? `${name.replace(/_\d+$/, '')}'` : undefined);

export const TOOLS = [
  { id: 'move', group: 'move', name: 'Move', key: 'v', help: 'Drag objects, drag the background to pan, scroll to zoom. Shift-drag to box-select.' },
  { id: 'point', group: 'points', name: 'Point', key: 'p', help: 'Click on the canvas, on an object, or at an intersection', special: 'point' },
  { id: 'intersect', group: 'points', name: 'Intersect', key: 'i', help: 'Select two objects, or click at their intersection', patterns: [['path', 'path']], make: 'intersect' },
  { id: 'midpoint', group: 'points', name: 'Midpoint or Center', key: 'm', help: 'Select two points, a segment, or a circle', patterns: [['pt', 'pt'], ['seg'], ['carc'], ['conic']],
    make: (s, N) => [{ name: N('pt'), src: `${s.length === 2 ? 'Midpoint' : 'Midpoint'}(${s.join(', ')})` }], preview: true },
  { id: 'roots', group: 'points', name: 'Roots', help: 'Select a function', patterns: [['fn']], make: one('pts', s => `Root(${s[0]})`) },
  { id: 'extremum', group: 'points', name: 'Extremum', help: 'Select a function', patterns: [['fn']], make: one('pts', s => `Extremum(${s[0]})`) },

  { id: 'line', group: 'lines', name: 'Line', key: 'l', help: 'Select two points', patterns: PT2, make: one('line', s => `Line(${s[0]}, ${s[1]})`), preview: true },
  { id: 'segment', group: 'lines', name: 'Segment', key: 's', help: 'Select two points', patterns: PT2, make: one('seg', s => `Segment(${s[0]}, ${s[1]})`), preview: true },
  { id: 'segfixed', group: 'lines', name: 'Segment with Given Length', help: 'Select a point, then enter the length', patterns: [['pt']],
    prompt: { label: 'Length', def: '3' },
    make: (s, N, ctx, x) => { const c = N('line'), B = N('pt'); return [{ name: c, src: `Circle(${s[0]}, ${x})`, style: { hidden: true, aux: true } }, { name: B, src: `Point(${c}, 0)` }, { name: N('seg'), src: `Segment(${s[0]}, ${B})` }]; } },
  { id: 'ray', group: 'lines', name: 'Ray', key: 'r', help: 'Select the start point, then a point on the ray', patterns: PT2, make: one('line', s => `Ray(${s[0]}, ${s[1]})`), preview: true },
  { id: 'vector', group: 'lines', name: 'Vector', key: 'w', help: 'Select the start point, then the end point', patterns: PT2, make: one('vec', s => `Vector(${s[0]}, ${s[1]})`), preview: true },
  { id: 'vecfrom', group: 'lines', name: 'Vector from Point', help: 'Select a point, then a vector', patterns: [['pt', 'vec']], make: one('vec', s => `Translate(${s[1]}, ${s[0]})`) },
  { id: 'polyline', group: 'lines', name: 'Polyline', help: 'Select points; click the last one again to finish', special: 'polyline' },

  { id: 'perpendicular', group: 'special', name: 'Perpendicular Line', key: 'h', help: 'Select a point and a line', patterns: [['pt', 'lin'], ['lin', 'pt']],
    make: (s, N, ctx, x, pi) => [{ name: N('line'), src: `Perpendicular(${pi ? s[1] : s[0]}, ${pi ? s[0] : s[1]})` }], preview: true },
  { id: 'parallel', group: 'special', name: 'Parallel Line', key: 'j', help: 'Select a point and a line', patterns: [['pt', 'lin'], ['lin', 'pt']],
    make: (s, N, ctx, x, pi) => [{ name: N('line'), src: `Line(${pi ? s[1] : s[0]}, ${pi ? s[0] : s[1]})` }], preview: true },
  { id: 'perpbisector', group: 'special', name: 'Perpendicular Bisector', key: 'b', help: 'Select two points or a segment', patterns: [['pt', 'pt'], ['seg']],
    make: one('line', s => `PerpendicularBisector(${s.join(', ')})`), preview: true },
  { id: 'anglebisector', group: 'special', name: 'Angle Bisector', help: 'Select three points (vertex second) or two lines', patterns: [['pt', 'pt', 'pt'], ['lin', 'lin']],
    make: (s, N, ctx, x, pi) => (pi === 1 ? [1, 2].map(k => ({ name: N('line'), src: `AngleBisector(${s[0]}, ${s[1]}, ${k})` })) : [{ name: N('line'), src: `AngleBisector(${s.join(', ')})` }]), preview: true },
  { id: 'tangent', group: 'special', name: 'Tangents', help: 'Select a point and a circle, conic or function', patterns: [['pt', 'tan'], ['tan', 'pt']], make: 'tangent' },
  { id: 'locus', group: 'special', name: 'Locus', help: 'Select the locus point, then the point on a path (or slider) that drives it', patterns: [['pt', 'pt'], ['pt', 'num']],
    make: one('line', s => `Locus(${s[0]}, ${s[1]})`) },

  { id: 'center', group: 'olympiad', name: 'Triangle Centre', help: 'Select three vertices, then pick the centre (incentre, orthocentre, X(n)…)', patterns: PT3,
    prompt: { label: 'Centre', options: 'centers' }, make: 'center' },
  { id: 'foot', group: 'olympiad', name: 'Foot of Perpendicular', help: 'Select a point and a line', patterns: [['pt', 'lin'], ['lin', 'pt']],
    make: (s, N, ctx, x, pi) => { const [P, l] = pi ? [s[1], s[0]] : s; const F = N('pt'); return [{ name: F, src: `Foot(${P}, ${l})` }, { name: N('seg'), src: `Segment(${P}, ${F})`, style: { dash: 1, width: 1.5 } }]; }, preview: true },
  { id: 'excircle', group: 'olympiad', name: 'Excircle', help: 'Select the vertex the excircle is opposite to, then the other two', patterns: PT3,
    make: (s, N) => [{ name: N('pt', /^[A-Z]$/.test(s[0]) ? `I_${s[0]}` : undefined), src: `Excenter(${s.join(', ')})` }, { name: N('line'), src: `Excircle(${s.join(', ')})` }], preview: true },
  { id: 'ninepoint', group: 'olympiad', name: 'Nine-Point Circle', help: 'Select three vertices', patterns: PT3, make: one('line', s => `NinePointCircle(${s.join(', ')})`), preview: true },
  { id: 'eulerline', group: 'olympiad', name: 'Euler Line', help: 'Select three vertices', patterns: PT3, make: one('line', s => `EulerLine(${s.join(', ')})`), preview: true },
  { id: 'arcmid', group: 'olympiad', name: 'Arc Midpoint', help: 'Select a vertex A, then B and C: midpoint of arc BC not containing A', patterns: PT3, make: one('pt', s => `ArcMidpoint(${s.join(', ')})`), preview: true },
  { id: 'antipode', group: 'olympiad', name: 'Antipode', help: 'Select a point and a circle', patterns: [['pt', 'carc'], ['carc', 'pt']],
    make: (s, N, ctx, x, pi) => [{ name: N('pt'), src: `Antipode(${pi ? s[1] : s[0]}, ${pi ? s[0] : s[1]})` }] },
  { id: 'radical', group: 'olympiad', name: 'Radical Axis', help: 'Select two circles', patterns: [['circ', 'circ']], make: one('line', s => `RadicalAxis(${s.join(', ')})`) },
  { id: 'commontangent', group: 'olympiad', name: 'Common Tangents', help: 'Select two circles', patterns: [['circ', 'circ']], make: 'commontangent' },
  { id: 'isogonal', group: 'olympiad', name: 'Isogonal Conjugate', help: 'Select the point, then the three vertices', patterns: [['pt', 'pt', 'pt', 'pt']], make: one('pt', s => `IsogonalConjugate(${s.join(', ')})`), preview: true },
  { id: 'spiral', group: 'olympiad', name: 'Spiral Similarity Centre', help: 'Select A, B, then their images C, D', patterns: [['pt', 'pt', 'pt', 'pt']], make: one('pt', s => `SpiralCenter(${s.join(', ')})`), preview: true },
  { id: 'harmonic', group: 'olympiad', name: 'Harmonic Conjugate', help: 'Select A, B, then C: D on AB with (A, B; C, D) = −1', patterns: PT3, make: one('pt', s => `HarmonicConjugate(${s.join(', ')})`), preview: true },
  { id: 'relation', group: 'olympiad', name: 'Check Relation', key: 'q', help: 'Select 2–4 objects: collinear, concyclic, concurrent, tangent, equal… and whether it always holds', special: 'relation' },

  { id: 'polygon', group: 'polygons', name: 'Polygon', key: 'g', help: 'Select vertices; click the first one again to close', special: 'polygon' },
  { id: 'regpolygon', group: 'polygons', name: 'Regular Polygon', help: 'Select two points, then enter the number of vertices', patterns: PT2,
    prompt: { label: 'Vertices', def: '6' }, make: 'regpolygon' },

  { id: 'circle', group: 'circles', name: 'Circle with Center through Point', key: 'c', help: 'Select the center, then a point on the circle', patterns: PT2, make: one('line', s => `Circle(${s[0]}, ${s[1]})`), preview: true },
  { id: 'circleR', group: 'circles', name: 'Circle: Center & Radius', help: 'Select the center, then enter the radius', patterns: [['pt']], prompt: { label: 'Radius', def: '2' },
    make: (s, N, ctx, x) => [{ name: N('line'), src: `Circle(${s[0]}, ${x})` }] },
  { id: 'compass', group: 'circles', name: 'Compass', key: 'k', help: 'Select a segment or two points for the radius, then the center', patterns: [['pt', 'pt', 'pt'], ['seg', 'pt'], ['carc', 'pt']],
    make: (s, N, ctx, x, pi) => [{ name: N('line'), src: pi === 0 ? `Circle(${s[2]}, Distance(${s[0]}, ${s[1]}))` : pi === 1 ? `Circle(${s[1]}, ${s[0]})` : `Circle(${s[1]}, Radius(${s[0]}))` }], preview: true },
  { id: 'circle3', group: 'circles', name: 'Circle through 3 Points', help: 'Select three points', patterns: PT3, make: one('line', s => `Circle(${s.join(', ')})`), preview: true },
  { id: 'incircle', group: 'circles', name: 'Incircle', help: 'Select three points', patterns: PT3, make: one('line', s => `Incircle(${s.join(', ')})`), preview: true },
  { id: 'semicircle', group: 'circles', name: 'Semicircle', help: 'Select two points', patterns: PT2, make: one('line', s => `Semicircle(${s.join(', ')})`), preview: true },
  { id: 'arc', group: 'circles', name: 'Circular Arc', help: 'Select the center, then two points', patterns: PT3, make: one('line', s => `CircularArc(${s.join(', ')})`), preview: true },
  { id: 'circarc', group: 'circles', name: 'Circumcircular Arc', help: 'Select three points', patterns: PT3, make: one('line', s => `CircumcircularArc(${s.join(', ')})`), preview: true },
  { id: 'sector', group: 'circles', name: 'Circular Sector', help: 'Select the center, then two points', patterns: PT3, make: one('poly', s => `CircularSector(${s.join(', ')})`), preview: true },
  { id: 'circsector', group: 'circles', name: 'Circumcircular Sector', help: 'Select three points', patterns: PT3, make: one('poly', s => `CircumcircularSector(${s.join(', ')})`), preview: true },

  { id: 'ellipse', group: 'conics', name: 'Ellipse', key: 'e', help: 'Select two foci, then a point on the ellipse', patterns: PT3, make: one('line', s => `Ellipse(${s.join(', ')})`), preview: true },
  { id: 'hyperbola', group: 'conics', name: 'Hyperbola', help: 'Select two foci, then a point on the hyperbola', patterns: PT3, make: one('line', s => `Hyperbola(${s.join(', ')})`), preview: true },
  { id: 'parabola', group: 'conics', name: 'Parabola', help: 'Select the focus and the directrix', patterns: [['pt', 'lin'], ['lin', 'pt']],
    make: (s, N, ctx, x, pi) => [{ name: N('line'), src: `Parabola(${pi ? s[1] : s[0]}, ${pi ? s[0] : s[1]})` }], preview: true },
  { id: 'conic5', group: 'conics', name: 'Conic through 5 Points', help: 'Select five points', patterns: [['pt', 'pt', 'pt', 'pt', 'pt']], make: one('line', s => `Conic(${s.join(', ')})`), preview: true },

  { id: 'angle', group: 'measure', name: 'Angle', key: 'a', help: 'Select three points (vertex second), two lines, or a polygon', patterns: [['pt', 'pt', 'pt'], ['lin', 'lin'], ['poly']], make: 'angle' },
  { id: 'anglesize', group: 'measure', name: 'Angle with Given Size', help: 'Select a leg point and the vertex, then enter the size', patterns: PT2, prompt: { label: 'Angle (degrees, counter-clockwise)', def: '45°' },
    make: (s, N, ctx, x) => { const B = prime(s[0], N, 'pt'); return [{ name: B, src: `Rotate(${s[0]}, ${x}, ${s[1]})` }, { name: N('angle'), src: `OrientedAngle(${s[0]}, ${s[1]}, ${B})` }]; } },
  { id: 'distance', group: 'measure', name: 'Distance or Length', key: 'd', help: 'Select two points, a point and a line, or a segment, polygon or circle',
    patterns: [['pt', 'pt'], ['pt', 'lin'], ['lin', 'pt'], ['seg'], ['poly'], ['carc']], make: 'distance' },
  { id: 'area', group: 'measure', name: 'Area', help: 'Select a polygon, circle, sector or ellipse', patterns: [['poly'], ['carc'], ['conic']],
    make: (s, N) => [{ name: N('num', `area${s[0].replace(/[^A-Za-z0-9]/g, '')}`), src: `Area(${s[0]})` }] },
  { id: 'slope', group: 'measure', name: 'Slope', help: 'Select a line', patterns: [['lin']], make: (s, N) => [{ name: N('num', 'm'), src: `Slope(${s[0]})` }] },

  { id: 'reflectline', group: 'transform', name: 'Reflect about Line', key: 'f', help: 'Select the object, then the mirror line', patterns: [['obj', 'lin']], make: 'transform', fmt: s => `Reflect(${s[0]}, ${s[1]})` },
  { id: 'reflectpoint', group: 'transform', name: 'Reflect about Point', help: 'Select the object, then the center', patterns: [['obj', 'pt']], make: 'transform', fmt: s => `Reflect(${s[0]}, ${s[1]})` },
  { id: 'inversion', group: 'transform', name: 'Reflect about Circle', help: 'Select a point, line or circle, then the circle of inversion', patterns: [['obj', 'circ']], make: 'transform', fmt: s => `Reflect(${s[0]}, ${s[1]})` },
  { id: 'rotate', group: 'transform', name: 'Rotate around Point', key: 'o', help: 'Select the object, then the center, then enter the angle', patterns: [['obj', 'pt']],
    prompt: { label: 'Angle (degrees, counter-clockwise)', def: '90°' }, make: 'transform', fmt: (s, x) => `Rotate(${s[0]}, ${x}, ${s[1]})` },
  { id: 'translate', group: 'transform', name: 'Translate by Vector', help: 'Select the object, then the vector', patterns: [['obj', 'vec']], make: 'transform', fmt: s => `Translate(${s[0]}, ${s[1]})` },
  { id: 'dilate', group: 'transform', name: 'Dilate from Point', help: 'Select the object, then the center, then enter the factor', patterns: [['obj', 'pt']],
    prompt: { label: 'Factor', def: '2' }, make: 'transform', fmt: (s, x) => `Dilate(${s[0]}, ${x}, ${s[1]})` },

  { id: 'tangentfn', group: 'functions', name: 'Tangent to Function', help: 'Select a point on the function and the function', patterns: [['pt', 'fn'], ['fn', 'pt']], make: 'tangent', icon: 'tangent' },
  { id: 'derivative', group: 'functions', name: 'Derivative', help: 'Select a function', patterns: [['fn']], make: (s, N) => [{ name: N('line', /^[a-z]$/.test(s[0]) ? `${s[0]}'` : undefined), src: `Derivative(${s[0]})` }] },
  { id: 'integral', group: 'functions', name: 'Integral', help: 'Select a function, then enter the bounds', patterns: [['fn']], prompt: { label: 'From, to', def: '0, 1' },
    make: (s, N, ctx, x) => [{ name: N('num', 'I'), src: `Integral(${s[0]}, ${x})` }] },
  { id: 'fnroots', group: 'functions', name: 'Roots', help: 'Select a function', patterns: [['fn']], make: one('pts', s => `Root(${s[0]})`), icon: 'roots' },
  { id: 'fnextremum', group: 'functions', name: 'Extremum', help: 'Select a function', patterns: [['fn']], make: one('pts', s => `Extremum(${s[0]})`), icon: 'extremum' },

  { id: 'slider', group: 'other', name: 'Slider', key: 'n', help: 'Click where the slider should go', special: 'slider' },
  { id: 'text', group: 'other', name: 'Text', key: 't', help: 'Click where the text should go. Start with = for a live value, e.g. ="Area: " + poly1', special: 'text' },
  { id: 'showlabel', group: 'other', name: 'Show / Hide Label', help: 'Click objects to toggle their label', special: 'showlabel' },
  { id: 'showhide', group: 'other', name: 'Show / Hide Object', help: 'Click objects to hide them; hidden ones show faded while this tool is on', special: 'showhide' },
  { id: 'delete', group: 'other', name: 'Delete', key: 'x', help: 'Click objects to delete them (and what depends on them)', special: 'delete' },
  { id: 'zoomin', group: 'other', name: 'Zoom In', help: 'Click to zoom in there', special: 'zoomin' },
  { id: 'zoomout', group: 'other', name: 'Zoom Out', help: 'Click to zoom out there', special: 'zoomout' },
];

export const GROUPS = [
  ['move', 'Move'], ['points', 'Points'], ['lines', 'Lines'], ['special', 'Constructions'], ['olympiad', 'Olympiad'], ['polygons', 'Polygons'],
  ['circles', 'Circles & arcs'], ['conics', 'Conics'], ['measure', 'Measure'], ['transform', 'Transform'],
  ['functions', 'Functions'], ['other', 'Slider, text & view'],
];

for (const t of TOOLS) t.svg = ICON[t.icon || t.id];
export const TOOL = Object.fromEntries(TOOLS.map(t => [t.id, t]));
export { prime };
