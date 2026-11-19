// Builds the committed geography outputs from the raw downloads:
//
//   data/geo/cells.json           cells (secondary medical areas): id, name,
//                                 prefecture, representative point, population
//   data/geo/municipalities.json  municipality -> cell table with population
//   data/geo/japan.topo.json      simplified TopoJSON (layers: cells, prefs)
//
//   node scripts/geo/fetch.ts && node scripts/geo/build.ts
//
// The cell definition is data-driven: everything downstream only reads
// cells.json / japan.topo.json, so another partition (e.g. dialect regions)
// can replace this one by regrouping municipalities here.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCensus, type CensusRow } from './census.ts';
import { ROOT, rawPath } from './sources.ts';
import { extractZip } from './zip.ts';

export const GEO_CONFIG = {
  // Share of vertices kept by mapshaper's weighted Visvalingam simplification.
  simplifyPercent: 1.2,
  // Islands smaller than this are dropped from the map (not from the data).
  minIslandKm2: 3,
  // Coordinate quantization of the TopoJSON output.
  quantization: 20000,
  // Decimal places of representative points in cells.json.
  coordDecimals: 4,
  // Hard limit for the TopoJSON file.
  maxTopoBytes: 2 * 1024 * 1024,
};

const OUT_DIR = join(ROOT, 'data', 'geo');
const WORK_DIR = join(ROOT, 'data', 'raw', 'a38', 'extracted');
const SHP = join(WORK_DIR, 'A38-20_1.shp');
const MAPSHAPER = join(ROOT, 'node_modules', 'mapshaper', 'bin', 'mapshaper');

export interface Cell {
  id: string;
  // Official name of the secondary medical area. Kept for reference only;
  // the UI shows `label`, which players can recognise.
  name: string;
  // Display name built from the largest city in the cell, e.g. "札幌市周辺".
  label: string;
  pref: string;
  lon: number;
  lat: number;
  population: number;
}

export interface Municipality {
  code: string;
  name: string;
  cell: string;
  population: number;
}

interface PartRow {
  code: string;
  cell: string;
  cellName: string;
  cx: number;
  cy: number;
  area: number;
}

function mapshaper(args: string[]): void {
  const res = spawnSync(process.execPath, ['--max-old-space-size=16000', MAPSHAPER, ...args], {
    cwd: WORK_DIR,
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new Error(`mapshaper failed:\n${res.stdout}\n${res.stderr}`);
  }
  const log = (res.stderr + res.stdout).split('\n');
  for (let i = 0; i < log.length; i++) {
    if (log[i].trim() !== '' && !log[i].startsWith('Allocating')) console.log(`  mapshaper: ${log[i]}`);
  }
}

// Minimal CSV reader for mapshaper output (quoted fields, no embedded newlines).
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') continue;
    const row: string[] = [];
    let cur = '';
    let quoted = false;
    for (let k = 0; k < line.length; k++) {
      const ch = line[k];
      if (quoted) {
        if (ch === '"' && line[k + 1] === '"') {
          cur += '"';
          k++;
        } else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') {
        row.push(cur);
        cur = '';
      } else cur += ch;
    }
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function readParts(csvPath: string): PartRow[] {
  const rows = parseCsv(readFileSync(csvPath, 'utf8'));
  const head = rows[0];
  const col = (name: string): number => {
    const i = head.indexOf(name);
    if (i < 0) throw new Error(`parts.csv: missing column ${name}`);
    return i;
  };
  const iCode = col('A38a_001');
  const iCell = col('A38a_003');
  const iName = col('A38a_004');
  const iCx = col('cx');
  const iCy = col('cy');
  const iArea = col('area');
  const out: PartRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    out.push({
      code: r[iCode],
      cell: r[iCell],
      cellName: r[iName],
      cx: Number(r[iCx]),
      cy: Number(r[iCy]),
      area: Number(r[iArea]),
    });
  }
  return out;
}

