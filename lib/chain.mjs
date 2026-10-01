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
// when each block reached this tab: height → { at (ms), alone }. Every height a sync pass applied reached it now, and
// replaces what was there (a reorganisation brings another block at that height); alone when the pass applied just that one
// block (a pass that applied several caught up after a gap: none of them was watched arriving). Heights above the tip
// (a rollback) are forgotten. A pass that applied nothing marks the tip only if it has no arrival yet. watched: false when
// the page was not listening just before (a gap: the computer asleep), so even a single block was not watched arriving.
export function markArrived(arrived, { height, applied = 1 }, at, { watched = true } = {}) {
  for (const h of [...arrived.keys()]) if (h > height) arrived.delete(h);
  if (!(applied > 0)) {
    if (!arrived.has(height)) arrived.set(height, { at, alone: false });
    return arrived;
  }
  for (let h = height - applied + 1; h <= height; h++) arrived.set(h, { at, alone: applied === 1 && watched });
  return arrived;
}
// a Map keyed by height without the keys below `floor` (what the page asked or saw of blocks it no longer shows)
export function pruneBelow(map, floor) {
  for (const h of [...map.keys()]) if (h < floor) map.delete(h);
  return map;
}
// the block subsidy at a height, by the engine's rule (bitcoin-desktop/schema codec/blocks.js: 50 BTC halving every
// 210,000 blocks, as testnet4); and the fees a block's coinbase claimed: its outputs less the subsidy. A miner may claim
// less than the fees it collected, so this is what the coinbase claimed, not what the transactions paid. null when the node
// does not say (an older node), or when the figure cannot be right (less than the subsidy).
export const HALVING = 210000;
export const INITIAL_SUBSIDY = 5e9;
export const subsidyAt = (h) => {
  const halvings = Math.floor(h / HALVING);
  return halvings >= 64 ? 0 : Math.floor(INITIAL_SUBSIDY / 2 ** halvings);
};
export function feesClaimed(coinbaseValue, height) {
  if (!Number.isFinite(coinbaseValue) || !Number.isFinite(height)) return null;
  const f = coinbaseValue - subsidyAt(height);
  return f >= 0 ? f : null;
}
// the requests the page sends carry a generation (req "bight:<gen>" for the cache, "bight:s<gen>.<id>" for a search, each
// search its own id): a reorganisation or a rollback starts a new one, so a reply asked for on the branch it replaced is
// recognised and ignored. The node echoes req in its reply, and in the error for a request it cannot answer ("Block not
// found"), so an answer is matched to its own request, never to another one out at the same time
export const reqOf = (gen, search = false, id = 0) => `bight:${search ? `s${gen}.${id}` : gen}`;
export function parseReq(req) {
  const m = /^bight:(?:(\d+)|s(\d+)\.(\d+))$/.exec(String(req ?? ''));
  return m ? (m[1] != null ? { search: false, gen: Number(m[1]) } : { search: true, gen: Number(m[2]), id: Number(m[3]) }) : null;
}
