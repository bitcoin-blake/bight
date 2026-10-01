// Search: a txid, the start of one, a block hash or a block height, looked for in the mempool the page has, the blocks it
// has looked at, and what it has seen. Pure; tested in test/lib-test.mjs.
export function parseQuery(s) {
  const t = String(s ?? '')
    .trim()
    .toLowerCase();
  if (/^[0-9a-f]{64}$/.test(t)) return { id: t };
  // a height as people write it: 152103, or grouped in threes with one separator (152,103, 152 103, 152_103). Digits
  // alone are a height only up to 7 of them and without a leading zero: a block hash starts with zeros, and the start of a
  // txid can be all digits, so "00000000" or "12345678" is the start of an id
  if (/^(0|[1-9]\d{0,6})$/.test(t)) return { height: Number(t) };
  const g = /^\d{1,3}([,\s_])\d{3}(?:\1\d{3})*$/.exec(t);
  if (g && t[0] !== '0') return { height: Number(t.replace(/[,\s_]/g, '')) };
  if (/^[0-9a-f]{8,63}$/.test(t)) return { prefix: t };
  return { error: 'search a transaction id or a block hash (or the first 8 or more characters of either), or a block height' };
}
// the run of blocks searched, for the words: from, to, how many
export function searchedOf(blocks) {
  const hs = blocks.map((b) => b.height);
  return { from: hs.length ? Math.min(...hs) : null, to: hs.length ? Math.max(...hs) : null, count: hs.length };
}
// list: the mempool as objects (pack.mempoolList); blocks: [{ height, hash, txids }]; seen: Map txid → { … }
// → { where: 'mempool', tx } | { where: 'block', height, txid? } | { where: 'seen', txid, seen } | { where: 'many', count }
//   | { where: 'none', searched: { from, to, count } }
export function locate(q, { list = [], blocks = [], seen = new Map() } = {}) {
  const searched = searchedOf(blocks);
  if (q.height != null) {
    const b = blocks.find((x) => x.height === q.height);
    return b ? { where: 'block', height: b.height } : { where: 'none', height: q.height, searched };
  }
  const match = q.id ? (x) => x === q.id : (x) => String(x ?? '').startsWith(q.prefix);
  // a txid in the mempool and a block hash, by the whole id or its start
  const inMp = list.filter((t) => match(t.txid));
  const byHash = blocks.filter((b) => match(b.hash));
  if (inMp.length + byHash.length > 1) return { where: 'many', count: inMp.length + byHash.length };
  if (inMp.length === 1) return { where: 'mempool', tx: inMp[0] };
  if (byHash.length === 1) return { where: 'block', height: byHash[0].height };
  for (const b of blocks) {
    const t = (b.txids ?? []).find(match);
    if (t) return { where: 'block', height: b.height, txid: t };
  }
  for (const [txid, s] of seen) if (match(txid)) return { where: 'seen', txid, seen: s };
  return { where: 'none', searched };
}
// a height this tab does not hold: the node can be asked for any block above the snapshot up to its tip
// → 'ask' | 'below' (at or under the snapshot: no blocks there) | 'above' (past the tip) | 'unknown' (no tip yet)
export function heightRange(h, { floor, tip }) {
  if (tip == null) return 'unknown';
  if (h <= floor) return 'below';
  if (h > tip) return 'above';
  return 'ask';
}