function round(v: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

// Combines polygon parts and census rows into cells and municipalities.
// The representative point of a cell is the population-weighted mean of its
// municipalities' centroids (centroid of each municipality's largest part),
// i.e. an approximate centre of population rather than of land area.
export function assemble(
  parts: PartRow[],
  census: CensusRow[],
  coordDecimals: number,
): { cells: Cell[]; municipalities: Municipality[] } {
  const censusByCode = new Map<string, CensusRow>();
  for (let i = 0; i < census.length; i++) censusByCode.set(census[i].code, census[i]);

  // Largest part per municipality.
  const best = new Map<string, PartRow>();
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const cur = best.get(p.code);
    if (cur !== undefined && cur.cell !== p.cell) {
      throw new Error(`municipality ${p.code} belongs to two cells: ${cur.cell}, ${p.cell}`);
    }
    if (cur === undefined || p.area > cur.area) best.set(p.code, p);
  }

  const municipalities: Municipality[] = [];
  const members = new Map<string, CensusRow[]>();
  const acc = new Map<string, { name: string; pop: number; wx: number; wy: number; sx: number; sy: number; n: number }>();
  const codes = Array.from(best.keys()).sort();
  for (let i = 0; i < codes.length; i++) {
    const p = best.get(codes[i])!;
    const c = censusByCode.get(p.code);
    if (c === undefined) throw new Error(`municipality ${p.code} is missing from the census table`);
    if (!Number.isFinite(p.cx) || !Number.isFinite(p.cy)) throw new Error(`no centroid for ${p.code}`);
    municipalities.push({ code: p.code, name: c.name, cell: p.cell, population: c.population });
    let a = acc.get(p.cell);
    if (a === undefined) {
      a = { name: p.cellName, pop: 0, wx: 0, wy: 0, sx: 0, sy: 0, n: 0 };
      acc.set(p.cell, a);
      members.set(p.cell, []);
    }
    members.get(p.cell)!.push(c);
    a.pop += c.population;
    a.wx += p.cx * c.population;
    a.wy += p.cy * c.population;
    a.sx += p.cx;
    a.sy += p.cy;
    a.n += 1;
  }

  const cells: Cell[] = [];
  const ids = Array.from(acc.keys()).sort();
  const labels = cellLabels(ids, members);
  for (let i = 0; i < ids.length; i++) {
    const a = acc.get(ids[i])!;
    const lon = a.pop > 0 ? a.wx / a.pop : a.sx / a.n;
    const lat = a.pop > 0 ? a.wy / a.pop : a.sy / a.n;
    cells.push({
      id: ids[i],
      name: a.name,
      label: labels[i],
      pref: ids[i].slice(0, 2),
      lon: round(lon, coordDecimals),
      lat: round(lat, coordDecimals),
      population: a.pop,
    });
  }
  return { cells, municipalities };
}

const TOKYO_WARDS = '13100';

// Display names. The largest city of a cell names it ("札幌市周辺"; just
// "横浜市" when the cell is that city alone). When several cells share the
// same largest city (a big city split into several cells, or the Tokyo
// wards), the largest ward is used instead ("川崎市中原区周辺", "世田谷区周辺").
export function cellLabels(ids: string[], members: Map<string, CensusRow[]>): string[] {
  const topCity: string[] = [];
  const topCityName: string[] = [];
  const shareCount = new Map<string, number>();
  for (let i = 0; i < ids.length; i++) {
    const rows = members.get(ids[i])!;
    const popByCity = new Map<string, number>();
    for (let k = 0; k < rows.length; k++) {
      popByCity.set(rows[k].cityCode, (popByCity.get(rows[k].cityCode) ?? 0) + rows[k].population);
    }
    let best = '';
    let bestName = '';
    let bestPop = -1;
    for (let k = 0; k < rows.length; k++) {
      const pop = popByCity.get(rows[k].cityCode)!;
      if (pop > bestPop) {
        bestPop = pop;
        best = rows[k].cityCode;
        bestName = rows[k].cityName;
      }
    }
    topCity.push(best);
    topCityName.push(bestName);
    shareCount.set(best, (shareCount.get(best) ?? 0) + 1);
  }
  const out: string[] = [];
  for (let i = 0; i < ids.length; i++) {
    const rows = members.get(ids[i])!;
    const shared = topCity[i] === TOKYO_WARDS || shareCount.get(topCity[i])! > 1;
    let base = topCityName[i];
    let alone = true;
    if (shared) {
      let ward: CensusRow | null = null;
      for (let k = 0; k < rows.length; k++) {
        if (rows[k].cityCode !== topCity[i]) continue;
        if (ward === null || rows[k].population > ward.population) ward = rows[k];
      }
      base = ward!.name;
      alone = rows.length === 1;
    } else {
      for (let k = 0; k < rows.length; k++) if (rows[k].cityCode !== topCity[i]) alone = false;
    }
    out.push(alone ? base : `${base}周辺`);
  }
  return out;
}

