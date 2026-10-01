// What the node's log lines and replies mean for the page. The wording is the node's (blaketestnode at the pinned commit);
// test/contract-test.mjs checks these patterns against the worker's source, so a node release that rewords them fails CI.
// "mempool: refused 0123456789ab… from relay.x: input … is not an unspent coin"
export function parseRefusal(text) {
  const m = /^mempool: refused (?:([0-9a-f]+)…|a transaction)(?: from (.*?))?: (.*)$/.exec(String(text));
  return m ? { txid: m[1] ?? null, from: m[2] ?? null, reason: m[3] } : null;
}
// "mempool: 12 of 15 from the mirror's file at height 152100" or "mempool: seed file: <error>"
export function parseSeedLine(text) {
  const ok = /^mempool: (\d+) of (\d+) from the mirror's file(?: at height (\d+))?/.exec(String(text));
  if (ok) return { ok: true, accepted: Number(ok[1]), total: Number(ok[2]), height: ok[3] ? Number(ok[3]) : null };
  const bad = /^mempool: seed file: (.*)$/.exec(String(text));
  return bad ? { ok: false, error: bad[1] } : null;
}
// the worker's template reply in words; stale when built on another tip than the one the node is at now
export function templateWords(m, nodeHeight) {
  if (!m) return { ok: false, stale: false, text: '…' };
  const stale = nodeHeight != null && m.height !== nodeHeight + 1;
  const failed = m.checks && m.checks.ok === false ? (m.checks.failed ?? []) : null;
  return {
    ok: !stale && !failed,
    stale,
    failed,
    text: stale
      ? 'building on the new tip…'
      : failed
        ? `the worker's build fails: ${failed.join(', ') || 'a rule'}`
        : `${m.txs} tx · ${Number(m.fees).toLocaleString('en-US')} sat · ${Number(m.weight).toLocaleString('en-US')} WU, every rule passes`,
  };
}
