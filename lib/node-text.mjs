// What the node's log lines and replies mean for the page. The wording is the node's (blaketestnode at the pinned commit);
// test/release-test.mjs builds these lines with the node's own template expressions at the pin and reads them back, so a
// node release that rewords them fails CI. Pure; tested in test/lib-test.mjs.
// "mempool: refused 0123456789ab… from 1a2b3c4d… via relay.damus.io: input … is not an unspent coin"; the source is the
// node's own words (a publisher's key and its relay, "the mirror", or none) and may hold spaces, never ": "
export function parseRefusal(text) {
  const m = /^mempool: refused (?:([0-9a-f]+)…|a transaction)(?: from (.+?))?: (.*)$/.exec(String(text));
  return m ? { txid: m[1] ?? null, from: m[2] ?? null, reason: m[3] } : null;
}
// "mempool: 12 of 15 from the mirror's file at height 152100" or "mempool: seed file: <error>"
export function parseSeedLine(text) {
  const ok = /^mempool: (\d+) of (\d+) from the mirror's file(?: at height (\d+))?/.exec(String(text));
  if (ok) return { ok: true, accepted: Number(ok[1]), total: Number(ok[2]), height: ok[3] ? Number(ok[3]) : null };
  const bad = /^mempool: seed file: (.*)$/.exec(String(text));
  return bad ? { ok: false, error: bad[1] } : null;
}
// the worker's template reply in words. Stale when built on another tip than the node's now (a different height, or the
// same height on another parent). "Built" only when current, checked, every rule it checked passed, and built from the
// mempool the page shows: the same count (the template says how many it saw) and, when the page packed a block, the same
// transactions and fees. A template with no checks is not a pass. mempool: { count, block } as the page has them.
export function templateWords(m, nodeHeight, nodeHash = null, mempool = null) {
  if (!m) return { ok: false, stale: false, failed: null, text: '…' };
  const stale = (nodeHeight != null && m.height !== nodeHeight + 1) || (!!nodeHash && !!m.prevHash && m.prevHash !== nodeHash);
  const failed = m.checks?.ok === true ? null : (m.checks?.failed ?? []);
  const vb = Math.ceil((m.weight ?? 0) / 4);
  const figures = `${Number(m.txs).toLocaleString('en-US')} tx · ${Number(m.fees).toLocaleString('en-US')} sat · ${vb.toLocaleString('en-US')} vB`;
  const tc = m.mempool?.count;
  // the worker builds after the adds it has queued, and posts its mempool to the page a moment later, so a build of another
  // count can be of an earlier mempool or a later one: said as another mempool, with both counts
  const otherMempool = !!mempool && tc != null && mempool.count != null && tc !== mempool.count;
  const b = mempool?.block;
  const differs = !!mempool && !otherMempool && (b ? m.txs !== b.txs.length || m.fees !== b.fees : m.txs !== 0);
  return {
    ok: !stale && !failed && !otherMempool && !differs,
    stale,
    failed,
    otherMempool,
    differs,
    vb,
    text: stale
      ? 'building on the new tip…'
      : failed
        ? m.checks
          ? `the worker's build fails: ${failed.join(', ') || 'a rule'}`
          : "the worker's build was not checked"
        : otherMempool
          ? `built on a different mempool (${Number(tc).toLocaleString('en-US')} tx in the node's, ${Number(mempool.count).toLocaleString('en-US')} here): ${figures}`
          : differs
            ? `the node's build differs from this page's: ${figures}`
            : `✓ built: ${figures}, every rule it checks passes`,
  };
}
