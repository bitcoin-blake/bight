// The blocks this tab would build from its mempool, packed the way the node's own template builder packs (lib/template.mjs
// in blaketestnode): in the node's order (by fee rate, ties in the order the node holds them), greedily, a transaction that
// does not fit is skipped and the next one tried, within the block's weight budget. Approximately: the page knows each
// transaction's size in vB, not its exact weight, so it counts 4 × vB (never below the weight, at most 3 above).
// Pure; tested in test/lib-test.mjs (and the node's rule in test/release-test.mjs).
export const REDUCED_DATA_MAX_BLOCK_WEIGHT = 800000;
export const FULL_MAX_BLOCK_WEIGHT = 4000000;
export const COINBASE_ROOM = 4000; // the template builder keeps this for the header and the coinbase
export const weightOf = (t) => t.vsize * 4;
// by fee rate, highest first; Array.prototype.sort is stable, so ties keep the node's order
export const byRate = (a, b) => b.feeRate - a.feeRate;
// the mempool as the page reads it: every transaction (the node's compact `all`: [txid, vsize, fee, at, fed]), or, from an
// older node, the first 1,000 it sends in full
export function mempoolList(mp) {
  if (!mp) return [];
  if (Array.isArray(mp.all))
    return mp.all.map(([txid, vsize, fee, at, fed]) => ({ txid, vsize, fee, feeRate: vsize ? fee / vsize : 0, at, fed: !!fed }));
  return mp.txs ?? [];
}
// the median of numbers: the mean of the two middle values when there is an even count; null for none
export function median(xs) {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
// pack: [{ txs, weight, vsize, fees, min, max, med, wmed }] up to maxBlocks, each filled skip-and-continue from what the
// earlier ones left
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
// the rate at which half the space is reached, counting from the lowest rate: what mempool.space calls the median fee
export function weightedMedian(txs) {
  const v = [...txs].filter((t) => Number.isFinite(t.feeRate) && t.vsize > 0).sort((a, b) => a.feeRate - b.feeRate);
  const total = v.reduce((a, t) => a + t.vsize, 0);
  if (!total) return null;
  let acc = 0;
  for (const t of v) {
    acc += t.vsize;
    if (acc * 2 >= total) return t.feeRate;
  }
  return null; // not reached: acc ends at total, so the loop always returns
}
// how much of the mempool the page sees: everything when the node sends `all`; else the first 1,000 by fee rate
export function coverage(mp) {
  if (!mp) return { shown: 0, total: 0, truncated: false, shownVb: 0, totalVb: 0 };
  const list = mempoolList(mp);
  const shownVb = list.reduce((a, t) => a + t.vsize, 0);
  const total = mp.count ?? list.length;
  return { shown: list.length, total, truncated: total > list.length, shownVb, totalVb: mp.bytes ?? shownVb };
}
// which projected block each transaction would be in (txid → index)
export const blockIndex = (blocks) => new Map(blocks.flatMap((b, i) => b.txs.map((t) => [t.txid, i])));
// what the projected blocks leave: the transactions and vB beyond them, and about how many more blocks they fill
export function remainder(list, blocks, { rdts = true } = {}) {
  const inBlocks = blocks.reduce((a, b) => a + b.txs.length, 0);
  const vb = list.reduce((a, t) => a + t.vsize, 0) - blocks.reduce((a, b) => a + b.vsize, 0);
  const per = ((rdts === false ? FULL_MAX_BLOCK_WEIGHT : REDUCED_DATA_MAX_BLOCK_WEIGHT) - COINBASE_ROOM) / 4;
  return { count: Math.max(0, list.length - inBlocks), vb: Math.max(0, vb), blocks: vb > 0 ? Math.ceil(vb / per) : 0 };
}
