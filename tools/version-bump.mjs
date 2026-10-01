// Writes a release's version in every place it lives: version.json, VERSION in bight.js, and bight.js?v= and theme.js?v=
// in index.html (test/release-test.mjs checks they agree; tools/version-up.mjs that it went up with the code). With no
// argument: the next version after the current one, today's date (UTC) and .1 on a new day, else the next number.
//   node tools/version-bump.mjs [YYYY-MM-DD.N]
import { readFileSync, writeFileSync } from 'node:fs';
import { versionKey, newer } from '../lib/version.mjs';
const was = JSON.parse(readFileSync('version.json', 'utf8')).version;
const today = new Date().toISOString().slice(0, 10);
const next = process.argv[2] ?? (was.startsWith(today + '.') ? `${today}.${versionKey(was)[3] + 1}` : `${today}.1`);
if (versionKey(next).length !== 4 || !newer(next, was)) {
  console.log(`${next} is not a version above ${was} (YYYY-MM-DD.N)`);
  process.exit(1);
}
const swap = (file, pairs) => {
  let s = readFileSync(file, 'utf8');
  for (const [re, to] of pairs) {
    if (!re.test(s)) {
      console.log(`${file}: no ${re} to replace`);
      process.exit(1);
    }
    s = s.replace(re, to);
  }
  writeFileSync(file, s);
};
swap('version.json', [[/"version": "[^"]+"/, `"version": "${next}"`]]);
swap('bight.js', [[/export const VERSION = '[^']+';/, `export const VERSION = '${next}';`]]);
swap('index.html', [
  [/bight\.js\?v=[^"]+"/, `bight.js?v=${next}"`],
  [/theme\.js\?v=[^"]+"/, `theme.js?v=${next}"`],
]);
console.log(`version ${was} → ${next}`);
