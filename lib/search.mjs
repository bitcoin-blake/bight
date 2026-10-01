// Search: a txid, looked for in the mempool the page has, the blocks it has looked at, and what it has seen.
export function parseQuery(s) {
  const t = String(s ?? '')
    .trim()
    .toLowerCase();
  return /^[0-9a-f]{64}$/.test(t) ? { txid: t } : { error: 'a txid is 64 hex characters' };
}
// → { where: 'mempool', tx } | { where: 'block', height } | { where: 'seen', seen } | { where: 'none', partial }
export function locate(txid, { mempool = null, blocks = [], seen = new Map() } = {}) {
  const tx = mempool?.txs?.find((x) => x.txid === txid);
  if (tx) return { where: 'mempool', tx };
  for (const b of blocks) if (b.txids?.includes(txid)) return { where: 'block', height: b.height };
  if (seen.has(txid)) return { where: 'seen', seen: seen.get(txid) };
  // the page sees only part of a large mempool: not finding it there proves nothing
  const partial = !!mempool && (mempool.count ?? 0) > (mempool.txs?.length ?? 0);
  return { where: 'none', partial };
}
