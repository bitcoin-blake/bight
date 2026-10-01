// Bight: a mempool monitor in a tab, in the shape everyone knows from mempool.space, over blaketestnode's browser node.
// The node in the tab is the shared loader (browser/tabnode.js, pinned by commit); this file is the page: the projected
// blocks the tab itself would build from its own mempool, the last blocks it validated, the fee bands, the sources,
// a graph over the session, and a search. Every transaction shown was validated here; nothing is relayed onward.
// The decisions (packing, bands, what was seen first, the chain cache, search, the status words, the sources, the
// settings, the markup of tiles and details) are lib/*.mjs, tested; this file wires them to the document, patching in
// place so a focused or selected element survives the next update.
export const VERSION = '2026-10-01.7';
const $ = (id) => document.getElementById(id);
const NODE = 'https://cdn.jsdelivr.net/gh/bitcoin-blake/blaketestnode@3037bb4c7ea414e75332632677ac2ffee191b704';
const RELAYS = [
  'wss://relay.primal.net',
  'wss://nostr.oxtr.dev',
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nostr.mom',
];
export const MODULES = [
  'pack',
  'fees',
  'seen',
  'series',
  'search',
  'fmt',
  'node-text',
  'status',
  'sources',
  'version',
  'chain',
  'schedule',
  'settings',
  'view',
];
const store = (s) => ({
  get: (k) => {
    try {
      return s().getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      s().setItem(k, v);
      return true;
    } catch {
      return false;
    }
  },
  del: (k) => {
    try {
      s().removeItem(k);
    } catch {}
  },
});
const LS = store(() => localStorage),
  SS = store(() => sessionStorage);
const q = new URLSearchParams(location.search);
const embedded = q.get('embedded') === '1';
if (embedded) document.body.classList.add('embedded');
// every reload keeps the page's query (embedded=1, an accepted source) and changes only what it must
const reloadWith = (set = {}, drop = []) => {
  const p = new URLSearchParams(location.search);
  for (const k of drop) p.delete(k);
  for (const [k, v] of Object.entries(set)) p.set(k, v);
  const s = p.toString();
  location.replace(location.pathname + (s ? '?' + s : ''));
};

// ---- notices: one line each under the top bar, patched in place (a focused button in one survives a change of its words);
// said to screen readers when a notice is new or grows more serious, not on every change of its words (a count of minutes
// would otherwise be spoken once a minute)
const RANK = { info: 0, warn: 1, bad: 2 };
function banner(id, cls, text, actions = []) {
  let el = document.querySelector(`#banners [data-b="${id}"]`);
  const sig = actions.map(([l]) => l).join('\n');
  if (el && el.dataset.text === cls + text && el.dataset.sig === sig) return;
  const prev = el?.dataset.cls;
  if (!el) {
    el = document.createElement('div');
    el.dataset.b = id;
    el.appendChild(document.createElement('span'));
    $('banners').appendChild(el);
  }
  el.dataset.text = cls + text;
  el.dataset.cls = cls;
  el.className = 'banner ' + cls;
  el.firstChild.textContent = text;
  const btns = [...el.querySelectorAll('button')];
  if (el.dataset.sig !== sig) {
    // the buttons change only when their labels do; otherwise only what they do is updated
    for (const b of btns) b.remove();
    for (const [label, fn] of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      b.textContent = label;
      b.onclick = fn;
      el.appendChild(b);
    }
    el.dataset.sig = sig;
  } else btns.forEach((b, i) => (b.onclick = actions[i][1]));
  if (prev == null || (RANK[cls] ?? 0) > (RANK[prev] ?? 0)) say(text);
}
// a notice that goes while it holds the focus first hands the focus on (to the next notice's button, else the search), so
// a keyboard user is not dropped at the top of the page
const unbanner = (id) => {
  const el = document.querySelector(`#banners [data-b="${id}"]`);
  if (!el) return;
  if (el.contains(document.activeElement)) {
    const next = [...document.querySelectorAll('#banners [data-b] button')].find((b) => !el.contains(b));
    (next ?? $('q')).focus();
  }
  el.remove();
};
// what is said to screen readers, one at a time, so a second message does not cut off the first
const sayQueue = [];
let saying = false;
const say = (text) => {
  if (!text || sayQueue.at(-1) === text) return;
  sayQueue.push(text);
  if (saying) return;
  saying = true;
  const next = () => {
    const t = sayQueue.shift();
    if (t == null) return (saying = false);
    $('announce').textContent = '';
    setTimeout(() => {
      $('announce').textContent = t;
      setTimeout(next, 1500);
    }, 50);
  };
  next();
};
const fatal = (text) => {
  $('syncmsg').textContent = text;
  banner('fatal', 'bad', text, [['Reload', () => location.reload()]]);
};
// in a frame whose page is on another site, nothing that downloads, trusts a source or overrides the lock is done on a click
// (the page around it could have placed that click); it says to open Bight in its own tab instead
const foreignFrame = (() => {
  if (top === self) return false;
  try {
    return top.location.origin !== location.origin;
  } catch {
    return true;
  }
})();
const ownTab = () => {
  const u = new URL(location.href);
  u.searchParams.delete('embedded');
  return u.href;
};
const openOwnTab = () => window.open(ownTab(), '_blank', 'noopener');

// ---- a cached page and a script from different releases: reload once for this pair of versions (only if the browser
// can remember that it did, or it would reload for ever), and run nothing meanwhile
{
  const asked = document.querySelector('script[src*="bight.js"]')?.src.match(/v=([^&]+)/)?.[1];
  const key = 'bight:mixed:' + decodeURIComponent(asked ?? '') + '>' + VERSION;
  if (asked && decodeURIComponent(asked) !== VERSION && !SS.get(key) && SS.set(key, '1')) {
    reloadWith({ v: VERSION });
    await new Promise(() => {});
  }
}

// ---- the code: the node's loader from the CDN (with a deadline: a CDN that hangs would leave "Starting…" for ever), then
// this page's own modules, cache-busted with the version so a page never runs another release's modules
let createTabNode, PARAMS, P, F, SE, SR, SC, FM, NT, ST, SO, VS, CH, SD, SET, V;
try {
  const deadline = new Promise((_, no) => setTimeout(() => no(new Error('no answer in 20 seconds')), 20e3));
  [{ createTabNode }, PARAMS] = await Promise.race([
    Promise.all([import(`${NODE}/browser/tabnode.js`), import(`${NODE}/lib/params.mjs`)]),
    deadline,
  ]);
  [P, F, SE, SR, SC, FM, NT, ST, SO, VS, CH, SD, SET, V] = await Promise.all(MODULES.map((m) => import(`./lib/${m}.mjs?v=${VERSION}`)));
} catch (e) {
  fatal(`Bight could not load its code (${e.message}). The CDN (cdn.jsdelivr.net) may be unreachable: check the connection and reload.`);
  throw e;
}
const { esc, n, fmtAge, txUrl } = FM;
$('ver').textContent = VERSION;
const SNAP_BASE = PARAMS.SNAPSHOT.baseHeight;
const SNAP_SIZE = FM.fmtGB(PARAMS.SNAPSHOT.bytes);
// the welcome's figures, from the node this page pins (the page's own text is checked against them in CI)
$('wl-base').textContent = n(SNAP_BASE);
$('wl-size').textContent = SNAP_SIZE;

