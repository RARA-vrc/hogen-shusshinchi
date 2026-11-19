// Generates LICENSES.md and src/generated/credits.json from data/licenses.yaml
// plus the licence fields of the installed direct npm dependencies.
//
//   node scripts/build-licenses.ts          write both outputs
//   node scripts/build-licenses.ts --check  fail if LICENSES.md is out of date

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export interface LicenseEntry {
  id: string;
  category: string;
  name: string;
  source_url: string;
  license: string;
  license_url: string;
  credit: string;
  processing: string;
  retrieved: string;
}

export interface PackageEntry {
  name: string;
  version: string;
  license: string;
  url: string;
  bundled: boolean;
}

export interface CreditsModel {
  repoUrl: string;
  entries: LicenseEntry[];
  packages: PackageEntry[];
}

export const REQUIRED_FIELDS = [
  'id',
  'category',
  'name',
  'source_url',
  'license',
  'license_url',
  'credit',
  'processing',
  'retrieved',
];

export const CATEGORIES = ['code', 'own-data', 'third-party-data'];

const CATEGORY_TITLES: Record<string, string> = {
  code: 'コード',
  'own-data': '自作データ',
  'third-party-data': '第三者のデータ',
};

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function licenseOf(pkg: any): string {
  if (typeof pkg.license === 'string' && pkg.license !== '') return pkg.license;
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
  return '';
}

function urlOf(pkg: any): string {
  let url = '';
  if (typeof pkg.repository === 'string') url = pkg.repository;
  else if (pkg.repository && typeof pkg.repository.url === 'string') url = pkg.repository.url;
  url = url.replace(/^git\+/, '').replace(/\.git$/, '');
  if (!url.startsWith('http')) url = `https://www.npmjs.com/package/${pkg.name}`;
  return url;
}

// Licences accepted for code that is bundled into the published site.
export const BUNDLE_ALLOWED = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD'];

// Directories (relative to node_modules) of the given packages plus all their
// transitive dependencies. A dependency nested inside its parent
// (parent/node_modules/dep) takes precedence over the hoisted copy, as in
// Node's own resolution.
export function runtimeClosure(root: string, names: string[]): string[] {
  const seen: string[] = [];
  const queue = names.slice();
  while (queue.length > 0) {
    const dir = queue.pop()!;
    if (seen.indexOf(dir) >= 0) continue;
    seen.push(dir);
    const pkg = readJson(join(root, 'node_modules', dir, 'package.json'));
    const deps = Object.keys(pkg.dependencies ?? {});
    for (let i = 0; i < deps.length; i++) {
      const nested = `${dir}/node_modules/${deps[i]}`;
      queue.push(existsSync(join(root, 'node_modules', nested, 'package.json')) ? nested : deps[i]);
    }
  }
  return seen;
}

function readPackages(root: string, dirs: string[], bundled: boolean, out: PackageEntry[]): void {
  const rows: PackageEntry[] = [];
  for (let i = 0; i < dirs.length; i++) {
    const pkg = readJson(join(root, 'node_modules', dirs[i], 'package.json'));
    rows.push({
      name: String(pkg.name),
      version: String(pkg.version),
      license: licenseOf(pkg),
      url: urlOf(pkg),
      bundled,
    });
  }
  rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (let i = 0; i < rows.length; i++) out.push(rows[i]);
}

export function validateEntries(entries: LicenseEntry[]): string[] {
  const errors: string[] = [];
  const seen: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as unknown as Record<string, unknown>;
    const label = typeof e.id === 'string' ? e.id : `#${i}`;
    for (let k = 0; k < REQUIRED_FIELDS.length; k++) {
      const v = e[REQUIRED_FIELDS[k]];
      if (typeof v !== 'string' || v.trim() === '') {
        errors.push(`${label}: field "${REQUIRED_FIELDS[k]}" is missing or empty`);
      }
    }
    if (typeof e.category === 'string' && CATEGORIES.indexOf(e.category) < 0) {
      errors.push(`${label}: unknown category "${e.category}"`);
    }
    if (typeof e.license === 'string' && /(^|[^A-Za-z])NC([^A-Za-z]|$)|non-?commercial|非営利/i.test(e.license)) {
      errors.push(`${label}: non-commercial licences are not allowed in licenses.yaml`);
    }
    if (e.category === 'third-party-data') {
      if (typeof e.retrieved !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.retrieved)) {
        errors.push(`${label}: third-party data needs a retrieval date (YYYY-MM-DD)`);
      }
      if (typeof e.source_url !== 'string' || !e.source_url.startsWith('https://')) {
        errors.push(`${label}: third-party data needs an https source_url`);
      }
    }
    if (seen.indexOf(label) >= 0) errors.push(`${label}: duplicate id`);
    seen.push(label);
  }
  return errors;
}

