// Simulation of virtual respondents.
//
// A respondent from cell c answers each question by sampling from the
// model's own likelihood table P(answer | c); with probability `noise` the
// answer is instead picked uniformly at random. The engine then plays the
// game exactly as the app does.
//
// This measures the engine's internal consistency and how well the question
// set can tell cells apart IF the likelihood tables were true. It does not
// measure accuracy on real people.

import type { EngineConfig } from '../../src/engine/config.ts';
import {
  STOP_NONE,
  answer,
  createEngine,
  nextQuestion,
  prefProbs,
  reset,
  stopReason,
  topK,
} from '../../src/engine/engine.ts';
import type { Model } from '../../src/engine/model.ts';
import { makeRng, nextFloat, nextInt, type Rng } from './rng.ts';

export interface SimOptions {
  noise: number; // probability that an answer is uniformly random
  trialsPerCell: number;
  seed: number;
}

export interface SimStats {
  trials: number;
  // Population-weighted: each cell's results count in proportion to its prior.
  prefTop1: number;
  prefTop3: number;
  cellTop1: number;
  cellTop3: number;
  meanQuestions: number;
  // Unweighted: every cell counts the same.
  prefTop1Unweighted: number;
  cellTop1Unweighted: number;
}

function sampleAnswer(model: Model, rng: Rng, q: number, cell: number, noise: number): number {
  const n = model.qOptions[q];
  if (nextFloat(rng) < noise) return nextInt(rng, n);
  const r = nextFloat(rng);
  let acc = 0;
  for (let o = 0; o < n; o++) {
    acc += model.lik[model.qOffset[q] + o * model.cellCount + cell];
    if (r < acc) return o;
  }
  return n - 1;
}

export function simulate(model: Model, config: EngineConfig, opts: SimOptions): SimStats {
  const rng = makeRng(opts.seed);
  const e = createEngine(model, config);
  const prefP = new Float32Array(model.prefCount);
  const top = new Int32Array(3);
  const stats: SimStats = {
    trials: 0,
    prefTop1: 0,
    prefTop3: 0,
    cellTop1: 0,
    cellTop3: 0,
    meanQuestions: 0,
    prefTop1Unweighted: 0,
    cellTop1Unweighted: 0,
  };
  for (let cell = 0; cell < model.cellCount; cell++) {
    const w = model.prior[cell] / opts.trialsPerCell;
    const u = 1 / (model.cellCount * opts.trialsPerCell);
    for (let t = 0; t < opts.trialsPerCell; t++) {
      reset(e);
      while (stopReason(e) === STOP_NONE) {
        const q = nextQuestion(e);
        if (q < 0) break;
        answer(e, q, sampleAnswer(model, rng, q, cell, opts.noise));
      }
      let n = topK(e.post, model.cellCount, 3, top);
      if (top[0] === cell) {
        stats.cellTop1 += w;
        stats.cellTop1Unweighted += u;
      }
      for (let i = 0; i < n; i++) if (top[i] === cell) stats.cellTop3 += w;
      prefProbs(e, prefP);
      n = topK(prefP, model.prefCount, 3, top);
      if (top[0] === model.cellPref[cell]) {
        stats.prefTop1 += w;
        stats.prefTop1Unweighted += u;
      }
      for (let i = 0; i < n; i++) if (top[i] === model.cellPref[cell]) stats.prefTop3 += w;
      stats.meanQuestions += w * e.histLen;
      stats.trials++;
    }
  }
  return stats;
}
