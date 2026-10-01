// Fee-rate bands for the histogram, and the colour scale of the projected blocks. Pure; tested in test/fees-test.mjs.
// The first band is everything under 1 sat/vB (the mempool's floor is configurable, so it is not assumed).
export const BANDS = [0, 1, 2, 3, 5, 8, 12, 20, 30, 50, 80, 120, 200, 300, 500, 1000];
export function bandOf(rate) {
  if (!(rate >= 0)) return 0;
  let i = 0;
  while (i + 1 < BANDS.length && rate >= BANDS[i + 1]) i++;
  return i;
}
export const bandLabel = (i) => (i === 0 ? '< 1' : i === BANDS.length - 1 ? `≥ ${BANDS[i]}` : `${BANDS[i]}–${BANDS[i + 1]}`);
// vB per band
export function histogram(txs) {
  const out = BANDS.map(() => 0);
  for (const t of txs) out[bandOf(t.feeRate)] += t.vsize;
  return out;
}
// a hue from blue (1 sat/vB) to orange (1000 and above), on a log scale
export const feeHue = (rate) => 210 - 180 * Math.max(0, Math.min(1, Math.log10(Math.max(1, rate)) / 3));
