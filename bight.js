// Bight: a mempool monitor in a tab, in the shape everyone knows from mempool.space, over blaketestnode's browser node.
// The node in the tab is the shared loader (browser/tabnode.js, pinned by commit); this file is the page: the projected
// blocks the tab itself would build from its own mempool, the last blocks it validated, the fee bands, the sources,
// a graph over the session, and a search. Every transaction shown was validated here; nothing is relayed onward.
// The decisions (packing, bands, what was seen first, search, the status words, the sources) are lib/*.mjs, tested.
export const VERSION = '2026-10-01.1';
const $ = (id) => document.getElementById(id);
const NODE = 'https://cdn.jsdelivr.net/gh/bitcoin-blake/blaketestnode@cebed0bb2fcf2157e32e8411a5594fb48d878a81';
const RELAYS = [
  'wss://relay.primal.net',
  'wss://nostr.oxtr.dev',
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nostr.mom',
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

// ---- notices: one line each under the top bar; said once to screen readers through #announce
function banner(id, cls, text, actions = []) {
  let el = document.querySelector(`#banners [data-b="${id}"]`);
  if (el && el.dataset.text === cls + text) return;
  if (!el) {
    el = document.createElement('div');
    el.dataset.b = id;
    $('banners').appendChild(el);
  }
  el.dataset.text = cls + text;
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
  $('announce').textContent = text;
}
const unbanner = (id) => document.querySelector(`#banners [data-b="${id}"]`)?.remove();
const fatal = (text) => {
  $('syncmsg').textContent = text;
  banner('fatal', 'bad', text, [['Reload', () => location.reload()]]);
};

// ---- the code: the node's loader from the CDN (with a deadline: a CDN that hangs would leave "Starting…" for ever), then
// this page's own modules, cache-busted with the version so a page never runs another release's modules
let createTabNode, mib, n, P, F, SE, SR, SC, FM, NT, ST, SO, PARAMS;
try {
  const deadline = new Promise((_, no) => setTimeout(() => no(new Error('no answer in 20 seconds')), 20e3));
  [{ createTabNode, mib, n }, PARAMS] = await Promise.race([
    Promise.all([import(`${NODE}/browser/tabnode.js`), import(`${NODE}/lib/params.mjs`)]),
    deadline,
  ]);
  [P, F, SE, SR, SC, FM, NT, ST, SO] = await Promise.all(
    ['pack', 'fees', 'seen', 'series', 'search', 'fmt', 'node-text', 'status', 'sources'].map((m) => import(`./lib/${m}.mjs?v=${VERSION}`)),
  );
} catch (e) {
  fatal(`Bight could not load its code (${e.message}). The CDN (cdn.jsdelivr.net) may be unreachable: check the connection and reload.`);
  throw e;
}
const { esc, fmtAge, txUrl, blockUrl, etaWords } = FM;
// a cached page and a script from different releases: reload once for this pair of versions, and run nothing meanwhile
{
  const asked = document.querySelector('script[src*="bight.js"]')?.src.match(/v=([^&]+)/)?.[1];
  const key = 'bight:mixed:' + decodeURIComponent(asked ?? '') + '>' + VERSION;
  if (asked && decodeURIComponent(asked) !== VERSION && !SS.get(key)) {
    SS.set(key, '1');
    location.replace(location.pathname + '?v=' + encodeURIComponent(VERSION));
    await new Promise(() => {});
  }
}
$('ver').textContent = VERSION;
const SNAP_BASE = PARAMS.SNAPSHOT.baseHeight;

// ---- the sources: stored, or proposed by a link and used only if the person agrees, for this visit
const SRC = SO.resolveSources({ get: LS.get, query: q, accepted: (k) => SS.get('bight:accept:' + k) });
for (const k of Object.keys(SRC.proposed))
  if (SRC.use[k] !== SRC.proposed[k]) {
    const v = SRC.proposed[k];
    const host = (() => {
      try {
        return new URL(v).host;
      } catch {
        return v;
      }
    })();
    banner(
      'src-' + k,
      'warn',
      `This link asks Bight to read the ${k === 'snapshot' ? 'snapshot' : 'blocks'} from ${host}. A source you do not trust can show you a chain that is not the real one. It is ignored unless you choose it, for this visit only.`,
      SO.validUrl(v)
        ? [
            [
              'Use it for this visit',
              () => {
                SS.set('bight:accept:' + k, v);
                location.reload();
              },
            ],
            ['Ignore', () => unbanner('src-' + k)],
          ]
        : [['Ignore', () => unbanner('src-' + k)]],
    );
  }
const OPT = SO.parseOptions(LS.get('bight:options'));

const tn = createTabNode({ base: NODE, snapshotUrl: SRC.use.snapshot, blocksUrl: SRC.use.blocks, torrent: OPT.torrent, seed: OPT.seed });
const node = tn.node;
window.bight = { tn, node, OPT, VERSION };
const state = {
  blocks: new Map(), // height → { height, hash, prev, time, nTx, size, txids, arrivedAt }
  wanted: new Map(), // height → when asked
  tipSeenAt: new Map(), // height → when this page learned of it (s)
  seenTx: new Map(),
  refusals: [],
  samples: [],
  template: null,
  selected: null,
  highlight: null,
  followedAt: null, // when the first mempool state arrived (s)
  followStartedAt: null, // ms, for the silent-feed warning
  running: false,
  idle: false,
  wiped: false,
  dirty: false,
};
const now = () => Math.floor(Date.now() / 1000);

// ---- status bar, pill and the node's state in words
tn.on('sync', ({ msg, pct, eta }) => {
  $('syncmsg').textContent = msg;
  $('synceta').textContent = eta || '';
  if (pct == null) $('pb').hidden = true;
  else {
    $('pb').hidden = false;
    $('pbi').style.width = Math.max(0, Math.min(100, pct)).toFixed(1) + '%';
  }
  pill();
});
function pill() {
  const p = ST.pillState(node, { wiped: state.wiped });
  $('pilldot').className = p.level;
  $('pilltxt').textContent = p.text;
  $('nodeinfo').textContent = node.st
    ? `${node.coins ? n(node.coins) + ' coins · ' : ''}${mib(node.recv)} received${node.sent ? ' · ' + mib(node.sent) + ' sent' : ''}`
    : '';
  // what the node says about the chain and its sources, as notices
  if (node.error && !state.idle) banner('nodeerr', 'bad', ST.plainError(node.error), [['Reload', () => location.reload()]]);
  else unbanner('nodeerr');
  const c = node.synced ? ST.chainState(node) : null;
  if (c && (c.level === 'warn' || c.level === 'bad')) banner('chain', c.level === 'bad' ? 'bad' : 'warn', c.text);
  else unbanner('chain');
  $('chainnote').textContent = c ? c.text : '';
  const fd = ST.feedState(node.mempool, { followedAt: state.followStartedAt });
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
  if (level === 'err') console.warn(text);
});
tn.on('nostr', () => {
  pill();
  scheduleRender();
});
tn.on('error', () => pill());
tn.on('unresponsive', () => pill());

