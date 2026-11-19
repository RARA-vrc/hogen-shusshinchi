import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GEO_CONFIG, assemble, parseCsv } from '../scripts/geo/build.ts';
import { ROOT } from '../scripts/geo/sources.ts';

describe('parseCsv', () => {
  it('handles quoted fields with commas and escaped quotes', () => {
    expect(parseCsv('a,b\r\n"x,y","he said ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['x,y', 'he said "hi"'],
    ]);
  });
});

describe('assemble', () => {
  const census = [
    { code: '01101', name: 'X市A区', kind: '0', population: 300, cityCode: '01100', cityName: 'X市' },
    { code: '01102', name: 'X市B区', kind: '0', population: 100, cityCode: '01100', cityName: 'X市' },
    { code: '01202', name: 'C市', kind: '2', population: 0, cityCode: '01202', cityName: 'C市' },
    { code: '01203', name: 'D町', kind: '3', population: 10, cityCode: '01203', cityName: 'D町' },
  ];
  const part = (code: string, cell: string, cx: number, cy: number, area: number) => ({
    code, cell, cellName: `cell${cell}`, cx, cy, area,
  });

  it('sums population and uses the population-weighted centre of the largest parts', () => {
    const { cells, municipalities } = assemble(
      [
        part('01101', '0101', 140, 40, 5),
        part('01101', '0101', 150, 50, 1), // small island: ignored for the centroid
        part('01102', '0101', 144, 44, 2),
        part('01202', '0102', 141, 41, 3),
      ],
      census,
      4,
    );
    expect(municipalities.length).toBe(3);
    expect(cells).toEqual([
      { id: '0101', name: 'cell0101', label: 'X市', pref: '01', lon: 141, lat: 41, population: 400 },
      // zero population: falls back to the plain mean
      { id: '0102', name: 'cell0102', label: 'C市', pref: '01', lon: 141, lat: 41, population: 0 },
    ]);
  });

  it('labels cells by their largest city, or by ward when a city spans several cells', () => {
    const { cells } = assemble(
      [
        part('01101', '0101', 140, 40, 5),
        part('01203', '0101', 140, 40, 5),
        part('01102', '0102', 141, 41, 3),
      ],
      census,
      4,
    );
    expect(cells.map((c) => c.label)).toEqual(['X市A区周辺', 'X市B区']);
    const single = assemble([part('01202', '0101', 1, 1, 1), part('01203', '0101', 1, 1, 1)], census, 4);
    expect(single.cells[0].label).toBe('D町周辺');
  });

  it('rejects a municipality split across two cells', () => {
    expect(() =>
      assemble([part('01101', '0101', 140, 40, 5), part('01101', '0102', 140, 40, 1)], census, 4),
    ).toThrow();
  });

  it('rejects a municipality missing from the census', () => {
    expect(() => assemble([part('99999', '0101', 140, 40, 5)], census, 4)).toThrow();
  });
});

describe('committed geography outputs', () => {
  const dir = join(ROOT, 'data', 'geo');
  const cellsDoc = JSON.parse(readFileSync(join(dir, 'cells.json'), 'utf8'));
  const munDoc = JSON.parse(readFileSync(join(dir, 'municipalities.json'), 'utf8'));
  const topo = JSON.parse(readFileSync(join(dir, 'japan.topo.json'), 'utf8'));

  it('has 47 prefectures and cells with complete fields', () => {
    expect(cellsDoc.prefectures.length).toBe(47);
    expect(cellsDoc.cells.length).toBeGreaterThan(300);
    const ids = new Set<string>();
    for (const c of cellsDoc.cells) {
      expect(typeof c.id).toBe('string');
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.pref).toBe(c.id.slice(0, 2));
      expect(c.lon).toBeGreaterThan(122);
      expect(c.lon).toBeLessThan(154);
      expect(c.lat).toBeGreaterThan(20);
      expect(c.lat).toBeLessThan(46);
      expect(c.population).toBeGreaterThan(0);
      ids.add(c.id);
    }
    expect(ids.size).toBe(cellsDoc.cells.length);
  });

  it('display labels are unique within each prefecture', () => {
    const seen = new Set<string>();
    for (const c of cellsDoc.cells) {
      const key = `${c.pref}:${c.label}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('cell populations add up to the prefecture and municipality totals', () => {
    const byPref = new Map<string, number>();
    for (const c of cellsDoc.cells) byPref.set(c.pref, (byPref.get(c.pref) ?? 0) + c.population);
    for (const p of cellsDoc.prefectures) expect(byPref.get(p.code)).toBe(p.population);
    const byCell = new Map<string, number>();
    for (const m of munDoc.municipalities) byCell.set(m.cell, (byCell.get(m.cell) ?? 0) + m.population);
    for (const c of cellsDoc.cells) expect(byCell.get(c.id)).toBe(c.population);
  });

  it('the TopoJSON has a shape for every cell and prefecture and stays under the size limit', () => {
    const cellIds = topo.objects.cells.geometries.map((g: { id: string }) => g.id).sort();
    expect(cellIds).toEqual(cellsDoc.cells.map((c: { id: string }) => c.id).sort());
    const prefIds = topo.objects.prefs.geometries.map((g: { id: string }) => g.id).sort();
    expect(prefIds).toEqual(cellsDoc.prefectures.map((p: { code: string }) => p.code).sort());
    expect(statSync(join(dir, 'japan.topo.json')).size).toBeLessThanOrEqual(GEO_CONFIG.maxTopoBytes);
  });
});
