// Turns question files (zones + default distribution) into per-cell answer
// likelihoods, with geographic smoothing across zone borders.

import { distanceKm, type Geo } from '../sim/geo-model.ts';

export const CATEGORIES = ['accent', 'grammar', 'vocab', 'unaware', 'culture', 'knowledge'];
export const CONFIDENCES = ['high', 'medium', 'low'];
export const UNKNOWN_ID = 'unknown';
export const UNVERIFIED = '未確認';

export const QUESTION_BUILD_CONFIG = {
  // Standard deviation (km) of the Gaussian used to blend neighbouring cells.
  smoothingKm: 15,
  // Published dialect maps mostly reflect older speakers, so no single answer
  // may be given a probability at or above this in a question file.
  maxProbability: 0.95,
  defaultUnknownText: 'わからない/どちらとも言えない',
  // Decimal places kept in the generated model.
  decimals: 4,
};

// Shared answer sets, selected with `preset:` in a question file.
export const PRESETS: Record<string, { id: string; text: string }[]> = {
  // "Do you say it yourself?" — keeps using and merely knowing apart.
  use3: [
    { id: 'use', text: '自分でも言う' },
    { id: 'hear', text: '自分は言わないが、地元でよく聞く' },
    { id: 'none', text: '地元では聞かない' },
  ],
  // "Do you know it?" — knowing it from home is strong evidence, not knowing
  // it says little.
  know3: [
    { id: 'local', text: '地元で普通に通じる' },
    { id: 'media', text: 'テレビやネットで知っているだけ' },
    { id: 'no', text: '知らない' },
  ],
};

export interface Zone {
  regions?: string[];
  prefs?: string[];
  cells?: string[];
  dist: Record<string, number>;
}

export interface QuestionFile {
  id: string;
  category: string;
  fun?: number;
  text: string;
  preset?: string;
  options?: { id: string; text: string }[];
  unknown_text?: string;
  distribution: { default: Record<string, number>; zones?: Zone[] };
  smoothing_km?: number;
  source: string;
  confidence: string;
  needs_review: boolean;
  notes?: string;
}

export function optionsOf(q: QuestionFile): { id: string; text: string }[] {
  if (q.preset !== undefined) {
    const preset = PRESETS[q.preset];
    if (preset === undefined) throw new Error(`${q.id}: unknown preset "${q.preset}"`);
    if (q.options !== undefined) throw new Error(`${q.id}: use either preset or options, not both`);
    return preset;
  }
  if (q.options === undefined) throw new Error(`${q.id}: options or preset is required`);
  return q.options;
}

// Converts a keyed distribution into an array ordered like the options, with
// "unknown" last. Reports problems into `errors`.
function distArray(
  q: QuestionFile,
  dist: Record<string, number>,
  where: string,
  ids: string[],
  errors: string[],
): number[] {
  const out: number[] = [];
  let sum = 0;
  const keys = Object.keys(dist ?? {});
  for (let i = 0; i < keys.length; i++) {
    if (ids.indexOf(keys[i]) < 0) errors.push(`${q.id}: ${where}: unknown answer id "${keys[i]}"`);
  }
  for (let i = 0; i < ids.length; i++) {
    const v = dist === undefined ? undefined : dist[ids[i]];
    if (typeof v !== 'number' || !(v >= 0)) {
      errors.push(`${q.id}: ${where}: missing or invalid probability for "${ids[i]}"`);
      out.push(0);
      continue;
    }
    if (v >= QUESTION_BUILD_CONFIG.maxProbability) {
      errors.push(`${q.id}: ${where}: "${ids[i]}" = ${v} is too extreme (limit ${QUESTION_BUILD_CONFIG.maxProbability})`);
    }
    out.push(v);
    sum += v;
  }
  if (Math.abs(sum - 1) > 1e-6) errors.push(`${q.id}: ${where}: probabilities sum to ${sum.toFixed(4)}, expected 1`);
  return out;
}

