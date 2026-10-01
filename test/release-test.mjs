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
const rd = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const src = rd('bight.js'),
  html = rd('index.html');
const v = src.match(/export const VERSION = '([^']+)'/)?.[1];
t('bight.js VERSION matches version.json', v && v === JSON.parse(rd('version.json')).version);
t('index.html loads bight.js?v= the same version', html.includes(`bight.js?v=${v}"`));
const node = src.match(/blaketestnode@([0-9a-f]{40})/)?.[1];
const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
t(
  'there is a security policy, without inline scripts',
  !!csp && !/'unsafe-inline'[^;]*;/.test(csp.match(/script-src[^;]*/)?.[0] ?? '') && !/<script>/.test(html),
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
t(
  'the policy names the node pin and every library the worker imports, in script-src and worker-src',
  !!node &&
    [`bitcoin-blake/blaketestnode@${node}`, ...workerPins].every(
      (p) => (csp.match(/script-src[^;]*/)?.[0] ?? '').includes(p) && (csp.match(/worker-src[^;]*/)?.[0] ?? '').includes(p),
    ),
  workerPins.join(', '),
);
t(
  'the policy names the WebTorrent build the loader imports',
  (tabnode.match(/https:\/\/cdn\.jsdelivr\.net\/npm\/webtorrent@[^'"]+/) ?? [''])[0] !== '' &&
    csp.includes(tabnode.match(/https:\/\/cdn\.jsdelivr\.net\/npm\/webtorrent@[^'"]+/)?.[0]),
);
// ---- the contract: what the page reads from the node
const mpPost = worker.match(/post\(\{ type: 'mempool',[^\n]*/)?.[0] ?? '';
t(
  'the mempool state carries what the page reads',
  [
    'count:',
    'bytes:',
    'fees:',
    'stats:',
    'txs:',
    'txid:',
    'fee:',
    'vsize:',
    'feeRate:',
    'at:',
    'inputs:',
    'outputs:',
    'lastFeedAt',
    'following',
  ].every((f) => mpPost.includes(f)),
);
t('the worker still sends at most the first 1,000 by fee rate (the page says so when it does)', /i < 1000/.test(mpPost));
const blockPost = worker.match(/post\(\{ type: 'block',[^\n]*/)?.[0] ?? '';
t(
  'a block reply carries hash, size, header, nTx, txids and the previous hash',
  ['hash:', 'size:', 'header:', 'nTx:', 'txids', 'previousblockhash'].every((f) => blockPost.includes(f)),
);
const tplPost = worker.match(/post\(\{ type: 'template',[^\n]*/)?.[0] ?? '';
t(
  'a template reply carries height, txs, fees, weight, rdts and its checks',
  ['height:', 'txs:', 'fees:', 'weight:', 'rdts:', 'checks:'].every((f) => tplPost.includes(f)),
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
t(
  'the refusal log line still has the shape the page reads',
  !!refuse &&
    NT.parseRefusal('mempool: refused 0123456789ab… from relay.x: fee too low')?.reason === 'fee too low' &&
    refuse.startsWith('mempool: refused ${r.txid ? r.txid.slice(0, 12)'),
);
t(
  'the seed log lines still have the shapes the page reads',
  /log\(`mempool: \$\{n\} of \$\{\(j\.txs \?\? \[\]\)\.length\} from the mirror's file at height/.test(worker) &&
    /log\(`mempool: seed file: \$\{e\.message\}`\)/.test(worker),
);
t(
  'the loader has followMempool, seedSupported and a wipe that answers',
  /followMempool\(/.test(tabnode) && /seedSupported/.test(tabnode) && /removed, failed/.test(tabnode),
);
done();
