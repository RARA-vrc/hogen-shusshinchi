import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ROOT,
  loadModel,
  renderMarkdown,
  validateEntries,
  type LicenseEntry,
} from '../scripts/build-licenses.ts';

function entry(overrides: Partial<LicenseEntry>): LicenseEntry {
  return {
    id: 'x',
    category: 'third-party-data',
    name: 'X',
    source_url: 'https://example.org/data',
    license: 'CC BY 4.0',
    license_url: 'https://creativecommons.org/licenses/by/4.0/',
    credit: 'X',
    processing: 'none',
    retrieved: '2026-01-01',
    ...overrides,
  };
}

describe('licenses.yaml', () => {
  it('loads and passes validation', () => {
    const model = loadModel(ROOT);
    expect(model.entries.length).toBeGreaterThan(0);
    expect(validateEntries(model.entries)).toEqual([]);
  });

  it('LICENSES.md on disk matches the generated output', () => {
    const onDisk = readFileSync(join(ROOT, 'LICENSES.md'), 'utf8').replaceAll('\r\n', '\n');
    expect(onDisk).toBe(renderMarkdown(loadModel(ROOT)));
  });

  it('every entry appears in LICENSES.md with all six items', () => {
    const model = loadModel(ROOT);
    const md = renderMarkdown(model);
    for (const e of model.entries) {
      expect(md).toContain(`- 名称:${e.name}`);
      expect(md).toContain(`- クレジット表記:${e.credit}`);
      expect(md).toContain(`- 加工内容:${e.processing}`);
    }
    for (const label of ['配布元URL', 'ライセンス', '取得日']) {
      expect(md.split(`- ${label}:`).length - 1).toBe(model.entries.length);
    }
  });
});

describe('validateEntries', () => {
  it('accepts a complete third-party entry', () => {
    expect(validateEntries([entry({})])).toEqual([]);
  });

  it('rejects an empty field', () => {
    expect(validateEntries([entry({ credit: '' })]).length).toBe(1);
  });

  it('rejects non-commercial licences', () => {
    expect(validateEntries([entry({ license: 'CC BY-NC 4.0' })]).length).toBe(1);
    expect(validateEntries([entry({ license: 'CC BY-NC-SA 4.0' })]).length).toBe(1);
  });

  it('requires a real retrieval date for third-party data', () => {
    expect(validateEntries([entry({ retrieved: 'n/a' })]).length).toBe(1);
  });

  it('rejects duplicate ids', () => {
    expect(validateEntries([entry({}), entry({})]).length).toBe(1);
  });
});
