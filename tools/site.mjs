// CI: the files Pages serves are every file in the repository except the tests, the tools and CI (git ls-files), copied
// into a directory; then every local file the page refers to (in index.html: scripts and links; in every .js/.mjs that is
// served: relative imports, the page's module list, fetched files) must be there, so a missing file fails the run instead
// of breaking the published page. Usage: node tools/site.mjs <dir>
import { cpSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname, normalize } from 'node:path';
const out = process.argv[2] ?? '_site';
const files = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !/^(test|tools|\.github)\//.test(f) && !/^(package\.json|\.prettierrc\.json|\.gitignore)$/.test(f));
mkdirSync(out, { recursive: true });
for (const f of files) {
  mkdirSync(join(out, dirname(f)), { recursive: true });
  cpSync(f, join(out, f));
}
const refs = new Set();
for (const m of readFileSync('index.html', 'utf8').matchAll(/(?:src|href)="([^"#:?]+)(?:\?[^"]*)?"/g)) refs.add(m[1]);
for (const f of files.filter((x) => /\.m?js$/.test(x))) {
  const js = readFileSync(f, 'utf8');
  for (const m of js.matchAll(/(?:from|import\()\s*['`](\.{1,2}\/[^'`?$]+)/g)) refs.add(normalize(join(dirname(f), m[1])));
  for (const m of js.matchAll(/fetch\('([^':?]+)'/g)) refs.add(m[1]);
}
const mods = readFileSync('bight.js', 'utf8').match(/export const MODULES = \[([^\]]+)\]/)?.[1] ?? '';
for (const m of mods.matchAll(/'([a-z-]+)'/g)) refs.add(`lib/${m[1]}.mjs`);
const missing = [...refs].filter((r) => !existsSync(join(out, r)));
if (missing.length) {
  console.log(`the site refers to files it does not have: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`site: ${files.length} files, ${refs.size} local references, all present`);
