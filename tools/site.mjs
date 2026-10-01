// CI: copies the files Pages serves into a directory and checks that every local file the page refers to (in index.html
// and bight.js: scripts, modules, fetched JSON) is there, so a file left out of the copy fails the run instead of breaking
// the published page. Usage: node tools/site.mjs <dir>
import { cpSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const out = process.argv[2] ?? '_site';
const FILES = ['index.html', 'bight.js', 'bight-app.js', 'theme.js', 'version.json', 'og.html', 'og.png', 'lib', 'README.md', 'LICENSE'];
mkdirSync(out, { recursive: true });
for (const f of FILES) cpSync(f, join(out, f), { recursive: true });
const refs = new Set();
for (const m of readFileSync('index.html', 'utf8').matchAll(/(?:src|href)="([^"#:?]+)(?:\?[^"]*)?"/g)) refs.add(m[1]);
const js = readFileSync('bight.js', 'utf8');
for (const m of js.matchAll(/'(pack|fees|seen|series|search|fmt|node-text|status|sources)'/g)) refs.add(`lib/${m[1]}.mjs`);
for (const m of js.matchAll(/fetch\('([^':?]+)'/g)) refs.add(m[1]);
const missing = [...refs].filter((r) => !existsSync(join(out, r)));
if (missing.length) {
  console.log(`the site refers to files it does not have: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`site: ${FILES.length} entries, ${refs.size} local references, all present`);
