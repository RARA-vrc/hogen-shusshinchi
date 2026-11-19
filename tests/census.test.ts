import { describe, expect, it } from 'vitest';
import { parseSharedStrings, parseSheetRows, rowsToCensus } from '../scripts/geo/census.ts';

const SHARED =
  '<sst><si><t>01_北海道</t></si>' +
  '<si><t>01100_札幌市</t><rPh sb="0" eb="1"><t>サッポロ</t></rPh></si>' +
  '<si><t>a &amp; b</t></si>' +
  '<si><t>07546_双葉町</t></si><si><t>-</t></si></sst>';

const SHEET =
  '<worksheet><sheetData>' +
  '<row r="1"><c r="A1" t="s"><v>2</v></c></row>' +
  '<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="s"><v>1</v></c><c r="D2"><v>1</v></c><c r="E2"><v>1973395</v></c></row>' +
  '<row r="3"><c r="B3" t="s"><v>3</v></c><c r="C3"/><c r="D3"><v>3</v></c><c r="E3" t="s"><v>4</v></c></row>' +
  '</sheetData></worksheet>';

describe('census workbook parser', () => {
  it('reads shared strings without furigana and decodes entities', () => {
    expect(parseSharedStrings(SHARED)).toEqual(['01_北海道', '01100_札幌市', 'a & b', '07546_双葉町', '-']);
  });

  it('extracts municipality rows and treats "-" as zero', () => {
    const rows = parseSheetRows(SHEET, parseSharedStrings(SHARED));
    expect(
      rowsToCensus(rows).map((r) => ({ code: r.code, name: r.name, kind: r.kind, population: r.population })),
    ).toEqual([
      { code: '01100', name: '札幌市', kind: '1', population: 1973395 },
      { code: '07546', name: '双葉町', kind: '3', population: 0 },
    ]);
  });

  it('fails loudly when a population cell is missing', () => {
    expect(() => rowsToCensus([{ B: '01100_札幌市', D: '1' }])).toThrow();
  });
});
