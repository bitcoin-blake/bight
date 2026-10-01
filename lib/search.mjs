// Search: a txid, the start of one, a block hash or a block height, looked for in the mempool the page has, the blocks it
// has looked at, and what it has seen. Pure; tested in test/lib-test.mjs.
export function parseQuery(s) {
  const t = String(s ?? '')
    .trim()
    .toLowerCase();
  if (/^[0-9a-f]{64}$/.test(t)) return { id: t };
  if (/^\d{1,9}$/.test(t)) return { height: Number(t) };
  if (/^[0-9a-f]{8,63}$/.test(t)) return { prefix: t };
  return { error: 'search a transaction id (or its first 8 or more characters), a block hash, or a block height' };
}
// list: the mempool as objects (pack.mempoolList); blocks: [{ height, hash, txids }]; seen: Map txid → { … }
// → { where: 'mempool', tx } | { where: 'block', height, txid? } | { where: 'seen', txid, seen } | { where: 'many', count }
//   | { where: 'none', searched: { from, to, count } }
export function locate(q, { list = [], blocks = [], seen = new Map() } = {}) {
  const hs = blocks.map((b) => b.height);
  const searched = { from: hs.length ? Math.min(...hs) : null, to: hs.length ? Math.max(...hs) : null, count: hs.length };
  if (q.height != null) {
    const b = blocks.find((x) => x.height === q.height);
    return b ? { where: 'block', height: b.height } : { where: 'none', searched };
  }
  const match = q.id ? (x) => x === q.id : (x) => x.startsWith(q.prefix);
  const inMp = list.filter((t) => match(t.txid));
  if (inMp.length > 1) return { where: 'many', count: inMp.length };
  if (inMp.length === 1) return { where: 'mempool', tx: inMp[0] };
  if (q.id) {
    const byHash = blocks.find((b) => b.hash === q.id);
    if (byHash) return { where: 'block', height: byHash.height };
  }
  for (const b of blocks) {
    const t = (b.txids ?? []).find(match);
    if (t) return { where: 'block', height: b.height, txid: t };
  }
  for (const [txid, s] of seen) if (match(txid)) return { where: 'seen', txid, seen: s };
  return { where: 'none', searched };
}
