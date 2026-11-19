import { describe, expect, it } from 'vitest';
import { defaultConfig, type EngineConfig } from '../src/engine/config.ts';
import {
  LEVEL_CELL,
  LEVEL_PREF,
  LEVEL_REGION,
  STOP_LOW_GAIN,
  STOP_MAX_QUESTIONS,
  STOP_NONE,
  STOP_TOP_PROB,
  answer,
  applyFloor,
  categoryStreak,
  createEngine,
  entropyBits,
  expectedGain,
  nextQuestion,
  normalize,
  prefProbs,
  questionScore,
  regionProbs,
  resultLevel,
  stopReason,
  sumByGroup,
  topCell,
  topK,
  undo,
} from '../src/engine/engine.ts';
import { modelFromJson, type ModelJson } from '../src/engine/model.ts';

// Four cells: 0,1 in prefecture A (region East), 2 in B (East), 3 in C (West).
// Likelihood tables are option-major: [option0 for cells 0..3, option1 ...].
function testModel(): ModelJson {
  return {
    version: 1,
    cellIds: ['a1', 'a2', 'b1', 'c1'],
    cellPref: [0, 0, 1, 2],
    prior: [0.25, 0.25, 0.25, 0.25],
    prefCodes: ['A', 'B', 'C'],
    prefRegion: [0, 0, 1],
    regionIds: ['east', 'west'],
    categories: ['vocab', 'grammar'],
    questions: [
      // q0 "broad": splits east (cells 0-2) from west (cell 3)
      { id: 'broad', category: 0, fun: 0, options: 2, lik: [0.9, 0.9, 0.9, 0.1, 0.1, 0.1, 0.1, 0.9] },
      // q1 "local": only tells cell 0 from cell 1; says nothing elsewhere
      { id: 'local', category: 0, fun: 1, options: 2, lik: [0.9, 0.1, 0.5, 0.5, 0.1, 0.9, 0.5, 0.5] },
      // q2 "half": splits cells {0,1} from {2,3}, three options incl. don't know
      {
        id: 'half',
        category: 1,
        fun: 0,
        options: 3,
        lik: [0.8, 0.8, 0.1, 0.1, 0.1, 0.1, 0.8, 0.8, 0.1, 0.1, 0.1, 0.1],
      },
      // q3 "noise": identical everywhere, carries no information
      { id: 'noise', category: 1, fun: 0, options: 2, lik: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5] },
    ],
  };
}

function config(overrides: Partial<EngineConfig>): EngineConfig {
  return { ...defaultConfig(), ...overrides };
}

function sum(p: Float32Array): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += p[i];
  return s;
}

function h2(p: number): number {
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
}

describe('model loading', () => {
  it('normalizes the prior and derives the region of each cell', () => {
    const json = testModel();
    json.prior = [2, 2, 2, 2];
    const m = modelFromJson(json);
    expect(Array.from(m.prior)).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(Array.from(m.cellRegion)).toEqual([0, 0, 0, 1]);
    expect(m.maxOptions).toBe(3);
  });

  it('rejects tables whose options do not sum to 1 or have the wrong size', () => {
    const bad = testModel();
    bad.questions[0].lik[0] = 0.5;
    expect(() => modelFromJson(bad)).toThrow();
    const short = testModel();
    short.questions[0].lik.pop();
    expect(() => modelFromJson(short)).toThrow();
  });
});

describe('normalization', () => {
  it('normalize scales to sum 1 and refuses an all-zero vector', () => {
    const p = new Float32Array([1, 3, 0, 4]);
    expect(normalize(p, 4)).toBe(true);
    expect(Array.from(p)).toEqual([0.125, 0.375, 0, 0.5]);
    expect(normalize(new Float32Array(3), 3)).toBe(false);
  });

  it('the posterior sums to 1 before and after every answer', () => {
    const e = createEngine(modelFromJson(testModel()), config({}));
    expect(sum(e.post)).toBeCloseTo(1, 6);
    answer(e, 0, 1);
    expect(sum(e.post)).toBeCloseTo(1, 6);
    answer(e, 2, 2);
    expect(sum(e.post)).toBeCloseTo(1, 6);
  });

  it('matches Bayes rule computed by hand', () => {
    const e = createEngine(modelFromJson(testModel()), config({ epsilon: 0 }));
    answer(e, 0, 0); // likelihoods 0.9, 0.9, 0.9, 0.1 on a uniform prior
    expect(e.post[0]).toBeCloseTo(0.9 / 2.8, 6);
    expect(e.post[3]).toBeCloseTo(0.1 / 2.8, 6);
  });
});

