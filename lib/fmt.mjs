// Words and links: escaping for markup, numbers, ages, block ETAs, the explorer. Pure; tested in test/lib-test.mjs.
export const esc = (x) =>
  String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const n = (x) => Number(x).toLocaleString('en-US');
export const fmtAge = (s) => (s < 60 ? `${s} s` : s < 3570 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);
// minutes between blocks when the page has too few to judge: testnet4's target is 10, but a block may be mined at the
// minimum difficulty after 20 minutes without one, and on txbt4 that rule sets the pace
export const BLOCK_MIN = 20;
// the spacing the chain keeps lately: the median gap between the header times of consecutive blocks the page holds
// (blocks: [{ height, time }]), in minutes, between 1 and 60; BLOCK_MIN with fewer than 3 gaps
export function spacingMin(blocks) {
  const bs = [...blocks].filter((b) => Number.isFinite(b?.time)).sort((a, b) => a.height - b.height);
  const gaps = [];
  for (let i = 1; i < bs.length; i++) if (bs[i].height === bs[i - 1].height + 1) gaps.push((bs[i].time - bs[i - 1].time) / 60);
  if (gaps.length < 3) return BLOCK_MIN;
  gaps.sort((a, b) => a - b);
  const m = gaps.length >> 1;
  const med = gaps.length % 2 ? gaps[m] : (gaps[m - 1] + gaps[m]) / 2;
  return Math.min(60, Math.max(1, med));
}
// the projected block i in time: "next block", then "in ~N min" at the spacing the chain keeps lately
export const etaWords = (i, spacing = BLOCK_MIN) => (i === 0 ? 'next block' : `in ~${Math.round((i + 1) * spacing)} min`);
export const EXPLORER = 'https://mempool.guide/testnet4';
export const hex64 = (x) => /^[0-9a-f]{64}$/.test(String(x));
export const txUrl = (txid) => (hex64(txid) ? `${EXPLORER}/tx/${txid}` : '#');
export const blockUrl = (hash) => (hex64(hash) ? `${EXPLORER}/block/${hash}` : '#');
// a count with its noun: "1 transaction", "2 transactions"
export const pl = (count, one, many = one + 's') => `${n(count)} ${Number(count) === 1 ? one : many}`;
// bytes in decimal units, as disks and browsers state them: "870 MB", "1.2 GB" (one way of saying sizes on the whole page)
export const fmtGB = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : b > 0 ? '< 1 MB' : '0 MB');
