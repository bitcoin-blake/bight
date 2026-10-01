// What the pill and the notices say about the node, the chain and the sources, from what the node reports. Pure; tested
// in test/lib-test.mjs. Levels: 'ok' (green), 'warn' (amber), 'bad' (red), 'sync', 'idle'.
const n = (x) => Number(x).toLocaleString('en-US');
export function pillState(node, { now = Date.now(), wiped = false, notStarted = false } = {}) {
  if (wiped) return { level: 'bad', text: 'wiped · reload' };
  // "Not now" on the welcome: nothing is starting, so nothing pulses
  if (notStarted) return { level: 'idle', text: 'not started' };
  // the loader stops the node for a wipe (phase 'wiped'), and says 'error' when a wipe left no node running
  if (node.phase === 'wiped') return { level: 'bad', text: 'stopped for a wipe' };
  if (node.phase === 'error') return { level: 'bad', text: 'stopped · reload' };
  if (node.lockError) return { level: 'bad', text: 'lock refused' };
  if (node.phase === 'busy' || node.busy) return { level: 'idle', text: 'idle · another tab' };
  if (node.unresponsive) return { level: 'warn', text: 'not answering' };
  if (node.error) return { level: 'bad', text: 'error' };
  if (!node.synced) {
    if (node.retryAt && node.retryAt > now) return { level: 'sync', text: `retrying in ${Math.ceil((node.retryAt - now) / 1000)} s` };
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
  }
  const t = chainState(node, { now });
  // green only when the signed chain tip vouches for the tip; up to date but unsigned is amber, never green
  return {
    level: t.level === 'ok' ? 'ok' : t.level === 'none' ? 'warn' : t.level,
    text: `up to date · ${n(node.height)}${t.short ? ' · ' + t.short : ''}`,
  };
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
    return {
      level: 'none',
      short: 'not signed yet',
      text: 'no signed chain tip has reached this browser yet: the blocks are the block source’s word alone',
    };
  if (!(t.agree > 0))
    return { level: 'none', short: 'not signed yet', text: 'the signed chain tip has not been checked against these blocks yet' };
  if (t.height > node.height) {
    const behind = t.height - node.height;
    return {
      level: behind > 2 ? 'warn' : 'none',
      short: `${n(behind)} behind the signed tip`,
      text: `the tab is ${n(behind)} ${behind === 1 ? 'block' : 'blocks'} behind the signed chain tip (${n(t.height)})${behind > 2 ? ': the block source may be stale' : ': it catches up with the next sync'}`,
    };
  }
  const above = node.height - t.height;
  if (above >= 2)
    return {
      level: 'warn',
      short: `${n(above)} above the signed tip`,
      text: `the last ${above} blocks are above the signed chain tip (${n(t.height)}): not yet vouched for`,
    };
  if (above === 1)
    return {
      level: 'none',
      short: '1 above the signed tip',
      text: `the newest block is above the signed chain tip (${n(t.height)}): not yet vouched for`,
    };
  return { level: 'ok', short: 'signed', text: `matching the signed chain tip at ${n(t.height)}` };
}
// the height up to which blocks are vouched for by the signed tip (null when there is no agreeing tip)
export const signedHeight = (t) => (t && t.agree > 0 && !t.diverged ? t.height : null);
// the estate's mempool publisher, judged by its heartbeat (the mirror's mempool file, rewritten every pass), not by how
// many transactions it sent: a quiet chain is not a dead publisher. The beat is judged by when this page saw it change
// (seenAt, this browser's clock; the node's first reading is the file's own time, from another clock), falling back to
// the node's figure. Silent 10 minutes is a warning; so is no beat at all 5 minutes after the page began following.
export function feedState(mp, { now = Date.now(), seenAt = null, followedAt = null } = {}) {
  if (!mp?.following) return null;
  const beat = seenAt ?? mp.feedFileAt ?? null;
  if (beat == null)
    return followedAt != null && now - followedAt > 5 * 60e3
      ? {
          level: 'warn',
          text: 'no word from the node that publishes its mempool since this tab began following it: transactions it takes may not be shown',
        }
      : null;
  if (now - beat <= 10 * 60e3) return null;
  return {
    level: 'warn',
    text: `the node that publishes its mempool has not reported since ${new Date(beat).toLocaleTimeString()}: transactions it takes may not be shown`,
  };
}
// the mempool in words when it shows nothing: not followed yet, nothing heard yet, or empty after things were heard
export function emptyWords(mp, { following = false, notStarted = false } = {}) {
  if (!mp && notStarted) return 'not started: start the node to follow the mempool';
  if (!mp) return following ? 'nothing heard yet' : 'the mempool is followed once the tab is up to date';
  if ((mp.count ?? 0) > 0) return null;
  return (mp.stats?.seen ?? 0) === 0 && !mp.feedFileAt ? 'nothing heard yet' : 'the mempool is empty';
}
// node errors in words a person can act on
// an error from the node's files (a file gone, a handle held elsewhere, storage refused), by the error's name: the loader
// (blaketestnode bff010d's storageFault, the same list) makes it the node's state even when a request met it, so the request's
// own words only point at the notice. Checked against the pinned loader in test/release-test.mjs.
export const STORAGE_FAULTS = [
  'NotFoundError',
  'NoModificationAllowedError',
  'InvalidStateError',
  'NotReadableError',
  'QuotaExceededError',
];
export const isStorageFault = (m) => STORAGE_FAULTS.includes(m?.name ?? '');
export const FILES_FAILED = 'the node’s files failed (see the notice above)';
const FILES_GONE =
  'The node’s files are gone or unreadable (the site’s data cleared, or storage evicted). Reload: the node fetches them again.';
