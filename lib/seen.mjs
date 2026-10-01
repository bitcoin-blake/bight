// What this tab saw before a block: every transaction the mempool accepted is remembered (txid → fee, size, rate, when),
// so a block can be read as "how much of it was here first". Counted only for a block whose whole interval the tab was
// listening for: it arrived after the mempool was followed, alone (not in a catch-up of several after a gap), and the block
// before it arrived after that too (a transaction sent before the tab listened is not one it missed). Times are when the
// block reached this tab (ms), not the miner's header time; followedAt is when listening last began (ms), moved on after a
// gap in listening (the computer asleep, the tab frozen), and "after" is strictly after.
// Pure; tested in test/lib-test.mjs.
// The cap leaves out what is still in the mempool (txs, this message's list): only transactions no longer listed are evicted,
// and in the order they left the list (a transaction is moved to the end of the map when it is first seen missing), so the
// ones a block just took (often the longest waiting, so the first inserted) are the last to go. Never fewer than `margin` of
// the left ones are kept beyond the listed, so a block just mined is still known however large the pool is. Over the cap,
// eviction goes down to the cap less `evict` (not one at a time).
const lastListed = new WeakMap(); // seen → the txids listed at the previous call
export function rememberSeen(seen, txs, { cap = 20000, evict = 5000, margin = cap / 2 } = {}) {
  for (const t of txs) if (!seen.has(t.txid)) seen.set(t.txid, { fee: t.fee, vsize: t.vsize, feeRate: t.feeRate, at: t.at });
  const listed = new Set(txs.map((t) => t.txid));
  for (const k of lastListed.get(seen) ?? []) {
    if (listed.has(k) || !seen.has(k)) continue;
    const v = seen.get(k);
    seen.delete(k);
    seen.set(k, v); // left the list now: to the end, so eviction (oldest first) goes in order of leaving
  }
  lastListed.set(seen, listed);
  const limit = Math.max(cap, listed.size + margin);
  if (seen.size <= limit) return seen;
  for (const k of seen.keys()) {
    if (seen.size <= limit - evict) break;
    if (!listed.has(k)) seen.delete(k);
  }
  return seen;
}
// block: { txids, nTx }; arrival, prevArrival: chain.markArrived's { at (ms), alone } for it and the block before, or null
export function blockSeen(block, seen, { followedAt = null, arrival = null, prevArrival = null } = {}) {
  const others = Math.max(0, (block.nTx ?? block.txids.length) - 1); // the coinbase is never in a mempool
  const known = block.txids.slice(1).filter((t) => seen.has(t));
  const fees = known.map((t) => seen.get(t));
  const counted =
    followedAt != null && !!arrival?.alone && arrival.at > followedAt && prevArrival?.at != null && prevArrival.at > followedAt;
  // it was watched arriving on its own while the tab listened, but the block before it came earlier (in the catch-up at
  // start, or before a gap): the tab heard only part of the interval in which its transactions were sent
  const partly = !counted && followedAt != null && !!arrival?.alone && arrival.at > followedAt;
  return {
    others,
    seen: known.length,
    knownFees: fees.reduce((a, f) => a + f.fee, 0),
    knownCount: fees.length,
    counted,
    words:
      others === 0
        ? 'no transactions'
        : counted
          ? `${known.length} of ${others} seen first`
          : partly
            ? 'listening for only part of its interval'
            : 'not listening then',
  };
}
