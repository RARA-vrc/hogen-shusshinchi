// Raw inputs of the geography pipeline. Files are downloaded into data/raw/
// (git-ignored) and are never committed. Licence details for each source live
// in data/licenses.yaml; keep the two in sync when a source changes.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RAW_DIR = join(ROOT, 'data', 'raw');

export interface RawSource {
  id: string; // matches the id in data/licenses.yaml
  url: string;
  file: string; // path relative to data/raw
  minBytes: number; // sanity check against truncated downloads
}

export const SOURCES: RawSource[] = [
  {
    // National Land Numerical Information, medical areas, FY2020 (v2.0)
    id: 'ksj-a38-2020',
    url: 'https://nlftp.mlit.go.jp/ksj/gml/data/A38/A38-20/A38-20_GML.zip',
    file: 'a38/A38-20_GML.zip',
    minBytes: 1_000_000_000,
  },
  {
    // 2020 Population Census, main results by prefecture and municipality
    id: 'census-2020',
    url: 'https://www.e-stat.go.jp/stat-search/file-download?statInfId=000032143614&fileKind=0',
    file: 'census/major_results_2020.xlsx',
    minBytes: 1_000_000,
  },
];

export function rawPath(id: string): string {
  for (let i = 0; i < SOURCES.length; i++) {
    if (SOURCES[i].id === id) return join(RAW_DIR, SOURCES[i].file);
  }
  throw new Error(`unknown source: ${id}`);
}
