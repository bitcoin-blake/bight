// What the node's log lines and replies mean for the page. The wording is the node's (blaketestnode at the pinned commit);
// test/release-test.mjs builds these lines with the node's own template expressions at the pin and reads them back, so a
// node release that rewords them fails CI. Pure; tested in test/lib-test.mjs.
// "mempool: refused 0123456789ab… from relay.x: input … is not an unspent coin"
export function parseRefusal(text) {
  const m = /^mempool: refused (?:([0-9a-f]+)…|a transaction)(?: from (\S+?))?: (.*)$/.exec(String(text));
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
// same height on another parent); "built" only when current and every rule it checked passed.
export function templateWords(m, nodeHeight, nodeHash = null) {
  if (!m) return { ok: false, stale: false, failed: null, text: '…' };
  const stale = (nodeHeight != null && m.height !== nodeHeight + 1) || (!!nodeHash && !!m.prevHash && m.prevHash !== nodeHash);
  const failed = m.checks && m.checks.ok !== true ? (m.checks.failed ?? []) : null;
  const vb = Math.ceil((m.weight ?? 0) / 4);
  return {
    ok: !stale && !failed,
    stale,
    failed,
    vb,
    text: stale
      ? 'building on the new tip…'
      : failed
        ? `the worker's build fails: ${failed.join(', ') || 'a rule'}`
        : `✓ built: ${Number(m.txs).toLocaleString('en-US')} tx · ${Number(m.fees).toLocaleString('en-US')} sat · ${vb.toLocaleString('en-US')} vB, every rule it checks passes`,
  };
}