describe('epsilon floor', () => {
  it('keeps every effective likelihood at or above epsilon and each cell summing to 1', () => {
    const json = testModel();
    json.questions[0].lik = [1, 1, 1, 0, 0, 0, 0, 1]; // hard zeros in the raw table
    const m = modelFromJson(json);
    const eff = new Float32Array(m.lik.length);
    applyFloor(m, 0.03, eff);
    for (let i = 0; i < eff.length; i++) expect(eff[i]).toBeGreaterThanOrEqual(0.03 - 1e-7);
    for (let q = 0; q < m.questionCount; q++) {
      for (let c = 0; c < m.cellCount; c++) {
        let s = 0;
        for (let o = 0; o < m.qOptions[q]; o++) s += eff[m.qOffset[q] + o * m.cellCount + c];
        expect(s).toBeCloseTo(1, 6);
      }
    }
    expect(eff[m.qOffset[0] + 3]).toBeCloseTo(0.03, 6); // raw 0 -> epsilon
    expect(eff[m.qOffset[0]]).toBeCloseTo(0.97, 6); // raw 1 -> 1 - epsilon (2 options)
  });

  it('an "impossible" answer lowers a cell but never eliminates it', () => {
    const json = testModel();
    json.questions[0].lik = [1, 1, 1, 0, 0, 0, 0, 1];
    const e = createEngine(modelFromJson(json), config({ epsilon: 0.03 }));
    answer(e, 0, 0); // impossible for cell 3 in the raw table
    expect(e.post[3]).toBeGreaterThan(0);
    expect(e.post[3]).toBeCloseTo(0.03 / (3 * 0.97 + 0.03), 6);
  });

  it('rejects an epsilon too large for the number of options', () => {
    expect(() => createEngine(modelFromJson(testModel()), config({ epsilon: 0.34 }))).toThrow();
  });
});

