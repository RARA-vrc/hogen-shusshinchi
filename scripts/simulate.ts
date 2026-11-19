// Runs the respondent simulation and prints a Markdown table.
//
//   node scripts/simulate.ts [--model path/to/model.json] [--synthetic]
//                            [--trials 20] [--seed 1] [--noise 0.1,0.2]
//
// Without --model it uses src/generated/model.json (built from the real
// question set by scripts/questions/build.ts) if present, otherwise a
// synthetic question set.
// See simulate-core.ts for what the numbers do and do not mean.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultConfig } from '../src/engine/config.ts';
import { modelFromJson, type ModelJson } from '../src/engine/model.ts';
import { ROOT, loadGeo, syntheticModel } from './sim/geo-model.ts';
import { simulate } from './sim/simulate-core.ts';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function main(): void {
  const trials = Number(arg('trials', '20'));
  const seed = Number(arg('seed', '1'));
  const noises = arg('noise', '0.1,0.2').split(',').map(Number);
  const defaultPath = join(ROOT, 'src', 'generated', 'model.json');
  const modelPath = arg('model', defaultPath);
  const synthetic = process.argv.indexOf('--synthetic') >= 0 || !existsSync(modelPath);

  let json: ModelJson;
  let source: string;
  if (synthetic) {
    json = syntheticModel(loadGeo(ROOT), 40, seed);
    source = 'synthetic questions (not real dialect data)';
  } else {
    json = JSON.parse(readFileSync(modelPath, 'utf8'));
    source = modelPath;
  }
  const model = modelFromJson(json);
  const config = defaultConfig();

  console.log(`Model: ${source}`);
  console.log(
    `Cells: ${model.cellCount}, questions: ${model.questionCount}, trials per cell: ${trials}, seed: ${seed}`,
  );
  console.log(
    `Config: epsilon ${config.epsilon}, max questions ${config.maxQuestions}, ` +
      `stop at top cell ${config.stopTopCellProb}, min gain ${config.minGainBits} bits`,
  );
  console.log('');
  console.log('| ランダム回答率 | 地方 top-1 | 都道府県 top-1 | 都道府県 top-3 | セル top-1 | セル top-3 | 平均質問数 |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  for (let i = 0; i < noises.length; i++) {
    const s = simulate(model, config, { noise: noises[i], trialsPerCell: trials, seed: seed + i });
    console.log(
      `| ${pct(noises[i])} | ${pct(s.regionTop1)} | ${pct(s.prefTop1)} | ${pct(s.prefTop3)} | ${pct(s.cellTop1)} | ` +
        `${pct(s.cellTop3)} | ${s.meanQuestions.toFixed(1)} |`,
    );
  }
  console.log('');
  console.log('(population-weighted; each cell is simulated the same number of times)');
}

if (import.meta.main) main();
