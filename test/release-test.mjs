// Release checks: the version agrees in its three places; the security policy names exactly the node this page pins and
// the libraries that node's worker imports; and the node at that pin still says and sends what the page reads (a node
// release that renames a field or rewords a log line fails here, not in front of someone).
//   BLAKETESTNODE=<checkout> node test/release-test.mjs
import { t, done } from './h.mjs';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import * as NT from '../lib/node-text.mjs';
import * as P from '../lib/pack.mjs';
import * as ST from '../lib/status.mjs';
import * as SO from '../lib/sources.mjs';
import * as FM from '../lib/fmt.mjs';
const rd = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const src = rd('bight.js'),
  html = rd('index.html');
const v = src.match(/export const VERSION = '([^']+)'/)?.[1];
t('bight.js VERSION matches version.json', v && v === JSON.parse(rd('version.json')).version);
t('index.html loads bight.js?v= the same version', html.includes(`bight.js?v=${v}"`));
t('index.html loads theme.js?v= the same version', html.includes(`theme.js?v=${v}"`));
const node = src.match(/blaketestnode@([0-9a-f]{40})/)?.[1];
const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
// the policy, directive by directive, read exactly: a name that merely contains another is not that name
const directives = new Map(
  csp
    .split(';')
    .map((d) => d.trim().split(/\s+/))
    .filter((d) => d[0])
    .map(([k, ...v]) => [k, v]),
);
const scriptSrc = directives.get('script-src') ?? [],
  workerSrc = directives.get('worker-src') ?? [];