const ANOTHER_TAB = 'Another tab of this site is using the node’s files (Reef, Bight, Winch or Hitch). Close it and reload.';
const QUOTA = 'The browser refused more storage: the node needs about 1.2 GB. Free disk space or allow more for this site, then reload.';
// name: the error's kind when the node says it (the loader's node.errorName, a message's name since blaketestnode 670ad2b),
// read before the text: a fault in the node's files is worded by its kind whatever the browser's message says
const BY_NAME = {
  NotFoundError: 'files',
  NotReadableError: 'files',
  NoModificationAllowedError: 'tab',
  InvalidStateError: 'tab',
  QuotaExceededError: 'quota',
};
export function plainError(e, name = null) {
  const s = String(e ?? '').replace(/ @ .*$/, '');
  const kind = BY_NAME[name ?? ''];
  if (kind === 'files') return FILES_GONE;
  if (kind === 'tab') return ANOTHER_TAB;
  if (kind === 'quota') return QUOTA;
  if (/is not the pinned file|not in this loader's table/i.test(s))
    return 'The node’s code from the CDN is not the pinned code, so nothing was started. Reload later; if it persists, the CDN is serving something else.';
  if (/context headers/i.test(s))
    return 'The block source’s context headers do not check out (they must link up to the snapshot), so nothing was applied. ' + s;
  if (/written by (a newer|an older) node|layout/i.test(s))
    return 'The node’s files here were written by another version of the node. Wipe them in Settings and reload. ' + s;
  if (/could not be found|NotFoundError|NotReadable|could not be read/i.test(s)) return FILES_GONE;
  if (/another tab|NoModificationAllowedError|access handle|InvalidStateError/i.test(s)) return ANOTHER_TAB;
  if (/quota|QuotaExceeded|out of space|not enough space/i.test(s)) return QUOTA;
  if (/sha256 does not match|MISMATCH|hash_serialized/i.test(s))
    return 'The snapshot on disk is not the one the node expects (damaged or from another source). Wipe it in Settings and reload.';
  if (/SecurityError/i.test(s)) return 'This window cannot keep the node’s files (a private window?). Open Bight in an ordinary window.';
  if (/disagree/i.test(s)) return 'The block source disagrees with the signed chain tip: nothing from it is applied until they agree. ' + s;
  if (/Failed to fetch|NetworkError|no data for|answered 5\d\d|no answer in|timed? ?out|Load failed/i.test(s))
    return 'The node’s source could not be reached; it keeps trying. ' + s;
  if (/not answered for two minutes|stopped answering/i.test(s))
    return 'The node has not answered for two minutes. It usually comes back by itself; reload if it does not.';
  return s;
}
