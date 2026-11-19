// Game flow on top of the engine: which question is current, when to stop,
// and what to guess. No DOM access here, so it can be unit-tested.

import type { EngineConfig } from '../engine/config.ts';
import {
  LEVEL_CELL,
  LEVEL_PREF,
  LEVEL_REGION,
  STOP_NONE,
  answer,
  createEngine,
  nextQuestion,
  prefProbs,
  regionProbs,
  resultLevel,
  stopReason,
  topK,
  undo,
  type Engine,
} from '../engine/engine.ts';
import type { Model } from '../engine/model.ts';

export interface Game {
  engine: Engine;
  // Index of the question to show now, or -1 when the game is over.
  current: number;
  // Why the game stopped (STOP_* from the engine); STOP_NONE while playing.
  stopped: number;
  prefP: Float32Array;
  regionP: Float32Array;
}

// One thing the host can guess. `level` says how precise it is.
export interface Guess {
  level: number; // LEVEL_REGION | LEVEL_PREF | LEVEL_CELL
  region: number;
  pref: number; // -1 for a region-level guess
  cell: number; // -1 unless a cell-level guess
  prob: number;
  // Finer candidates inside the guess ("maybe around here"): cells inside the
  // prefecture for a prefecture guess, prefectures inside the region for a
  // region guess. Empty for a cell guess.
  hints: number[];
  hintProbs: number[];
}

const MAX_GUESSES = 3;
const MAX_HINTS = 3;

function advance(game: Game): void {
  const e = game.engine;
  game.stopped = stopReason(e);
  game.current = game.stopped === STOP_NONE ? nextQuestion(e) : -1;
  prefProbs(e, game.prefP);
  regionProbs(e, game.regionP);
}

export function createGame(model: Model, config: EngineConfig): Game {
  const game: Game = {
    engine: createEngine(model, config),
    current: -1,
    stopped: STOP_NONE,
    prefP: new Float32Array(model.prefCount),
    regionP: new Float32Array(model.regionCount),
  };
  advance(game);
  return game;
}

export function isFinished(game: Game): boolean {
  return game.current < 0;
}

export function answeredCount(game: Game): number {
  return game.engine.histLen;
}

// Answers the current question. Returns false if there is none or the option
// is invalid.
export function answerCurrent(game: Game, option: number): boolean {
  if (game.current < 0) return false;
  if (!answer(game.engine, game.current, option)) return false;
  advance(game);
  return true;
}

// Takes back the last answer (also works after the game has finished).
export function goBack(game: Game): boolean {
  if (!undo(game.engine)) return false;
  advance(game);
  return true;
}

// Most likely region right now and its probability.
export function leadingRegion(game: Game): { region: number; prob: number } {
  let best = 0;
  for (let r = 1; r < game.regionP.length; r++) {
    if (game.regionP[r] > game.regionP[best]) best = r;
  }
  return { region: best, prob: game.regionP[best] };
}

// Up to three guesses, best first, all at the precision the posterior
// supports. The UI tries them in order when the player says "wrong".
export function buildGuesses(game: Game): Guess[] {
  const e = game.engine;
  const m = e.model;
  const level = resultLevel(e, game.prefP);
  prefProbs(e, game.prefP);
  regionProbs(e, game.regionP);
  const guesses: Guess[] = [];
  const top = new Int32Array(MAX_GUESSES);

  if (level === LEVEL_CELL) {
    const n = topK(e.post, m.cellCount, MAX_GUESSES, top);
    for (let i = 0; i < n; i++) {
      const cell = top[i];
      guesses.push({
        level: LEVEL_CELL,
        region: m.cellRegion[cell],
        pref: m.cellPref[cell],
        cell,
        prob: e.post[cell],
        hints: [],
        hintProbs: [],
      });
    }
    return guesses;
  }

  if (level === LEVEL_PREF) {
    const n = topK(game.prefP, m.prefCount, MAX_GUESSES, top);
    for (let i = 0; i < n; i++) {
      const pref = top[i];
      // Cells of this prefecture, most likely first.
      const hints: number[] = [];
      const hintProbs: number[] = [];
      for (let h = 0; h < MAX_HINTS; h++) {
        let best = -1;
        for (let c = 0; c < m.cellCount; c++) {
          if (m.cellPref[c] !== pref || hints.indexOf(c) >= 0) continue;
          if (best < 0 || e.post[c] > e.post[best]) best = c;
        }
        if (best < 0) break;
        hints.push(best);
        hintProbs.push(e.post[best]);
      }
      guesses.push({
        level: LEVEL_PREF,
        region: m.prefRegion[pref],
        pref,
        cell: -1,
        prob: game.prefP[pref],
        hints,
        hintProbs,
      });
    }
    return guesses;
  }

  const n = topK(game.regionP, m.regionCount, MAX_GUESSES, top);
  for (let i = 0; i < n; i++) {
    const region = top[i];
    const hints: number[] = [];
    const hintProbs: number[] = [];
    for (let h = 0; h < MAX_HINTS; h++) {
      let best = -1;
      for (let p = 0; p < m.prefCount; p++) {
        if (m.prefRegion[p] !== region || hints.indexOf(p) >= 0) continue;
        if (best < 0 || game.prefP[p] > game.prefP[best]) best = p;
      }
      if (best < 0) break;
      hints.push(best);
      hintProbs.push(game.prefP[best]);
    }
    guesses.push({
      level: LEVEL_REGION,
      region,
      pref: -1,
      cell: -1,
      prob: game.regionP[region],
      hints,
      hintProbs,
    });
  }
  return guesses;
}
