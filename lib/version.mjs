// Versions "YYYY-MM-DD.N": compared as numbers, field by field, so a stale copy is never offered as newer. Used by the
// page's update notice and by tools/version-up.mjs (CI). Tested in test/lib-test.mjs.
export const versionKey = (v) => (/^(\d{4})-(\d{2})-(\d{2})\.(\d+)$/.exec(String(v ?? '')) ?? []).slice(1).map(Number);
export function newer(a, b) {
  const x = versionKey(a),
    y = versionKey(b);
  if (x.length !== 4 || y.length !== 4) return false;
  const i = x.findIndex((v, j) => v !== y[j]);
  return i >= 0 && x[i] > y[i];
}