t(
  'there is a security policy, and its script-src allows no inline code and no eval',
  !!csp && scriptSrc.length > 0 && !scriptSrc.some((x) => /unsafe-|^data:|^\*$|^https:$/.test(x)),
  scriptSrc.join(' '),
);
t(
  'the page has no inline script and no on* handler attribute (both would be refused by the policy)',
  ![...html.matchAll(/<script\b([^>]*)>/gi)].some((m) => !/\bsrc=/.test(m[1])) && !/<[^>]+\son[a-z]+\s*=/i.test(html),
);
const BTN = (process.env.BLAKETESTNODE ?? homedir() + '/remote/github.com/bitcoin-blake/blaketestnode').replace(/^~/, homedir());
const show = (path) =>
  execSync(`git -C ${BTN} show ${node}:${path}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 });
let worker = '',
  template = '',
  mempool = '',
  tabnode = '',
  params = '';
try {
  worker = show('browser/worker.js');
  template = show('lib/template.mjs');
  mempool = show('lib/mempool.mjs');
  tabnode = show('browser/tabnode.js');
  params = show('lib/params.mjs');
} catch {}
t('the node at the pin is readable (BLAKETESTNODE)', !!worker);
const workerPins = [...worker.matchAll(/https:\/\/cdn\.jsdelivr\.net\/gh\/([^'"`]+?@[0-9a-f]{40})/g)].map((m) => m[1]);
const expected = [
  `https://cdn.jsdelivr.net/gh/bitcoin-blake/blaketestnode@${node}/`,
  ...workerPins.map((p) => `https://cdn.jsdelivr.net/gh/${p}/`),
];
const pinsIn = (list) => list.filter((x) => /^https:\/\/cdn\.jsdelivr\.net\/gh\//.test(x)).sort();
t(
  'script-src and worker-src name exactly the node pin and the libraries its worker imports, nothing older or extra',
  !!node &&
    JSON.stringify(pinsIn(scriptSrc)) === JSON.stringify([...new Set(expected)].sort()) &&
    JSON.stringify(pinsIn(workerSrc)) === JSON.stringify([...new Set(expected)].sort()),
  `expected ${expected.join(' ')}; script-src ${pinsIn(scriptSrc).join(' ')}`,
);
t('the worker loads as blob modules, which worker-src allows', workerSrc.includes('blob:'));
t(
  'the policy names the WebTorrent build the loader imports',
  (tabnode.match(/https:\/\/cdn\.jsdelivr\.net\/npm\/webtorrent@[^'"]+/) ?? [''])[0] !== '' &&
    csp.includes(tabnode.match(/https:\/\/cdn\.jsdelivr\.net\/npm\/webtorrent@[^'"]+/)?.[0]),
);
// ---- the contract: what the page reads from the node
const mpPost = worker.match(/post\(\{ type: 'mempool',[^\n]*/)?.[0] ?? '';
t(
  'the mempool state carries what the page reads: every transaction compactly, the first 1,000 whole, the feed’s heartbeat',
  [
    'count:',
    'bytes:',
    'fees:',
    'stats:',
    'all: list.map((e) => [e.txid, e.vsize, e.fee, e.at, e.fed ? 1 : 0])',
    'txs:',
    'txid:',
    'fee:',
    'vsize:',
    'feeRate:',
    'at:',
    'inputs:',
    'outputs:',
    'fed:',
    'lastFeedAt',
    'feedFileAt',
    'following',
  ].every((f) => mpPost.includes(f)),
);
const getPost = worker.match(/post\(\{ type: 'mempool-tx',[^\n]*/)?.[0] ?? '';
t(
  'mempool-get answers mempool-tx with the whole transaction, found or not',
  /m\.type === 'mempool-get'/.test(worker) &&
    ['txid:', 'found:', 'fee:', 'vsize:', 'feeRate:', 'at:', 'via:', 'fed:', 'inputs:', 'outputs:', 'req:'].every((f) =>
      getPost.includes(f),
    ),
);
t('the signed tip says when this tab kept it (kept)', /kept: t\.relay === 'this tab \(kept\)'/.test(worker));
const blockPost = worker.match(/post\(\{ type: 'block',[^\n]*/)?.[0] ?? '';
t(
  'a block reply carries hash, size, header, nTx, txids and the previous hash',
  ['hash:', 'size:', 'header:', 'nTx:', 'txids', 'previousblockhash'].every((f) => blockPost.includes(f)),
);
const tplPost = worker.match(/post\(\{ type: 'template',[^\n]*/)?.[0] ?? '';
t(
  'a template reply carries height, hash, prevHash, txs, fees, weight, rdts, its checks and the mempool count it was built from',
  ['height:', 'hash:', 'prevHash:', 'txs:', 'fees:', 'weight:', 'rdts:', 'checks:', 'mempool: chain.mempool ? { count:'].every((f) =>
    tplPost.includes(f),
  ),
);
t(
  'a template’s txs leaves the coinbase out (as the page counts its packed block)',
  /txids = chosen\.map\(\(e\) => e\.txid\)/.test(template),
);
const syncedPost = worker.match(/post\(\{ type: 'synced',[^\n]*/)?.[0] ?? '';
t(
  'a synced message carries the height, the tip hash, its time and how many blocks the pass applied',
  ['height: chain.node.height', 'hash: chain.node.tipHash()', 'time:', 'applied'].every((f) => syncedPost.includes(f)),
  syncedPost.slice(0, 200),
);
const nostrNext = worker.match(/const next = \{ height: t\.height[^;]*\};/)?.[0] ?? '';
t(
  'the signed tip carries height, hash, agree, diverged, live, kept and vouchedTo, and the loader keeps it as node.nostr',
  ['height:', 'hash:', 'agree', 'diverged', 'live:', 'kept:', 'vouchedTo:'].every((f) => nostrNext.includes(f)) &&
    /m\.type === 'nostr'\) \{ node\.nostr = m; \}/.test(tabnode),
);
t(
  'the loader keeps what the page reads of a synced message (synced, height, hash, time, lastSync)',
  /m\.type === 'synced'\).*node\.synced = true;.*node\.height = m\.height; node\.hash = m\.hash; node\.time = m\.time; node\.lastSync = Date\.now\(\)/.test(
    tabnode,
  ),
);
// every field the page reads of a block reply (blockOf in bight.js, and req) is one the node's reply has
const blockOfSrc = src.match(/const blockOf = \(m\) => \(\{([\s\S]*?)\n\}\);/)?.[1] ?? '';
const reads = [...new Set([...blockOfSrc.matchAll(/\bm\.([a-zA-Z]+)/g)].map((x) => x[1]))];
const sent = new Set([...blockPost.matchAll(/[{,]\s*([a-zA-Z]+)(?=[,:} ])/g)].map((x) => x[1]));
t(
  'every field the page reads of a block reply (blockOf) is one the node at the pin sends, the coinbase’s value among them',
  reads.length >= 8 && reads.includes('coinbaseValue') && reads.every((f) => sent.has(f)),
  `reads ${reads.join(',')}; missing ${reads.filter((f) => !sent.has(f)).join(',')}`,
);
t(
  'a block request is answered by height, with the request’s req echoed (the page’s generation)',
  /Number\(m\.height\)/.test(worker) && blockPost.includes('req: m.req ?? null'),
);
t('checks are { ok, failed }', /return \{ ok: rest\.length === 0, failed: rest/.test(template));
t(
  'the template builder packs skip-and-continue within the weight budget less 4,000, as the page does',
  /if \(weight \+ w > budget\) continue;/.test(template) &&
    /REDUCED_DATA_MAX_BLOCK_WEIGHT = 800000/.test(template) &&
    /- 4000/.test(template) &&
    P.COINBASE_ROOM === 4000 &&
    P.REDUCED_DATA_MAX_BLOCK_WEIGHT === 800000,
);
// the log lines, built the way the node builds them, still read
const refuse = mempool.match(/this\.log\(`(mempool: refused [^`]+)`\)/)?.[1] ?? '';
// the sources the node passes, by its own expressions: a relay event's (subscribeMempool) and the mirror's seed (the worker)
const relayFrom = mempool.match(/mempool\.add\([^,]+, (`[^`]+`), viaOf/)?.[1] ?? '';
const seedFrom = worker.match(/rawAdd\(t\.hex, '([^']+)', 'seed'\)/)?.[1] ?? '';
let fromRelay = null;
try {
  fromRelay = new Function('ev', 'url', 'return ' + relayFrom + ';')({ pubkey: 'f'.repeat(64) }, 'wss://relay.damus.io');
} catch {}
t(
  'the node’s own sources (a publisher via a relay, the mirror) are found at the pin',
  !!fromRelay && / via relay\.damus\.io$/.test(fromRelay) && seedFrom === 'the mirror',
  `${relayFrom} → ${fromRelay}; ${seedFrom}`,
);
for (const [what, from] of [
  ['a relay event', fromRelay],
  ['the mirror’s seed', seedFrom],
  ['no source', ''],
]) {
  let line = null;
  try {
    line = new Function('r', 'from', 'return `' + refuse + '`;')({ txid: 'cd'.repeat(32), error: 'input 0: script failed: x' }, from);
  } catch {}
  const r = line && NT.parseRefusal(line);
  t(
    `a refusal from ${what}, built by the node’s template, reads back whole`,
    !!r && r.from === (from || null) && r.reason === 'input 0: script failed: x' && r.txid === 'cd'.repeat(6),
    line + ' → ' + JSON.stringify(r),
  );
}
// the node's own template, evaluated: a txid, a wss:// source and a reason with ": " in it come back as they went in
let built = null;
try {
  built = new Function('r', 'from', 'return `' + refuse + '`;')(
    { txid: 'ab'.repeat(32), error: 'missing inputs: 1 of 2' },
    'wss://relay.x',
  );
} catch {}
const parsed = built && NT.parseRefusal(built);
t(
  'the refusal log line, built by the node’s own template, still reads: source and reason',
  !!parsed && parsed.from === 'wss://relay.x' && parsed.reason === 'missing inputs: 1 of 2',
  built + ' → ' + JSON.stringify(parsed),
);
t(
  'the seed log lines still have the shapes the page reads',
  /log\(`mempool: \$\{n\} of \$\{\(j\.txs \?\? \[\]\)\.length\} from the mirror's file at height/.test(worker) &&
    /log\(`mempool: seed file: \$\{e\.message\}`\)/.test(worker),
);
t(
  'the loader has followMempool, seedSupported, a wipe that answers and a hash-checked workerSource',
  /followMempool\(/.test(tabnode) && /seedSupported/.test(tabnode) && /removed, failed/.test(tabnode) && /workerSource/.test(tabnode),
);
t(
  'the loader reports unresponsive as a state that clears, and when it retries',
  /node\.unresponsive = true/.test(tabnode) &&
    /node\.unresponsive = false/.test(tabnode) &&
    /emit\('unresponsive'/.test(tabnode) &&
    /node\.retryAt/.test(tabnode),
);
const unresp = tabnode.match(/const UNRESPONSIVE = '([^']+)'/)?.[1] ?? '';
t(
  'the loader’s unresponsive text is one the page words plainly',
  !!unresp && /two minutes/.test(ST.plainError(unresp)) && ST.plainError(unresp) !== unresp,
);
const kept = worker.match(/new Error\(`\$\{stopErr\.message\}([^`]+)`\)/)?.[1] ?? '';
t(
  'a stopped fetch says what arrived is kept, and the page words it as a source that did not answer',
  /what arrived is kept/.test(kept) && /^The node’s source could not be reached/.test(ST.plainError('no answer in 30 s' + kept)),
);
// the snapshot the page names and the one the pinned node expects
const base = Number(params.match(/baseHeight: (\d+)/)?.[1]);
const bytes = Number(params.match(/bytes: (\d+)/)?.[1]);
const file = params.match(/file: '([^']+)'/)?.[1];
const welcome = html.match(/<p id="wl-d"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '';
t(
  'the welcome’s figures before the page fills them are the pinned snapshot’s: its height and its size',
  !!base &&
    welcome.includes(`<span id="wl-base">${base.toLocaleString('en-US')}</span>`) &&
    welcome.includes(`<b id="wl-size">${FM.fmtGB(bytes)}</b>`),
  `${base} ${bytes} · ${welcome.slice(0, 160)}`,
);
t(
  'the built-in default snapshot is the pinned node’s file on the mirror',
  SO.DEFAULT_SNAP === SO.MIRROR + file && SO.defaultsFor({ SNAPSHOT: { file } }).snapshot === SO.DEFAULT_SNAP,
  `${SO.DEFAULT_SNAP} vs ${file}`,
);
done();
