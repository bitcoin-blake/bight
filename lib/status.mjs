// What the pill and the status say about the node, the chain and the sources, from what the node reports. Pure; tested
// in test/status-test.mjs. Levels: 'ok', 'warn', 'bad', 'sync', 'idle'.
const n = (x) => Number(x).toLocaleString('en-US');
export function pillState(node, { now = Date.now(), wiped = false } = {}) {
  if (wiped) return { level: 'bad', text: 'wiped · reload' };
  if (node.phase === 'busy' || node.busy) return { level: 'idle', text: 'idle · another tab' };
  if (node.error) return { level: 'bad', text: 'error' };
  if (!node.synced)
    return {
      level: 'sync',
      text:
        {
          fetch: 'fetching the snapshot',
          hash: 'checking the snapshot',
          verify: 'verifying the snapshot',
          sync: `syncing · ${n(node.height ?? 0)}`,
        }[node.phase] ?? 'starting',
    };
  const t = chainState(node, { now });
  return { level: t.level === 'none' ? 'ok' : t.level, text: `up to date · ${n(node.height)}${t.short ? ' · ' + t.short : ''}` };
}
// the chain against the signed tip (NIP-333) and the clock
export function chainState(node, { now = Date.now() } = {}) {
  const t = node.nostr;
  const quietS = node.time ? now / 1000 - node.time : 0;
  if (t?.diverged)
    return {
      level: 'bad',
      short: 'source disagrees',
      text: `the block source disagrees with the signed chain tip at ${n(t.height)}: do not trust the blocks shown`,
    };
  if (node.lastSync && now - node.lastSync > 180e3)
    return {
      level: 'warn',
      short: 'source silent',
      text: `no answer from the block source since ${new Date(node.lastSync).toLocaleTimeString()}`,
    };
  if (quietS > 5400)
    return {
      level: 'warn',
      short: 'no new block',
      text: `no new block for ${Math.round(quietS / 60)} minutes: the block source or the chain may have stopped`,
    };
  if (!t)
    return { level: 'none', short: '', text: 'no signed chain tip reached this browser: the blocks are the block source’s word alone' };
  const above = node.height - t.height;
  if (above >= 2)
    return {
      level: 'warn',
      short: `${above} above the signed tip`,
      text: `the last ${above} blocks are above the signed chain tip (${n(t.height)}): not yet vouched for`,
    };
  if (!(t.agree > 0)) return { level: 'none', short: '', text: 'the signed chain tip has not been checked against these blocks yet' };
  return { level: 'ok', short: 'signed', text: `matching the signed chain tip at ${n(t.height)}` };
}
// the height up to which blocks are vouched for by the signed tip (null when there is no agreeing tip)
export const signedHeight = (t) => (t && t.agree > 0 && !t.diverged ? t.height : null);
// the estate's mempool feed: silent for 15 minutes is a warning (no node is publishing what it has)
export function feedState(mp, { now = Date.now(), followedAt = null } = {}) {
  if (!mp?.following) return null;
  const last = mp.lastFeedAt ?? followedAt;
  if (last == null || now - last <= 15 * 60e3) return null;
  return {
    level: 'warn',
    text: `no node's mempool heard ${mp.lastFeedAt ? 'since ' + new Date(mp.lastFeedAt).toLocaleTimeString() : 'since the mempool was followed'}: the transactions shown come from relays and wallets only`,
  };
}
// node errors in words a person can act on
export function plainError(e) {
  const s = String(e ?? '').replace(/ @ .*$/, '');
  if (/another tab|NoModificationAllowedError|access handle|InvalidStateError/i.test(s))
    return 'Another tab of this site is using the node’s files (Reef, Bight, Winch or Hitch). Close it and reload.';
  if (/quota|QuotaExceeded|out of space|not enough space/i.test(s))
    return 'The browser refused more storage: the node needs about 1.1 GB. Free disk space or allow more for this site, then reload.';
  if (/sha256 does not match|MISMATCH|hash_serialized/i.test(s))
    return 'The snapshot on disk is not the one the node expects (damaged or from another source). Wipe it in Settings and reload.';
  if (/SecurityError/i.test(s)) return 'This window cannot keep the node’s files (a private window?). Open Bight in an ordinary window.';
  if (/disagree/i.test(s)) return 'The block source disagrees with the signed chain tip: nothing from it is applied until they agree. ' + s;
  if (/Failed to fetch|NetworkError|no data for|answered 5\d\d|timed? ?out|Load failed/i.test(s))
    return 'The block source could not be reached; the node keeps trying. ' + s;
  if (/stopped answering/i.test(s)) return 'The node has stopped answering (the browser may have stopped its worker): reload the page.';
  return s;
}
