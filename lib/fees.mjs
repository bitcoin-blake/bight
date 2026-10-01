// Fee-rate bands for the histogram, and the colours of the projected blocks. Pure; tested in test/lib-test.mjs.
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
// colour arithmetic (WCAG 2): HSL → sRGB, relative luminance, contrast ratio
export function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((x) => Math.round(x * 255));
}
export function luminance([r, g, b]) {
  const c = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
export const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
export const WHITE = [255, 255, 255];
// the two stops of a projected block's gradient for a fee rate, dark enough that white text on either reads at 4.5:1 or
// better (a yellow-green at the same lightness as a blue is far brighter, so the lightness is lowered until it passes)
export function feeColors(rate) {
  const h = Math.round(feeHue(rate ?? 1));
  let l1 = 40;
  while (contrast(WHITE, hslToRgb(h, 65, l1)) < 4.6 && l1 > 10) l1--;
  const l2 = Math.max(10, l1 - 12);
  return { c1: `hsl(${h} 65% ${l1}%)`, c2: `hsl(${h} 70% ${l2}%)`, rgb1: hslToRgb(h, 65, l1), rgb2: hslToRgb(h, 70, l2) };
}
