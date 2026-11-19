// SVG map of Japan with a heat layer for the current estimate.
// Okinawa is drawn in an inset at the top left so the main islands can be
// shown larger.

import { geoMercator, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { feature, mesh } from 'topojson-client';

const SVG_NS = 'http://www.w3.org/2000/svg';
const WIDTH = 360;
const HEIGHT = 470;
const OKINAWA_PREF = '47';

// Geographic extents (lon/lat corners) the two views are fitted to.
const MAIN_EXTENT: [number, number][] = [
  [128.2, 27.0],
  [146.0, 45.7],
];
const INSET_EXTENT: [number, number][] = [
  [122.8, 24.0],
  [131.5, 27.9],
];
const INSET_BOX = { x: 6, y: 6, w: 132, h: 100 };

export interface HeatMap {
  element: SVGSVGElement;
  // Colours every cell by its probability (relative to the current maximum).
  update(probs: Float32Array): void;
  // Outlines the given cells (model cell indices); pass [] to clear.
  highlight(cells: number[]): void;
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

// Cold-to-hot ramp through three stops.
const RAMP: [number, number, number][] = [
  [214, 222, 230],
  [249, 199, 79],
  [214, 64, 40],
];

export function heatColor(t: number): string {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const seg = x < 0.5 ? 0 : 1;
  const u = x < 0.5 ? x * 2 : (x - 0.5) * 2;
  const a = RAMP[seg];
  const b = RAMP[seg + 1];
  return `rgb(${lerp(a[0], b[0], u)},${lerp(a[1], b[1], u)},${lerp(a[2], b[2], u)})`;
}

// Maps a probability to 0..1 for colouring. The square root keeps runners-up
// visible next to a strong leader.
export function heatLevel(prob: number, maxProb: number): number {
  if (!(maxProb > 0) || !(prob > 0)) return 0;
  return Math.sqrt(prob / maxProb);
}

function el<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

// `topology` is data/geo/japan.topo.json; `cellIds` is the model's cell
// order, so that probs[i] belongs to cellIds[i].
export function createHeatMap(topology: unknown, cellIds: string[], label: string): HeatMap {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topo = topology as any;
  const svg = el('svg');
  svg.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.classList.add('heatmap');

  const mainProj = geoMercator().fitExtent(
    [
      [4, 4],
      [WIDTH - 4, HEIGHT - 4],
    ],
    { type: 'MultiPoint', coordinates: MAIN_EXTENT },
  );
  const insetProj = geoMercator().fitExtent(
    [
      [INSET_BOX.x + 4, INSET_BOX.y + 4],
      [INSET_BOX.x + INSET_BOX.w - 4, INSET_BOX.y + INSET_BOX.h - 4],
    ],
    { type: 'MultiPoint', coordinates: INSET_EXTENT },
  );
  const mainPath = geoPath(mainProj);
  const insetPath = geoPath(insetProj);

  const frame = el('rect');
  frame.setAttribute('x', String(INSET_BOX.x));
  frame.setAttribute('y', String(INSET_BOX.y));
  frame.setAttribute('width', String(INSET_BOX.w));
  frame.setAttribute('height', String(INSET_BOX.h));
  frame.classList.add('heatmap-inset');
  svg.appendChild(frame);

  const cellLayer = el('g');
  svg.appendChild(cellLayer);
  const paths: (SVGPathElement | null)[] = new Array(cellIds.length).fill(null);
  const collection = feature(topo, topo.objects.cells) as unknown as {
    features: { id?: string | number; geometry: GeoPermissibleObjects }[];
  };
  for (let i = 0; i < collection.features.length; i++) {
    const f = collection.features[i];
    const id = String(f.id);
    const index = cellIds.indexOf(id);
    if (index < 0) continue;
    const isOkinawa = id.slice(0, 2) === OKINAWA_PREF;
    const d = (isOkinawa ? insetPath : mainPath)(f as unknown as GeoPermissibleObjects);
    if (d === null) continue;
    const p = el('path');
    p.setAttribute('d', d);
    p.classList.add('heatmap-cell');
    cellLayer.appendChild(p);
    paths[index] = p;
  }

  // Prefecture borders on the main view (Okinawa is a single prefecture).
  const borders = mesh(topo, topo.objects.prefs, (a: unknown, b: unknown) => a !== b);
  const borderPath = el('path');
  borderPath.setAttribute('d', mainPath(borders as unknown as GeoPermissibleObjects) ?? '');
  borderPath.classList.add('heatmap-border');
  svg.appendChild(borderPath);

  const highlightLayer = el('g');
  svg.appendChild(highlightLayer);

  return {
    element: svg,
    update(probs: Float32Array): void {
      let max = 0;
      for (let i = 0; i < probs.length; i++) if (probs[i] > max) max = probs[i];
      for (let i = 0; i < paths.length; i++) {
        const p = paths[i];
        if (p !== null) p.setAttribute('fill', heatColor(heatLevel(probs[i], max)));
      }
    },
    highlight(cells: number[]): void {
      while (highlightLayer.firstChild !== null) highlightLayer.removeChild(highlightLayer.firstChild);
      for (let i = 0; i < cells.length; i++) {
        const src = paths[cells[i]];
        if (src === null || src === undefined) continue;
        const p = el('path');
        p.setAttribute('d', src.getAttribute('d') ?? '');
        p.classList.add('heatmap-highlight');
        highlightLayer.appendChild(p);
      }
    },
  };
}
