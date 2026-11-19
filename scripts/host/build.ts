// Builds src/generated/host.json from data/host/*.yaml.
//
// Each file holds the host character's lines for one regional block
// ("standard" is the dialect-neutral set and the fallback). All host lines
// must stay needs_review: true until a human editor has approved them.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { ROOT, loadGeo } from '../sim/geo-model.ts';

export const HOST_KEYS = [
  'start',
  'next',
  'hunch',
  'result_cell',
  'result_pref',
  'result_region',
  'retry',
  'hit',
  'miss',
  'ask_answer',
  'thanks',
];

export const STANDARD = 'standard';

export interface HostFile {
  id: string;
  needs_review: boolean;
  notes?: string;
  lines: Record<string, string[]>;
}

export interface HostJson {
  // voices[id].lines[key] = list of lines; id is "standard" or a region id.
  voices: Record<string, { needs_review: boolean; lines: Record<string, string[]> }>;
}

export function validateHost(files: HostFile[], regionIds: string[]): string[] {
  const errors: string[] = [];
  let hasStandard = false;
  const seen: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (seen.indexOf(f.id) >= 0) errors.push(`${f.id}: duplicate host file`);
    seen.push(f.id);
    if (f.id === STANDARD) hasStandard = true;
    else if (regionIds.indexOf(f.id) < 0) errors.push(`${f.id}: not a region id`);
    if (typeof f.needs_review !== 'boolean') errors.push(`${f.id}: needs_review must be true or false`);
    const keys = Object.keys(f.lines ?? {});
    if (keys.length === 0) errors.push(`${f.id}: no lines`);
    for (let k = 0; k < keys.length; k++) {
      if (HOST_KEYS.indexOf(keys[k]) < 0) errors.push(`${f.id}: unknown line key "${keys[k]}"`);
      const list = f.lines[keys[k]];
      if (!Array.isArray(list) || list.length === 0) {
        errors.push(`${f.id}: "${keys[k]}" must be a non-empty list`);
        continue;
      }
      for (let j = 0; j < list.length; j++) {
        if (typeof list[j] !== 'string' || list[j].trim() === '') errors.push(`${f.id}: empty line in "${keys[k]}"`);
      }
    }
    if (f.id === STANDARD) {
      for (let k = 0; k < HOST_KEYS.length; k++) {
        if (keys.indexOf(HOST_KEYS[k]) < 0) errors.push(`standard: missing "${HOST_KEYS[k]}" (it is the fallback)`);
      }
    }
  }
  if (!hasStandard) errors.push('data/host/standard.yaml is required');
  return errors;
}

export function loadHostFiles(dir: string): HostFile[] {
  const names = readdirSync(dir).filter((n) => n.endsWith('.yaml')).sort();
  const out: HostFile[] = [];
  for (let i = 0; i < names.length; i++) {
    const f = parse(readFileSync(join(dir, names[i]), 'utf8')) as HostFile;
    if (`${f.id}.yaml` !== names[i]) throw new Error(`${names[i]}: file name must match id "${f.id}"`);
    out.push(f);
  }
  return out;
}

export function buildHost(files: HostFile[], regionIds: string[]): HostJson {
  const errors = validateHost(files, regionIds);
  if (errors.length > 0) throw new Error(`host data is invalid:\n  ${errors.join('\n  ')}`);
  const voices: HostJson['voices'] = {};
  for (let i = 0; i < files.length; i++) {
    voices[files[i].id] = { needs_review: files[i].needs_review, lines: files[i].lines };
  }
  return { voices };
}

function main(): void {
  const geo = loadGeo(ROOT);
  const files = loadHostFiles(join(ROOT, 'data', 'host'));
  const host = buildHost(files, geo.regionIds);
  const outDir = join(ROOT, 'src', 'generated');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'host.json'), JSON.stringify(host, null, 1) + '\n');
  console.log(`Built host lines for ${files.length} voices -> src/generated/host.json`);
}

if (import.meta.main) main();
