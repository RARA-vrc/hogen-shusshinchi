import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { modelFromJson } from '../src/engine/model.ts';
import { buildModel, loadQuestionFiles, renderReviewList } from '../scripts/questions/build.ts';
import {
  CATEGORIES,
  UNVERIFIED,
  expandZones,
  optionsOf,
  smooth,
  toLikelihoodTable,
  validateQuestion,
  type QuestionFile,
} from '../scripts/questions/expand.ts';
import { ROOT, loadGeo, type Geo } from '../scripts/sim/geo-model.ts';

// Tiny world: three prefectures in a row, 100 km apart at the equator-ish
// scale used here (about 0.9 degrees of longitude at latitude 35).
const geo: Geo = {
  cells: [
    { id: 'a1', name: '', label: '', pref: '01', lon: 135.0, lat: 35, population: 1 },
    { id: 'a2', name: '', label: '', pref: '01', lon: 135.2, lat: 35, population: 1 },
    { id: 'b1', name: '', label: '', pref: '02', lon: 135.4, lat: 35, population: 1 },
    { id: 'c1', name: '', label: '', pref: '03', lon: 140.0, lat: 35, population: 1 },
  ],
  prefCodes: ['01', '02', '03'],
  prefNames: ['A', 'B', 'C'],
  regionIds: ['west', 'east'],
  prefRegion: [0, 0, 1],
};

function question(overrides: Partial<QuestionFile>): QuestionFile {
  return {
    id: 't01',
    category: 'vocab',
    text: 'test',
    options: [
      { id: 'x', text: 'X' },
      { id: 'y', text: 'Y' },
    ],
    distribution: {
      default: { x: 0.8, y: 0.1, unknown: 0.1 },
      zones: [{ regions: ['west'], dist: { x: 0.2, y: 0.7, unknown: 0.1 } }],
    },
    source: UNVERIFIED,
    confidence: 'medium',
    needs_review: true,
    ...overrides,
  };
}

describe('zone expansion', () => {
  it('gives zone cells the zone distribution and everything else the default', () => {
    const raw = expandZones(question({}), geo);
    expect(raw[0]).toEqual([0.2, 0.7, 0.1]);
    expect(raw[1]).toEqual([0.2, 0.7, 0.1]);
    expect(raw[2]).toEqual([0.2, 0.7, 0.1]);
    expect(raw[3]).toEqual([0.8, 0.1, 0.1]); // east: default
  });

  it('a cell beats a prefecture, which beats a region', () => {
    const q = question({
      distribution: {
        default: { x: 0.8, y: 0.1, unknown: 0.1 },
        zones: [
          { regions: ['west'], dist: { x: 0.2, y: 0.7, unknown: 0.1 } },
          { prefs: ['01'], dist: { x: 0.5, y: 0.4, unknown: 0.1 } },
          { cells: ['a2'], dist: { x: 0.3, y: 0.3, unknown: 0.4 } },
        ],
      },
    });
    const raw = expandZones(q, geo);
    expect(raw[0]).toEqual([0.5, 0.4, 0.1]); // prefecture 01
    expect(raw[1]).toEqual([0.3, 0.3, 0.4]); // listed cell
    expect(raw[2]).toEqual([0.2, 0.7, 0.1]); // region only
  });

  it('refuses two zones that claim a cell at the same level', () => {
    const q = question({
      distribution: {
        default: { x: 0.8, y: 0.1, unknown: 0.1 },
        zones: [
          { prefs: ['01'], dist: { x: 0.2, y: 0.7, unknown: 0.1 } },
          { prefs: ['01', '02'], dist: { x: 0.5, y: 0.4, unknown: 0.1 } },
        ],
      },
    });
    expect(() => expandZones(q, geo)).toThrow(/two zones/);
  });

  it('supports the shared answer presets', () => {
    const q = question({
      options: undefined,
      preset: 'use3',
      distribution: { default: { use: 0.1, hear: 0.2, none: 0.6, unknown: 0.1 } },
    });
    expect(optionsOf(q).map((o) => o.id)).toEqual(['use', 'hear', 'none']);
    expect(expandZones(q, geo)[0]).toEqual([0.1, 0.2, 0.6, 0.1]);
  });
});