// ---- the sources: stored, or proposed by a link and used only if the person agrees, for this visit
const DEFS = SO.defaultsFor(PARAMS);
const SRC = SO.resolveSources({ get: LS.get, query: q, accepted: (k) => SS.get('bight:accept:' + k), defaults: DEFS });
const storedSources = (app) => ({
  snapshot: SO.storedValue(LS.get(app + ':snapshot')),
  blocks: SO.storedValue(LS.get(app + ':blocks')),
});
for (const k of Object.keys(SRC.proposed))
  if (SRC.use[k] !== SRC.proposed[k]) {
    const v = SRC.proposed[k];
    banner(
      'src-' + k,
      'warn',
      `This link asks Bight to read the ${k === 'snapshot' ? 'snapshot' : 'blocks'} from ${SO.hostOf(v)}. A source you do not trust can show you a chain that is not the real one. It is ignored unless you choose it, for this visit only.`,
      SO.validUrl(v)
        ? [
            [
              foreignFrame ? 'Open Bight in its own tab to choose' : 'Use it for this visit',
              () => {
                if (foreignFrame) return openOwnTab();
                if (SS.set('bight:accept:' + k, v)) location.reload();
              },
            ],
            ['Ignore', () => unbanner('src-' + k)],
          ]
        : [['Ignore', () => unbanner('src-' + k)]],
    );
  }
// a source that is not the default, in use: said for as long as it is, with the way back
{
  const custom = SO.nonDefault(SRC.use, DEFS);
  if (custom.length)
    banner(
      'custom-src',
      'warn',
      `Reading ${custom.map((k) => `the ${k} from ${SO.hostOf(SRC.use[k])}`).join(' and ')}, not the default source. What this page shows is that source's chain.`,
      [
        [
          'Back to the default',
          () => {
            for (const k of ['snapshot', 'blocks']) SS.del('bight:accept:' + k);
            const w = SET.sourceWrites({ fields: DEFS, bight: storedSources('bight'), reef: storedSources('reef'), defaults: DEFS });
            for (const x of w) x.del ? LS.del(x.key) : LS.set(x.key, x.set);
            reloadWith({}, ['snapshot', 'blocks']);
          },
        ],
      ],
    );
}
const OPT = SO.parseOptions(LS.get('bight:options'));

const tn = createTabNode({ base: NODE, snapshotUrl: SRC.use.snapshot, blocksUrl: SRC.use.blocks, torrent: OPT.torrent, seed: OPT.seed });
const node = tn.node;
window.bight = { node, OPT, VERSION };
const state = {
  blocks: new Map(), // height → { height, hash, prev, time, nTx, size, txids, fees }: the last ones, for the tiles
  found: new Map(), // height → block: older blocks asked by a search, kept apart from the tiles (the last few)
  wanted: new Map(), // height → when asked
  arrived: new Map(), // height → { at (ms), alone }: when this page learned of it (chain.markArrived)
  gen: 0, // the generation of the block requests: a reorganisation starts a new one, and older replies are ignored
  seenTx: new Map(),
  refusals: [],
  samples: [],
  template: null,
  selected: null, // height of the mined block shown in the detail
  openFound: null, // height of a block a search fetched, shown in the detail (it is not a tile)
  selectedProj: null, // index of the projected block shown in the detail
  opener: null, // { kind: 'p' | 'h' | 'r' | 'q', key } what opened the detail, for the focus on Close
  pendingTx: null, // { txid, opener, timer }: a transaction asked of the node for the detail
  openTx: null, // { txid, opener, fed }: the mempool transaction the detail shows, from the node's whole copy
  pendingSearch: null, // { height, gen, timer }: a block asked of the node by a search
  highlight: null,
  followedAt: null, // when the page last began listening without a gap (ms): the first mempool state, moved on after a gap
  followStartedAt: null, // when the first mempool state arrived (ms)
  feedBeat: null, // the node's last heartbeat value, and when this page saw it change (ms, this browser's clock)
  feedSeenAt: null,
  lastTick: Date.now(),
  skew: null, // this browser's clock less the web server's, in seconds (from the Date of version.json), for the node
  templateWanted: false, // a template asked while the tab was hidden: asked when it is shown
  lastSampleAt: 0,
  announcedSync: false,
  following: false,
  running: false,
  idle: false,
  wiped: false,
  dirty: false,
  log: [],
};
const now = () => Math.floor(Date.now() / 1000);
// the mempool as a list, computed once per state the node sends
let listOf = null,
  listMemo = [];
const list = () => {
  if (node.mempool !== listOf) {
    listOf = node.mempool;
    listMemo = P.mempoolList(node.mempool);
  }
  return listMemo;
};
const blockAt = (h) => state.blocks.get(h) ?? state.found.get(h);
// minutes between blocks lately, from the header times of the blocks shown: for the projected blocks' ETAs
const spacing = () => FM.spacingMin([...state.blocks.values()]);

// ---- status bar, pill and the node's state in words
tn.on('sync', ({ msg, pct, eta }) => {
  $('syncmsg').textContent = msg;
  $('synceta').textContent = eta || '';
  if (pct == null) $('pb').hidden = true;
  else {
    $('pb').hidden = false;
    $('pbi').style.width = Math.max(0, Math.min(100, pct)).toFixed(1) + '%';
    $('pb').setAttribute('aria-valuenow', pct.toFixed(0));
  }
  pill();
});
function pill() {
  const p = ST.pillState(node, { wiped: state.wiped });
  $('pilldot').className = p.level;
  $('pilltxt').textContent = p.text;
  $('nodeinfo').textContent = node.st
    ? `${node.coins ? n(node.coins) + ' coins · ' : ''}${node.recv ? FM.fmtGB(node.recv) + ' fetched this session' : "from this browser's storage"}`
    : '';
  // what the node says about the chain and its sources, as notices
  if (node.unresponsive) banner('slow', 'warn', ST.plainError('not answered for two minutes'), [['Reload', () => location.reload()]]);
  else unbanner('slow');
  if (node.error && !state.idle && !node.unresponsive)
    banner('nodeerr', 'bad', ST.plainError(node.error), [['Reload', () => location.reload()]]);
  else unbanner('nodeerr');
  const c = node.synced ? ST.chainState(node) : null;
  if (c && (c.level === 'warn' || c.level === 'bad')) banner('chain', c.level === 'bad' ? 'bad' : 'warn', c.text);
  else unbanner('chain');
  $('chainnote').textContent = c ? c.text : '';
  const fd = ST.feedState(node.mempool, { seenAt: state.feedSeenAt, followedAt: state.followStartedAt });
  if (fd) banner('feed', 'warn', fd.text);
  else unbanner('feed');
}
tn.on('log', ({ text, level }) => {
  const r = NT.parseRefusal(text);
  if (r) {
    state.refusals.unshift(
      `${new Date().toLocaleTimeString()} ${r.txid ? r.txid + '…' : '(no txid)'} ${r.reason}${r.from ? ' (' + r.from + ')' : ''}`,
    );
    state.refusals.length = Math.min(state.refusals.length, 30);
    $('refusals').textContent = state.refusals.join('\n');
  }
  const s = NT.parseSeedLine(text);
  if (s) $('s-seed').textContent = s.ok ? `${s.accepted} of ${s.total}` : `not loaded: ${s.error}`;
  if (level === 'err') {
    state.log.push(
      String(text)
        .replace(/https?:\/\/\S+/g, '<url>')
        .slice(0, 200),
    ); // for diagnostics, without addresses
    if (state.log.length > 20) state.log.shift();
  }
});
tn.on('nostr', () => {
  pill();
  scheduleRender();
});
tn.on('message', (m) => {
  unbanner('slowstart');
  if (m.type === 'responsive' || m.type === 'unresponsive' || m.type === 'error') pill();
  if (m.type === 'mempool-tx') onMempoolTx(m);
  // a wipe that left no node running (the loader says so as a fatal error): nothing more is asked of it
  if (m.type === 'error' && m.fatal) {
    state.running = false;
    fatal(ST.plainError(m.text));
  }
  // the node answers a block it does not have with an error that carries no req: while a search waits, it is that answer
  if (m.type === 'error' && /Block not found/.test(m.text ?? '') && state.pendingSearch) {
    const h = state.pendingSearch.height;
    dropPending();
    openDetail(
      `<h2 id="dtitle">Block ${esc(n(h))}</h2><p class="mut">the node has no block ${esc(n(h))} on its chain now (a reorganisation or a rollback may have just changed it); search again</p>`,
      { kind: 'q' },
      { focus: false },
    );
  }
});

