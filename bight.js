// Bight: a mempool monitor in a tab, in the shape everyone knows from mempool.space, over blaketestnode's browser node.
// The node in the tab is the shared loader (browser/tabnode.js, pinned by commit); this file is the page: the projected
// blocks the tab itself would build from its own mempool, the last blocks it validated, the fee bands, the sources,
// a graph over the session, and a search. Every transaction shown was validated here; nothing is relayed onward.
// The decisions (packing, bands, what was seen first, the chain cache, search, the status words, the sources, the
// settings, the markup of tiles and details) are lib/*.mjs, tested; this file wires them to the document, patching in
// place so a focused or selected element survives the next update.
export const VERSION = '2026-10-01.3';
const $ = (id) => document.getElementById(id);
const NODE = 'https://cdn.jsdelivr.net/gh/bitcoin-blake/blaketestnode@c03bf56404e986bf633a44d8a7bbb530ec282cb5';
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

// ---- notices: one line each under the top bar; said to screen readers when a notice is new or grows more serious, not
// on every change of its words (a count of minutes would otherwise be spoken once a minute)
const RANK = { info: 0, warn: 1, bad: 2 };
function banner(id, cls, text, actions = []) {
  let el = document.querySelector(`#banners [data-b="${id}"]`);
  if (el && el.dataset.text === cls + text) return;
  const prev = el?.dataset.cls;
  if (!el) {
    el = document.createElement('div');
    el.dataset.b = id;
    $('banners').appendChild(el);
  }
  el.dataset.text = cls + text;
  el.dataset.cls = cls;
  el.className = 'banner ' + cls;
  el.textContent = '';
  const t = document.createElement('span');
  t.textContent = text;
  el.appendChild(t);
  for (const [label, fn] of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = label;
    b.onclick = fn;
    el.appendChild(b);
  }
  if (prev == null || (RANK[cls] ?? 0) > (RANK[prev] ?? 0)) say(text);
}
const unbanner = (id) => document.querySelector(`#banners [data-b="${id}"]`)?.remove();
const say = (text) => {
  $('announce').textContent = '';
  setTimeout(() => ($('announce').textContent = text), 50);
};
const fatal = (text) => {
  $('syncmsg').textContent = text;
  banner('fatal', 'bad', text, [['Reload', () => location.reload()]]);
};

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
let createTabNode, mib, PARAMS, P, F, SE, SR, SC, FM, NT, ST, SO, VS, CH, SD, SET, V;
try {
  const deadline = new Promise((_, no) => setTimeout(() => no(new Error('no answer in 20 seconds')), 20e3));
  [{ createTabNode, mib }, PARAMS] = await Promise.race([
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

// ---- the sources: stored, or proposed by a link and used only if the person agrees, for this visit
const SRC = SO.resolveSources({ get: LS.get, query: q, accepted: (k) => SS.get('bight:accept:' + k) });
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
              'Use it for this visit',
              () => {
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
  const custom = SO.nonDefault(SRC.use);
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
            const w = SET.sourceWrites({
              fields: { snapshot: SO.DEFAULT_SNAP, blocks: SO.DEFAULT_BLOCKS },
              bight: { snapshot: SO.validUrl(LS.get('bight:snapshot')), blocks: SO.validUrl(LS.get('bight:blocks')) },
              reef: { snapshot: SO.validUrl(LS.get('reef:snapshot')), blocks: SO.validUrl(LS.get('reef:blocks')) },
              defaults: { snapshot: SO.DEFAULT_SNAP, blocks: SO.DEFAULT_BLOCKS },
            });
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
  blocks: new Map(), // height → { height, hash, prev, time, nTx, size, txids, arrivedAt }
  wanted: new Map(), // height → when asked
  arrived: new Map(), // height → when this page learned of it (s)
  seenTx: new Map(),
  refusals: [],
  samples: [],
  template: null,
  selected: null, // height of the mined block shown in the detail
  opener: null, // { kind: 'p' | 'h' | 'q', key } what opened the detail, for the focus on Close
  highlight: null,
  followedAt: null, // when the first mempool state arrived (s)
  following: false,
  running: false,
  idle: false,
  wiped: false,
  dirty: false,
  log: [],
};
const now = () => Math.floor(Date.now() / 1000);
const list = () => P.mempoolList(node.mempool);

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
    ? `${node.coins ? n(node.coins) + ' coins · ' : ''}${node.recv ? mib(node.recv) + ' fetched this session' : "from this browser's storage"}`
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
  const fd = ST.feedState(node.mempool);
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
});

// ---- the chain tip and the last blocks: asked from the worker by height, cached, dropped when a reorganisation replaced them
tn.on('synced', (m) => {
  if (!state.following && !state.wiped) {
    state.following = true;
    tn.followMempool({ relays: RELAYS });
    $('s-relays').textContent = `${RELAYS.length} asked (the node does not report which answer)`;
  }
  CH.onSynced(state.blocks, m);
  CH.markArrived(state.arrived, m, now()); // every height this pass applied reached this tab now
  document.title = `Bight · txbt4 · ${n(m.height)}`;
  pill();
  wantBlocks();
  askTemplate();
});
function wantBlocks() {
  if (state.wiped || !state.running) return;
  for (const h of CH.wantHeights({ height: node.height, blocks: state.blocks, wanted: state.wanted, now: Date.now(), floor: SNAP_BASE }))
    tn.post({ type: 'block', height: h, req: 'bight' });
  scheduleRender();
}
tn.on('block', (m) => {
  if (m.req !== 'bight' || state.wiped) return;
  state.wanted.delete(m.height);
  const kept = CH.acceptBlock(
    state.blocks,
    {
      height: m.height,
      hash: m.hash,
      prev: m.previousblockhash,
      time: m.header?.time ?? null,
      nTx: m.nTx,
      size: m.size,
      txids: m.txids ?? [],
      arrivedAt: state.arrived.get(m.height) ?? null,
    },
    { tipHeight: node.height, tipHash: node.hash },
  );
  if (!kept) return;
  if (state.blocks.size > 40) state.blocks.delete(Math.min(...state.blocks.keys()));
  scheduleRender();
  if (state.selected === m.height && !$('detail').contains(document.activeElement)) showBlock(m.height, { focus: false });
});

// ---- the mempool: the loader keeps node.mempool; the page remembers every txid it accepted
tn.on('mempool', () => {
  state.followedAt ??= now();
  SE.rememberSeen(state.seenTx, list());
  scheduleRender();
  askTemplate();
});
// the worker's own block for the next height: asked at most every 2 s, and within 2 s of a change however busy the mempool
const askTemplate = (() => {
  const go = SD.throttle(() => tn.post({ type: 'template', pay: '6a00' }), 2000);
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
  if (!document.hidden && state.dirty) requestAnimationFrame(renderAll);
});
function renderAll() {
  state.dirty = false;
  if (state.wiped || state.idle) return;
  const blocks = node.mempool ? P.packBlocks(list(), { rdts: state.template?.rdts ?? true }) : [];
  renderProjected(blocks);
  renderMempool(blocks);
  renderMined();
  pill();
}
// patch a row of tiles in place: one <button> per key, its content and name updated, moved only when out of place, so
// the focused one keeps the focus
function patchTiles(container, items) {
  const have = new Map([...container.children].map((el) => [el.dataset.k, el]));
  let at = container.firstChild;
  for (const it of items) {
    let el = have.get(it.key);
    if (!el) {
      el = document.createElement(it.tag ?? 'button');
      if (el.tagName === 'BUTTON') el.type = 'button';
      el.dataset.k = it.key;
    }
    have.delete(it.key);
    if (el.className !== it.cls) el.className = it.cls;
    if (el.dataset.html !== it.html) {
      el.innerHTML = it.html;
      el.dataset.html = it.html;
    }
    if (it.label != null) el.setAttribute('aria-label', it.label);
    if (it.expanded != null) {
      el.setAttribute('aria-expanded', String(it.expanded));
      el.setAttribute('aria-controls', 'detail');
    }
    for (const [k, v] of Object.entries(it.style ?? {})) el.style.setProperty(k, v);
    el.onclick = it.onActivate ?? null;
    if (el !== at) container.insertBefore(el, at);
    else at = at.nextSibling;
    if (el === at) at = at.nextSibling;
  }
  for (const el of have.values()) el.remove();
}
function renderProjected(blocks) {
  const tw = NT.templateWords(state.template, node.height, node.hash);
  const items = [];
  if (!blocks.length) {
    const e = V.emptyNextTile({
      built: !!node.mempool && tw.ok,
      words: ST.emptyWords(node.mempool, { following: state.following }) ?? 'the mempool is empty',
    });
    items.push({ key: 'empty', cls: 'blk empty', html: e.html, label: e.label, tag: 'div' });
  } else {
    const cov = P.coverage(node.mempool);
    if (cov.truncated)
      items.push({
        key: 'more',
        cls: 'blk empty more',
        tag: 'div',
        html: `<span class="h">more</span><span class="s">${esc(n(Math.max(0, cov.totalVb - cov.shownVb)))} vB more in the mempool than this page sees</span>`,
      });
    // in the order they read: the furthest projection first, the next block beside the chain tip
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      const built = i === 0 && tw.ok ? state.template : null;
      const t = V.projTile(b, i, { built, failed: i === 0 && !!tw.failed });
      const c = F.feeColors(b.wmed);
      items.push({
        key: 'p' + i,
        cls: 'blk proj',
        html: t.html,
        label: t.label,
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
      const sw = SE.blockSeen(b, state.seenTx, { followedAt: state.followedAt, prevArrivedAt: state.arrived.get(h - 1) ?? null });
      const unsigned = sh == null || h > sh;
      const t = V.minedTile(b, {
        med: P.weightedMedian(known),
        known: known.length,
        others: sw.others,
        seenWords: sw.words,
        unsigned,
        ageS: Math.max(0, now() - (b.time ?? now())),
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
// the detail panel takes the focus when it opens and gives it back to what opened it when it closes
function openDetail(html, opener, { focus = true } = {}) {
  const d = $('detail');
  d.hidden = false;
  d.innerHTML = html + '<div class="dfoot"><button class="btn" type="button" id="dclose">Close</button></div>';
  state.opener = opener;
  $('dclose').onclick = closeDetail;
  if (focus) d.focus();
  const h = d.querySelector('#dtitle');
  if (h) say(h.textContent);
}
function closeDetail() {
  $('detail').hidden = true;
  const o = state.opener;
  state.selected = null;
  renderMined();
  const back = o?.kind === 'q' ? $('q') : o ? document.querySelector(`[data-k="${o.kind}${o.key}"]`) : null;
  (back ?? $('q')).focus();
}
function showBlock(h, { focus = true, foundTxid = null } = {}) {
  const b = state.blocks.get(h);
  if (!b) return;
  state.selected = h;
  renderMined();
  const sw = SE.blockSeen(b, state.seenTx, { followedAt: state.followedAt, prevArrivedAt: state.arrived.get(h - 1) ?? null });
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
    }),
    foundTxid ? { kind: 'q' } : { kind: 'h', key: h },
    { focus },
  );
}
function showProjected(b, i) {
  state.selected = null;
  renderMined();
  const tw = NT.templateWords(state.template, node.height, node.hash);
  openDetail(
    V.projDetail(b, i, {
      tw: i === 0 && state.template ? tw : null,
      built: tw.ok ? state.template : null,
      asOf: new Date().toLocaleTimeString(),
    }),
    {
      kind: 'p',
      key: i,
    },
  );
}

// ---- the mempool panel, the histogram, the table
function renderMempool(blocks) {
  const m = node.mempool;
  if (!m) return;
  const all = list();
  const cov = P.coverage(m);
  const wmed = P.weightedMedian(all);
  const tw = NT.templateWords(state.template, node.height, node.hash);
  $('m-count').textContent = n(m.count);
  $('m-size').textContent = `${n(m.bytes)} vB`;
  $('m-fees').textContent = `${n(m.fees)} sat`;
  $('m-med').textContent = wmed != null ? `${wmed.toFixed(1)} sat/vB${cov.truncated ? ' (of those shown)' : ''}` : '—';
  $('m-next').textContent = tw.text;
  $('m-next').classList.toggle('badt', !!tw.failed);
  $('m-cover').textContent = cov.truncated
    ? `This page sees the top ${n(cov.shown)} of ${n(cov.total)} transactions by fee rate; the bands, the median, the projected blocks and the table cover those.`
    : '';
  $('s-seen').textContent = n(m.stats.seen);
  $('s-acc').textContent = n(m.stats.accepted);
  $('s-ref').textContent = n(m.stats.refused);
  $('s-drop').textContent = n(m.stats.dropped);
  $('s-feed').textContent = m.feedFileAt
    ? `${fmtAge(Math.max(0, now() - Math.floor(m.feedFileAt / 1000)))} ago`
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
  const have = new Map([...tb.querySelectorAll('tr[data-t]')].map((tr) => [tr.dataset.t, tr]));
  [...tb.querySelectorAll('tr:not([data-t])')].forEach((tr) => tr.remove());
  let at = tb.firstChild;
  for (const t of rows) {
    let tr = have.get(t.txid);
    const i = blockOf.get(t.txid);
    const html = `<td class="mono"><button type="button" class="txbtn" data-open="${esc(t.txid)}">${esc(t.txid.slice(0, 20))}…</button> <a class="ext" href="${esc(txUrl(t.txid))}" target="_blank" rel="noopener" aria-label="transaction ${esc(t.txid.slice(0, 12))} on mempool.guide (another site, not checked by this tab)" title="on mempool.guide: another site, not checked by this tab">↗</a></td><td class="age"></td><td class="amt">${esc(n(t.vsize))}</td><td class="amt">${esc(n(t.fee))}</td><td class="amt">${esc(t.feeRate.toFixed(1))}</td><td>${i == null ? 'later' : i === 0 ? 'next' : `#${i + 1}`}</td>`;
    if (!tr) {
      tr = document.createElement('tr');
      tr.dataset.t = t.txid;
    }
    have.delete(t.txid);
    if (tr.dataset.html !== html) {
      tr.innerHTML = html;
      tr.dataset.html = html;
    }
    tr.classList.toggle('hi', state.highlight === t.txid);
    tr.querySelector('.age').textContent = fmtAge(Math.max(0, t0 - t.at));
    if (tr !== at) tb.insertBefore(tr, at);
    else at = at.nextSibling;
    if (tr === at) at = at.nextSibling;
  }
  for (const tr of have.values()) if (!tr.contains(document.activeElement)) tr.remove();
}
$('rows').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-open]');
  if (b) openTx(b.dataset.open, { kind: 'q' });
});
// one transaction of the mempool, in the page: from the full copy the node sent when it has one, else asked of the node
function openTx(txid, opener) {
  const full = (node.mempool?.txs ?? []).find((x) => x.txid === txid);
  state.highlight = txid;
  scheduleRender();
  if (full) return openDetail(V.mempoolTxDetail(full), opener);
  state.pendingTx = { txid, opener };
  tn.post({ type: 'mempool-get', txid, req: 'bight' });
  openDetail(`<h2 id="dtitle">In this tab's mempool</h2><p class="mut">asking the node for ${esc(txid.slice(0, 20))}…</p>`, opener);
}
function onMempoolTx(m) {
  if (m.req !== 'bight' || state.pendingTx?.txid !== m.txid) return;
  const { opener } = state.pendingTx;
  state.pendingTx = null;
  openDetail(
    m.found
      ? V.mempoolTxDetail(m)
      : `<h2 id="dtitle">Not found</h2><p class="mut">no longer in this tab's mempool: confirmed or dropped</p>`,
    opener,
  );
}
// every 5 s: a sample for the graph, and the ages
setInterval(() => {
  if (state.wiped || state.idle) return;
  if (node.mempool) {
    SR.pushSample(state.samples, { t: Date.now(), count: node.mempool.count, vb: node.mempool.bytes });
    if (!document.hidden) drawGraph();
  }
  wantBlocks();
  scheduleRender();
}, 5000);
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
  const draw = (key, color, dash) => {
    const { runs, top } = SR.polyline(s, key, { W, H, pad });
    g.strokeStyle = color;
    g.lineWidth = 1.5 * devicePixelRatio;
    g.setLineDash(dash.map((x) => x * devicePixelRatio));
    for (const r of runs) {
      g.beginPath();
      r.forEach(([X, Y], i) => (i ? g.lineTo(X, Y) : g.moveTo(X, Y)));
      g.stroke();
    }
    g.setLineDash([]);
    return top;
  };
  const maxVb = draw('vb', cv('--acc', '#f0a04b'), [5, 4]);
  const maxN = draw('count', cv('--blue', '#4a90e2'), []);
  $('gmax').textContent = maxN || maxVb ? `top of the graph: ${n(maxN)} transactions, ${n(maxVb)} vB` : 'empty all the time shown';
  c.setAttribute(
    'aria-label',
    `Mempool over ${SR.spanWords(s)}: now ${n(s.at(-1).count)} transactions and ${n(s.at(-1).vb)} vB; at most ${n(maxN)} and ${n(maxVb)}`,
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
  const r = SC.locate(pq, { list: list(), blocks: [...state.blocks.values()], seen: state.seenTx });
  state.highlight = r.where === 'mempool' ? r.tx.txid : null;
  scheduleRender();
  if (r.where === 'mempool') openTx(r.tx.txid, { kind: 'q' });
  else if (r.where === 'block') showBlock(r.height, { foundTxid: r.txid ?? null });
  else
    openDetail(`<h2 id="dtitle">Not found</h2><p class="mut">${esc(V.notFoundWords(r, { count: node.mempool?.count ?? 0 }))}</p>`, {
      kind: 'q',
    });
};

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
    $('o-snapshot').value.trim() !== SRC.stored.snapshot ? 'saving a different snapshot fetches it again: 830 MB' : '';
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
$('o-reset').onclick = () => fillSettings({ snapshot: SO.DEFAULT_SNAP, blocks: SO.DEFAULT_BLOCKS }, SO.OPT_DEFAULTS);
$('o-wipe').onclick = () => {
  if (!state.running || top !== self) return;
  if ($('o-wipe').dataset.armed) {
    $('o-wipenote').textContent = 'wiping…';
    delete $('o-wipe').dataset.armed;
    Promise.resolve(tn.wipe()).then(
      (r) => {
        state.wiped = true;
        // the files are gone, so is the answer to "may I download 830 MB": the next visit asks again
        LS.del('reef:started');
        LS.del('bight:started');
        $('dlg').close();
        const left = r?.failed?.length ? ` These could not be removed: ${r.failed.join(', ')}.` : '';
        banner(
          'wiped',
          'bad',
          `The node's files are removed; nothing more is shown until you reload, which asks before fetching the snapshot again.${left}`,
          [['Reload', () => location.reload()]],
        );
        pill();
      },
      (e) => {
        $('o-wipenote').textContent = 'not wiped: ' + (e?.message || e);
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
    bight: { snapshot: SO.validUrl(LS.get('bight:snapshot')), blocks: SO.validUrl(LS.get('bight:blocks')) },
    reef: { snapshot: SO.validUrl(LS.get('reef:snapshot')), blocks: SO.validUrl(LS.get('reef:blocks')) },
    defaults: { snapshot: SO.DEFAULT_SNAP, blocks: SO.DEFAULT_BLOCKS },
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
    sources: Object.fromEntries(['snapshot', 'blocks'].map((k) => [k, SO.nonDefault(SRC.use).includes(k) ? 'custom' : 'default'])),
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
    const v = await (await fetch('version.json', { cache: 'no-cache' })).json();
    if (VS.newer(v.version, VERSION))
      banner('update', 'info', `A newer Bight is available (${v.version}). Reload to use it.`, [
        ['Reload', () => reloadWith({ v: v.version })],
      ]);
  } catch {}
}
setTimeout(checkVersion, 10e3);
setInterval(checkVersion, 3600e3);

// ---- start: what the browser needs, the person's go before 830 MB (shared with Reef: one answer for both), one node
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
      [
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
  try {
    const started = await tn.start({ force });
    if (started === false) return node.lockError ? lockFailed(node.lockError) : goIdle();
    state.running = true;
    navigator.storage?.persist?.().catch(() => {}); // asked on every start: a site not asked is the first evicted
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
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const free = est ? est.quota - est.usage : null;
  const short = free != null && free < 1.2e9;
  $('wl-space').textContent =
    free == null
      ? 'The browser does not say how much space it allows.'
      : short
        ? `The browser allows ${mib(free)} more for this site, less than the 1.1 GB needed. Free disk space first; in a private window, open Bight in an ordinary one instead.`
        : `The browser allows ${mib(free)} for this site; 1.1 GB is needed.`;
  $('wl-start').disabled = short;
  $('wl-start').onclick = () => {
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
