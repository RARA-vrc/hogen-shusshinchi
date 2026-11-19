// Bayesian inference engine.
//
//   posterior(cell) ∝ prior(cell) × Π P(answer_i | cell)
//
// PORTING NOTE (UdonSharp): this file must stay free of DOM access, external
// libraries, closures, higher-order functions, Map/Set and generics. State is
// kept in flat typed arrays and everything is written as plain for-loops so
// it can be translated to U# line by line (Float32Array -> float[],
// Int32Array -> int[], Uint8Array -> bool[] / byte[]).

import type { EngineConfig } from './config.ts';
import type { Model } from './model.ts';

export const STOP_NONE = 0;
export const STOP_TOP_PROB = 1; // most likely cell is confident enough
export const STOP_MAX_QUESTIONS = 2;
export const STOP_LOW_GAIN = 3; // no question left that is worth asking

export const LEVEL_REGION = 0;
export const LEVEL_PREF = 1;
export const LEVEL_CELL = 2;

export interface Engine {
  model: Model;
  config: EngineConfig;
  // Likelihoods with the epsilon floor applied, same layout as model.lik.
  eff: Float32Array;
  post: Float32Array; // [cellCount] current posterior
  asked: Uint8Array; // [questionCount] 1 if already answered
  histQ: Int32Array; // answered question indices, in order
  histA: Int32Array; // chosen option per answered question
  histLen: number;
  // Raw expected gain (bits) of the question returned by the last
  // nextQuestion() call; 0 if none.
  lastBestGain: number;
  scratch: Float32Array; // [cellCount]
}

// Applies the floor so that every option keeps at least `epsilon`
// probability while each cell's options still sum to 1:
//   eff = epsilon + (1 - K * epsilon) * p        (K = number of options)
// This equals "with probability K * epsilon the person answers at random".
export function applyFloor(model: Model, epsilon: number, out: Float32Array): void {
  for (let q = 0; q < model.questionCount; q++) {
    const n = model.qOptions[q];
    const scale = 1 - n * epsilon;
    if (epsilon < 0 || scale <= 0) {
      throw new Error('engine: epsilon must be >= 0 and smaller than 1 / (number of options)');
    }
    const start = model.qOffset[q];
    const count = n * model.cellCount;
    for (let i = 0; i < count; i++) {
      out[start + i] = epsilon + scale * model.lik[start + i];
    }
  }
}

export function createEngine(model: Model, config: EngineConfig): Engine {
  const eff = new Float32Array(model.lik.length);
  applyFloor(model, config.epsilon, eff);
  const e: Engine = {
    model,
    config,
    eff,
    post: new Float32Array(model.cellCount),
    asked: new Uint8Array(model.questionCount),
    histQ: new Int32Array(model.questionCount),
    histA: new Int32Array(model.questionCount),
    histLen: 0,
    lastBestGain: 0,
    scratch: new Float32Array(model.cellCount),
  };
  reset(e);
  return e;
}

export function reset(e: Engine): void {
  e.histLen = 0;
  recompute(e);
}

// Scales p[0..n) to sum to 1. Returns false (and leaves p untouched) if the
// sum is not positive.
export function normalize(p: Float32Array, n: number): boolean {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += p[i];
  if (!(sum > 0)) return false;
  for (let i = 0; i < n; i++) p[i] = p[i] / sum;
  return true;
}

function applyAnswer(e: Engine, q: number, a: number): void {
  const m = e.model;
  const base = m.qOffset[q] + a * m.cellCount;
  for (let c = 0; c < m.cellCount; c++) {
    e.post[c] = e.post[c] * e.eff[base + c];
  }
  if (!normalize(e.post, m.cellCount)) {
    // Cannot happen while epsilon > 0; fall back to the prior to stay valid.
    for (let c = 0; c < m.cellCount; c++) e.post[c] = m.prior[c];
  }
}

// Rebuilds the posterior and the asked flags from the answer history. Used
// for undo, and after loading a saved history.
export function recompute(e: Engine): void {
  const m = e.model;
  for (let c = 0; c < m.cellCount; c++) e.post[c] = m.prior[c];
  for (let q = 0; q < m.questionCount; q++) e.asked[q] = 0;
  for (let i = 0; i < e.histLen; i++) {
    e.asked[e.histQ[i]] = 1;
    applyAnswer(e, e.histQ[i], e.histA[i]);
  }
}

// Records an answer and updates the posterior. Returns false if the question
// or option is invalid or the question was already answered.
export function answer(e: Engine, q: number, a: number): boolean {
  const m = e.model;
  if (q < 0 || q >= m.questionCount) return false;
  if (a < 0 || a >= m.qOptions[q]) return false;
  if (e.asked[q] !== 0) return false;
  e.histQ[e.histLen] = q;
  e.histA[e.histLen] = a;
  e.histLen = e.histLen + 1;
  e.asked[q] = 1;
  applyAnswer(e, q, a);
  return true;
}

// Takes back the most recent answer. Returns false if there is none.
export function undo(e: Engine): boolean {
  if (e.histLen === 0) return false;
  e.histLen = e.histLen - 1;
  recompute(e);
  return true;
}

// Shannon entropy in bits of p[0..n) (p must sum to 1).
export function entropyBits(p: Float32Array, n: number): number {
  let h = 0;
  for (let i = 0; i < n; i++) {
    const v = p[i];
    if (v > 0) h -= v * Math.log2(v);
  }
  return h;
}