// ---- the chain tip and the last blocks: asked from the worker by height, cached, dropped when a reorganisation replaced them
tn.on('synced', (m) => {
  // a gap in listening first: a block the node applied while the computer slept was not watched arriving
  const gap = checkGap();
  if (!state.following && !state.wiped) {
    state.following = true;
    tn.followMempool({ relays: RELAYS });
    $('s-relays').textContent = `${RELAYS.length} asked (the node does not report which answer)`;
  }
  const dropped = CH.onSynced(state.blocks, m);
  // a reorganisation or a rollback: the requests already out may be answered from the branch it replaced, so a new
  // generation is started, and the heights it replaced are asked again
  const from = m.height - (m.applied ?? 0) + 1;
  const replaced = [...state.wanted.keys()].filter((h) => h > m.height || (m.applied > 0 && h >= from && state.arrived.has(h)));
  const gone = (h) => h > m.height || dropped.includes(h) || (m.applied > 0 && h >= from);
  if (dropped.length || replaced.length) {
    state.gen++;
    for (const h of [...dropped, ...replaced]) state.wanted.delete(h);
    for (const h of [...state.found.keys()]) if (h > m.height || dropped.includes(h)) state.found.delete(h);
  }
  CH.markArrived(state.arrived, m, Date.now(), { watched: !gap }); // every height this pass applied reached this tab now
  // an open block that a reorganisation replaced is not left on screen as validated: it says so, and the new block is
  // shown when the node answers (the tile's reply, or a search asked again under the new generation)
  const open = !$('detail').hidden;
  if (open && state.selected != null && dropped.includes(state.selected)) replacedDetail(state.selected);
  if (open && state.openFound != null && gone(state.openFound)) {
    const h = state.openFound;
    state.found.delete(h);
    replacedDetail(h, { opener: { kind: 'q' } });
    if (h <= m.height) askSearch(h, { keepOpen: true });
  }
  // a search still waiting was asked under the generation just replaced: asked again
  if (state.pendingSearch && state.pendingSearch.gen !== state.gen) askSearch(state.pendingSearch.height, { keepOpen: true });
  document.title = `Bight · txbt4 · ${n(m.height)}`;
  pill();
  if (!state.announcedSync) {
    state.announcedSync = true;
    say(`Up to date at block ${n(m.height)}`);
  }
  wantBlocks();
  askTemplate();
});
function wantBlocks() {
  if (state.wiped || !state.running) return;
  // what was asked of heights no longer shown, and when blocks below the tiles arrived (the lowest tile keeps its
  // predecessor's, for seen-first), are forgotten
  if (node.height != null) CH.pruneBelow(state.wanted, node.height - 8);
  if (state.blocks.size) CH.pruneBelow(state.arrived, Math.min(...state.blocks.keys()) - 1);
  for (const h of CH.wantHeights({ height: node.height, blocks: state.blocks, wanted: state.wanted, now: Date.now(), floor: SNAP_BASE }))
    tn.post({ type: 'block', height: h, req: CH.reqOf(state.gen) });
  scheduleRender();
}
const blockOf = (m) => ({
  height: m.height,
  hash: m.hash,
  prev: m.previousblockhash,
  time: m.header?.time ?? null,
  nTx: m.nTx,
  size: m.size,
  txids: m.txids ?? [],
  // the fees its coinbase claimed: its value (the node sends it since c3f6a46) less the subsidy; null from an older node
  fees: CH.feesClaimed(m.coinbaseValue, m.height),
});
tn.on('block', (m) => {
  const r = CH.parseReq(m.req);
  if (!r || state.wiped) return;
  if (r.search) return onSearchBlock(m, r);
  if (r.gen !== state.gen) return; // asked on a branch a reorganisation replaced: asked again under the new generation
  state.wanted.delete(m.height);
  const kept = CH.acceptBlock(state.blocks, blockOf(m), { tipHeight: node.height, tipHash: node.hash });
  if (!kept) return;
  if (state.blocks.size > 40) state.blocks.delete(Math.min(...state.blocks.keys()));
  scheduleRender();
  // the block open in the detail is shown again with what the node now says (after a reorganisation, the new block),
  // without moving the focus
  if (state.selected === m.height && !$('detail').hidden) showBlock(m.height, { focus: false });
});

// ---- the mempool: the loader keeps node.mempool; the page remembers every txid it accepted
tn.on('mempool', (mp) => {
  checkGap();
  state.followedAt ??= Date.now();
  state.followStartedAt ??= Date.now();
  // the publisher's heartbeat, by this browser's clock: a change seen now is a beat now; the node's first reading is the
  // file's own time (another computer's clock), never taken as later than now
  if (mp?.feedFileAt != null && mp.feedFileAt !== state.feedBeat) {
    state.feedBeat = mp.feedFileAt;
    state.feedSeenAt = Math.min(mp.feedFileAt, Date.now());
  }
  SE.rememberSeen(state.seenTx, list());
  refreshTx();
  // a sample for the graph from the node's own messages too: a background tab's timers are slowed, its messages are not
  if (Date.now() - state.lastSampleAt >= 5000) sample();
  scheduleRender();
  askTemplate();
});
// the worker's own block for the next height: asked at most every 2 s, and within 2 s of a change however busy the mempool;
// whether it is still wanted is decided when the request goes, not when it was queued
// a hidden tab does not ask (each build checks a whole block in the worker's one queue, beside the mempool's adds): it asks
// once when shown
const askTemplate = (() => {
  const go = SD.throttle(() => {
    if (document.hidden) return void (state.templateWanted = true);
    if (node.synced && !state.wiped && !state.idle) tn.post({ type: 'template', pay: '6a00' });
  }, 2000);
  return () => node.synced && !state.wiped && go();
})();
tn.on('template', (m) => {
  state.template = m;
  scheduleRender();
});

// ---- rendering: once per frame at most, and not while the tab is hidden (it catches up when shown)
function scheduleRender() {
  if (state.dirty) return;
  state.dirty = true;
  if (document.hidden) return;
  requestAnimationFrame(renderAll);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (state.dirty) requestAnimationFrame(renderAll);
  if (state.templateWanted) {
    state.templateWanted = false;
    askTemplate();
  }
});
function renderAll() {
  state.dirty = false;
  if (state.wiped || state.idle) return;
  const blocks = node.mempool ? P.packBlocks(list(), { rdts: state.template?.rdts ?? true }) : [];
  renderProjected(blocks);
  renderMempool(blocks);
  renderMined();
  centreRow();
  pill();
}
// the next block and the chain tip in view: the row of tiles is scrolled to the divider between them when it first
// overflows and whenever the number of projected tiles changes, until the person scrolls the row themselves
const row = $('blocksrow');
let rowCount = -1,
  rowManual = false;
