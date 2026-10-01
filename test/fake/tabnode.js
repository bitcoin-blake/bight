// A stand-in for blaketestnode's browser/tabnode.js, the page's only seam to the node: the smoke test serves it in place of
// the pinned file and drives the page with window.__fake.emit(type, message). Like the real loader, it keeps node.* from
// the messages before the page sees them, and start() holds the shared node lock.
export const mib = (b) => `${(b / 1048576).toFixed(1)} MiB`;
export const n = (x) => Number(x).toLocaleString('en-US');
export function createTabNode() {
  const node = { phase: 'starting', hist: [], synced: false, mempool: null, error: null, height: null, st: null, nostr: null };
  const h = new Map();
  const on = (t, f) => {
    (h.get(t) ?? h.set(t, new Set()).get(t)).add(f);
    return () => h.get(t)?.delete(f);
  };
  const fire = (t, a) => {
    for (const f of h.get(t) ?? []) f(a);
  };
  const posts = [];
  const emit = (t, m) => {
    if (t === 'mempool') node.mempool = m;
    if (t === 'synced')
      Object.assign(node, {
        synced: true,
        phase: 'synced',
        height: m.height,
        hash: m.hash,
        time: m.time ?? Math.floor(Date.now() / 1000),
        lastSync: Date.now(),
      });
    if (t === 'nostr') node.nostr = m;
    fire(t, m);
    fire('message', { type: t, ...m });
  };
  const fake = (window.__fake = { node, emit, posts, starts: 0, follows: 0, wipes: 0 });
  const start = async () => {
    fake.starts++;
    const got = await new Promise((res) =>
      navigator.locks.request('bitcoin-blake:node', { ifAvailable: true }, (l) => (res(!!l), l ? new Promise(() => {}) : null)),
    );
    if (!got) {
      node.phase = 'busy';
      return false;
    }
    node.st = {};
    return true;
  };
  return {
    node,
    on,
    emit,
    posts,
    opts: {},
    seeding: false,
    start,
    post: (m) => posts.push(m),
    followMempool() {
      fake.follows++;
    },
    seedSupported: async () => true,
    setTorrent() {},
    setSeed() {},
    wipe: async () => (fake.wipes++, { removed: ['x'], failed: [] }),
  };
}
