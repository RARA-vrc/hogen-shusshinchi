// Tunable parameters of the inference engine. Plain numbers only, so the
// same structure ports directly to UdonSharp fields.

export interface EngineConfig {
  // Lower bound of every answer likelihood. Models people whose answers do
  // not follow their home region (moved around, parents' dialect, words
  // picked up online).
  epsilon: number;
  // Stop after this many answered questions.
  maxQuestions: number;
  // Stop when the most likely cell reaches this probability.
  stopTopCellProb: number;
  // Stop when the best remaining question is expected to gain less than this
  // many bits.
  minGainBits: number;
  // Score multiplier applied once per immediately preceding question of the
  // same category (1 = no penalty).
  categoryPenalty: number;
  // Weight of a question's "fun" value in the selection score (0 = ignore).
  funWeight: number;
  // Result granularity: name the cell when its probability reaches
  // cellConfident; otherwise name the prefecture when it reaches
  // prefConfident; otherwise name only the region.
  cellConfident: number;
  prefConfident: number;
}

export function defaultConfig(): EngineConfig {
  return {
    epsilon: 0.03,
    maxQuestions: 25,
    stopTopCellProb: 0.8,
    minGainBits: 0.01,
    categoryPenalty: 0.7,
    funWeight: 0,
    cellConfident: 0.6,
    prefConfident: 0.6,
  };
}
