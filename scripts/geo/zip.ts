// Small promise wrappers around yauzl for the data scripts.

import { createWriteStream, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import yauzl from 'yauzl';

export function listZip(zipPath: string): Promise<{ name: string; size: number }[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, decodeStrings: false }, (err, zip) => {
      if (err || !zip) return reject(err);
      const out: { name: string; size: number }[] = [];
      zip.on('entry', (e) => {
        out.push({ name: decodeName(e.fileName as unknown as Buffer), size: e.uncompressedSize });
        zip.readEntry();
      });
      zip.on('end', () => resolve(out));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

// Entry names in the KSJ archives are Shift_JIS; names we care about are ASCII
// in their file-name part, so a lossy decode is enough for matching.
function decodeName(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('shift_jis').decode(buf);
  }
}

// Extracts entries whose name passes `want` into destDir (flattened to the
// base name). Returns the written paths.
export function extractZip(
  zipPath: string,
  want: (name: string) => boolean,
  destDir: string,
): Promise<string[]> {
  mkdirSync(destDir, { recursive: true });
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, decodeStrings: false }, (err, zip) => {
      if (err || !zip) return reject(err);
      const written: string[] = [];
      zip.on('entry', (e) => {
        const name = decodeName(e.fileName as unknown as Buffer);
        if (name.endsWith('/') || !want(name)) return zip.readEntry();
        zip.openReadStream(e, (err2, stream) => {
          if (err2 || !stream) return reject(err2);
          const dest = join(destDir, basename(name));
          const ws = createWriteStream(dest);
          stream.pipe(ws);
          ws.on('finish', () => {
            written.push(dest);
            zip.readEntry();
          });
          ws.on('error', reject);
        });
      });
      zip.on('end', () => resolve(written));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

// Reads entries whose name passes `want` fully into memory.
export function readZip(zipPath: string, want: (name: string) => boolean): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      const out = new Map<string, Buffer>();
      zip.on('entry', (e) => {
        if (!want(e.fileName)) return zip.readEntry();
        zip.openReadStream(e, (err2, stream) => {
          if (err2 || !stream) return reject(err2);
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => {
            out.set(e.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
          stream.on('error', reject);
        });
      });
      zip.on('end', () => resolve(out));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}