describe('smoothing', () => {
  const raw = expandZones(question({ distribution: {
    default: { x: 0.8, y: 0.1, unknown: 0.1 },
    zones: [{ prefs: ['01'], dist: { x: 0.2, y: 0.7, unknown: 0.1 } }],
  } }), geo);

  it('keeps every cell summing to 1', () => {
    const s = smooth(raw, geo, 40);
    for (const row of s) expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it('pulls border cells toward their neighbours and leaves distant cells alone', () => {
    const s = smooth(raw, geo, 40);
    // b1 (default 0.8) sits about 18 km from a2 (zone 0.2): pulled down
    expect(s[2][0]).toBeLessThan(0.8);
    expect(s[2][0]).toBeGreaterThan(0.2);
    // a2 is nearer the border than a1, so it moves more
    expect(s[1][0]).toBeGreaterThan(s[0][0]);
    expect(s[0][0]).toBeGreaterThan(0.2);
    // c1 is hundreds of km away: unchanged
    expect(s[3]).toEqual([0.8, 0.1, 0.1]);
  });

  it('a wider kernel blends more; zero width disables smoothing', () => {
    const narrow = smooth(raw, geo, 10);
    const wide = smooth(raw, geo, 80);
    expect(wide[2][0]).toBeLessThan(narrow[2][0]);
    expect(smooth(raw, geo, 0)).toEqual(raw);
  });

  it('builds an option-major table', () => {
    const lik = toLikelihoodTable(raw, 4);
    expect(lik.length).toBe(3 * 4);
    expect(lik.slice(0, 4)).toEqual([0.2, 0.2, 0.8, 0.8]); // option x for cells a1,a2,b1,c1
    expect(lik.slice(8, 12)).toEqual([0.1, 0.1, 0.1, 0.1]); // unknown
  });
});

describe('question validation', () => {
  it('accepts a well-formed question', () => {
    expect(validateQuestion(question({}), geo)).toEqual([]);
  });

  it('rejects distributions that do not sum to 1 or miss an answer', () => {
    const bad = question({ distribution: { default: { x: 0.8, y: 0.1, unknown: 0.2 } } });
    expect(validateQuestion(bad, geo).length).toBeGreaterThan(0);
    const missing = question({ distribution: { default: { x: 0.9, unknown: 0.1 } } });
    expect(validateQuestion(missing, geo).length).toBeGreaterThan(0);
  });

  it('rejects extreme probabilities', () => {
    const q = question({ distribution: { default: { x: 0.96, y: 0.02, unknown: 0.02 } } });
    expect(validateQuestion(q, geo).some((e) => e.includes('too extreme'))).toBe(true);
  });

  it('requires review for unverified sources and low confidence', () => {
    expect(validateQuestion(question({ needs_review: false }), geo).length).toBe(1);
    const low = question({ source: 'some checked source', confidence: 'low', needs_review: false });
    expect(validateQuestion(low, geo).length).toBe(1);
    const ok = question({ source: 'some checked source', confidence: 'high', needs_review: false });
    expect(validateQuestion(ok, geo)).toEqual([]);
  });

  it('rejects unknown areas, categories and reserved option ids', () => {
    const area = question({ distribution: {
      default: { x: 0.8, y: 0.1, unknown: 0.1 },
      zones: [{ prefs: ['99'], dist: { x: 0.2, y: 0.7, unknown: 0.1 } }],
    } });
    expect(validateQuestion(area, geo).length).toBeGreaterThan(0);
    expect(validateQuestion(question({ category: 'nope' }), geo).length).toBeGreaterThan(0);
    const reserved = question({ options: [{ id: 'unknown', text: 'U' }, { id: 'y', text: 'Y' }] });
    expect(validateQuestion(reserved, geo).length).toBeGreaterThan(0);
  });
});

describe('the committed question set', () => {
  const realGeo = loadGeo(ROOT);
  const files = loadQuestionFiles(join(ROOT, 'data', 'questions'));
  const built = buildModel(files, realGeo);

  it('has about 40 valid questions covering every category', () => {
    expect(files.length).toBeGreaterThanOrEqual(38);
    for (const category of CATEGORIES) {
      expect(files.some((q) => q.category === category)).toBe(true);
    }
  });

  it('builds a model the engine accepts', () => {
    const model = modelFromJson(built.model);
    expect(model.questionCount).toBe(files.length);
    expect(model.cellCount).toBe(realGeo.cells.length);
    expect(built.ui.length).toBe(files.length);
    for (const q of built.ui) expect(q.options[q.options.length - 1].id).toBe('unknown');
  });

  it('marks every unverified or low-confidence question for review', () => {
    for (const q of files) {
      if (q.source === UNVERIFIED || q.confidence === 'low') expect(q.needs_review).toBe(true);
    }
  });

  it('lists every question in the review list', () => {
    const md = renderReviewList(files);
    for (const q of files) expect(md).toContain(`| ${q.id} |`);
  });
});
