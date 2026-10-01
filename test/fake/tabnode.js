// A stand-in for blaketestnode's browser/tabnode.js, the page's only seam to the node: the smoke test serves it in place of
// the pinned file and drives the page with window.__fake.emit(type, message). Like the real loader (at bff010d), it keeps
// node.* from the messages before the page sees them, emits every message on 'message' too, holds the shared node lock in
// start() (or reports node.lockError when the browser refuses it), answers mempool-get with mempool-tx from what it was
// last sent, and clears node.unresponsive on 'responsive'. window.__fake records the options the page created it with,
// what the page posted, how often it started, followed and wiped, and the clock offsets it gave (setSkew).
// window.__fakeConfig (set before the page loads): { lockError } makes the lock refused; { wipeFail } makes a wipe fail as
// the loader's does when no node answers it (phase 'error', a fatal error message, a rejection); { wipeLeaves: [names] }
// makes a wipe leave those files; { wipeFailQuiet } makes it fail with the node stopped (phase 'error') but no message.
export const storageFault = (m) =>
  /^(NotFoundError|NoModificationAllowedError|InvalidStateError|NotReadableError|QuotaExceededError)$/.test(m?.name ?? '');
export const mib = (b) => `${(b / 1048576).toFixed(1)} MiB`;
export const n = (x) => Number(x).toLocaleString('en-US');
export function createTabNode(opts = {}) {
  const node = {
    phase: 'starting',
    hist: [],
    synced: false,
    mempool: null,
    error: null,
    height: null,
    st: null,
    nostr: null,
    retryAt: null,
  };
  const h = new Map();
  const on = (t, f) => {
    (h.get(t) ?? h.set(t, new Set()).get(t)).add(f);
    return () => h.get(t)?.delete(f);
  };
  const fire = (t, a) => {
    for (const f of h.get(t) ?? []) f(a);
  };
  const posts = [];
  const emit = (t, m = {}) => {
    if (t === 'mempool') node.mempool = m;
    if (t === 'synced')
      Object.assign(node, {
        synced: true,
        phase: 'synced',
        height: m.height,
        hash: m.hash,
        time: m.time ?? Math.floor(Date.now() / 1000),
        lastSync: Date.now(),
        st: node.st ?? {},
      });
    if (t === 'nostr') node.nostr = m;
    if (t === 'unresponsive') Object.assign(node, { unresponsive: true, error: 'the node has not answered for two minutes' });
    if (t === 'responsive') Object.assign(node, { unresponsive: false, error: null });
    // as the loader at bff010d: an error answering a request (it echoes req, or names a lookup) is not the node's state,
    // unless it is a fault in the node's files (storageFault, by the error's name): that is the node's, whoever asked
    if (
      t === 'error' &&
      !(node.synced && !storageFault(m) && (m.req != null || /Block not found|sync first|not in the set|not in mempool/.test(m.text)))
    )
      node.error = m.text;
    fire(t, m);
    fire('message', { type: t, ...m });
  };
  const cfg = window.__fakeConfig ?? {};
  const fake = (window.__fake = { node, emit, posts, opts, starts: 0, forced: 0, follows: [], wipes: 0, skews: [] });
  const start = async ({ force = false } = {}) => {
    fake.starts++;
    if (force) {
      fake.forced++;
      node.st = {};
      return true;
    }
    if (cfg.lockError) {
      node.lockError = cfg.lockError;
      node.phase = 'busy';
      return false;
    }
    // as the real loader: a reload can find the lock still held by the page it replaces, so wait up to three seconds
    const got = await new Promise((res) =>
      navigator.locks
        .request('bitcoin-blake:node', { signal: AbortSignal.timeout(3000) }, () => (res(true), new Promise(() => {})))
        .catch(() => res(false)),
    );
    if (!got) {
      node.busy = true;
      node.phase = 'busy';
      return false;
    }
    node.st = {};
    return true;
  };
  const post = (m) => {
    posts.push(m);
    if (m.type === 'mempool-get')
      setTimeout(() => {
        const e = (node.mempool?.all ?? []).find((x) => x[0] === m.txid);
        emit(
          'mempool-tx',
          e
            ? {
                txid: m.txid,
                found: true,
                vsize: e[1],
                fee: e[2],
                feeRate: e[2] / e[1],
                at: e[3],
                fed: !!e[4],
                via: 'fake',
                inputs: [],
                outputs: [],
                req: m.req,
              }
            : { txid: m.txid, found: false, req: m.req },
        );
      }, 20);
  };
  return {
    node,
    on,
    emit,
    posts,
    opts,
    seeding: false,
    start,
    post,
    followMempool(o) {
      fake.follows.push(o);
    },
    seedSupported: async () => true,
    setTorrent() {},
    setSeed() {},
    setSkew(s) {
      fake.skews.push(s);
    },
    wipe: async () => {
      fake.wipes++;
      node.phase = 'wiped';
      if (cfg.wipeFail) {
        const text =
          'the node did not wipe in time and is stopped: its files may be partly removed. Close the other tabs of this site and reload';
        Object.assign(node, { phase: 'error', synced: false, error: text });
        emit('error', { text, fatal: true });
        throw new Error('the node did not wipe in time, and nothing is pending: close the other tabs of this site and try again');
      }
      if (cfg.wipeFailQuiet) {
        Object.assign(node, { phase: 'error', synced: false, error: 'the node did not wipe in time and is stopped' });
        throw new Error('the node did not wipe in time');
      }
      return { removed: ['x'], failed: cfg.wipeLeaves ?? [] };
    },
  };
}
