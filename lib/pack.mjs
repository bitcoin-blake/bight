// The blocks this tab would build from its mempool, packed the way the node's own template builder packs (lib/template.mjs
// in blaketestnode): by fee rate, greedily, a transaction that does not fit is skipped and the next one tried, within the
// block's weight budget. Pure; tested in test/pack-test.mjs (and against the pinned template.mjs in test/contract-test.mjs).
export const REDUCED_DATA_MAX_BLOCK_WEIGHT = 800000;
export const FULL_MAX_BLOCK_WEIGHT = 4000000;
export const COINBASE_ROOM = 4000; // the template builder keeps this for the header and the coinbase
// a transaction's weight from what the mempool reports: vsize is weight / 4 rounded up, so 4 × vsize is never below it
export const weightOf = (t) => t.weight ?? t.vsize * 4;
export const byRate = (a, b) => b.feeRate - a.feeRate || (a.txid < b.txid ? -1 : 1);
// the median of numbers: the mean of the two middle values when there is an even count; null for none
export function median(xs) {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
// pack: [{ txs, weight, vsize, fees }] up to maxBlocks, each filled skip-and-continue from what the earlier ones left
export function packBlocks(txs, { rdts = true, maxBlocks = 8 } = {}) {
  const budget = (rdts === false ? FULL_MAX_BLOCK_WEIGHT : REDUCED_DATA_MAX_BLOCK_WEIGHT) - COINBASE_ROOM;
  let left = [...txs].sort(byRate);
  const blocks = [];
  while (left.length && blocks.length < maxBlocks) {
    const b = { txs: [], weight: 0, vsize: 0, fees: 0 };
    const rest = [];
    for (const t of left) {
      const w = weightOf(t);
      if (b.weight + w > budget) {
        rest.push(t);
        continue;
      }
      b.txs.push(t);
      b.weight += w;
      b.vsize += t.vsize;
      b.fees += t.fee;
    }
    if (!b.txs.length) break; // a transaction heavier than a whole block: nothing more can be packed
    blocks.push(b);
    left = rest;
  }
  return blocks.map((b) => ({ ...b, ...rateStats(b.txs) }));
}
// fee-rate figures of a set of transactions: lowest, highest, median (by count) and median weighted by size
export function rateStats(txs) {
  if (!txs.length) return { min: null, max: null, med: null, wmed: null };
  const r = txs.map((t) => t.feeRate);
  return { min: Math.min(...r), max: Math.max(...r), med: median(r), wmed: weightedMedian(txs) };
}
// the rate below and above which half the block's space is: what mempool.space calls the median fee
export function weightedMedian(txs) {
  const v = [...txs].sort((a, b) => a.feeRate - b.feeRate);
  const total = v.reduce((a, t) => a + t.vsize, 0);
  if (!total) return null;
  let acc = 0;
  for (const t of v) {
    acc += t.vsize;
    if (acc * 2 >= total) return t.feeRate;
  }
  return v.at(-1).feeRate;
}
// how much of the mempool the page sees: the worker sends at most the first 1,000 by fee rate (plus the ones it watches)
export function coverage(mp) {
  if (!mp) return { shown: 0, total: 0, truncated: false, shownVb: 0, totalVb: 0 };
  const shown = mp.txs?.length ?? 0;
  const shownVb = (mp.txs ?? []).reduce((a, t) => a + t.vsize, 0);
  return { shown, total: mp.count ?? shown, truncated: (mp.count ?? shown) > shown, shownVb, totalVb: mp.bytes ?? shownVb };
}
// which projected block each transaction would be in (txid → index)
export const blockIndex = (blocks) => new Map(blocks.flatMap((b, i) => b.txs.map((t) => [t.txid, i])));
