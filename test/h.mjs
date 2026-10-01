// the tiny harness every test file uses: t(name, cond, detail) and done()
let ok = 0,
  bad = 0;
export const t = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `\n        ${detail}`}`);
  cond ? ok++ : bad++;
};
export const done = () => {
  console.log(`\n${ok} passed, ${bad} failed`);
  process.exit(bad ? 1 : 0);
};