describe('information gain', () => {
  it('entropyBits of a uniform distribution over 4 items is 2 bits', () => {
    expect(entropyBits(new Float32Array([0.25, 0.25, 0.25, 0.25]), 4)).toBeCloseTo(2, 6);
    expect(entropyBits(new Float32Array([1, 0, 0, 0]), 4)).toBe(0);
  });

  it('a perfectly splitting question gains 1 bit; an uninformative one gains 0', () => {
    const json = testModel();
    json.questions[2] = {
      id: 'perfect', category: 1, fun: 0, options: 2, lik: [1, 1, 0, 0, 0, 0, 1, 1],
    };
    const e = createEngine(modelFromJson(json), config({ epsilon: 0 }));
    expect(expectedGain(e, 2)).toBeCloseTo(1, 5);
    expect(expectedGain(e, 3)).toBeCloseTo(0, 6);
  });

  it('with the floor, the same question gains 1 - H2(epsilon) bits', () => {
    const json = testModel();
    json.questions[2] = {
      id: 'perfect', category: 1, fun: 0, options: 2, lik: [1, 1, 0, 0, 0, 0, 1, 1],
    };
    const e = createEngine(modelFromJson(json), config({ epsilon: 0.03 }));
    expect(expectedGain(e, 2)).toBeCloseTo(1 - h2(0.03), 5);
  });

  it('asks the broad question first and the local one once its area is likely', () => {
    const e = createEngine(modelFromJson(testModel()), config({ categoryPenalty: 1 }));
    const first = nextQuestion(e);
    expect(first).not.toBe(1); // the local question is not worth asking yet
    expect(expectedGain(e, 1)).toBeLessThan(expectedGain(e, 0));
    answer(e, 2, 0); // "half": points to cells 0 and 1
    answer(e, 0, 0); // "broad": east
    expect(nextQuestion(e)).toBe(1); // now the local question separates the leaders
    expect(e.lastBestGain).toBeGreaterThan(0.3);
  });

  it('penalizes repeating a category and can weigh in the fun value', () => {
    const e = createEngine(modelFromJson(testModel()), config({ categoryPenalty: 0.5 }));
    answer(e, 0, 0); // vocab
    expect(categoryStreak(e, 0)).toBe(1);
    expect(categoryStreak(e, 1)).toBe(0);
    const g1 = expectedGain(e, 1); // local: vocab again -> halved
    const g2 = expectedGain(e, 2); // half: grammar -> untouched
    expect(questionScore(e, 1, g1)).toBeCloseTo(g1 * 0.5, 6);
    expect(questionScore(e, 2, g2)).toBeCloseTo(g2, 6);
    expect(nextQuestion(e)).toBe(g1 * 0.5 > g2 ? 1 : 2);

    const harsh = createEngine(modelFromJson(testModel()), config({ categoryPenalty: 0.01 }));
    answer(harsh, 0, 0);
    expect(nextQuestion(harsh)).toBe(2); // the other category wins
    answer(harsh, 2, 0);
    expect(categoryStreak(harsh, 0)).toBe(0); // streak broken by the grammar question
    expect(nextQuestion(harsh)).toBe(1);

    const fun = createEngine(modelFromJson(testModel()), config({ categoryPenalty: 1, funWeight: 100 }));
    expect(nextQuestion(fun)).toBe(1); // only "local" has a fun value
  });

  it('returns -1 when every question has been answered', () => {
    const e = createEngine(modelFromJson(testModel()), config({}));
    for (let q = 0; q < 4; q++) answer(e, q, 0);
    expect(nextQuestion(e)).toBe(-1);
    expect(e.lastBestGain).toBe(0);
  });
});

describe('stop conditions', () => {
  it('keeps going at the start', () => {
    const e = createEngine(modelFromJson(testModel()), config({}));
    expect(stopReason(e)).toBe(STOP_NONE);
  });

  it('stops when the top cell reaches the threshold', () => {
    const e = createEngine(modelFromJson(testModel()), config({ stopTopCellProb: 0.8 }));
    answer(e, 0, 1); // west: only cell 3 fits
    expect(e.post[topCell(e)]).toBeLessThan(0.8);
    expect(stopReason(e)).toBe(STOP_NONE);
    answer(e, 2, 1);
    expect(topCell(e)).toBe(3);
    expect(e.post[3]).toBeGreaterThanOrEqual(0.8);
    expect(stopReason(e)).toBe(STOP_TOP_PROB);
  });

  it('stops at the question limit', () => {
    const e = createEngine(modelFromJson(testModel()), config({ maxQuestions: 1, stopTopCellProb: 0.99 }));
    answer(e, 3, 0);
    expect(stopReason(e)).toBe(STOP_MAX_QUESTIONS);
  });

  it('stops when no remaining question is informative enough', () => {
    const e = createEngine(
      modelFromJson(testModel()),
      config({ stopTopCellProb: 0.999, minGainBits: 0.01 }),
    );
    answer(e, 0, 0);
    answer(e, 1, 0);
    answer(e, 2, 0);
    expect(stopReason(e)).toBe(STOP_LOW_GAIN); // only "noise" is left
    const strict = createEngine(modelFromJson(testModel()), config({ minGainBits: 5 }));
    expect(stopReason(strict)).toBe(STOP_LOW_GAIN);
  });
});

