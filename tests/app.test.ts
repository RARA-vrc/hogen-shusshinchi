import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  answerCurrent,
  answeredCount,
  buildGuesses,
  createGame,
  goBack,
  isFinished,
  leadingRegion,
} from '../src/app/game.ts';
import { STANDARD_VOICE, chooseVoice, hostLine, type HostData } from '../src/app/host.ts';
import { defaultConfig } from '../src/engine/config.ts';
import { LEVEL_CELL, LEVEL_PREF, LEVEL_REGION } from '../src/engine/engine.ts';
import { modelFromJson, type ModelJson } from '../src/engine/model.ts';
import {
  LOCAL_LOG_KEY,
  LOCAL_LOG_LIMIT,
  LocalSink,
  NoopSink,
  dayOf,
  recordIfConsented,
  type KeyValueStore,
  type PlayRecord,
} from '../src/log/sink.ts';
import { buildHost, loadHostFiles, validateHost } from '../scripts/host/build.ts';
import { buildModel, loadQuestionFiles } from '../scripts/questions/build.ts';
import { ROOT, loadGeo } from '../scripts/sim/geo-model.ts';
import { insidePref } from '../src/app/text.ts';
import { EXPRESSIONS } from '../src/ui/face.ts';
import { heatColor, heatLevel } from '../src/ui/map.ts';
import { SOUNDS } from '../src/ui/sound.ts';

const geo = loadGeo(ROOT);
const built = buildModel(loadQuestionFiles(join(ROOT, 'data', 'questions')), geo);
const modelJson: ModelJson = built.model;

function optionIndex(questionIndex: number, optionId: string): number {
  const options = built.ui[questionIndex].options;
  for (let i = 0; i < options.length; i++) if (options[i].id === optionId) return i;
  return options.length - 1; // unknown
}

// Plays a whole game answering with the most likely option for `cellId`.
function playAs(cellId: string) {
  const model = modelFromJson(modelJson);
  const game = createGame(model, defaultConfig());
  const cell = modelJson.cellIds.indexOf(cellId);
  while (!isFinished(game)) {
    const q = game.current;
    let best = 0;
    for (let o = 1; o < model.qOptions[q]; o++) {
      const base = model.qOffset[q];
      if (model.lik[base + o * model.cellCount + cell] > model.lik[base + best * model.cellCount + cell]) best = o;
    }
    answerCurrent(game, best);
  }
  return { game, model, cell };
}

describe('game flow with the real question set', () => {
  it('starts with a question and ends within the question limit', () => {
    const { game } = playAs('2704'); // a cell in Osaka
    expect(isFinished(game)).toBe(true);
    expect(answeredCount(game)).toBeGreaterThan(0);
    expect(answeredCount(game)).toBeLessThanOrEqual(defaultConfig().maxQuestions);
  });

  it('a typical Osaka respondent ends up in Kinki, a typical Sapporo one in Hokkaido', () => {
    const osaka = playAs('2704');
    expect(modelJson.regionIds[leadingRegion(osaka.game).region]).toBe('kinki');
    const sapporo = playAs('0104');
    expect(modelJson.regionIds[leadingRegion(sapporo.game).region]).toBe('hokkaido');
  });

  it('offers up to three guesses of one precision, best first, with consistent fields', () => {
    const { game, model } = playAs('4001');
    const guesses = buildGuesses(game);
    expect(guesses.length).toBeGreaterThan(0);
    expect(guesses.length).toBeLessThanOrEqual(3);
    for (let i = 0; i < guesses.length; i++) {
      const g = guesses[i];
      expect(g.level).toBe(guesses[0].level);
      if (i > 0) expect(g.prob).toBeLessThanOrEqual(guesses[i - 1].prob);
      if (g.level === LEVEL_CELL) {
        expect(model.cellPref[g.cell]).toBe(g.pref);
        expect(g.hints.length).toBe(0);
      } else if (g.level === LEVEL_PREF) {
        expect(g.cell).toBe(-1);
        expect(model.prefRegion[g.pref]).toBe(g.region);
        for (const c of g.hints) expect(model.cellPref[c]).toBe(g.pref);
      } else {
        expect(g.level).toBe(LEVEL_REGION);
        expect(g.pref).toBe(-1);
        for (const p of g.hints) expect(model.prefRegion[p]).toBe(g.region);
      }
    }
  });

  it('going back restores the previous question and can reopen a finished game', () => {
    const model = modelFromJson(modelJson);
    const game = createGame(model, defaultConfig());
    const first = game.current;
    answerCurrent(game, 0);
    const second = game.current;
    answerCurrent(game, 0);
    expect(goBack(game)).toBe(true);
    expect(game.current).toBe(second);
    expect(goBack(game)).toBe(true);
    expect(game.current).toBe(first);
    expect(goBack(game)).toBe(false);

    const done = playAs('1301').game;
    expect(isFinished(done)).toBe(true);
    const n = answeredCount(done);
    expect(goBack(done)).toBe(true);
    expect(answeredCount(done)).toBe(n - 1);
    expect(isFinished(done)).toBe(false);
  });

  it('every question id has UI text with matching option counts', () => {
    for (let q = 0; q < modelJson.questions.length; q++) {
      expect(built.ui[q].id).toBe(modelJson.questions[q].id);
      expect(built.ui[q].options.length).toBe(modelJson.questions[q].options);
      expect(optionIndex(q, 'unknown')).toBe(built.ui[q].options.length - 1);
    }
  });
});