// ---- the chain tip and the last blocks: asked from the worker by height, cached, dropped when a reorganisation replaced them
tn.on('synced', (m) => {
  if (!node.mempoolOn) {
    node.mempoolOn = true;
    state.followStartedAt = Date.now();
    tn.followMempool({ relays: RELAYS });
    $('s-relays').textContent = `${RELAYS.length} followed`;
  }
  // a block replaced, or a rollback: the cached ones at and above the first height this pass applied go
  const from = m.height - (m.applied ?? 0) + 1;
  for (const h of [...state.blocks.keys()]) if (h > m.height || (m.applied && h >= from)) state.blocks.delete(h);
  const tipCached = state.blocks.get(m.height);
  if (tipCached && m.hash && tipCached.hash !== m.hash) state.blocks.clear();
  if (!state.tipSeenAt.has(m.height)) state.tipSeenAt.set(m.height, now());
  document.title = `Bight · txbt4 · ${n(m.height)}`;
  pill();
  wantBlocks();
  askTemplate();
});
function wantBlocks() {
  if (node.height == null) return;
  const t = Date.now();
  for (let h = node.height; h > node.height - 8 && h > SNAP_BASE; h--)
    if (!state.blocks.has(h) && !(t - (state.wanted.get(h) ?? 0) < 30e3)) {
      state.wanted.set(h, t); // asked again after 30 s if no answer came (a reply that failed carries no request id)
      tn.post({ type: 'block', height: h, req: 'bight' });
    }
  scheduleRender();
}
tn.on('block', (m) => {
  if (m.req !== 'bight') return;
  state.wanted.delete(m.height);
  // the block below, cached earlier, is not the one this block builds on: it was replaced
  const below = state.blocks.get(m.height - 1);
  if (below && m.previousblockhash && below.hash !== m.previousblockhash) state.blocks.delete(m.height - 1);
  state.blocks.set(m.height, {
    height: m.height,
    hash: m.hash,
    prev: m.previousblockhash,
    time: m.header.time,
    nTx: m.nTx,
    size: m.size,
    txids: m.txids,
    arrivedAt: state.tipSeenAt.get(m.height) ?? null,
  });
  if (state.blocks.size > 40) state.blocks.delete(Math.min(...state.blocks.keys()));
  scheduleRender();
  if (state.selected === m.height) showBlock(m.height);
});