export function loadModel(root: string): CreditsModel {
  const site = readJson(join(root, 'site.config.json'));
  const doc = parse(readFileSync(join(root, 'data', 'licenses.yaml'), 'utf8'));
  const entries: LicenseEntry[] = doc.entries;
  const errors = validateEntries(entries);
  if (errors.length > 0) {
    throw new Error(`data/licenses.yaml is invalid:\n  ${errors.join('\n  ')}`);
  }
  const pkg = readJson(join(root, 'package.json'));
  const packages: PackageEntry[] = [];
  // Runtime dependencies end up in the published site, so list them together
  // with everything they depend on, and only accept permissive licences.
  const runtime = runtimeClosure(root, Object.keys(pkg.dependencies ?? {}));
  readPackages(root, runtime, true, packages);
  for (let i = 0; i < packages.length; i++) {
    if (BUNDLE_ALLOWED.indexOf(packages[i].license) < 0) {
      throw new Error(
        `npm package "${packages[i].name}" (${packages[i].license}) would be bundled into the site ` +
          'but its licence is not on the allowed list; review it by hand',
      );
    }
  }
  readPackages(root, Object.keys(pkg.devDependencies ?? {}), false, packages);
  for (let i = 0; i < packages.length; i++) {
    if (packages[i].license === '') {
      throw new Error(`npm package "${packages[i].name}" has no licence field; check it by hand`);
    }
  }
  return {
    repoUrl: `https://github.com/${site.repoOwner}/${site.repoName}`,
    entries,
    packages,
  };
}

function cell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function sourceText(e: LicenseEntry, repoUrl: string): string {
  return e.source_url === 'self' ? `本リポジトリ(${repoUrl})` : e.source_url;
}

function retrievedText(e: LicenseEntry): string {
  return e.retrieved === 'n/a' ? '—(自作)' : e.retrieved;
}

function packageTable(lines: string[], packages: PackageEntry[], bundled: boolean): void {
  let count = 0;
  for (let i = 0; i < packages.length; i++) if (packages[i].bundled === bundled) count++;
  if (count === 0) {
    lines.push('(該当なし)', '');
    return;
  }
  lines.push('| パッケージ | バージョン | ライセンス | 配布元 |', '| --- | --- | --- | --- |');
  for (let i = 0; i < packages.length; i++) {
    const p = packages[i];
    if (p.bundled !== bundled) continue;
    lines.push(`| ${cell(p.name)} | ${cell(p.version)} | ${cell(p.license)} | ${p.url} |`);
  }
  lines.push('');
}

export function renderMarkdown(model: CreditsModel): string {
  const lines: string[] = [];
  lines.push(
    '# LICENSES',
    '',
    '<!-- このファイルは data/licenses.yaml から scripts/build-licenses.ts が生成します。直接編集しないでください。 -->',
    '',
    'このリポジトリに含まれるコードとデータの権利情報です。アプリ内の「クレジット」画面も同じ元データ(`data/licenses.yaml`)から生成しています。',
    '',
  );
  for (let c = 0; c < CATEGORIES.length; c++) {
    lines.push(`## ${CATEGORY_TITLES[CATEGORIES[c]]}`, '');
    let count = 0;
    for (let i = 0; i < model.entries.length; i++) {
      const e = model.entries[i];
      if (e.category !== CATEGORIES[c]) continue;
      count++;
      lines.push(
        `### ${e.name}`,
        '',
        `- 名称:${e.name}`,
        `- 配布元URL:${sourceText(e, model.repoUrl)}`,
        `- ライセンス:${e.license}(${e.license_url})`,
        `- クレジット表記:${e.credit}`,
        `- 加工内容:${e.processing}`,
        `- 取得日:${retrievedText(e)}`,
        '',
      );
    }
    if (count === 0) lines.push('(現時点では同梱していません)', '');
  }
  lines.push(
    '## npm パッケージ',
    '',
    '直接依存しているパッケージの一覧です。ライセンスは、インストールされた各パッケージの `package.json` の `license` 欄から生成時に読み取っています。',
    '',
    '### 公開サイトに組み込まれるもの(dependencies と、その間接依存すべて)',
    '',
  );
  packageTable(lines, model.packages, true);
  lines.push('### 開発・ビルド時にのみ使うもの(devDependencies)', '');
  packageTable(lines, model.packages, false);
  return lines.join('\n');
}

export function renderCreditsJson(model: CreditsModel): string {
  return JSON.stringify(model, null, 2) + '\n';
}

function main(): void {
  const model = loadModel(ROOT);
  const md = renderMarkdown(model);
  const mdPath = join(ROOT, 'LICENSES.md');
  if (process.argv.indexOf('--check') >= 0) {
    let current = '';
    try {
      current = readFileSync(mdPath, 'utf8').replaceAll('\r\n', '\n');
    } catch {
      current = '';
    }
    if (current !== md) {
      console.error('LICENSES.md is out of date. Run: npm run licenses');
      process.exit(1);
    }
    console.log('LICENSES.md is up to date.');
    return;
  }
  writeFileSync(mdPath, md);
  const outDir = join(ROOT, 'src', 'generated');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'credits.json'), renderCreditsJson(model));
  console.log(`Wrote LICENSES.md and src/generated/credits.json (${model.entries.length} entries, ${model.packages.length} packages).`);
}

if (import.meta.main) main();