function prefectures(census: CensusRow[]): { code: string; name: string; population: number }[] {
  const out: { code: string; name: string; population: number }[] = [];
  for (let i = 0; i < census.length; i++) {
    const c = census[i];
    if (c.kind === 'a' && c.code !== '00000' && c.code.endsWith('000')) {
      out.push({ code: c.code.slice(0, 2), name: c.name, population: c.population });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const zip = rawPath('ksj-a38-2020');
  const xlsx = rawPath('census-2020');
  if (!existsSync(zip) || !existsSync(xlsx)) {
    throw new Error('raw data is missing; run: node scripts/geo/fetch.ts');
  }
  mkdirSync(OUT_DIR, { recursive: true });

  if (!existsSync(SHP)) {
    console.log('Extracting the municipality-level shapefile...');
    await extractZip(zip, (n) => /A38-20_1\.(shp|shx|dbf|prj)$/.test(n), WORK_DIR);
  }

  console.log('Measuring polygon parts...');
  const partsCsv = join(WORK_DIR, 'parts.csv');
  mapshaper([
    '-i', 'A38-20_1.shp', 'encoding=shift_jis',
    '-each', 'cx=this.centroidX, cy=this.centroidY, area=this.area',
    '-o', 'parts.csv',
  ]);

  console.log('Reading the census table...');
  const census = await readCensus(xlsx);
  const { cells, municipalities } = assemble(readParts(partsCsv), census, GEO_CONFIG.coordDecimals);
  const prefs = prefectures(census);

  let total = 0;
  for (let i = 0; i < cells.length; i++) total += cells[i].population;
  const national = census.find((c) => c.code === '00000');
  if (national === undefined || national.population !== total) {
    throw new Error(`population mismatch: cells ${total}, census ${national?.population}`);
  }
  if (prefs.length !== 47) throw new Error(`expected 47 prefectures, got ${prefs.length}`);

  console.log('Simplifying polygons...');
  const topoPath = join(OUT_DIR, 'japan.topo.json');
  rmSync(topoPath, { force: true });
  mapshaper([
    '-i', 'A38-20_1.shp', 'encoding=shift_jis', 'name=cells',
    '-dissolve', 'A38a_003',
    '-rename-fields', 'id=A38a_003',
    '-simplify', `${GEO_CONFIG.simplifyPercent}%`, 'weighted', 'keep-shapes',
    '-filter-islands', `min-area=${GEO_CONFIG.minIslandKm2}km2`,
    '-clean',
    '-each', 'pref=id.slice(0,2)',
    '-dissolve', 'pref', '+', 'name=prefs',
    '-rename-fields', 'id=pref', 'target=prefs',
    '-filter-fields', 'id', 'target=cells',
    '-o', topoPath, 'format=topojson', 'target=cells,prefs', 'id-field=id',
    `quantization=${GEO_CONFIG.quantization}`,
  ]);

  // Every cell and prefecture must still have a shape after simplification.
  const topo = JSON.parse(readFileSync(topoPath, 'utf8'));
  const check = (layer: string, expected: string[]): void => {
    const geoms = topo.objects[layer].geometries as { id?: string; type: string | null }[];
    const have = new Set<string>();
    for (let i = 0; i < geoms.length; i++) {
      if (geoms[i].type !== null && geoms[i].id !== undefined) have.add(String(geoms[i].id));
    }
    for (let i = 0; i < expected.length; i++) {
      if (!have.has(expected[i])) throw new Error(`${layer}: no shape for ${expected[i]}`);
    }
    if (have.size !== expected.length) throw new Error(`${layer}: ${have.size} shapes, expected ${expected.length}`);
  };
  check('cells', cells.map((c) => c.id));
  check('prefs', prefs.map((p) => p.code));
  const topoBytes = statSync(topoPath).size;
  if (topoBytes > GEO_CONFIG.maxTopoBytes) {
    throw new Error(`japan.topo.json is ${topoBytes} bytes, over the ${GEO_CONFIG.maxTopoBytes} limit`);
  }

  const meta = {
    cellDefinition: 'secondary-medical-area',
    cellSource: 'ksj-a38-2020',
    populationSource: 'census-2020',
  };
  writeFileSync(
    join(OUT_DIR, 'cells.json'),
    JSON.stringify({ ...meta, prefectures: prefs, cells }, null, 1) + '\n',
  );
  writeFileSync(
    join(OUT_DIR, 'municipalities.json'),
    JSON.stringify({ ...meta, municipalities }) + '\n',
  );
  console.log(
    `Wrote ${cells.length} cells, ${municipalities.length} municipalities, ` +
      `${prefs.length} prefectures; japan.topo.json is ${(topoBytes / 1024).toFixed(0)} KB.`,
  );
}

if (import.meta.main) await main();