describe('host character', () => {
  const files = loadHostFiles(join(ROOT, 'data', 'host'));
  const host: HostData = buildHost(files, geo.regionIds);

  it('has a standard voice plus one per region, all awaiting review', () => {
    expect(validateHost(files, geo.regionIds)).toEqual([]);
    expect(host.voices[STANDARD_VOICE]).toBeDefined();
    for (const region of geo.regionIds) expect(host.voices[region]).toBeDefined();
    for (const f of files) expect(f.needs_review).toBe(true);
  });

  it('switches to a dialect only above the threshold', () => {
    expect(chooseVoice('kinki', 0.59, 0.6, host)).toBe(STANDARD_VOICE);
    expect(chooseVoice('kinki', 0.6, 0.6, host)).toBe('kinki');
    expect(chooseVoice('nowhere', 0.99, 0.6, host)).toBe(STANDARD_VOICE);
  });

  it('fills placeholders, rotates lines and falls back to the standard voice', () => {
    const line = hostLine(host, 'kinki', 'result_cell', 0, { pref: '大阪府', label: '堺市' });
    expect(line).toContain('大阪府');
    expect(line).toContain('堺市');
    expect(line).not.toContain('{');
    expect(hostLine(host, 'kinki', 'next', 0, {})).not.toBe(hostLine(host, 'kinki', 'next', 1, {}));
    // dialect files do not define "thanks": the standard line is used
    expect(hostLine(host, 'kinki', 'thanks', 0, {})).toBe(hostLine(host, STANDARD_VOICE, 'thanks', 0, {}));
    expect(hostLine(host, 'kinki', 'no-such-key', 0, {})).toBe('');
  });

  it('rejects a host set without the standard voice or with unknown keys', () => {
    expect(validateHost([{ id: 'kinki', needs_review: true, lines: { next: ['a'] } }], geo.regionIds).length).toBeGreaterThan(0);
    const bad = [{ id: 'standard', needs_review: true, lines: { bogus: ['a'] } }];
    expect(validateHost(bad, geo.regionIds).some((e) => e.includes('unknown line key'))).toBe(true);
  });
});

describe('logging', () => {
  function memoryStore(): KeyValueStore & { data: Record<string, string> } {
    const data: Record<string, string> = {};
    return {
      data,
      getItem: (k) => (k in data ? data[k] : null),
      setItem: (k, v) => {
        data[k] = v;
      },
    };
  }
  const entry: PlayRecord = {
    questions: ['q1'],
    answers: ['a'],
    estimate: { level: 'pref', id: '27' },
    correct: '2704',
    day: '2026-11-19',
  };

  it('records nothing without consent', () => {
    const store = memoryStore();
    expect(recordIfConsented(new LocalSink(store), false, entry)).toBe(false);
    expect(store.data[LOCAL_LOG_KEY]).toBeUndefined();
  });

  it('LocalSink appends with consent and keeps only the latest records', () => {
    const store = memoryStore();
    const sink = new LocalSink(store);
    expect(recordIfConsented(sink, true, entry)).toBe(true);
    expect(JSON.parse(store.data[LOCAL_LOG_KEY])).toEqual([entry]);
    for (let i = 0; i < LOCAL_LOG_LIMIT + 5; i++) sink.record(entry);
    expect(JSON.parse(store.data[LOCAL_LOG_KEY]).length).toBe(LOCAL_LOG_LIMIT);
  });

  it('LocalSink survives corrupt stored data; NoopSink does nothing', () => {
    const store = memoryStore();
    store.data[LOCAL_LOG_KEY] = 'not json';
    new LocalSink(store).record(entry);
    expect(JSON.parse(store.data[LOCAL_LOG_KEY])).toEqual([entry]);
    expect(() => new NoopSink().record(entry)).not.toThrow();
  });

  it('a record holds only the agreed fields, with the date rounded to the day', () => {
    expect(Object.keys(entry).sort()).toEqual(['answers', 'correct', 'day', 'estimate', 'questions']);
    expect(dayOf(new Date('2026-11-19T23:59:58Z'))).toBe('2026-11-19');
  });
});

describe('heat colours', () => {
  it('scales by the square root of the share of the maximum', () => {
    expect(heatLevel(0, 0.5)).toBe(0);
    expect(heatLevel(0.5, 0.5)).toBe(1);
    expect(heatLevel(0.125, 0.5)).toBeCloseTo(0.5, 6);
    expect(heatLevel(0.1, 0)).toBe(0);
  });

  it('runs from the cold colour to the hot colour', () => {
    expect(heatColor(0)).toBe('rgb(214,222,230)');
    expect(heatColor(1)).toBe('rgb(214,64,40)');
    expect(heatColor(5)).toBe(heatColor(1));
    expect(heatColor(-1)).toBe(heatColor(0));
  });
});

describe('published app text', () => {
  it('does not use the trademarked game name in screens', () => {
    const app = readFileSync(join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
    const site = readFileSync(join(ROOT, 'site.config.json'), 'utf8');
    expect(app.includes('アキネ')).toBe(false);
    expect(JSON.parse(site).title.includes('アキネ')).toBe(false);
  });
});

describe('wording and feedback helpers', () => {
  it("uses the prefecture own suffix for inside-the-prefecture wording", () => {
    expect(insidePref('東京都')).toBe('都内');
    expect(insidePref('北海道')).toBe('道内');
    expect(insidePref('大阪府')).toBe('府内');
    expect(insidePref('京都府')).toBe('府内');
    expect(insidePref('沖縄県')).toBe('県内');
  });

  it('the screens no longer hard-code "県内"', () => {
    const app = readFileSync(join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
    expect(app.includes('県内')).toBe(false);
  });

  it('defines short, quiet sounds and six expressions', () => {
    for (const notes of Object.values(SOUNDS)) {
      for (const [freq, start, duration] of notes) {
        expect(freq).toBeGreaterThan(100);
        expect(start + duration).toBeLessThan(0.5);
      }
    }
    expect(EXPRESSIONS.length).toBe(6);
  });
});
