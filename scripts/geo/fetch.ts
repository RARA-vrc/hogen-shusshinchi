// Downloads the raw inputs listed in sources.ts into data/raw/ (git-ignored).
// Existing files of plausible size are kept; pass --force to download again.
//
//   node scripts/geo/fetch.ts [--force]

import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { RAW_DIR, SOURCES } from './sources.ts';

async function main(): Promise<void> {
  const force = process.argv.indexOf('--force') >= 0;
  for (let i = 0; i < SOURCES.length; i++) {
    const s = SOURCES[i];
    const dest = join(RAW_DIR, s.file);
    if (!force && existsSync(dest) && statSync(dest).size >= s.minBytes) {
      console.log(`[skip] ${s.id}: ${dest} (${statSync(dest).size} bytes)`);
      continue;
    }
    console.log(`[get ] ${s.id}: ${s.url}`);
    mkdirSync(dirname(dest), { recursive: true });
    const res = await fetch(s.url, { headers: { 'User-Agent': 'Mozilla/5.0 (data build script)' } });
    if (!res.ok || res.body === null) throw new Error(`${s.id}: HTTP ${res.status}`);
    const tmp = `${dest}.part`;
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
    const size = statSync(tmp).size;
    if (size < s.minBytes) throw new Error(`${s.id}: download too small (${size} bytes)`);
    renameSync(tmp, dest);
    console.log(`[done] ${s.id}: ${size} bytes`);
  }
}

if (import.meta.main) await main();