describe('undo', () => {
  it('restores exactly the state before the last answer', () => {
    const m = modelFromJson(testModel());
    const a = createEngine(m, config({}));
    answer(a, 0, 0);
    answer(a, 2, 1);
    answer(a, 1, 1);
    expect(undo(a)).toBe(true);

    const b = createEngine(m, config({}));
    answer(b, 0, 0);
    answer(b, 2, 1);

    expect(Array.from(a.post)).toEqual(Array.from(b.post)); // bit-identical
    expect(Array.from(a.asked)).toEqual(Array.from(b.asked));
    expect(a.histLen).toBe(b.histLen);
    expect(nextQuestion(a)).toBe(nextQuestion(b));

    // the undone question can be answered again, differently
    expect(answer(a, 1, 0)).toBe(true);
  });

  it('undoing everything returns to the prior, and then reports nothing to undo', () => {
    const m = modelFromJson(testModel());
    const e = createEngine(m, config({}));
    answer(e, 0, 0);
    answer(e, 1, 0);
    undo(e);
    undo(e);
    expect(Array.from(e.post)).toEqual(Array.from(m.prior));
    expect(undo(e)).toBe(false);
  });

  it('rejects invalid or repeated answers without changing state', () => {
    const e = createEngine(modelFromJson(testModel()), config({}));
    answer(e, 0, 0);
    const before = Array.from(e.post);
    expect(answer(e, 0, 1)).toBe(false);
    expect(answer(e, 9, 0)).toBe(false);
    expect(answer(e, 1, 2)).toBe(false);
    expect(Array.from(e.post)).toEqual(before);
    expect(e.histLen).toBe(1);
  });

  it('recovers the right cell after a wrong answer is outweighed by later ones', () => {
    const e = createEngine(modelFromJson(testModel()), config({ stopTopCellProb: 0.999 }));
    answer(e, 0, 1); // "west" — wrong for someone from cell 0
    expect(topCell(e)).toBe(3);
    answer(e, 2, 0); // points to cells 0/1
    answer(e, 1, 0); // points to cell 0
    expect(topCell(e)).toBe(0);
  });
});

describe('aggregation and ranking', () => {
  it('sums cell probabilities into prefectures and regions', () => {
    const e = createEngine(modelFromJson(testModel()), config({ epsilon: 0 }));
    const pref = new Float32Array(3);
    const region = new Float32Array(2);
    prefProbs(e, pref);
    regionProbs(e, region);
    expect(Array.from(pref)).toEqual([0.5, 0.25, 0.25]);
    expect(Array.from(region)).toEqual([0.75, 0.25]);
    const out = new Float32Array(2);
    sumByGroup(new Float32Array([0.1, 0.2, 0.7]), new Int32Array([1, 0, 1]), 3, 2, out);
    expect(out[0]).toBeCloseTo(0.2, 6);
    expect(out[1]).toBeCloseTo(0.8, 6);
  });

  it('topK returns the largest values in order', () => {
    const out = new Int32Array(3);
    const p = new Float32Array([0.1, 0.4, 0.05, 0.3, 0.15]);
    expect(topK(p, 5, 3, out)).toBe(3);
    expect(Array.from(out)).toEqual([1, 3, 4]);
    const two = new Int32Array(3);
    expect(topK(new Float32Array([0.2, 0.8]), 2, 3, two)).toBe(2);
    expect(Array.from(two.subarray(0, 2))).toEqual([1, 0]);
    const ties = new Int32Array(2);
    topK(new Float32Array([0.25, 0.25, 0.25, 0.25]), 4, 2, ties);
    expect(Array.from(ties)).toEqual([0, 1]);
  });

  it('chooses the result granularity from the confidence', () => {
    const scratch = new Float32Array(3);
    const e = createEngine(
      modelFromJson(testModel()),
      config({ cellConfident: 0.6, prefConfident: 0.6, stopTopCellProb: 0.999 }),
    );
    expect(resultLevel(e, scratch)).toBe(LEVEL_REGION); // nothing known yet
    answer(e, 2, 0); // cells 0 and 1 (both prefecture A) share the lead
    expect(resultLevel(e, scratch)).toBe(LEVEL_PREF);
    answer(e, 1, 0); // cell 0 pulls ahead
    expect(resultLevel(e, scratch)).toBe(LEVEL_CELL);
  });
});