const rowScrolled = () => (rowManual = true);
row.addEventListener('wheel', rowScrolled, { passive: true });
row.addEventListener('touchmove', rowScrolled, { passive: true });
row.addEventListener('pointerdown', (e) => e.target === row && rowScrolled()); // its scrollbar
function centreRow() {
  const count = $('proj').children.length;
  if (rowManual || count === rowCount || row.scrollWidth <= row.clientWidth) return;
  rowCount = count;
  row.scrollLeft = Math.max(0, row.querySelector('.divider').offsetLeft - row.clientWidth / 2);
}
// patch a row of tiles in place: one <button> per key, its content and name updated, moved only when out of place, so
// the focused one keeps the focus. What is no longer shown is removed first, so the walk below moves only what is out of
// order (a stale tile in the way would otherwise make it move every tile after it).
function patchTiles(container, items) {
  const keys = new Set(items.map((it) => it.key));
  const have = new Map();
  for (const el of [...container.children]) {
    const want = items.find((it) => it.key === el.dataset.k);
    if (!keys.has(el.dataset.k) || el.tagName !== (want?.tag ?? 'button').toUpperCase()) el.remove();
    else have.set(el.dataset.k, el);
  }
  let at = container.firstChild;
  for (const it of items) {
    let el = have.get(it.key);
    if (!el) {
      el = document.createElement(it.tag ?? 'button');
      if (el.tagName === 'BUTTON') el.type = 'button';
      el.dataset.k = it.key;
    }
    if (el.className !== it.cls) el.className = it.cls;
    if (el.dataset.html !== it.html) {
      el.innerHTML = it.html;
      el.dataset.html = it.html;
    }
    // a name only on what can have one (a button); a plain box says what it says
    if (it.label != null && el.tagName === 'BUTTON') el.setAttribute('aria-label', it.label);
    if (it.expanded != null) {
      el.setAttribute('aria-expanded', String(it.expanded));
      el.setAttribute('aria-controls', 'detail');
    }
    for (const [k, v] of Object.entries(it.style ?? {})) el.style.setProperty(k, v);
    el.onclick = it.onActivate ?? null;
    if (el !== at) container.insertBefore(el, at);
    else at = at.nextSibling;
  }
}
const EMPTY_BLOCK = { txs: [], vsize: 0, fees: 0, weight: 0, min: null, max: null, med: null, wmed: null };
// the node's build of the next block in words, judged against the mempool this page shows and the block it packed
const templateNow = (blocks = state.lastBlocks ?? []) =>
  NT.templateWords(state.template, node.height, node.hash, node.mempool ? { count: node.mempool.count, block: blocks[0] ?? null } : null);
function renderProjected(blocks) {
  const tw = templateNow(blocks);
  const note = tw.failed ? 'build fails' : tw.otherMempool ? 'built on a different mempool' : tw.differs ? 'the node’s build differs' : '';
  const items = [];
  const sel = (i) => state.selectedProj === i;
  if (!blocks.length) {
    // the same key as the full next block, so the focus stays on it when the mempool empties or fills
    const e = V.emptyNextTile({
      built: !!node.mempool && tw.ok,
      words: ST.emptyWords(node.mempool, { following: state.following }) ?? 'the mempool is empty',
    });
    items.push({
      key: 'p0',
      cls: `blk empty${sel(0) ? ' sel' : ''}`,
      html: e.html,
      label: e.label,
      expanded: sel(0),
      onActivate: () => showProjected(EMPTY_BLOCK, 0),
    });
  } else {
    const cov = P.coverage(node.mempool);
    if (cov.truncated)
      items.push({
        key: 'more',
        cls: 'blk empty more',
        tag: 'div',
        html: `<span class="h">more</span><span class="s">${esc(n(Math.max(0, cov.totalVb - cov.shownVb)))} vB more in the mempool than this page sees</span>`,
      });
    const rest = P.remainder(list(), blocks, { rdts: state.template?.rdts ?? true });
    if (rest.count) {
      const r = V.remainderTile(rest);
      items.push({ key: 'rest', cls: 'blk empty more', tag: 'div', html: r.html });
    }
    // in the order they read: the furthest projection first, the next block beside the chain tip
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      const t = V.projTile(b, i, { built: i === 0 && tw.ok ? state.template : null, note: i === 0 ? note : '', spacing: spacing() });
      const c = F.feeColors(b.wmed);
      items.push({
        key: 'p' + i,
        cls: `blk proj${sel(i) ? ' sel' : ''}`,
        html: t.html,
        label: t.label,
        expanded: sel(i),
        style: { '--c1': c.c1, '--c2': c.c2 },
        onActivate: () => showProjected(b, i),
      });
    }
  }
  patchTiles($('proj'), items);
  state.lastBlocks = blocks;
}
function renderMined() {
  const hs = [...state.blocks.keys()].sort((a, b) => b - a).slice(0, 8);
  const sh = ST.signedHeight(node.nostr);
  if (!hs.length) {
    patchTiles($('mined'), [
      {
        key: 'empty',
        cls: 'blk empty',
        tag: 'div',
        html: '<span class="h">last blocks</span><span class="s">appear once the tab is up to date</span>',
      },
    ]);
    return;
  }
  patchTiles(
    $('mined'),
    hs.map((h) => {
      const b = state.blocks.get(h);
      const known = b.txids
        .slice(1)
        .map((t) => state.seenTx.get(t))
        .filter(Boolean);
      const sw = seenOf(b);
      const unsigned = sh == null || h > sh;
      // how long ago it reached this tab, when it was watched arriving on its own; one that came in a catch-up (the first
      // sync, after sleep) is aged by its header, and says so
      const arr = state.arrived.get(h);
      const fromArrival = !!arr?.alone;
      const t = V.minedTile(b, {
        med: P.weightedMedian(known),
        known: known.length,
        others: sw.others,
        seenWords: sw.words,
        unsigned,
        ageS: fromArrival ? Math.round((Date.now() - arr.at) / 1000) : now() - (b.time ?? now()),
        ageFrom: fromArrival ? 'arrival' : 'header',
      });
      return {
        key: 'h' + h,
        cls: `blk mined${state.selected === h ? ' sel' : ''}${unsigned ? ' unsigned' : ''}`,
        html: t.html,
        label: t.label,
        expanded: state.selected === h,
        onActivate: () => showBlock(h),
      };
    }),
  );
}
const seenOf = (b) =>
  SE.blockSeen(b, state.seenTx, {
    followedAt: state.followedAt,
    arrival: state.arrived.get(b.height) ?? null,
    prevArrival: state.arrived.get(b.height - 1) ?? null,
  });
// the detail panel takes the focus when it opens (the region's name, its title, is then read; it is not said again) and
// gives it back to what opened it when it closes; Close sits in its header, and Escape closes it
function openDetail(html, opener, { focus = true, keepPending = false } = {}) {
  if (!keepPending) dropPending();
  state.openTx = null; // set again by showTx when it is a mempool transaction
  const d = $('detail');
  // the focus on something inside the detail (Close) would be lost with the content: it goes to the detail itself
  const inside = d.contains(document.activeElement) && document.activeElement !== d;
  d.hidden = false;
  const close = '<button class="btn" type="button" id="dclose">Close</button>';
  const m = /^(<h2 id="dtitle">[\s\S]*?<\/h2>)/.exec(html);
  d.innerHTML = m ? `<div class="dhead">${m[1]}${close}</div>${html.slice(m[1].length)}` : `<div class="dhead">${close}</div>${html}`;
  state.opener = opener;
  $('dclose').onclick = closeDetail;
  if (focus || inside) d.focus();
  if (!focus) {
    const h = d.querySelector('#dtitle');
    if (h && d.dataset.said !== h.textContent) say(h.textContent);
  }
  d.dataset.said = d.querySelector('#dtitle')?.textContent ?? '';
}
// Escape closes the detail from anywhere on the page (a tile, a row, the detail itself), unless a dialog is open: the
// dialog's own Escape is meant then
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented || $('detail').hidden || document.querySelector('dialog[open]')) return;
  e.preventDefault();
  closeDetail();
});
// a transaction or a block asked of the node for the detail is forgotten when the detail closes or shows something else
function dropPending() {
  for (const k of ['pendingTx', 'pendingSearch']) {
    clearTimeout(state[k]?.timer);
    state[k] = null;
  }
}
function closeDetail() {
  dropPending();
  $('detail').hidden = true;
  $('detail').dataset.said = '';
  const o = state.opener;
  state.selected = null;
  state.openFound = null;
  state.selectedProj = null;
  renderMined();
  renderProjected(state.lastBlocks ?? []);
  const back =
    o?.kind === 'q'
      ? $('q')
      : o?.kind === 'r'
        ? document.querySelector(`#rows tr[data-t="${o.key}"] .txbtn`)
        : o
          ? document.querySelector(`[data-k="${o.kind}${o.key}"]`)
          : null;
  (back ?? $('q')).focus();
}
function showBlock(h, { focus = true, foundTxid = null, opener = null } = {}) {
  const b = blockAt(h);
  if (!b) return;
  state.selected = state.blocks.has(h) ? h : null;
  state.openFound = state.blocks.has(h) ? null : h;
  state.selectedProj = null;
  renderMined();
  renderProjected(state.lastBlocks ?? []);
  const sw = seenOf(b);
  const mpIds = new Set(list().map((x) => x.txid));
  const sh = ST.signedHeight(node.nostr);
  openDetail(
    V.blockDetail(b, {
      sw,
      seenTx: state.seenTx,
      signedWords:
        sh == null
          ? 'no signed chain tip to check it against yet'
          : h > sh
            ? 'above the signed chain tip: not yet signed'
            : 'the signed chain tip agrees',
      inMempool: b.txids.filter((t) => mpIds.has(t)).length,
      foundTxid,
      arrival: state.arrived.get(h) ?? null,
    }),
    opener ?? (foundTxid || !state.blocks.has(h) ? { kind: 'q' } : { kind: 'h', key: h }),
    { focus },
  );
}
function showProjected(b, i) {
  state.selected = null;
  state.openFound = null;
  state.selectedProj = i;
  state.highlight = null;
  renderMined();
  renderProjected(state.lastBlocks ?? []);
  const tw = templateNow();
  openDetail(V.projDetail(b, i, { tw: i === 0 && state.template ? tw : null, asOf: new Date().toLocaleTimeString() }), {
    kind: 'p',
    key: i,
  });
}

