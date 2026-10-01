// CI: when the code changed since `base`, version.json must have gone up (a version not above the last is never offered
// to open tabs, so they would keep running the old code). The comparison is lib/version.mjs, the page's own.
// Usage: node tools/version-up.mjs <base-commit>
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { newer } from '../lib/version.mjs';
const base = process.argv[2];
const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
let changed;
try {
  changed = sh(`git diff --name-only ${base} HEAD`).split('\n');
} catch {
  console.log('no base commit to compare with');
  process.exit(0);
}
if (!changed.some((f) => /^(bight\.js|bight-app\.js|theme\.js|lib\/|index\.html)/.test(f))) process.exit(0);
const now = JSON.parse(readFileSync('version.json', 'utf8')).version;
let was;
try {
  was = JSON.parse(sh(`git show ${base}:version.json`)).version;
} catch {
  console.log(`no version.json at ${base}: the first versioned release (${now})`);
  process.exit(0);
}
if (!newer(now, was)) {
  console.log(`version ${now} is not above ${was}: bump version.json with the code (README, Releasing)`);
  process.exit(1);
}
console.log(`version ${was} → ${now}`);
