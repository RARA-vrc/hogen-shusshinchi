// Shared helpers that turn data/geo into the cell part of a model, plus a
// synthetic question generator used to exercise the engine before (and
// independently of) the real question set.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelJson, ModelQuestionJson } from '../../src/engine/model.ts';
import { makeRng, nextFloat, nextInt } from './rng.ts';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface GeoCell {
  id: string;
  name: string;
  label: string;
  pref: string;
  lon: number;
  lat: number;
  population: number;
}

export interface Geo {
  cells: GeoCell[];
  prefCodes: string[];
  prefNames: string[];
  regionIds: string[];
  prefRegion: number[];
}

export function loadGeo(root: string): Geo {
  const cellsDoc = JSON.parse(readFileSync(join(root, 'data', 'geo', 'cells.json'), 'utf8'));
  const regionsDoc = JSON.parse(readFileSync(join(root, 'data', 'geo', 'regions.json'), 'utf8'));
  const prefCodes: string[] = [];
  const prefNames: string[] = [];
  for (let i = 0; i < cellsDoc.prefectures.length; i++) {
    prefCodes.push(cellsDoc.prefectures[i].code);
    prefNames.push(cellsDoc.prefectures[i].name);
  }
  const regionIds: string[] = [];
  const prefRegion: number[] = new Array(prefCodes.length).fill(-1);
  for (let r = 0; r < regionsDoc.regions.length; r++) {
    regionIds.push(regionsDoc.regions[r].id);
    const prefs: string[] = regionsDoc.regions[r].prefs;
    for (let k = 0; k < prefs.length; k++) {
      const p = prefCodes.indexOf(prefs[k]);
      if (p < 0) throw new Error(`regions.json: unknown prefecture ${prefs[k]}`);
      if (prefRegion[p] >= 0) throw new Error(`regions.json: prefecture ${prefs[k]} listed twice`);
      prefRegion[p] = r;
    }
  }
  for (let p = 0; p < prefCodes.length; p++) {
    if (prefRegion[p] < 0) throw new Error(`regions.json: prefecture ${prefCodes[p]} has no region`);
  }
  return { cells: cellsDoc.cells, prefCodes, prefNames, regionIds, prefRegion };
}

// Model skeleton (cells, priors, regions) without questions.
export function baseModel(geo: Geo, categories: string[]): ModelJson {
  const cellIds: string[] = [];
  const cellPref: number[] = [];
  const prior: number[] = [];
  let total = 0;
  for (let c = 0; c < geo.cells.length; c++) total += geo.cells[c].population;
  for (let c = 0; c < geo.cells.length; c++) {
    cellIds.push(geo.cells[c].id);
    cellPref.push(geo.prefCodes.indexOf(geo.cells[c].pref));
    prior.push(geo.cells[c].population / total);
  }
  return {
    version: 1,
    cellIds,
    cellPref,
    prior,
    prefCodes: geo.prefCodes,
    prefRegion: geo.prefRegion,
    regionIds: geo.regionIds,
    categories,
    questions: [],
  };
}

// Great-circle distance in km.
export function distanceKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function randomDistribution(rng: { state: number }, n: number, unknownShare: number): number[] {
  // n real options with one dominant answer, then "don't know" as the last.
  const out: number[] = [];
  const main = nextInt(rng, n);
  let sum = 0;
  for (let o = 0; o < n; o++) {
    const v = o === main ? 0.6 + 0.25 * nextFloat(rng) : 0.05 + 0.2 * nextFloat(rng);
    out.push(v);
    sum += v;
  }
  for (let o = 0; o < n; o++) out[o] = (out[o] / sum) * (1 - unknownShare);
  out.push(unknownShare);
  return out;
}

// Synthetic questions: each one separates a random circular zone from the
// rest of the country, with a soft boundary. These are NOT real dialect
// facts; they only give the engine something geographically structured to
// work on.
export function syntheticModel(geo: Geo, questionCount: number, seed: number): ModelJson {
  const categories = ['accent', 'grammar', 'vocab', 'unaware', 'culture', 'knowledge'];
  const model = baseModel(geo, categories);
  const rng = makeRng(seed);
  const cells = geo.cells;
  for (let q = 0; q < questionCount; q++) {
    const centre = cells[nextInt(rng, cells.length)];
    const radius = 80 + 520 * nextFloat(rng);
    const softness = 30 + 60 * nextFloat(rng);
    const real = 2 + nextInt(rng, 3);
    const inside = randomDistribution(rng, real, 0.05 + 0.1 * nextFloat(rng));
    const outside = randomDistribution(rng, real, 0.05 + 0.1 * nextFloat(rng));
    const options = real + 1;
    const lik: number[] = new Array(options * cells.length);
    for (let c = 0; c < cells.length; c++) {
      const d = distanceKm(centre.lon, centre.lat, cells[c].lon, cells[c].lat);
      const w = 1 / (1 + Math.exp((d - radius) / softness)); // 1 inside, 0 far outside
      for (let o = 0; o < options; o++) {
        lik[o * cells.length + c] = w * inside[o] + (1 - w) * outside[o];
      }
    }
    const question: ModelQuestionJson = {
      id: `synthetic-${q + 1}`,
      category: nextInt(rng, categories.length),
      fun: nextFloat(rng),
      options,
      lik,
    };
    model.questions.push(question);
  }
  return model;
}