// ---- the mempool panel, the histogram, the table
function renderMempool(blocks) {
  const m = node.mempool;
  if (!m) return;
  const all = list();
  const cov = P.coverage(m);
  const wmed = P.weightedMedian(all);
  const tw = templateNow(blocks);
  $('m-count').textContent = n(m.count);
  $('m-size').textContent = `${n(m.bytes)} vB`;
  $('m-fees').textContent = `${n(m.fees)} sat`;
  $('m-med').textContent = wmed != null ? `${wmed.toFixed(1)} sat/vB${cov.truncated ? ' (of those shown)' : ''}` : '—';
  $('m-next').textContent = tw.text;
  $('m-next').classList.toggle('badt', !!tw.failed && !tw.stale);
  $('m-cover').textContent = cov.truncated
    ? `This page sees the top ${n(cov.shown)} of ${n(cov.total)} transactions by fee rate; the bands, the median, the projected blocks and the table cover those.`
    : '';
  $('s-seen').textContent = n(m.stats.seen);
  $('s-acc').textContent = n(m.stats.accepted);
  $('s-ref').textContent = n(m.stats.refused);
  $('s-drop').textContent = n(m.stats.dropped);
  $('s-feed').textContent = state.feedSeenAt
    ? `${fmtAge(Math.max(0, Math.round((Date.now() - state.feedSeenAt) / 1000)))} ago`
    : m.following
      ? 'not yet'
      : '…';
  $('s-feedtx').textContent = m.lastFeedAt ? `${fmtAge(Math.max(0, now() - Math.floor(m.lastFeedAt / 1000)))} ago` : 'none yet';
  // the bands: bars for the eye, a table for a screen reader
  const counts = F.histogram(all);
  const max = Math.max(1, ...counts);
  const bars = F.BANDS.map(
    (b, i) =>
      `<div style="height:${((counts[i] / max) * 100).toFixed(1)}%" title="${esc(F.bandLabel(i))} sat/vB: ${esc(n(counts[i]))} vB"><span>${i % 2 ? '' : i === 0 ? '<1' : b}</span></div>`,
  ).join('');
  if ($('hist').dataset.html !== bars) {
    $('hist').innerHTML = bars;
    $('hist').dataset.html = bars;
    const top = counts
      .map((c, i) => [c, i])
      .filter(([c]) => c > 0)
      .sort((a, b) => b[0] - a[0])
      .slice(0, 3);
    $('hist').setAttribute(
      'aria-label',
      top.length
        ? `vB by fee rate; the largest bands: ${top.map(([c, i]) => `${F.bandLabel(i)} sat/vB, ${n(c)} vB`).join('; ')}`
        : 'vB by fee rate: none',
    );
    $('histtbl').innerHTML = F.BANDS.map((_, i) => `<tr><td>${esc(F.bandLabel(i))}</td><td>${esc(n(counts[i]))}</td></tr>`).join('');
  }
  renderRows(all, blocks);
}
// the table: rows keyed by txid and patched in place; the age cell is updated on its own, so a row's link or a text
// selection in it survives the next update
function renderRows(all, blocks) {
  const tb = $('rows');
  const sel = getSelection();
  if (sel && !sel.isCollapsed && tb.contains(sel.anchorNode)) return; // someone is selecting a txid: leave it
  const blockOf = P.blockIndex(blocks);
  const t0 = now();
  const rows = [...all].sort((a, b) => b.at - a.at).slice(0, 300);
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="6" class="mut">${esc(ST.emptyWords(node.mempool, { following: state.following }) ?? 'empty')}</td></tr>`;
    return;
  }
  // what is no longer listed goes first (but not a row holding the focus), so the walk moves only what is out of order
  const keep = new Set(rows.map((t) => t.txid));
  const have = new Map();
  for (const tr of [...tb.children]) {
    if (tr.dataset.t && (keep.has(tr.dataset.t) || tr.contains(document.activeElement))) have.set(tr.dataset.t, tr);
    else tr.remove();
  }
  let at = tb.firstChild;
  for (const t of rows) {
    let tr = have.get(t.txid);
    const i = blockOf.get(t.txid);
    const html = `<td class="mono"><button type="button" class="txbtn" data-open="${esc(t.txid)}">${esc(t.txid.slice(0, 20))}…</button> <a class="ext" href="${esc(txUrl(t.txid))}" target="_blank" rel="noopener" aria-label="transaction ${esc(t.txid.slice(0, 12))} on mempool.guide (another site, not checked by this tab)" title="on mempool.guide: another site, not checked by this tab">↗</a></td><td class="age"></td><td class="amt">${esc(n(t.vsize))}</td><td class="amt">${esc(n(t.fee))}</td><td class="amt">${esc(t.feeRate.toFixed(1))}</td><td>${i == null ? 'later' : i === 0 ? 'next' : `#${i + 1}`}</td>`;
    if (!tr) {
      tr = document.createElement('tr');
      tr.dataset.t = t.txid;
    }
    if (tr.dataset.html !== html) {
      tr.innerHTML = html;
      tr.dataset.html = html;
    }
    tr.classList.toggle('hi', state.highlight === t.txid);
    tr.querySelector('.age').textContent = fmtAge(Math.max(0, t0 - t.at));
    if (tr !== at) tb.insertBefore(tr, at);
    else at = at.nextSibling;
  }
  // a focused row no longer listed stays, after the others, until the focus leaves it
  for (const tr of have.values()) if (!keep.has(tr.dataset.t) && !tr.contains(document.activeElement)) tr.remove();
}
$('rows').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-open]');
  if (b) openTx(b.dataset.open, { kind: 'r', key: b.dataset.open });
});
// one transaction of the mempool, in the page: from the full copy the node sent when it has one, else asked of the node
// (given up after 15 s); with where it would go in the projected blocks
function openTx(txid, opener) {
  const full = (node.mempool?.txs ?? []).find((x) => x.txid === txid);
  state.highlight = txid;
  state.selected = null;
  state.openFound = null;
  state.selectedProj = null;
  scheduleRender();
  if (full) return showTx(full, opener);
  const block = P.blockIndex(state.lastBlocks ?? []).get(txid) ?? null;
  openDetail(`<h2 id="dtitle">In this tab's mempool</h2><p class="mut">asking the node for ${esc(txid.slice(0, 20))}…</p>`, opener);
  const timer = setTimeout(() => {
    if (state.pendingTx?.txid !== txid) return;
    state.pendingTx = null;
    openDetail(
      `<h2 id="dtitle">No answer</h2><p class="mut">the node did not answer for ${esc(txid.slice(0, 20))}… in 15 seconds; search again to retry</p>`,
      opener,
      { focus: false },
    );
  }, 15e3);
  state.pendingTx = { txid, opener, timer, block };
  tn.post({ type: 'mempool-get', txid, req: 'bight' });
}
// a mempool transaction from the node's whole copy, with where it would go; shown again when that copy changes what it
// says (a node's mempool took it: "fed")
function showTx(tx, opener, { focus = true } = {}) {
  const block = P.blockIndex(state.lastBlocks ?? []).get(tx.txid) ?? null;
  openDetail(V.mempoolTxDetail(tx, { block, spacing: spacing() }), opener, { focus });
  state.openTx = { txid: tx.txid, opener, fed: !!tx.fed };
}
function refreshTx() {
  const o = state.openTx;
  if (!o || $('detail').hidden) return;
  const full = (node.mempool?.txs ?? []).find((x) => x.txid === o.txid);
  if (full && !!full.fed !== o.fed) showTx(full, o.opener, { focus: false });
}
function onMempoolTx(m) {
  if (m.req !== 'bight' || state.pendingTx?.txid !== m.txid) return;
  const { opener, block } = state.pendingTx;
  dropPending();
  openDetail(
    m.found
      ? V.mempoolTxDetail(m, { block, spacing: spacing() })
      : `<h2 id="dtitle">Not found</h2><p class="mut">no longer in this tab's mempool: confirmed or dropped</p>`,
    opener,
    { focus: false },
  );
}
// every 5 s: a sample for the graph, the ages, and a check for a gap in listening: when the timer comes back much later than
// it should (the computer slept, or the browser froze or slowed a background tab), the transactions of that time may not
// have been heard, so "seen first" counts only blocks after it
function sample() {
  if (!node.mempool) return;
  state.lastSampleAt = Date.now();
  SR.pushSample(state.samples, { t: Date.now(), count: node.mempool.count, vb: node.mempool.bytes });
  if (!document.hidden) drawGraph();
}
const listeningGap = () => {
  if (state.followedAt != null) state.followedAt = Date.now();
};
// a gap in listening: neither this timer nor a message from the node for over two minutes (the computer slept, or the
// browser froze the tab). A background tab's timers run about once a minute, and the node's messages go on: not a gap.
// Checked here and first thing on every sync and mempool message, so a block applied during sleep is not counted.
function checkGap() {
  const t = Date.now();
  const gap = t - state.lastTick > 120e3;
  if (gap) listeningGap();
  state.lastTick = t;
  return gap;
}
setInterval(() => {
  checkGap();
  const t = Date.now();
  if (state.wiped || state.idle) return;
  if (t - state.lastSampleAt >= 4500) sample();
  wantBlocks();
  scheduleRender();
}, 5000);
addEventListener('online', listeningGap);
document.addEventListener('resume', listeningGap); // a frozen tab brought back
function drawGraph() {
  const c = $('g');
  const W = (c.width = c.clientWidth * devicePixelRatio),
    H = (c.height = c.clientHeight * devicePixelRatio);
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  const s = state.samples;
  $('gspan').textContent = SR.spanWords(s);
  const cs = getComputedStyle(document.documentElement);
  const cv = (k, d) => cs.getPropertyValue(k).trim() || d;
  if (s.length < 2) {
    g.fillStyle = cv('--mut', '#8d92ab');
    g.font = `${12 * devicePixelRatio}px system-ui,sans-serif`;
    g.fillText(
      state.idle ? 'the graph runs where the node runs' : 'collecting: a point every 5 s',
      8 * devicePixelRatio,
      20 * devicePixelRatio,
    );
    c.setAttribute('aria-label', 'Mempool over time: collecting, a point every 5 seconds');
    return;
  }
  const pad = 6 * devicePixelRatio;
  g.strokeStyle = cv('--grid', '#2a2f47');
  g.lineWidth = devicePixelRatio;
  for (let i = 1; i < 4; i++) {
    g.beginPath();
    g.moveTo(pad, (H * i) / 4);
    g.lineTo(W - pad, (H * i) / 4);
    g.stroke();
  }
  // vB as a filled area under its line, transactions as a line over it; a lone point (gaps on both sides) as a dot
  const vb = SR.polyline(s, 'vb', { W, H, pad });
  const acc = cv('--acc', '#f0a04b');
  g.fillStyle = acc;
  g.globalAlpha = 0.28;
  for (const r of vb.runs) {
    if (r.length < 2) continue;
    g.beginPath();
    g.moveTo(r[0][0], H - pad);
    for (const [X, Y] of r) g.lineTo(X, Y);
    g.lineTo(r.at(-1)[0], H - pad);
    g.closePath();
    g.fill();
  }
  g.globalAlpha = 1;
  const line = (runs, color) => {
    g.strokeStyle = g.fillStyle = color;
    g.lineWidth = 1.5 * devicePixelRatio;
    for (const r of runs) {
      if (r.length === 1) {
        g.beginPath();
        g.arc(r[0][0], r[0][1], 2.5 * devicePixelRatio, 0, 2 * Math.PI);
        g.fill();
        continue;
      }
      g.beginPath();
      r.forEach(([X, Y], i) => (i ? g.lineTo(X, Y) : g.moveTo(X, Y)));
      g.stroke();
    }
  };
  line(vb.runs, acc);
  const cnt = SR.polyline(s, 'count', { W, H, pad });
  line(cnt.runs, cv('--blue', '#4a90e2'));
  const maxVb = vb.top,
    maxN = cnt.top;
  const gaps = cnt.runs.length - 1;
  $('gmax').textContent =
    (maxN || maxVb ? `top of the graph: ${FM.pl(maxN, 'transaction')}, ${n(maxVb)} vB` : 'empty all the time shown') +
    (gaps ? ` · ${FM.pl(gaps, 'gap')} where this tab was in the background or asleep and not sampling` : '');
  c.setAttribute(
    'aria-label',
    `Mempool over ${SR.spanWords(s)}: now ${FM.pl(s.at(-1).count, 'transaction')} and ${n(s.at(-1).vb)} vB; at most ${n(maxN)} and ${n(maxVb)}`,
  );
}

