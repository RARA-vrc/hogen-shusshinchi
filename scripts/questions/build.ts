// Builds the model and UI data from data/questions/*.yaml:
//
//   src/generated/model.json      engine model (cells, priors, likelihoods)
//   src/generated/questions.json  texts and metadata for the UI
//   docs/needs-review.md          review list for the human editor
//
//   node scripts/questions/build.ts

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { ModelJson } from '../../src/engine/model.ts';
import { ROOT, baseModel, loadGeo, type Geo } from '../sim/geo-model.ts';
import {
  CATEGORIES,
  QUESTION_BUILD_CONFIG,
  UNKNOWN_ID,
  UNVERIFIED,
  expandZones,
  optionsOf,
  smooth,
  toLikelihoodTable,
  validateQuestion,
  type QuestionFile,
} from './expand.ts';

export interface UiQuestion {
  id: string;
  category: string;
  text: string;
  options: { id: string; text: string }[]; // last one is "unknown"
  source: string;
  confidence: string;
  needs_review: boolean;
}

export function loadQuestionFiles(dir: string): QuestionFile[] {
  const names = readdirSync(dir).filter((n) => n.endsWith('.yaml')).sort();
  const out: QuestionFile[] = [];
  for (let i = 0; i < names.length; i++) {
    const q = parse(readFileSync(join(dir, names[i]), 'utf8')) as QuestionFile;
    if (q === null || typeof q !== 'object') throw new Error(`${names[i]}: not a YAML mapping`);
    if (`${q.id}.yaml` !== names[i]) throw new Error(`${names[i]}: file name must match id "${q.id}"`);
    out.push(q);
  }
  return out;
}

export function buildModel(
  questions: QuestionFile[],
  geo: Geo,
): { model: ModelJson; ui: UiQuestion[] } {
  const errors: string[] = [];
  const seen: string[] = [];
  for (let i = 0; i < questions.length; i++) {
    const e = validateQuestion(questions[i], geo);
    for (let k = 0; k < e.length; k++) errors.push(e[k]);
    if (seen.indexOf(questions[i].id) >= 0) errors.push(`${questions[i].id}: duplicate question id`);
    seen.push(questions[i].id);
  }
  if (errors.length > 0) throw new Error(`question data is invalid:\n  ${errors.join('\n  ')}`);

  const model = baseModel(geo, CATEGORIES);
  const ui: UiQuestion[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const options = optionsOf(q);
    const sigma = q.smoothing_km ?? QUESTION_BUILD_CONFIG.smoothingKm;
    const perCell = smooth(expandZones(q, geo), geo, sigma);
    model.questions.push({
      id: q.id,
      category: CATEGORIES.indexOf(q.category),
      fun: q.fun ?? 0,
      options: options.length + 1,
      lik: toLikelihoodTable(perCell, QUESTION_BUILD_CONFIG.decimals),
    });
    const uiOptions: { id: string; text: string }[] = [];
    for (let o = 0; o < options.length; o++) uiOptions.push({ id: options[o].id, text: options[o].text });
    uiOptions.push({ id: UNKNOWN_ID, text: q.unknown_text ?? QUESTION_BUILD_CONFIG.defaultUnknownText });
    ui.push({
      id: q.id,
      category: q.category,
      text: q.text,
      options: uiOptions,
      source: q.source,
      confidence: q.confidence,
      needs_review: q.needs_review,
    });
  }
  return { model, ui };
}

function cellText(s: string): string {
  return s.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function renderReviewList(questions: QuestionFile[]): string {
  const lines: string[] = [];
  let review = 0;
  let unverified = 0;
  for (let i = 0; i < questions.length; i++) {
    if (questions[i].needs_review) review++;
    if (questions[i].source === UNVERIFIED) unverified++;
  }
  lines.push(
    '# 質問データ レビュー一覧',
    '',
    '<!-- このファイルは data/questions/*.yaml から scripts/questions/build.ts が生成します。直接編集しないでください。 -->',
    '',
    `質問数:${questions.length} / 要レビュー(needs_review: true):${review} / 出典未確認:${unverified}`,
    '',
    '分布の数値はすべて作成時の見積もりで、調査データから計算したものではありません。',
    '出典欄は、実際に内容を確認できたものだけを記載しています。',
    '',
    '| id | カテゴリ | 確信度 | 要レビュー | 出典 | 質問文 | メモ |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  );
  const order = ['low', 'medium', 'high'];
  for (let k = 0; k < order.length; k++) {
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (q.confidence !== order[k]) continue;
      lines.push(
        `| ${q.id} | ${q.category} | ${q.confidence} | ${q.needs_review ? 'はい' : 'いいえ'} | ` +
          `${cellText(q.source)} | ${cellText(q.text)} | ${cellText(q.notes ?? '')} |`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

function main(): void {
  const geo = loadGeo(ROOT);
  const questions = loadQuestionFiles(join(ROOT, 'data', 'questions'));
  const { model, ui } = buildModel(questions, geo);
  const outDir = join(ROOT, 'src', 'generated');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'model.json'), JSON.stringify(model) + '\n');
  writeFileSync(join(outDir, 'questions.json'), JSON.stringify({ questions: ui }, null, 1) + '\n');
  mkdirSync(join(ROOT, 'docs'), { recursive: true });
  writeFileSync(join(ROOT, 'docs', 'needs-review.md'), renderReviewList(questions));
  console.log(`Built ${questions.length} questions -> src/generated/model.json, questions.json, docs/needs-review.md`);
}

if (import.meta.main) main();
