// What this tab saw before a block: every transaction the mempool accepted is remembered (txid → fee, size, rate, when),
// so a block can be read as "how much of it was here first". Counted only for a block whose whole interval the tab was
// listening for: it arrived after the mempool was followed, and so did the block before it (a transaction sent before the
// tab listened is not one it missed). Times are when the block reached this tab, not the miner's header time.
// Pure; tested in test/lib-test.mjs.
export function rememberSeen(seen, txs, { cap = 20000, evict = 5000 } = {}) {
  for (const t of txs) if (!seen.has(t.txid)) seen.set(t.txid, { fee: t.fee, vsize: t.vsize, feeRate: t.feeRate, at: t.at });
  if (seen.size > cap) for (const k of [...seen.keys()].slice(0, evict)) seen.delete(k);
  return seen;
}
// block: { txids, nTx, arrivedAt (s) }; prevArrivedAt: when the block before it arrived (s), or null; followedAt (s)
export function blockSeen(block, seen, { followedAt = null, prevArrivedAt = null } = {}) {
  const others = Math.max(0, (block.nTx ?? block.txids.length) - 1); // the coinbase is never in a mempool
  const known = block.txids.slice(1).filter((t) => seen.has(t));
  const fees = known.map((t) => seen.get(t));
  const counted =
    followedAt != null && block.arrivedAt != null && block.arrivedAt >= followedAt && prevArrivedAt != null && prevArrivedAt >= followedAt;
  return {
    others,
    seen: known.length,
    knownFees: fees.reduce((a, f) => a + f.fee, 0),
    knownCount: fees.length,
    counted,
    words: others === 0 ? 'no transactions' : !counted ? 'not listening then' : `${known.length} of ${others} seen first`,
  };
}