// Expected reduction of posterior entropy (bits) from asking question q:
//   H(post) - Σ_o P(o) × H(post | o)
export function expectedGain(e: Engine, q: number): number {
  const m = e.model;
  const n = m.qOptions[q];
  const cells = m.cellCount;
  const before = entropyBits(e.post, cells);
  let after = 0;
  for (let o = 0; o < n; o++) {
    const base = m.qOffset[q] + o * cells;
    let pOption = 0;
    for (let c = 0; c < cells; c++) {
      const v = e.post[c] * e.eff[base + c];
      e.scratch[c] = v;
      pOption += v;
    }
    if (pOption > 0) {
      let h = 0;
      for (let c = 0; c < cells; c++) {
        const v = e.scratch[c] / pOption;
        if (v > 0) h -= v * Math.log2(v);
      }
      after += pOption * h;
    }
  }
  const gain = before - after;
  return gain > 0 ? gain : 0;
}

// Number of most recent answers whose question has the given category,
// counted back from the latest answer until a different category appears.
export function categoryStreak(e: Engine, category: number): number {
  let n = 0;
  for (let i = e.histLen - 1; i >= 0; i--) {
    if (e.model.qCategory[e.histQ[i]] !== category) break;
    n++;
  }
  return n;
}

// Selection score: expected gain, reduced when the category repeats and
// optionally boosted by the question's fun value.
export function questionScore(e: Engine, q: number, gain: number): number {
  let score = gain;
  const streak = categoryStreak(e, e.model.qCategory[q]);
  for (let i = 0; i < streak; i++) score = score * e.config.categoryPenalty;
  return score * (1 + e.config.funWeight * e.model.qFun[q]);
}

// Returns the unanswered question with the best score, or -1 if every
// question has been answered. Stores that question's raw (unpenalized) gain
// in e.lastBestGain.
export function nextQuestion(e: Engine): number {
  let best = -1;
  let bestScore = -1;
  let bestGain = 0;
  for (let q = 0; q < e.model.questionCount; q++) {
    if (e.asked[q] !== 0) continue;
    const gain = expectedGain(e, q);
    const score = questionScore(e, q, gain);
    if (score > bestScore) {
      bestScore = score;
      best = q;
      bestGain = gain;
    }
  }
  e.lastBestGain = bestGain;
  return best;
}

// Largest expected gain among unanswered questions (0 if none are left).
export function maxRemainingGain(e: Engine): number {
  let best = 0;
  for (let q = 0; q < e.model.questionCount; q++) {
    if (e.asked[q] !== 0) continue;
    const gain = expectedGain(e, q);
    if (gain > best) best = gain;
  }
  return best;
}

export function topCell(e: Engine): number {
  let best = 0;
  for (let c = 1; c < e.model.cellCount; c++) {
    if (e.post[c] > e.post[best]) best = c;
  }
  return best;
}

// Why the game should stop now, or STOP_NONE to keep asking.
export function stopReason(e: Engine): number {
  if (e.post[topCell(e)] >= e.config.stopTopCellProb) return STOP_TOP_PROB;
  if (e.histLen >= e.config.maxQuestions) return STOP_MAX_QUESTIONS;
  if (maxRemainingGain(e) < e.config.minGainBits) return STOP_LOW_GAIN;
  return STOP_NONE;
}

// Sums probabilities by group: out[g] = Σ p[i] over items with groupOf[i] = g.
export function sumByGroup(
  p: Float32Array,
  groupOf: Int32Array,
  itemCount: number,
  groupCount: number,
  out: Float32Array,
): void {
  for (let g = 0; g < groupCount; g++) out[g] = 0;
  for (let i = 0; i < itemCount; i++) out[groupOf[i]] += p[i];
}

export function prefProbs(e: Engine, out: Float32Array): void {
  sumByGroup(e.post, e.model.cellPref, e.model.cellCount, e.model.prefCount, out);
}

export function regionProbs(e: Engine, out: Float32Array): void {
  sumByGroup(e.post, e.model.cellRegion, e.model.cellCount, e.model.regionCount, out);
}

// Writes the indices of the k largest values of p[0..n) into out, in
// descending order (ties: lower index first). Returns how many were written.
export function topK(p: Float32Array, n: number, k: number, out: Int32Array): number {
  let count = 0;
  for (let i = 0; i < n; i++) {
    let pos = count;
    while (pos > 0 && p[i] > p[out[pos - 1]]) pos--;
    if (pos >= k) continue;
    const last = count < k ? count : k - 1;
    for (let j = last; j > pos; j--) out[j] = out[j - 1];
    out[pos] = i;
    if (count < k) count++;
  }
  return count;
}

// How precisely the result should be stated, given the current posterior.
// `prefScratch` must hold at least prefCount values.
export function resultLevel(e: Engine, prefScratch: Float32Array): number {
  if (e.post[topCell(e)] >= e.config.cellConfident) return LEVEL_CELL;
  prefProbs(e, prefScratch);
  let best = 0;
  for (let p = 1; p < e.model.prefCount; p++) {
    if (prefScratch[p] > prefScratch[best]) best = p;
  }
  if (prefScratch[best] >= e.config.prefConfident) return LEVEL_PREF;
  return LEVEL_REGION;
}