// Checks one question file. Returns a list of problems (empty if valid).
export function validateQuestion(q: QuestionFile, geo: Geo): string[] {
  const errors: string[] = [];
  const need = ['id', 'category', 'text', 'distribution', 'source', 'confidence'];
  for (let i = 0; i < need.length; i++) {
    if ((q as unknown as Record<string, unknown>)[need[i]] === undefined) {
      errors.push(`${q.id ?? '(no id)'}: field "${need[i]}" is required`);
    }
  }
  if (errors.length > 0) return errors;
  if (CATEGORIES.indexOf(q.category) < 0) errors.push(`${q.id}: unknown category "${q.category}"`);
  if (CONFIDENCES.indexOf(q.confidence) < 0) errors.push(`${q.id}: unknown confidence "${q.confidence}"`);
  if (typeof q.needs_review !== 'boolean') errors.push(`${q.id}: needs_review must be true or false`);
  if (typeof q.source !== 'string' || q.source.trim() === '') errors.push(`${q.id}: source must not be empty`);
  if (q.source === UNVERIFIED && q.needs_review !== true) {
    errors.push(`${q.id}: an unverified source requires needs_review: true`);
  }
  if (q.confidence === 'low' && q.needs_review !== true) {
    errors.push(`${q.id}: low confidence requires needs_review: true`);
  }
  if (q.fun !== undefined && !(q.fun >= 0 && q.fun <= 1)) errors.push(`${q.id}: fun must be between 0 and 1`);

  let options: { id: string; text: string }[];
  try {
    options = optionsOf(q);
  } catch (err) {
    errors.push((err as Error).message);
    return errors;
  }
  if (options.length < 2 || options.length > 5) errors.push(`${q.id}: needs 2 to 5 options (plus "unknown")`);
  const ids: string[] = [];
  for (let i = 0; i < options.length; i++) {
    if (options[i].id === UNKNOWN_ID) errors.push(`${q.id}: "${UNKNOWN_ID}" is reserved`);
    if (ids.indexOf(options[i].id) >= 0) errors.push(`${q.id}: duplicate option id "${options[i].id}"`);
    if (typeof options[i].text !== 'string' || options[i].text === '') errors.push(`${q.id}: option text is empty`);
    ids.push(options[i].id);
  }
  ids.push(UNKNOWN_ID);

  distArray(q, q.distribution.default, 'default', ids, errors);
  const zones = q.distribution.zones ?? [];
  for (let z = 0; z < zones.length; z++) {
    const zone = zones[z];
    const where = `zone ${z + 1}`;
    distArray(q, zone.dist, where, ids, errors);
    const regions = zone.regions ?? [];
    const prefs = zone.prefs ?? [];
    const cells = zone.cells ?? [];
    if (regions.length + prefs.length + cells.length === 0) errors.push(`${q.id}: ${where}: lists no area`);
    for (let i = 0; i < regions.length; i++) {
      if (geo.regionIds.indexOf(regions[i]) < 0) errors.push(`${q.id}: ${where}: unknown region "${regions[i]}"`);
    }
    for (let i = 0; i < prefs.length; i++) {
      if (geo.prefCodes.indexOf(prefs[i]) < 0) errors.push(`${q.id}: ${where}: unknown prefecture "${prefs[i]}"`);
    }
    for (let i = 0; i < cells.length; i++) {
      let found = false;
      for (let c = 0; c < geo.cells.length; c++) if (geo.cells[c].id === cells[i]) found = true;
      if (!found) errors.push(`${q.id}: ${where}: unknown cell "${cells[i]}"`);
    }
  }
  return errors;
}

// Assigns every cell the distribution of its zone, or the default.
// A cell listed by id beats a prefecture match, which beats a region match.
// Two zones claiming a cell at the same level is an error.
// Returns raw[cell][option] with "unknown" as the last option.
export function expandZones(q: QuestionFile, geo: Geo): number[][] {
  const options = optionsOf(q);
  const ids: string[] = [];
  for (let i = 0; i < options.length; i++) ids.push(options[i].id);
  ids.push(UNKNOWN_ID);
  const errors: string[] = [];
  const base = distArray(q, q.distribution.default, 'default', ids, errors);
  const zones = q.distribution.zones ?? [];
  const zoneDist: number[][] = [];
  for (let z = 0; z < zones.length; z++) zoneDist.push(distArray(q, zones[z].dist, `zone ${z + 1}`, ids, errors));
  if (errors.length > 0) throw new Error(errors.join('\n'));

  const raw: number[][] = [];
  for (let c = 0; c < geo.cells.length; c++) {
    const cell = geo.cells[c];
    const region = geo.regionIds[geo.prefRegion[geo.prefCodes.indexOf(cell.pref)]];
    let bestLevel = 0;
    let bestZone = -1;
    let tie = false;
    for (let z = 0; z < zones.length; z++) {
      let level = 0;
      if ((zones[z].regions ?? []).indexOf(region) >= 0) level = 1;
      if ((zones[z].prefs ?? []).indexOf(cell.pref) >= 0) level = 2;
      if ((zones[z].cells ?? []).indexOf(cell.id) >= 0) level = 3;
      if (level === 0) continue;
      if (level > bestLevel) {
        bestLevel = level;
        bestZone = z;
        tie = false;
      } else if (level === bestLevel) {
        tie = true;
      }
    }
    if (tie) throw new Error(`${q.id}: cell ${cell.id} (prefecture ${cell.pref}) is claimed by two zones at the same level`);
    raw.push(bestZone >= 0 ? zoneDist[bestZone] : base);
  }
  return raw;
}

// Blends each cell with its neighbours using Gaussian weights on the
// distance between representative points. sigmaKm <= 0 disables smoothing.
// Rows keep summing to 1 because every row of `raw` does.
export function smooth(raw: number[][], geo: Geo, sigmaKm: number): number[][] {
  const n = geo.cells.length;
  if (!(sigmaKm > 0)) {
    const copy: number[][] = [];
    for (let c = 0; c < n; c++) copy.push(raw[c].slice());
    return copy;
  }
  const k = raw[0].length;
  const out: number[][] = [];
  const cutoff = sigmaKm * 4; // beyond this the weight is negligible
  for (let c = 0; c < n; c++) {
    const acc: number[] = new Array(k).fill(0);
    let wSum = 0;
    for (let j = 0; j < n; j++) {
      const d = j === c ? 0 : distanceKm(geo.cells[c].lon, geo.cells[c].lat, geo.cells[j].lon, geo.cells[j].lat);
      if (d > cutoff) continue;
      const w = Math.exp(-(d * d) / (2 * sigmaKm * sigmaKm));
      wSum += w;
      for (let o = 0; o < k; o++) acc[o] += w * raw[j][o];
    }
    for (let o = 0; o < k; o++) acc[o] = acc[o] / wSum;
    out.push(acc);
  }
  return out;
}

// Option-major flat table for the model: lik[o * cellCount + c].
export function toLikelihoodTable(perCell: number[][], decimals: number): number[] {
  const n = perCell.length;
  const k = perCell[0].length;
  const f = Math.pow(10, decimals);
  const lik: number[] = new Array(n * k);
  for (let c = 0; c < n; c++) {
    for (let o = 0; o < k; o++) lik[o * n + c] = Math.round(perCell[c][o] * f) / f;
  }
  return lik;
}