// ---- the mempool: the loader keeps node.mempool; the page remembers every txid it accepted
tn.on('mempool', (m) => {
  state.followedAt ??= now();
  SE.rememberSeen(state.seenTx, m.txs);
  scheduleRender();
  askTemplate();
});
// the worker's own block for the next height: asked at most every 2 s, and within 2 s of a change however busy the mempool
let tplTimer = null,
  tplLast = 0;
function askTemplate() {
  if (!node.synced || state.wiped || tplTimer) return;
  const wait = Math.max(0, 2000 - (Date.now() - tplLast));
  tplTimer = setTimeout(() => {
    tplTimer = null;
    tplLast = Date.now();
    tn.post({ type: 'template', pay: '6a00' });
  }, wait);
}
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
  if (state.wiped) return;
  const blocks = node.mempool ? P.packBlocks(node.mempool.txs, { rdts: state.template?.rdts ?? true }) : [];
  renderProjected(blocks);
  renderMempool(blocks);
  renderMined();
  pill();
}

const feeColor = (rate) => {
  const h = F.feeHue(rate ?? 1);
  return [`hsl(${h} 70% 55%)`, `hsl(${h} 70% 38%)`];
};
function renderProjected(blocks) {
  const el = $('proj');
  const tw = NT.templateWords(state.template, node.height);
  if (!blocks.length) {
    el.innerHTML = `<div class="blk empty"><div class="h">next block</div><div class="s">${node.mempool ? 'the mempool is empty' : 'the mempool is followed once the tab is up to date'}</div></div>`;
    return;
  }
  const cov = P.coverage(node.mempool);
  el.innerHTML =
    blocks
      .map((b, i) => {
        const [c1, c2] = feeColor(b.wmed);
        // block 0 carries the worker's own figures when its build is current and passes every rule
        const built = i === 0 && tw.ok ? state.template : null;
        return `<div class="blk proj" style="--c1:${c1};--c2:${c2}" data-p="${i}" tabindex="0" role="button" aria-label="${esc(etaWords(i))}: about ${esc(b.wmed?.toFixed(1))} sat per vB"><div><div class="h">${esc(etaWords(i))}</div><div class="r">~${esc(b.wmed?.toFixed(1))} sat/vB</div></div><div><div class="s">${esc(b.min.toFixed(0))} – ${esc(b.max.toFixed(0))} sat/vB</div><div class="s">${built ? `${esc(n(built.txs))} tx · ${esc(n(built.weight))} WU` : `${esc(n(b.vsize))} vB · ${esc(n(b.txs.length))} tx`}</div><div class="s">${built ? `${esc(n(built.fees))} sat · as built` : `${esc(n(b.fees))} sat fees`}${i === 0 && tw.failed ? ' · build fails' : ''}</div></div></div>`;
      })
      .join('') +
    (cov.truncated
      ? `<div class="blk empty more"><div class="h">more</div><div class="s">${esc(n(Math.max(0, cov.totalVb - cov.shownVb)))} vB more in the mempool than this page sees</div></div>`
      : '');
  el.querySelectorAll('.blk.proj').forEach((d) => {
    const go = () => showProjected(blocks[Number(d.dataset.p)], Number(d.dataset.p));
    d.onclick = go;
    d.onkeydown = (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), go());
  });
}
function renderMined() {
  const hs = [...state.blocks.keys()].sort((a, b) => b - a).slice(0, 8);
  const sh = ST.signedHeight(node.nostr);
  $('mined').innerHTML = hs.length
    ? hs
        .map((h) => {
          const b = state.blocks.get(h);
          const known = b.txids.map((t) => state.seenTx.get(t)).filter(Boolean);
          const med = P.median(known.map((f) => f.feeRate));
          const age = Math.max(0, now() - b.time);
          const sw = SE.blockSeen(b, state.seenTx, { followedAt: state.followedAt });
          const unsigned = sh != null && h > sh;
          return `<div class="blk mined${state.selected === h ? ' sel' : ''}${unsigned ? ' unsigned' : ''}" data-h="${h}" tabindex="0" role="button" aria-label="block ${esc(n(h))}${unsigned ? ', not yet signed' : ''}"><div><div class="h">${esc(n(h))}</div><div class="r">${med != null ? '~' + esc(med.toFixed(1)) + ' sat/vB' : ''}</div></div><div><div class="s">${esc(n(b.size))} B · ${esc(n(b.nTx))} tx</div><div class="s">${esc(sw.words)}</div><div class="s">${unsigned ? 'not signed yet' : `${esc(fmtAge(age))} ago`}</div></div></div>`;
        })
        .join('')
    : `<div class="blk empty"><div class="h">last blocks</div><div class="s">appear once the tab is up to date</div></div>`;
  $('mined')
    .querySelectorAll('.blk.mined')
    .forEach((d) => {
      const go = () => showBlock(Number(d.dataset.h));
      d.onclick = go;
      d.onkeydown = (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), go());
    });
}
function showBlock(h) {
  const b = state.blocks.get(h);
  if (!b) return;
  state.selected = h;
  renderMined();
  const sw = SE.blockSeen(b, state.seenTx, { followedAt: state.followedAt });
  const mpIds = new Set((node.mempool?.txs ?? []).map((x) => x.txid));
  const inMp = b.txids.filter((t) => mpIds.has(t)).length;
  const sh = ST.signedHeight(node.nostr);
  $('detail').hidden = false;
  $('detail').innerHTML =
    `<h2>Block ${esc(n(h))}</h2><div class="kv"><span class="l">Hash</span><span class="v" style="text-align:left"><a href="${esc(blockUrl(b.hash))}" target="_blank" rel="noopener">${esc(b.hash)}</a></span><span class="l">Time (the miner's)</span><span class="v">${esc(new Date(b.time * 1000).toLocaleString())}</span><span class="l">Transactions</span><span class="v">${esc(n(b.nTx))} (${esc(n(b.size))} bytes)</span><span class="l">Seen in this tab's mempool first</span><span class="v">${esc(sw.counted ? `${sw.seen} of ${sw.others}` : sw.words)}${inMp ? ` · ${inMp} still listed until the next check` : ''}</span>${sw.knownCount ? `<span class="l">Fees this tab knew</span><span class="v">${esc(n(sw.knownFees))} sat over ${esc(sw.knownCount)} tx</span>` : ''}<span class="l">Validated by</span><span class="v">this tab · ${sh == null ? 'no signed chain tip to check it against' : h > sh ? 'above the signed chain tip: not yet signed' : 'signed chain tip agrees'}</span></div>
  ${sw.knownCount < sw.others ? `<div class="note" style="margin-top:8px">Fees are shown for the transactions this tab had in its mempool before the block; a UTXO node keeps no history for the rest.</div>` : ''}<table style="margin-top:10px"><thead><tr><th scope="col">Transaction</th><th scope="col" class="amt">vB</th><th scope="col" class="amt">Fee</th><th scope="col" class="amt">sat/vB</th><th scope="col">Seen</th></tr></thead><tbody>${b.txids
    .map((t, i) => {
      const f = state.seenTx.get(t);
      return `<tr><td class="mono" title="${esc(t)}"><a href="${esc(txUrl(t))}" target="_blank" rel="noopener" style="color:inherit">${esc(t.slice(0, 20))}…</a>${i === 0 ? ' <span class="mut">coinbase</span>' : ''}</td><td class="amt">${f ? esc(n(f.vsize)) : '—'}</td><td class="amt">${f ? esc(n(f.fee)) : '—'}</td><td class="amt">${f ? esc(f.feeRate.toFixed(1)) : '—'}</td><td>${f ? esc(fmtAge(Math.max(0, (b.arrivedAt ?? b.time) - f.at))) + ' before the block' : i === 0 ? '' : 'never'}</td></tr>`;
    })
    .join('')}</tbody></table><div style="margin-top:8px"><button class="btn" id="dclose">Close</button></div>`;
  $('dclose').onclick = () => {
    $('detail').hidden = true;
    state.selected = null;
    renderMined();
  };
}
function showProjected(b, i) {
  state.selected = null;
  renderMined();
  const tw = NT.templateWords(state.template, node.height);
  $('detail').hidden = false;
  $('detail').innerHTML =
    `<h2>${i === 0 ? 'The next block, as this tab would build it' : `Projected block ${i + 1}`} <span class="mut" style="text-transform:none;letter-spacing:0">as of ${esc(new Date().toLocaleTimeString())}</span></h2><div class="kv"><span class="l">Transactions</span><span class="v">${esc(n(b.txs.length))} · ${esc(n(b.vsize))} vB</span><span class="l">Fees</span><span class="v">${esc(n(b.fees))} sat</span><span class="l">Fee rates</span><span class="v">${esc(b.min.toFixed(1))} – ${esc(b.max.toFixed(1))} sat/vB, median ${esc(b.wmed.toFixed(1))} (by size)</span>${i === 0 && state.template ? `<span class="l">The worker's own build</span><span class="v">${esc(tw.text)}${tw.stale ? '' : ` at height ${esc(n(state.template.height))}`}</span>` : ''}</div><div class="note" style="margin-top:8px">Packed by fee rate from the transactions this page sees, the way the node builds its block: what does not fit is skipped and the next tried. The first is also built in full by the node worker (coinbase, witness commitment, header) and checked against every block rule it knows; its figures are shown when that build passes.</div><table style="margin-top:10px"><thead><tr><th scope="col">Transaction</th><th scope="col" class="amt">vB</th><th scope="col" class="amt">Fee</th><th scope="col" class="amt">sat/vB</th></tr></thead><tbody>${b.txs
      .slice(0, 200)
      .map(
        (t) =>
          `<tr><td class="mono" title="${esc(t.txid)}">${esc(t.txid.slice(0, 20))}…</td><td class="amt">${esc(n(t.vsize))}</td><td class="amt">${esc(n(t.fee))}</td><td class="amt">${esc(t.feeRate.toFixed(1))}</td></tr>`,
      )
      .join('')}</tbody></table><div style="margin-top:8px"><button class="btn" id="dclose">Close</button></div>`;
  $('dclose').onclick = () => {
    $('detail').hidden = true;
  };
}

// ---- the mempool panel, the histogram, the table
function renderMempool(blocks) {
  const m = node.mempool;
  if (!m) return;
  const cov = P.coverage(m);
  const wmed = P.weightedMedian(m.txs);
  const tw = NT.templateWords(state.template, node.height);
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
  $('s-feed').textContent = m.lastFeedAt
    ? `${fmtAge(Math.max(0, now() - Math.floor(m.lastFeedAt / 1000)))} ago`
    : m.following
      ? 'not yet'
      : '…';
  const counts = F.histogram(m.txs);
  const max = Math.max(1, ...counts);
  $('hist').innerHTML = F.BANDS.map(
    (b, i) =>
      `<div style="height:${((counts[i] / max) * 100).toFixed(1)}%" title="${esc(F.bandLabel(i))} sat/vB: ${esc(n(counts[i]))} vB"><span>${i % 2 ? '' : i === 0 ? '<1' : b}</span></div>`,
  ).join('');
  const blockOf = P.blockIndex(blocks);
  const t0 = now();
  $('rows').innerHTML = m.txs.length
    ? [...m.txs]
        .sort((a, b) => b.at - a.at)
        .slice(0, 300)
        .map((t) => {
          const i = blockOf.get(t.txid);
          return `<tr data-t="${esc(t.txid)}"${state.highlight === t.txid ? ' class="hi"' : ''}><td class="mono" title="${esc(t.txid)}"><a href="${esc(txUrl(t.txid))}" target="_blank" rel="noopener" style="color:inherit">${esc(t.txid.slice(0, 24))}…</a></td><td>${esc(fmtAge(Math.max(0, t0 - t.at)))}</td><td class="amt">${esc(n(t.vsize))}</td><td class="amt">${esc(n(t.fee))}</td><td class="amt">${esc(t.feeRate.toFixed(1))}</td><td>${i == null ? 'later' : i === 0 ? 'next' : `#${i + 1}`}</td></tr>`;
        })
        .join('')
    : '<tr><td colspan="6" class="mut">empty</td></tr>';
}
// every 5 s: a sample for the graph, and the ages
setInterval(() => {
  if (node.mempool && !state.wiped) {
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
  if (s.length < 2) return;
  const cs = getComputedStyle(document.documentElement);
  const cv = (k, d) => cs.getPropertyValue(k).trim() || d;
  const pad = 6 * devicePixelRatio;
  g.strokeStyle = cv('--grid', '#2a2f47');
  g.lineWidth = devicePixelRatio;
  for (let i = 1; i < 4; i++) {
    g.beginPath();
    g.moveTo(pad, (H * i) / 4);
    g.lineTo(W - pad, (H * i) / 4);
    g.stroke();
  }
  const draw = (key, color) => {
    const { runs, max } = SR.polyline(s, key, { W, H, pad });
    g.strokeStyle = color;
    g.lineWidth = 1.5 * devicePixelRatio;
    for (const r of runs) {
      g.beginPath();
      r.forEach(([X, Y], i) => (i ? g.lineTo(X, Y) : g.moveTo(X, Y)));
      g.stroke();
    }
    return max;
  };
  const maxVb = draw('vb', cv('--acc', '#f0a04b'));
  const maxN = draw('count', cv('--blue', '#4a90e2'));
  $('gmax').textContent = `top of the graph: ${n(maxN)} transactions, ${n(maxVb)} vB`;
  c.setAttribute(
    'aria-label',
    `Mempool over ${SR.spanWords(s)}: now ${n(s.at(-1).count)} transactions and ${n(s.at(-1).vb)} vB; at most ${n(maxN)} and ${n(maxVb)}`,
  );
}

// ---- search: the mempool this page sees, then the blocks it has looked at, then what it has seen
$('search').onsubmit = (e) => {
  e.preventDefault();
  const pq = SC.parseQuery($('q').value);
  $('detail').hidden = false;
  if (pq.error) {
    state.highlight = null;
    $('detail').innerHTML = `<h2>Search</h2><div class="mut">${esc(pq.error)}</div>`;
    return;
  }
  const t = pq.txid;
  const r = SC.locate(t, { mempool: node.mempool, blocks: [...state.blocks.values()], seen: state.seenTx });
  state.highlight = r.where === 'mempool' ? t : null;
  scheduleRender();
  if (r.where === 'mempool') {
    const mp = r.tx;
    $('detail').innerHTML =
      `<h2>In this tab's mempool</h2><div class="kv"><span class="l">Transaction</span><span class="v" style="text-align:left"><a href="${esc(txUrl(t))}" target="_blank" rel="noopener">${esc(t)}</a></span><span class="l">Size</span><span class="v">${esc(n(mp.vsize))} vB</span><span class="l">Fee</span><span class="v">${esc(n(mp.fee))} sat · ${esc(mp.feeRate.toFixed(1))} sat/vB</span><span class="l">Heard</span><span class="v">${esc(new Date(mp.at * 1000).toLocaleTimeString())}</span><span class="l">Inputs</span><span class="v" style="text-align:left">${mp.inputs.map((k) => esc(k.slice(0, 16)) + '…:' + esc(k.split(':')[1])).join(', ')}</span><span class="l">Outputs</span><span class="v" style="text-align:left">${mp.outputs.map((o) => `${esc(n(o.value))} sat → ${esc(o.scriptPubKey.slice(0, 20))}…`).join('<br>')}</span></div>`;
  } else if (r.where === 'block') showBlock(r.height);
  else
    $('detail').innerHTML = `<h2>Not found</h2><div class="mut">${esc(
      r.where === 'seen'
        ? `this tab had it in its mempool at ${new Date(r.seen.at * 1000).toLocaleTimeString()} (${n(r.seen.vsize)} vB, ${r.seen.feeRate.toFixed(1)} sat/vB); it has since been confirmed or dropped`
        : r.partial
          ? `not among the ${n(node.mempool.txs.length)} transactions this page sees (the tab's mempool has ${n(node.mempool.count)}), and not in the last blocks it looked at`
          : "not in this tab's mempool, and not in the last blocks it looked at; a tab keeps no history beyond that",
    )}</div>`;
};

// ---- theme
$('theme').onclick = () => {
  const el = document.documentElement;
  el.dataset.theme = el.dataset.theme === 'light' ? 'dark' : 'light';
  LS.set('bight:theme', el.dataset.theme);
  drawGraph();
};

// ---- settings: filled from what is stored (never from a link); only what the person changed is written
const fillSettings = (src = SRC.stored, opt = OPT) => {
  $('o-snapshot').value = src.snapshot;
  $('o-blocks').value = src.blocks;
  $('o-torrent').checked = !!opt.torrent;
  $('o-seed').checked = !!opt.seed;
  $('o-err').textContent = '';
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
        $('dlg').close();
        const left = r?.failed?.length ? ` These could not be removed: ${r.failed.join(', ')}.` : '';
        banner(
          'wiped',
          'bad',
          `The node's files are removed; nothing more is shown until you reload, which fetches the snapshot again.${left}`,
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
  }
};
$('o-ok').onclick = () => {
  const s = $('o-snapshot').value.trim(),
    b = $('o-blocks').value.trim();
  if ((s && !SO.validUrl(s)) || (b && !SO.validUrl(b))) {
    $('o-err').textContent = 'Only https:// addresses can be used for the snapshot and the blocks.';
    return;
  }
  OPT.torrent = $('o-torrent').checked;
  OPT.seed = $('o-seed').checked && !$('o-seed').disabled;
  LS.set('bight:options', JSON.stringify(OPT));
  tn.setTorrent(OPT.torrent);
  tn.setSeed(OPT.seed);
  // only a field the person changed is written; the defaults are not stored
  let reload = false;
  for (const [k, v, def] of [
    ['snapshot', s, SO.DEFAULT_SNAP],
    ['blocks', b, SO.DEFAULT_BLOCKS],
  ])
    if (v && v !== SRC.stored[k]) {
      v === def ? LS.del('bight:' + k) : LS.set('bight:' + k, v);
      reload = true;
    }
  $('dlg').close();
  if (reload) location.replace(location.pathname);
};
$('o-diag').onclick = async () => {
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const d = {
    bight: VERSION,
    node: NODE.slice(-40),
    ua: navigator.userAgent,
    embedded,
    phase: node.phase,
    synced: !!node.synced,
    height: node.height,
    error: node.error ?? null,
    lastError: node.lastError ?? null,
    hist: node.hist,
    nostr: node.nostr
      ? { height: node.nostr.height, agree: node.nostr.agree, diverged: !!node.nostr.diverged, live: !!node.nostr.live }
      : null,
    mempool: node.mempool
      ? {
          count: node.mempool.count,
          shown: node.mempool.txs.length,
          following: node.mempool.following,
          lastFeedAt: node.mempool.lastFeedAt,
          stats: node.mempool.stats,
        }
      : null,
    sources: {
      snapshot: SRC.use.snapshot === SO.DEFAULT_SNAP ? 'default' : 'custom',
      blocks: SRC.use.blocks === SO.DEFAULT_BLOCKS ? 'default' : 'custom',
    },
    storage: est ? { usage: est.usage, quota: est.quota } : null,
    running: state.running,
    idle: state.idle,
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
const versionKey = (v) => (/^(\d{4})-(\d{2})-(\d{2})\.(\d+)$/.exec(String(v ?? '')) ?? []).slice(1).map(Number);
const newer = (a, b) => {
  const x = versionKey(a),
    y = versionKey(b);
  if (x.length !== 4 || y.length !== 4) return false;
  const i = x.findIndex((v, j) => v !== y[j]);
  return i >= 0 && x[i] > y[i];
};
async function checkVersion() {
  try {
    const v = await (await fetch('version.json', { cache: 'no-cache' })).json();
    if (newer(v.version, VERSION))
      banner('update', 'info', `A newer Bight is available (${v.version}). Reload to use it.`, [
        ['Reload', () => location.replace(location.pathname + '?v=' + encodeURIComponent(v.version))],
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
  );
  pill();
  // the lock is held by the other tab: when it is granted here, the other tab has closed, so this one takes over
  navigator.locks
    ?.request('bitcoin-blake:node', () => {})
    .then(() => setTimeout(() => location.reload(), 1500))
    .catch(() => {});
}
function lockFailed(err) {
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
  try {
    const started = await tn.start({ force });
    if (started === false) return node.lockError ? lockFailed(node.lockError) : goIdle();
    state.running = true;
    LS.set('reef:started', String(Date.now()));
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
tn.on('message', () => unbanner('slowstart'));
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
      `This window cannot keep the node's files (${e?.name || e}): a private window cannot run the node. Open Bight in an ordinary window.`,
    );
  }
  if (!navigator.locks) return lockFailed('this browser has no Web Locks');
  if (LS.get('reef:started') || LS.get('bight:started')) return startNode();
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const free = est ? est.quota - est.usage : null;
  $('wl-space').textContent =
    free == null
      ? 'The browser does not say how much space it allows.'
      : free < 1.2e9
        ? `The browser allows ${mib(free)} more for this site, less than the 1.1 GB needed: free disk space first.`
        : `The browser allows ${mib(free)} for this site; 1.1 GB is needed.`;
  $('wl-start').onclick = () => {
    $('welcome').close();
    startNode();
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
begin().catch((e) => fatal('Bight could not start: ' + (e?.message || e)));