// ---- search: a txid (or its start), a block hash or height; the mempool, then the blocks this tab holds, then what it saw
$('search').onsubmit = (e) => {
  e.preventDefault();
  const pq = SC.parseQuery($('q').value);
  state.selected = null;
  if (state.idle)
    return openDetail(
      `<h2 id="dtitle">Search</h2><p class="mut">This tab is idle: the node and its mempool are in the other tab. Search there.</p>`,
      { kind: 'q' },
    );
  if (pq.error) {
    state.highlight = null;
    return openDetail(`<h2 id="dtitle">Search</h2><p class="mut">${esc(pq.error)}</p>`, { kind: 'q' });
  }
  const r = SC.locate(pq, {
    list: list(),
    blocks: [...state.blocks.values(), ...[...state.found.values()].filter((b) => !state.blocks.has(b.height))],
    seen: state.seenTx,
  });
  state.highlight = r.where === 'mempool' ? r.tx.txid : null;
  state.selectedProj = null;
  scheduleRender();
  if (r.where === 'mempool') return openTx(r.tx.txid, { kind: 'q' });
  if (r.where === 'block') return showBlock(r.height, { foundTxid: r.txid ?? null, opener: { kind: 'q' } });
  // a height this tab does not hold: any block between the snapshot and the tip is asked of the node
  const range = r.height != null ? SC.heightRange(r.height, { floor: SNAP_BASE, tip: node.synced ? node.height : null }) : null;
  if (range === 'ask') return askSearch(r.height);
  if (r.where === 'none') r.searched = SC.searchedOf([...state.blocks.values()]); // the last blocks, not those a search fetched
  openDetail(
    `<h2 id="dtitle">Not found</h2><p class="mut">${esc(V.notFoundWords(r, { count: node.mempool?.count ?? 0, range, floor: SNAP_BASE, tip: node.height }))}</p>`,
    { kind: 'q' },
  );
};
// a block asked of the node for a search, under the current generation (given up after 15 s); keepOpen: the detail already
// says why it is asking (a reorganisation replaced the block shown)
function askSearch(h, { keepOpen = false } = {}) {
  clearTimeout(state.pendingSearch?.timer);
  if (!keepOpen)
    openDetail(`<h2 id="dtitle">Block ${esc(n(h))}</h2><p class="mut">asking the node for block ${esc(n(h))}…</p>`, { kind: 'q' });
  const timer = setTimeout(() => {
    if (state.pendingSearch?.height !== h) return;
    state.pendingSearch = null;
    openDetail(
      `<h2 id="dtitle">Block ${esc(n(h))}</h2><p class="mut">the node did not answer in 15 seconds; search again to retry</p>`,
      { kind: 'q' },
      { focus: false },
    );
  }, 15e3);
  state.pendingSearch = { height: h, gen: state.gen, timer };
  tn.post({ type: 'block', height: h, req: CH.reqOf(state.gen, true) });
}
// the block open in the detail was replaced by a reorganisation (or rolled back): said in place of it, without moving the
// focus, until the node answers with the block now at that height
function replacedDetail(h, { opener = { kind: 'h', key: h } } = {}) {
  const gone = node.height != null && h > node.height;
  const words = gone
    ? `rolled back: the chain is now at ${n(node.height)}, below this block`
    : 'replaced by a reorganisation: asking the node for the block now at this height…';
  openDetail(`<h2 id="dtitle">Block ${esc(n(h))}</h2><p class="mut">${esc(words)}</p>`, opener, { focus: false });
  say(`Block ${n(h)} was ${gone ? 'rolled back' : 'replaced by a reorganisation'}`);
}
// a block a search asked for: kept apart from the tiles (the last few), and shown if that search is still the one open
function onSearchBlock(m, r) {
  if (r.gen !== state.gen || !m.hash) return;
  state.found.set(m.height, blockOf(m));
  while (state.found.size > 10) state.found.delete(state.found.keys().next().value);
  if (state.pendingSearch?.height !== m.height) return;
  dropPending();
  showBlock(m.height, { opener: { kind: 'q' }, focus: false });
}

