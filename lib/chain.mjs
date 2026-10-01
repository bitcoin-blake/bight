// The blocks the page keeps (height → { height, hash, prev, … }) against the node's chain: what a sync or a reply means
// for the cache, which heights to ask for, and when each block reached this tab. Pure; tested in test/lib-test.mjs.
// a 'synced' message { height, hash, applied }: drops what a reorganisation or a rollback replaced
export function onSynced(blocks, m) {
  const dropped = [];
  const from = m.height - (m.applied ?? 0) + 1;
  for (const h of [...blocks.keys()])
    if (h > m.height || (m.applied && h >= from)) {
      blocks.delete(h);
      dropped.push(h);
    }
  const tip = blocks.get(m.height);
  if (tip && m.hash && tip.hash !== m.hash) {
    dropped.push(...blocks.keys());
    blocks.clear();
  }
  return dropped;
}
// a 'block' reply: refused when it is the node's tip height with another hash (an answer from before a reorganisation);
// otherwise kept, and a neighbour it does not link to is dropped (it was replaced)
export function acceptBlock(blocks, b, { tipHeight = null, tipHash = null } = {}) {
  if (b.height === tipHeight && tipHash && b.hash !== tipHash) return false;
  const below = blocks.get(b.height - 1);
  if (below && b.prev && below.hash !== b.prev) blocks.delete(b.height - 1);
  const above = blocks.get(b.height + 1);
  if (above && above.prev && above.prev !== b.hash) blocks.delete(b.height + 1);
  blocks.set(b.height, b);
  return true;
}
// the heights to ask for: the last `count` above the snapshot that are not cached and were not asked in the last retryMs
export function wantHeights({ height, blocks, wanted, now, floor, count = 8, retryMs = 30e3 }) {
  if (height == null) return [];
  const out = [];
  for (let h = height; h > height - count && h > floor; h--)
    if (!blocks.has(h) && !(now - (wanted.get(h) ?? -Infinity) < retryMs)) {
      wanted.set(h, now);
      out.push(h);
    }
  return out;
}
// every height a sync pass applied reached this tab now (not only the tip)
export function markArrived(arrived, { height, applied = 1 }, at) {
  for (let h = height - Math.max(1, applied) + 1; h <= height; h++) if (!arrived.has(h)) arrived.set(h, at);
  return arrived;
}
