// The host character, drawn as SVG so the expression can change.
// Black hair with parted bangs, blue hoodie over a white shirt, dog tag.
// To replace it with illustrations later, swap this module for one that
// returns an <img> per expression.

export type Expression = 'smile' | 'think' | 'confident' | 'happy' | 'surprise' | 'sorry';

export const EXPRESSIONS: Expression[] = ['smile', 'think', 'confident', 'happy', 'surprise', 'sorry'];

const NS = 'http://www.w3.org/2000/svg';

type Part = [string, Record<string, string>];

const INK = '#1b1b1f';
const SKIN = '#fde6d4';
const HOODIE = '#3d55a5';
const HOODIE_DARK = '#2c3f80';

const BASE: Part[] = [
  // hoodie, shirt, dog tag
  ['path', { d: 'M10 96 C10 76 24 66 48 66 C72 66 86 76 86 96 Z', fill: HOODIE, stroke: INK, 'stroke-width': '1.6' }],
  ['path', { d: 'M38 66 L48 82 L58 66 Z', fill: '#ffffff', stroke: INK, 'stroke-width': '1.2' }],
  ['path', { d: 'M38 66 L44 96 M58 66 L52 96', fill: 'none', stroke: HOODIE_DARK, 'stroke-width': '1.4' }],
  ['path', { d: 'M44 72 L48 84 L52 72', fill: 'none', stroke: '#8a8f98', 'stroke-width': '0.9' }],
  ['rect', { x: '46', y: '83', width: '4.4', height: '6.4', rx: '1', fill: '#8a8f98', stroke: INK, 'stroke-width': '0.7' }],
  // back hair
  ['path', { d: 'M17 50 C12 22 30 7 49 8 C70 8 84 24 79 52 C78 60 74 62 72 56 L24 56 C21 62 18 58 17 50 Z', fill: INK }],
  ['path', { d: 'M44 9 C44 4 50 3 52 6', fill: 'none', stroke: INK, 'stroke-width': '1.6', 'stroke-linecap': 'round' }],
  // ear and face
  ['ellipse', { cx: '22', cy: '53', rx: '4', ry: '5', fill: SKIN, stroke: INK, 'stroke-width': '1.2' }],
  ['path', { d: 'M24 44 C22 62 34 73 48 73 C62 73 74 62 72 44 C66 30 30 30 24 44 Z', fill: SKIN, stroke: INK, 'stroke-width': '1.4' }],
  // bangs, parted right of centre
  ['path', { d: 'M20 48 C18 26 34 12 50 13 C52 26 46 40 38 50 C37 44 35 40 32 38 C30 44 26 48 20 48 Z', fill: INK }],
  ['path', { d: 'M50 13 C66 12 80 26 76 50 C72 46 70 42 69 37 C66 42 62 46 58 48 C59 36 56 24 50 13 Z', fill: INK }],
  // blush
  ['ellipse', { cx: '32', cy: '60', rx: '5', ry: '2.6', fill: '#f6a5a0', opacity: '0.55' }],
  ['ellipse', { cx: '64', cy: '60', rx: '5', ry: '2.6', fill: '#f6a5a0', opacity: '0.55' }],
];

const LINE = { fill: 'none', stroke: INK, 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };

function line(d: string): Part {
  return ['path', { d, ...LINE }];
}

const CLOSED_EYES: Part[] = [line('M32 54 Q37 49 42 54'), line('M54 54 Q59 49 64 54')];
const OPEN_EYES: Part[] = [
  ['ellipse', { cx: '37', cy: '53', rx: '2.6', ry: '3.4', fill: INK }],
  ['ellipse', { cx: '59', cy: '53', rx: '2.6', ry: '3.4', fill: INK }],
  ['circle', { cx: '38', cy: '51.8', r: '0.9', fill: '#ffffff' }],
  ['circle', { cx: '60', cy: '51.8', r: '0.9', fill: '#ffffff' }],
];

const THUMB: Part[] = [
  ['path', { d: 'M74 92 C70 86 72 78 78 78 L80 70 C81 66 86 67 85 72 L84 78 C90 78 92 84 90 92 Z', fill: SKIN, stroke: INK, 'stroke-width': '1.4', 'stroke-linejoin': 'round' }],
  line('M78 82 L88 82 M78 86 L89 86'),
];

const FACES: Record<Expression, Part[]> = {
  smile: [...CLOSED_EYES, line('M43 63 Q48 67 53 63')],
  think: [
    ['ellipse', { cx: '38', cy: '52', rx: '2.4', ry: '3.2', fill: INK }],
    ['ellipse', { cx: '60', cy: '52', rx: '2.4', ry: '3.2', fill: INK }],
    ['circle', { cx: '39', cy: '50.6', r: '0.9', fill: '#ffffff' }],
    ['circle', { cx: '61', cy: '50.6', r: '0.9', fill: '#ffffff' }],
    line('M54 45 L64 43'),
    line('M45 65 L52 64'),
    ['circle', { cx: '80', cy: '30', r: '1.6', fill: INK }],
    ['circle', { cx: '86', cy: '24', r: '2.2', fill: INK }],
    ['circle', { cx: '92', cy: '16', r: '2.8', fill: INK }],
  ],
  confident: [
    ...OPEN_EYES,
    line('M31 46 L42 47 M54 47 L65 46'),
    line('M42 63 Q48 69 54 63'),
    ['path', { d: 'M84 20 L86 26 L92 28 L86 30 L84 36 L82 30 L76 28 L82 26 Z', fill: '#f4b942', stroke: INK, 'stroke-width': '0.8' }],
  ],
  happy: [
    ...CLOSED_EYES,
    line('M43 62 Q45.5 65 48 62 Q50.5 65 53 62'),
    ['path', { d: 'M45.5 64 Q48 70 50.5 64 Z', fill: '#f08a8a', stroke: INK, 'stroke-width': '1' }],
    ...THUMB,
  ],
  surprise: [
    ['circle', { cx: '37', cy: '53', r: '3.6', fill: '#ffffff', stroke: INK, 'stroke-width': '1.4' }],
    ['circle', { cx: '59', cy: '53', r: '3.6', fill: '#ffffff', stroke: INK, 'stroke-width': '1.4' }],
    ['circle', { cx: '37', cy: '53', r: '1.4', fill: INK }],
    ['circle', { cx: '59', cy: '53', r: '1.4', fill: INK }],
    ['ellipse', { cx: '48', cy: '65', rx: '2.6', ry: '3.4', fill: '#8a3b3b', stroke: INK, 'stroke-width': '1.2' }],
    line('M84 18 L88 10 M90 24 L98 20'),
  ],
  sorry: [
    line('M32 51 Q37 56 42 51'),
    line('M54 51 Q59 56 64 51'),
    line('M31 45 L41 47 M65 45 L55 47'),
    line('M43 65 Q45.5 62 48 65 Q50.5 68 53 65'),
    ['path', { d: 'M76 34 C72 40 73 45 76.5 45 C80 45 80 40 76 34 Z', fill: '#8fc8f0', stroke: INK, 'stroke-width': '0.9' }],
  ],
};

export function hostFace(expression: Expression): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 96');
  svg.setAttribute('class', `face face-${expression}`);
  const parts = BASE.concat(FACES[expression]);
  for (let i = 0; i < parts.length; i++) {
    const node = document.createElementNS(NS, parts[i][0]);
    const names = Object.keys(parts[i][1]);
    for (let k = 0; k < names.length; k++) node.setAttribute(names[k], parts[i][1][names[k]]);
    svg.appendChild(node);
  }
  return svg;
}