// ---- theme
$('theme').onclick = () => {
  const el = document.documentElement;
  el.dataset.theme = el.dataset.theme === 'light' ? 'dark' : 'light';
  LS.set('bight:theme', el.dataset.theme);
  themeButton();
  drawGraph();
};
const themeButton = () => {
  const light = document.documentElement.dataset.theme === 'light';
  $('theme').setAttribute('aria-label', light ? 'Switch to the dark theme' : 'Switch to the light theme');
};
themeButton();
// with no choice stored, the theme follows the system's, also when it changes
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', (e) => {
  if (LS.get('bight:theme')) return;
  document.documentElement.dataset.theme = e.matches ? 'light' : 'dark';
  themeButton();
  drawGraph();
});

// ---- settings: filled from what is stored (never from a link); only what the person changed is written
const fillSettings = (src = SRC.stored, opt = OPT) => {
  $('o-snapshot').value = src.snapshot;
  $('o-blocks').value = src.blocks;
  $('o-torrent').checked = !!opt.torrent;
  $('o-seed').checked = !!opt.seed;
  $('o-err').textContent = '';
  $('o-snapnote').textContent = '';
};
$('o-snapshot').oninput = () => {
  $('o-snapnote').textContent =
    $('o-snapshot').value.trim() !== SRC.stored.snapshot ? `saving a different snapshot fetches it again: ${SNAP_SIZE}` : '';
};
$('settings').onclick = () => {
  fillSettings();
  $('o-wipenote').textContent = !state.running
    ? 'the node runs in another tab (or is not started): wipe from there'
    : top !== self
      ? 'open Bight in its own tab to wipe'
      : '';
  $('o-wipe').disabled = !state.running || top !== self; // never from a frame: a page around it could make the click
  delete $('o-wipe').dataset.armed;
  $('o-wipe').removeAttribute('aria-describedby');
  tn.seedSupported?.().then((yes) => {
    if (yes === false) {
      $('o-seed').checked = false;
      $('o-seed').disabled = true;
    }
  });
  $('dlg').showModal();
};
$('o-cancel').onclick = () => $('dlg').close();
$('o-reset').onclick = () => fillSettings(DEFS, SO.OPT_DEFAULTS);
$('o-wipe').onclick = () => {
  if (!state.running || top !== self) return;
  if ($('o-wipe').dataset.armed) {
    $('o-wipenote').textContent = 'wiping…';
    delete $('o-wipe').dataset.armed;
    Promise.resolve(tn.wipe()).then(
      (r) => {
        state.wiped = true;
        // the files are gone, so is the answer to "may I download 870 MB": the next visit asks again
        LS.del('reef:started');
        LS.del('bight:started');
        $('dlg').close();
        pill();
        // all removed: the page reloads, so the node's worker and its timers end with it, and the reload asks before
        // fetching again; files left behind are named first, and the reload is left to the person
        if (!r?.failed?.length) return location.reload();
        banner(
          'wiped',
          'bad',
          `The node's files are removed except these: ${r.failed.join(', ')}. Nothing more is shown until you reload, which asks before fetching the snapshot again.`,
          [['Reload', () => location.reload()]],
        );
      },
      (e) => {
        $('o-wipenote').textContent = 'not wiped: ' + (e?.message || e);
        // the loader stops the node for a wipe; one that failed may have left none running (phase 'error'): the pill and
        // the notices say so rather than "up to date" over a stopped node
        if (node.phase === 'error' || node.phase === 'wiped') state.running = false;
        pill();
      },
    );
  } else {
    $('o-wipe').dataset.armed = '1';
    $('o-wipenote').textContent =
      "press again: this removes the node's files for Reef, Winch and Hitch in this browser too (the key in Reef is not touched)";
    $('o-wipe').setAttribute('aria-describedby', 'o-wipenote');
  }
};
$('o-ok').onclick = () => {
  const s = $('o-snapshot').value.trim(),
    b = $('o-blocks').value.trim();
  if ((s && !SO.validUrl(s)) || (b && !SO.validUrl(b))) {
    $('o-err').textContent = 'Only https:// addresses can be used for the snapshot and the blocks (an empty field means the default).';
    return;
  }
  OPT.torrent = $('o-torrent').checked;
  OPT.seed = $('o-seed').checked && !$('o-seed').disabled;
  LS.set('bight:options', JSON.stringify(OPT));
  tn.setTorrent(OPT.torrent);
  tn.setSeed(OPT.seed);
  const w = SET.sourceWrites({
    fields: { snapshot: s, blocks: b },
    bight: storedSources('bight'),
    reef: storedSources('reef'),
    defaults: DEFS,
  });
  for (const x of w) x.del ? LS.del(x.key) : LS.set(x.key, x.set);
  $('dlg').close();
  if (w.length) reloadWith({}, ['snapshot', 'blocks']);
};
$('o-diag').onclick = async () => {
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const persisted = await navigator.storage?.persisted?.().catch(() => null);
  const locks = await navigator.locks?.query?.().catch(() => null);
  const d = {
    bight: VERSION,
    node: NODE.slice(-40),
    ua: navigator.userAgent,
    embedded,
    phase: node.phase,
    synced: !!node.synced,
    height: node.height,
    error: node.error ? String(node.error).replace(/https?:\/\/\S+/g, '<url>') : null,
    lastError: node.lastError ? { ...node.lastError, text: String(node.lastError.text ?? '').replace(/https?:\/\/\S+/g, '<url>') } : null,
    unresponsive: !!node.unresponsive,
    lockError: node.lockError ?? null,
    retryAt: node.retryAt ?? null,
    lockHeld: locks ? (locks.held ?? []).some((l) => l.name === 'bitcoin-blake:node') : null,
    hist: node.hist,
    nostr: node.nostr
      ? {
          height: node.nostr.height,
          agree: node.nostr.agree,
          diverged: !!node.nostr.diverged,
          live: !!node.nostr.live,
          kept: !!node.nostr.kept,
        }
      : null,
    mempool: node.mempool
      ? {
          count: node.mempool.count,
          all: Array.isArray(node.mempool.all),
          following: node.mempool.following,
          lastFeedAt: node.mempool.lastFeedAt,
          feedFileAt: node.mempool.feedFileAt ?? null,
          stats: node.mempool.stats,
        }
      : null,
    template: state.template ? NT.templateWords(state.template, node.height, node.hash) : null,
    sources: Object.fromEntries(['snapshot', 'blocks'].map((k) => [k, SO.nonDefault(SRC.use, DEFS).includes(k) ? 'custom' : 'default'])),
    gen: state.gen,
    followedAt: state.followedAt,
    feedSeenAt: state.feedSeenAt,
    foreignFrame,
    consent: !!(LS.get('reef:started') || LS.get('bight:started')),
    storage: est ? { usage: est.usage, quota: est.quota } : null,
    persisted,
    running: state.running,
    idle: state.idle,
    log: state.log,
  };
  const text = JSON.stringify(d, null, 1);
  try {
    await navigator.clipboard.writeText(text);
    $('o-wipenote').textContent = 'diagnostics copied (they hold no addresses)';
  } catch {
    $('o-diagtext').hidden = false;
    $('o-diagtext').value = text;
    $('o-diagtext').select();
  }
};

