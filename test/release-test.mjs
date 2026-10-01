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
const rd = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const src = rd('bight.js'),
  html = rd('index.html');
const v = src.match(/export const VERSION = '([^']+)'/)?.[1];
t('bight.js VERSION matches version.json', v && v === JSON.parse(rd('version.json')).version);
t('index.html loads bight.js?v= the same version', html.includes(`bight.js?v=${v}"`));
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
  tabnode = '';
try {
  worker = show('browser/worker.js');
  template = show('lib/template.mjs');
  mempool = show('lib/mempool.mjs');
  tabnode = show('browser/tabnode.js');
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
  'a template reply carries height, hash, prevHash, txs, fees, weight, rdts and its checks',
  ['height:', 'hash:', 'prevHash:', 'txs:', 'fees:', 'weight:', 'rdts:', 'checks:'].every((f) => tplPost.includes(f)),
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
done();
