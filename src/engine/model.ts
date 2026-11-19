// Model data: cells, priors and per-question answer likelihoods.
//
// PORTING NOTE (UdonSharp): the JSON below uses only objects, arrays, strings
// and numbers so VRCJson (DataDictionary / DataList) can read it. `Model`
// holds the same data as flat typed arrays; in U# these become float[] /
// int[] fields. No Map/Set, closures or generics are used in src/engine.

export interface ModelQuestionJson {
  id: string;
  category: number; // index into ModelJson.categories
  fun: number; // 0..1, optional weight for question selection
  options: number; // number of answers, including "don't know" as the last one
  // options * cellCount numbers, option-major: lik[o * cellCount + c] is
  // P(answer o | home cell c). For every cell the options sum to 1.
  lik: number[];
}

export interface ModelJson {
  version: number;
  cellIds: string[];
  cellPref: number[]; // index into prefCodes, per cell
  prior: number[]; // per cell, sums to 1 (population share)
  prefCodes: string[];
  prefRegion: number[]; // index into regionIds, per prefecture
  regionIds: string[];
  categories: string[];
  questions: ModelQuestionJson[];
}

export interface Model {
  cellCount: number;
  prefCount: number;
  regionCount: number;
  questionCount: number;
  maxOptions: number;
  prior: Float32Array; // [cellCount]
  cellPref: Int32Array; // [cellCount]
  cellRegion: Int32Array; // [cellCount]
  prefRegion: Int32Array; // [prefCount]
  qOptions: Int32Array; // [questionCount]
  qCategory: Int32Array; // [questionCount]
  qFun: Float32Array; // [questionCount]
  qOffset: Int32Array; // [questionCount] start of each question in `lik`
  lik: Float32Array; // concatenated likelihood tables
}

const SUM_TOLERANCE = 1e-3;

export function modelFromJson(json: ModelJson): Model {
  const cellCount = json.cellIds.length;
  const prefCount = json.prefCodes.length;
  const regionCount = json.regionIds.length;
  const questionCount = json.questions.length;
  if (json.cellPref.length !== cellCount || json.prior.length !== cellCount) {
    throw new Error('model: per-cell arrays have inconsistent lengths');
  }
  if (json.prefRegion.length !== prefCount) {
    throw new Error('model: prefRegion length does not match prefCodes');
  }

  const prior = new Float32Array(cellCount);
  const cellPref = new Int32Array(cellCount);
  const cellRegion = new Int32Array(cellCount);
  const prefRegion = new Int32Array(prefCount);
  for (let p = 0; p < prefCount; p++) {
    if (json.prefRegion[p] < 0 || json.prefRegion[p] >= regionCount) {
      throw new Error('model: prefRegion out of range');
    }
    prefRegion[p] = json.prefRegion[p];
  }
  let priorSum = 0;
  for (let c = 0; c < cellCount; c++) {
    if (json.cellPref[c] < 0 || json.cellPref[c] >= prefCount) {
      throw new Error('model: cellPref out of range');
    }
    if (!(json.prior[c] >= 0)) throw new Error('model: negative or invalid prior');
    cellPref[c] = json.cellPref[c];
    cellRegion[c] = prefRegion[cellPref[c]];
    priorSum += json.prior[c];
  }
  if (!(priorSum > 0)) throw new Error('model: prior sums to zero');
  for (let c = 0; c < cellCount; c++) prior[c] = json.prior[c] / priorSum;

  const qOptions = new Int32Array(questionCount);
  const qCategory = new Int32Array(questionCount);
  const qFun = new Float32Array(questionCount);
  const qOffset = new Int32Array(questionCount);
  let total = 0;
  let maxOptions = 0;
  for (let q = 0; q < questionCount; q++) {
    const jq = json.questions[q];
    if (jq.options < 2) throw new Error(`model: question ${jq.id} needs at least 2 options`);
    if (jq.lik.length !== jq.options * cellCount) {
      throw new Error(`model: question ${jq.id} has a likelihood table of the wrong size`);
    }
    if (jq.category < 0 || jq.category >= json.categories.length) {
      throw new Error(`model: question ${jq.id} has an unknown category`);
    }
    qOptions[q] = jq.options;
    qCategory[q] = jq.category;
    qFun[q] = jq.fun;
    qOffset[q] = total;
    total += jq.lik.length;
    if (jq.options > maxOptions) maxOptions = jq.options;
  }

  const lik = new Float32Array(total);
  for (let q = 0; q < questionCount; q++) {
    const jq = json.questions[q];
    const n = jq.options;
    for (let c = 0; c < cellCount; c++) {
      let sum = 0;
      for (let o = 0; o < n; o++) {
        const v = jq.lik[o * cellCount + c];
        if (!(v >= 0)) throw new Error(`model: question ${jq.id} has a negative or invalid likelihood`);
        sum += v;
      }
      if (sum < 1 - SUM_TOLERANCE || sum > 1 + SUM_TOLERANCE) {
        throw new Error(`model: question ${jq.id}, cell ${c}: options sum to ${sum}, expected 1`);
      }
      for (let o = 0; o < n; o++) {
        lik[qOffset[q] + o * cellCount + c] = jq.lik[o * cellCount + c] / sum;
      }
    }
  }

  return {
    cellCount,
    prefCount,
    regionCount,
    questionCount,
    maxOptions,
    prior,
    cellPref,
    cellRegion,
    prefRegion,
    qOptions,
    qCategory,
    qFun,
    qOffset,
    lik,
  };
}