// ---- a newer Bight: checked a little after start and then hourly, offered, never forced
async function checkVersion() {
  try {
    const r = await fetch('version.json', { cache: 'no-cache' });
    // this browser's clock against the web server's (its Date, to the second): the node judges signed tips by real time
    const served = Date.parse(r.headers.get('date') ?? '');
    if (Number.isFinite(served)) {
      state.skew = Math.round((Date.now() - served) / 1000);
      if (state.running) tn.setSkew?.(state.skew);
    }
    const v = await r.json();
    if (VS.newer(v.version, VERSION))
      banner('update', 'info', `A newer Bight is available (${v.version}). Reload to use it.`, [
        ['Reload', () => reloadWith({ v: v.version })],
      ]);
  } catch {}
}
setTimeout(checkVersion, 10e3); // also run when the node starts (startNode), for the clock
setInterval(checkVersion, 3600e3);

// ---- start: what the browser needs, the person’s go before 870 MB (shared with Reef: one answer for both), one node
function missingFeatures() {
  const miss = [];
  if (!navigator.storage?.getDirectory) miss.push('a private file system for sites (OPFS)');
  if (typeof Worker === 'undefined') miss.push('web workers');
  if (typeof WebAssembly === 'undefined') miss.push('WebAssembly');
  if (!window.isSecureContext) miss.push('a secure (https) page');
  return miss;
}
function goIdle() {
  state.idle = true;
  document.body.classList.add('idle');
  $('syncmsg').textContent = 'idle: the node runs in another tab of this browser';
  banner(
    'idle',
    'info',
    'Another tab of this browser runs the node (Reef, Bight, Winch or Hitch). Bight shows the mempool only where the node runs; this tab starts it as soon as that tab closes.',
    [['Check again', () => location.reload()]],
  );
  pill();
  // the lock is held by the other tab: when it is granted here, the other tab has closed, so this one takes over
  navigator.locks
    ?.request('bitcoin-blake:node', () => {})
    .then(() => setTimeout(() => location.reload(), 1500))
    .catch(() => {});
}
function lockFailed(err) {
  pill();
  banner(
    'lockfail',
    'bad',
    `This browser refused the lock that keeps one node per browser (${err}). Running anyway is safe only if no other tab of Reef, Bight, Winch or Hitch is open.`,
    [
      foreignFrame
        ? ['Open Bight in its own tab', openOwnTab]
        : [
            'Run anyway in this tab',
            () => {
              unbanner('lockfail');
              startNode(true);
            },
          ],
    ],
  );
}
async function startNode(force = false) {
  unbanner('welcome');
  // asked first, always: no node starts (and nothing is downloaded) without the person's go
  if (!(LS.get('reef:started') || LS.get('bight:started'))) return welcome(force);
  if (!navigator.locks && !force) {
    node.lockError = 'this browser has no Web Locks';
    return lockFailed(node.lockError);
  }
  if (force) node.lockError = null; // run anyway: the refusal is answered, and no longer said
  try {
    const started = await tn.start({ force });
    if (started === false) return node.lockError ? lockFailed(node.lockError) : goIdle();
    state.running = true;
    navigator.storage?.persist?.().catch(() => {}); // asked on every start: a site not asked is the first evicted
    // the clock's offset for the node, once its worker runs (a message before then is not delivered)
    if (state.skew != null) tn.setSkew?.(state.skew);
    else checkVersion();
    // a node whose code hangs while loading never says a word: after a minute of silence, that is said
    setTimeout(() => {
      if (!node.st && !node.error && !node.synced)
        banner(
          'slowstart',
          'warn',
          'The node has said nothing for a minute: its code may not have loaded from the CDN (cdn.jsdelivr.net). Reload to try again.',
          [['Reload', () => location.reload()]],
        );
    }, 60e3);
  } catch (e) {
    fatal(ST.plainError(e.message));
  }
}
async function welcome(force = false) {
  // persistent storage is asked only after Start (Firefox asks the person, and nothing is agreed yet)
  const est = await navigator.storage?.estimate?.().catch(() => null);
  // what the node needs less what it already has here (files kept from an interrupted start count)
  const NEED = 1.2e9;
  const need = est ? Math.max(0, NEED - (est.usage ?? 0)) : NEED;
  const free = est ? est.quota - est.usage : null;
  const short = free != null && free < need;
  $('wl-space').textContent =
    free == null
      ? 'The browser does not say how much space it allows.'
      : short
        ? `The browser allows ${FM.fmtGB(free)} more for this site, and the node needs about ${FM.fmtGB(need)} more. It will likely stop when the space runs out: free disk space first, or, in a private window, open Bight in an ordinary one instead.`
        : `The browser allows ${FM.fmtGB(free)} more for this site; the node needs about ${FM.fmtGB(need)} more.`;
  $('wl-space').classList.toggle('badt', short);
  // in a frame on another site, the download is not started by a click there: Bight opens in its own tab
  $('wl-start').textContent = foreignFrame ? 'Open Bight in its own tab' : short ? 'Start anyway' : 'Start';
  $('wl-start').onclick = () => {
    if (foreignFrame) return openOwnTab();
    $('welcome').close();
    LS.set('reef:started', String(Date.now()));
    startNode(force);
  };
  $('wl-later').onclick = () => {
    $('welcome').close();
    $('syncmsg').textContent = 'not started: nothing is downloaded until you choose Start';
    banner('welcome', 'info', 'The node is not started. Nothing is downloaded until you start it.', [
      ['Start the node…', () => $('welcome').showModal()],
    ]);
    // the dialog gives the focus back to where it was (the page itself): it goes to the way to start later instead
    setTimeout(() => document.querySelector('#banners [data-b="welcome"] button')?.focus(), 0);
  };
  $('welcome').oncancel = (e) => {
    e.preventDefault();
    $('wl-later').onclick();
  };
  $('welcome').showModal();
}
async function begin() {
  const miss = missingFeatures();
  if (miss.length)
    return fatal(
      `This browser cannot run the node: it lacks ${miss.join(', ')}. Use a recent Chrome, Edge, Brave or Firefox, outside a private window.`,
    );
  try {
    await navigator.storage.getDirectory();
  } catch (e) {
    return fatal(
      top !== self
        ? `This frame cannot keep the node's files (${e?.name || e}): the page around it blocks storage. Open Bight in its own tab.`
        : `This window cannot keep the node's files (${e?.name || e}): a private window cannot run the node. Open Bight in an ordinary window.`,
    );
  }
  return startNode();
}
begin().catch((e) => fatal('Bight could not start: ' + (e?.message || e)));
