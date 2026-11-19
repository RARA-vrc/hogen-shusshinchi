// Reads municipal populations from the 2020 census workbook
// ("都道府県・市区町村別の主な結果", sheet 1). Column B holds
// "<5-digit code>_<name>", column D the area type, column E total population.

import { readZip } from './zip.ts';

export interface CensusRow {
  code: string; // 5-digit municipality code
  name: string;
  kind: string; // a: prefecture/national, 0: ward of a designated city, 1: designated city, 2: city, 3: town/village
  population: number;
}

function decodeXml(s: string): string {
  return s
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

export function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const items = xml.match(/<si>[\s\S]*?<\/si>/g) ?? [];
  for (let i = 0; i < items.length; i++) {
    // Skip phonetic runs (<rPh>), which hold furigana.
    const body = items[i].replace(/<rPh[\s\S]*?<\/rPh>/g, '');
    const texts = body.match(/<t[^>]*>[^<]*<\/t>/g) ?? [];
    let s = '';
    for (let k = 0; k < texts.length; k++) s += texts[k].replace(/<[^>]+>/g, '');
    out.push(decodeXml(s));
  }
  return out;
}

export function parseSheetRows(xml: string, strings: string[]): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const rowRe = /<row [^>]*>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml)) !== null) {
    const row: Record<string, string> = {};
    const cellRe = /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[1])) !== null) {
      if (cm[3] === undefined) continue;
      const v = /<v>([^<]*)<\/v>/.exec(cm[3]);
      if (v === null) continue;
      row[cm[1]] = cm[2].includes('t="s"') ? strings[Number(v[1])] : decodeXml(v[1]);
    }
    rows.push(row);
  }
  return rows;
}

export function rowsToCensus(rows: Record<string, string>[]): CensusRow[] {
  const out: CensusRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const m = /^(\d{5})_(.+)$/.exec(rows[i].B ?? '');
    if (m === null) continue;
    // "-" means no residents were counted (e.g. a fully evacuated town in 2020).
    const raw = (rows[i].E ?? '').trim();
    const population = raw === '-' ? 0 : Number(raw);
    if (raw === '' || !Number.isFinite(population)) {
      throw new Error(`census: no population for ${rows[i].B}`);
    }
    out.push({ code: m[1], name: m[2], kind: rows[i].D ?? '', population });
  }
  return out;
}

export async function readCensus(xlsxPath: string): Promise<CensusRow[]> {
  const files = await readZip(
    xlsxPath,
    (n) => n === 'xl/sharedStrings.xml' || n === 'xl/worksheets/sheet1.xml',
  );
  const ss = files.get('xl/sharedStrings.xml');
  const sheet = files.get('xl/worksheets/sheet1.xml');
  if (!ss || !sheet) throw new Error('census: unexpected workbook structure');
  return rowsToCensus(parseSheetRows(sheet.toString('utf8'), parseSharedStrings(ss.toString('utf8'))));
}
