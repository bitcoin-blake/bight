// The page's decisions: packing, medians, bands and their colours, what was seen first, search, the graph, words, the
// status, the sources, the chain cache, the throttle, the settings, versions, and the markup of tiles and details.
import { t, done } from './h.mjs';
import * as P from '../lib/pack.mjs';
import * as F from '../lib/fees.mjs';
import * as SE from '../lib/seen.mjs';
import * as SC from '../lib/search.mjs';
import * as SR from '../lib/series.mjs';
import * as FM from '../lib/fmt.mjs';
import * as NT from '../lib/node-text.mjs';
import * as ST from '../lib/status.mjs';
import * as SO from '../lib/sources.mjs';
import * as VS from '../lib/version.mjs';
import * as CH from '../lib/chain.mjs';
import * as SD from '../lib/schedule.mjs';
import * as SET from '../lib/settings.mjs';
import * as V from '../lib/view.mjs';
const id = (c) => c.repeat(64).slice(0, 64);
const tx = (c, vsize, feeRate, o = {}) => ({ txid: id(c), vsize, fee: Math.round(vsize * feeRate), feeRate, at: 1000, ...o });

// ---- packing, the way the node's template builder packs
{
  const big = tx('a', 150000, 50),
    mid = tx('b', 60000, 40),
    small = tx('c', 1000, 1);
  const b = P.packBlocks([big, mid, small]);
  t(
    'a transaction that does not fit is skipped and the next tried (the worker builds a + c, not a then b + c)',
    b[0].txs.map((x) => x.txid[0]).join('') === 'ac' && b[1].txs.map((x) => x.txid[0]).join('') === 'b',
    JSON.stringify(b.map((x) => x.txs.map((y) => y.txid[0]))),
  );
  t(
    'blocks are filled within 800,000 weight less room for the coinbase',
    b.every((x) => x.weight <= 796000),
  );
  t('a set of exactly 796,000 weight fits one block', P.packBlocks([tx('e', 199000, 2)]).length === 1);
  t('...and 796,004 does not', P.packBlocks([tx('e', 199001, 2)]).length === 0);
  t('without the reduced-data limit a block holds 4,000,000 weight', P.packBlocks([big, mid, small], { rdts: false }).length === 1);
  t(
    'at most maxBlocks blocks',
    P.packBlocks(
      Array.from({ length: 50 }, (_, i) => tx(String.fromCharCode(97 + (i % 26)) + i, 100000, 1 + i)),
      { maxBlocks: 3 },
    ).length === 3,
  );
  t('an empty mempool packs nothing', P.packBlocks([]).length === 0);
  t('a transaction heavier than a whole block stops the packing rather than loop', P.packBlocks([tx('h', 300000, 9)]).length === 0);
  const tie = P.packBlocks([tx('z', 100, 2), tx('a', 100, 2), tx('m', 100, 2)]);
  t('equal rates keep the node’s order (not the txid’s)', tie[0].txs.map((x) => x.txid[0]).join('') === 'zam');
  const fig = P.packBlocks([tx('a', 100, 10), tx('b', 300, 2)])[0];
  t(
    'a block’s figures: size, fees, lowest, highest, median by size',
    fig.vsize === 400 && fig.fees === 1600 && fig.min === 2 && fig.max === 10 && fig.wmed === 2,
    JSON.stringify(fig),
  );
  t(
    'the median of an even count is the mean of the two middles, of an odd count the middle, numerically',
    P.median([1, 2, 3, 4]) === 2.5 &&
      P.median([3, 1, 2]) === 2 &&
      P.median([]) === null &&
      P.median([10, 9, 100]) === 10 &&
      P.median([NaN, 5]) === 5,
  );
  t(
    'the size-weighted median is the rate at which half the space is reached',
    P.weightedMedian([tx('x', 100, 1), tx('y', 300, 10)]) === 10 &&
      P.weightedMedian([tx('x', 300, 1), tx('y', 100, 10)]) === 1 &&
      P.weightedMedian([tx('x', 100, 1), tx('y', 100, 10)]) === 1 &&
      P.weightedMedian([]) === null,
  );
  const all = {
    count: 3,
    bytes: 330,
    all: [
      [id('a'), 110, 220, 5, 1],
      [id('b'), 110, 110, 6, 0],
      [id('c'), 110, 330, 7, 0],
    ],
  };
  const l = P.mempoolList(all);
  t(
    'the node’s compact list is read: every transaction, its rate, when, and whether a node fed it',
    l.length === 3 && l[0].feeRate === 2 && l[0].fed === true && l[1].fed === false && l[2].at === 7,
  );
  t('with the compact list the page sees everything: not truncated', !P.coverage(all).truncated && P.coverage(all).shown === 3);
  const cov = P.coverage({ count: 3000, bytes: 330000, txs: Array.from({ length: 1000 }, (_, i) => tx('t' + i, 110, 2)) });
  t(
    'from an older node sending only 1,000, that is known',
    cov.truncated && cov.shown === 1000 && cov.total === 3000 && cov.totalVb - cov.shownVb === 220000,
  );
  t(
    'no mempool: nothing shown, not truncated',
    P.coverage(null).shown === 0 && !P.coverage(null).truncated && P.mempoolList(null).length === 0,
  );
  t(
    'the block index maps each transaction to its projected block',
    P.blockIndex(b).get(id('b')) === 1 && P.blockIndex(b).get(id('c')) === 0,
  );
}
// ---- bands and colours
t(
  'a rate under 1 goes to its own band, not to 1–2; a rate that is not a number to the first',
  F.bandOf(0.5) === 0 &&
    F.bandLabel(0) === '< 1' &&
    F.bandOf(1) === 1 &&
    F.bandOf(1.99) === 1 &&
    F.bandOf(2) === 2 &&
    F.bandOf(NaN) === 0 &&
    F.bandOf(-3) === 0,
);
t(
  'the top band holds everything from 1000 up',
  F.bandOf(999) === F.BANDS.length - 2 &&
    F.bandOf(1000) === F.BANDS.length - 1 &&
    F.bandOf(5000) === F.BANDS.length - 1 &&
    F.bandLabel(F.BANDS.length - 1) === '≥ 1000' &&
    F.bandLabel(3) === '3–5',
);
t(
  'the histogram adds up to the vB it was given, each in its band',
  F.histogram([tx('a', 100, 0.5), tx('b', 200, 3), tx('c', 300, 3000)]).reduce((a, x) => a + x, 0) === 600 &&
    F.histogram([tx('b', 200, 3)])[F.bandOf(3)] === 200,
);
t('the hue runs from blue at 1 to orange at 1000', F.feeHue(1) === 210 && F.feeHue(1000) === 30 && F.feeHue(0.1) === 210);
{
  const rates = [0.5, 1, 2, 3, 5, 8, 12, 20, 30, 50, 80, 120, 200, 300, 500, 1000, 5000];
  const worst = Math.min(...rates.flatMap((r) => [F.contrast(F.WHITE, F.feeColors(r).rgb1), F.contrast(F.WHITE, F.feeColors(r).rgb2)]));
  t('white text on every fee band’s colours reads at 4.5:1 or better (both stops)', worst >= 4.5, worst.toFixed(2));
  t(
    'contrast is computed as WCAG does',
    Math.abs(F.contrast([0, 0, 0], F.WHITE) - 21) < 0.01 && Math.abs(F.contrast(F.WHITE, F.WHITE) - 1) < 1e-9,
  );
}
// ---- seen first
{
  const seen = new Map();
  SE.rememberSeen(seen, [tx('a', 10, 1), tx('b', 10, 1)]);
  SE.rememberSeen(seen, [tx('a', 10, 1, { at: 9999, fee: 77 })]);
  t('what was seen first is kept, not overwritten by a later copy', seen.get(id('a')).at === 1000);
  const block = { txids: [id('c'), id('a'), id('z')], nTx: 3, arrivedAt: 2000 };
  t(
    'a block whose whole interval the tab listened for says how much of it was seen first (the coinbase never)',
    SE.blockSeen(block, seen, { followedAt: 1500, prevArrivedAt: 1600 }).words === '1 of 2 seen first',
  );
  t(
    'a block whose previous block came before the tab listened is not counted: "not listening then"',
    SE.blockSeen(block, seen, { followedAt: 1500, prevArrivedAt: 1400 }).words === 'not listening then' &&
      SE.blockSeen(block, seen, { followedAt: 1500, prevArrivedAt: null }).counted === false &&
      SE.blockSeen({ ...block, arrivedAt: 1000 }, seen, { followedAt: 1500, prevArrivedAt: 1600 }).counted === false &&
      SE.blockSeen(block, seen, { followedAt: null, prevArrivedAt: 1600 }).counted === false,
  );
  t(
    'a block with only its coinbase has no transactions',
    SE.blockSeen({ txids: [id('c')], nTx: 1, arrivedAt: 2000 }, seen, { followedAt: 1 }).words === 'no transactions',
  );
  const fees = SE.blockSeen({ txids: [id('c'), id('a'), id('b')], nTx: 9, arrivedAt: 2000 }, seen, { followedAt: 1, prevArrivedAt: 2 });
  t(
    'the fees known add up, and the transaction count is the block’s, not the list’s',
    fees.knownFees === 20 && fees.knownCount === 2 && fees.others === 8,
  );
  const many = new Map();
  SE.rememberSeen(
    many,
    Array.from({ length: 30 }, (_, i) => tx('k' + i, 1, 1)),
    { cap: 20, evict: 5 },
  );
  t('what was seen is capped, the oldest evicted first', many.size === 25 && !many.has(id('k0')) && many.has(id('k29')));
  const at = new Map();
  SE.rememberSeen(
    at,
    Array.from({ length: 20 }, (_, i) => tx('q' + i, 1, 1)),
    { cap: 20, evict: 5 },
  );
  t('...and not before the cap is passed', at.size === 20);
}
// ---- search
{
  const list = [tx('a', 1, 1), tx('a', 1, 1, { txid: 'aaaaaaaa' + 'b'.repeat(56) })];
  t(
    'a query reads as a txid, a height, the start of a txid, or says what it can be',
    SC.parseQuery(' ' + id('A') + ' ').id === id('a') &&
      SC.parseQuery('152103').height === 152103 &&
      SC.parseQuery('deadbeef').prefix === 'deadbeef' &&
      !!SC.parseQuery('abc').error &&
      !!SC.parseQuery('javascript:x').error,
  );
  const blocks = [
    { height: 5, hash: id('h'), txids: [id('c'), id('b')] },
    { height: 6, hash: id('i'), txids: [id('d')] },
  ];
  t(
    'found in the mempool, then in a block (by txid, by hash, by height), then in what was seen',
    SC.locate({ id: id('a') }, { list }).where === 'mempool' &&
      SC.locate({ id: id('b') }, { list, blocks }).height === 5 &&
      SC.locate({ id: id('b') }, { list, blocks }).txid === id('b') &&
      SC.locate({ id: id('h') }, { list, blocks }).height === 5 &&
      SC.locate({ height: 6 }, { blocks }).height === 6 &&
      SC.locate({ id: id('s') }, { list, seen: new Map([[id('s'), { at: 1 }]]) }).where === 'seen',
  );
  t('a prefix that two transactions share asks for more', SC.locate({ prefix: 'aaaaaaaa' }, { list }).where === 'many');
  const none = SC.locate({ id: id('q') }, { list, blocks });
  t(
    'not found says which blocks were searched',
    none.where === 'none' && none.searched.from === 5 && none.searched.to === 6 && none.searched.count === 2,
  );
  t('a height this tab does not hold is not found', SC.locate({ height: 1 }, { blocks }).where === 'none');
  t('no mempool yet: searching still works', SC.locate({ id: id('a') }, {}).where === 'none');
}
// ---- the graph
{
  const s = [];
  for (let i = 0; i < 5; i++) SR.pushSample(s, { t: i * 5000, count: i, vb: i * 10 }, 3);
  t('samples are capped, the oldest dropped', s.length === 3 && s[0].count === 2);
  const g = SR.polyline(
    [
      { t: 0, count: 0 },
      { t: 5000, count: 2 },
      { t: 60000, count: 4 },
      { t: 65000, count: 2 },
    ],
    'count',
    { W: 100, H: 50, pad: 5, gapMs: 20000 },
  );
  t('a gap in the samples breaks the line instead of drawing straight across it', g.runs.length === 2 && g.top === 4);
  t(
    'the first point is at the left edge and the floor; the highest at the top; the last at the right',
    g.runs[0][0][0] === 5 && g.runs[0][0][1] === 45 && g.runs[1][0][1] === 5 && g.runs[1][1][0] === 95,
    JSON.stringify(g.runs),
  );
  const flat = SR.polyline(
    [
      { t: 0, count: 0 },
      { t: 5000, count: 0 },
    ],
    'count',
    { W: 100, H: 50 },
  );
  t('an empty mempool all along: the true top is 0, drawn on the floor', flat.top === 0 && flat.scale === 1 && flat.runs[0][0][1] === 50);
  t('one sample draws nothing', SR.polyline([{ t: 0, count: 3 }], 'count', { W: 1, H: 1 }).runs.length === 0);
  t(
    'the span is said in minutes, then hours',
    SR.spanWords([{ t: 0 }, { t: 30 * 60000 }]) === 'the last 30 minutes' &&
      SR.spanWords([{ t: 0 }, { t: 3 * 3600000 }]) === 'the last 3.0 hours' &&
      SR.spanWords([{ t: 0 }]) === 'this session',
  );
}
// ---- words
t('markup is escaped', FM.esc('<a href="x">\'&') === '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
t(
  'ages at their boundaries: 59 s, 1 min, 59 min, 1.0 h',
  FM.fmtAge(59) === '59 s' &&
    FM.fmtAge(60) === '1 min' &&
    FM.fmtAge(3540) === '59 min' &&
    FM.fmtAge(3599) === '1.0 h' &&
    FM.fmtAge(3600) === '1.0 h',
);
t(
  'links only for a real txid or hash: anchored, lower-case',
  FM.txUrl(id('a')).endsWith('/tx/' + id('a')) &&
    FM.txUrl('javascript:alert(1)//' + id('a')) === '#' &&
    FM.txUrl(id('A')) === '#' &&
    FM.blockUrl('x') === '#',
);
t('the next blocks are said by when', FM.etaWords(0) === 'next block' && FM.etaWords(2) === 'in ~60 min');
t(
  'a refusal line is read, with or without a txid and a source, the reason whole',
  NT.parseRefusal('mempool: refused 0123abcd… from wss://relay.x: fee: too low').reason === 'fee: too low' &&
    NT.parseRefusal('mempool: refused 0123abcd… from wss://relay.x: fee: too low').from === 'wss://relay.x' &&
    NT.parseRefusal('mempool: refused a transaction: bad').txid === null &&
    NT.parseRefusal('xx mempool: refused a transaction: bad') === null &&
    NT.parseRefusal('other') === null,
);
{
  const s = NT.parseSeedLine("mempool: 12 of 15 from the mirror's file at height 152100");
  t(
    'the seed line: accepted of total at a height, or the reason it failed',
    s.accepted === 12 &&
      s.total === 15 &&
      s.height === 152100 &&
      NT.parseSeedLine('mempool: seed file: 404').ok === false &&
      NT.parseSeedLine('x') === null,
  );
}
{
  const m = { height: 101, prevHash: id('p'), txs: 3, fees: 900, weight: 4000, checks: { ok: true, failed: [] } };
  t(
    'a current template that passes is built',
    NT.templateWords(m, 100, id('p')).ok && /✓ built: 3 tx · 900 sat · 1,000 vB/.test(NT.templateWords(m, 100, id('p')).text),
  );
  t(
    'a failing template says which rules fail',
    NT.templateWords({ ...m, checks: { ok: false, failed: ['btc:rule-x'] } }, 100).text === "the worker's build fails: btc:rule-x",
  );
  t(
    'a failing template with no rule named still fails',
    NT.templateWords({ ...m, checks: { ok: false } }, 100).text === "the worker's build fails: a rule",
  );
  t('checks without ok are not a pass', !NT.templateWords({ ...m, checks: {} }, 100).ok);
  t('a template built on an old height is stale, never built', NT.templateWords(m, 101).stale && !NT.templateWords(m, 101).ok);
  t('...or on another parent at the same height', NT.templateWords(m, 100, id('q')).stale);
  t('...or ahead of the node', NT.templateWords(m, 99).stale);
  t('with the node’s height not known, a template is taken as current', NT.templateWords(m, null).ok);
  t('no template yet is "…"', NT.templateWords(null, 100).text === '…' && !NT.templateWords(null, 100).ok);
}
// ---- status
{
  const NOW = 1_800_000_000_000;
  const base = {
    synced: true,
    height: 100,
    time: NOW / 1000 - 60,
    lastSync: NOW - 5000,
    nostr: { height: 100, agree: 3, diverged: false },
  };
  t(
    'idle, error, syncing and up to date are told apart',
    ST.pillState({ phase: 'busy' }).level === 'idle' &&
      ST.pillState({ error: 'x' }).level === 'bad' &&
      ST.pillState({ phase: 'fetch' }).text === 'fetching the snapshot' &&
      ST.pillState({ phase: 'hash' }).text === 'checking the snapshot' &&
      ST.pillState({ phase: 'verify' }).text === 'verifying the snapshot' &&
      ST.pillState({ phase: 'sync', height: 5 }).text === 'syncing · 5' &&
      ST.pillState({}).text === 'starting' &&
      ST.pillState(base, { now: NOW }).text === 'up to date · 100 · signed' &&
      ST.pillState(base, { now: NOW }).level === 'ok',
  );
  t('a refused lock is a lock refused, not "idle"', ST.pillState({ phase: 'busy', lockError: 'x' }).text === 'lock refused');
  t('wiped says so', ST.pillState(base, { wiped: true }).text === 'wiped · reload');
  t('a node not answering is a warning, not an error', ST.pillState({ unresponsive: true, error: 'x' }).level === 'warn');
  t(
    'a retry waiting is said with its seconds',
    ST.pillState({ phase: 'sync', retryAt: NOW + 4500 }, { now: NOW }).text === 'retrying in 5 s',
  );
  t(
    'up to date with no signed tip, or one not checked, is amber "not signed yet", never green',
    ST.pillState({ ...base, nostr: null }, { now: NOW }).level === 'warn' &&
      /not signed yet/.test(ST.pillState({ ...base, nostr: null }, { now: NOW }).text) &&
      ST.pillState({ ...base, nostr: { height: 100, agree: 0 } }, { now: NOW }).level === 'warn',
  );
  t(
    '"signed" only at the tip: one block above is said as such, amber',
    ST.pillState({ ...base, height: 101 }, { now: NOW }).text === 'up to date · 101 · 1 above the signed tip' &&
      ST.pillState({ ...base, height: 101 }, { now: NOW }).level === 'warn',
  );
  t('a disagreeing signed tip is red', ST.chainState({ ...base, nostr: { ...base.nostr, diverged: true } }, { now: NOW }).level === 'bad');
  t('blocks two or more above the signed tip are a warning', ST.chainState({ ...base, height: 102 }, { now: NOW }).level === 'warn');
  t(
    'three or more behind the signed tip is a warning',
    ST.chainState({ ...base, nostr: { ...base.nostr, height: 103 } }, { now: NOW }).level === 'warn',
  );
  t(
    'a silent source and a stopped chain are warnings, at their thresholds',
    ST.chainState({ ...base, lastSync: NOW - 181e3 }, { now: NOW }).level === 'warn' &&
      ST.chainState({ ...base, lastSync: NOW - 179e3 }, { now: NOW }).level === 'ok' &&
      ST.chainState({ ...base, time: NOW / 1000 - 5401 }, { now: NOW }).level === 'warn' &&
      ST.chainState({ ...base, time: NOW / 1000 - 5399 }, { now: NOW }).level === 'ok',
  );
  t(
    'the signed height only from an agreeing tip',
    ST.signedHeight(base.nostr) === 100 &&
      ST.signedHeight({ height: 5, agree: 0 }) === null &&
      ST.signedHeight({ height: 5, agree: 3, diverged: true }) === null &&
      ST.signedHeight(null) === null,
  );
  t(
    'the publisher is judged by its heartbeat: silent 10 minutes is a warning; not before; not without one; not when not following',
    !!ST.feedState({ following: true, feedFileAt: NOW - 11 * 60e3 }, { now: NOW }) &&
      !ST.feedState({ following: true, feedFileAt: NOW - 9 * 60e3 }, { now: NOW }) &&
      !ST.feedState({ following: true, lastFeedAt: NOW - 60 * 60e3 }, { now: NOW }) &&
      !ST.feedState({ following: false, feedFileAt: NOW - 60 * 60e3 }, { now: NOW }),
  );
  t(
    'an empty page says why: not followed, nothing heard, empty',
    ST.emptyWords(null) === 'the mempool is followed once the tab is up to date' &&
      ST.emptyWords(null, { following: true }) === 'nothing heard yet' &&
      ST.emptyWords({ count: 0, stats: { seen: 0 } }) === 'nothing heard yet' &&
      ST.emptyWords({ count: 0, stats: { seen: 3 } }) === 'the mempool is empty' &&
      ST.emptyWords({ count: 0, stats: { seen: 0 }, feedFileAt: 1 }) === 'the mempool is empty' &&
      ST.emptyWords({ count: 2, stats: { seen: 2 } }) === null,
  );
  t(
    'errors in words',
    /another tab/i.test(ST.plainError('blocks.dat is open in another tab @ x')) &&
      /1.1 GB/.test(ST.plainError('QuotaExceededError')) &&
      /private window/.test(ST.plainError('SecurityError')) &&
      /not the pinned code/.test(ST.plainError("the node's browser/worker.js from x is not the pinned file")) &&
      /context headers/.test(ST.plainError('context headers do not link')) &&
      /another version of the node/.test(ST.plainError('written by a newer node (layout 2)')) &&
      /disagrees/.test(ST.plainError('block file disagrees with the NIP-333 headers')) &&
      /could not be reached/.test(ST.plainError('Failed to fetch')) &&
      /comes back by itself/.test(ST.plainError('the node has not answered for two minutes')) &&
      /Wipe it/.test(ST.plainError('sha256 does not match')) &&
      !/@/.test(ST.plainError('x @ stack')),
  );
}
// ---- sources
{
  const store = {
    'bight:blocks': 'https://mine.example/b',
    'reef:snapshot': 'https://reef.example/s.dat',
    'reef:blocks': 'https://reef.example/b',
  };
  const get = (k) => store[k] ?? null;
  const r = SO.resolveSources({ get, query: new URLSearchParams('blocks=https://evil.example/x&snapshot=') });
  t(
    "stored sources are used, Bight's before Reef's, then the defaults",
    r.stored.blocks === 'https://mine.example/b' &&
      r.stored.snapshot === 'https://reef.example/s.dat' &&
      SO.resolveSources({}).stored.blocks === SO.DEFAULT_BLOCKS,
  );
  t(
    'a source proposed by a link is not used until accepted; an empty one is no proposal',
    r.use.blocks === 'https://mine.example/b' && r.proposed.blocks === 'https://evil.example/x' && !('snapshot' in r.proposed),
  );
  const ok = SO.resolveSources({
    get,
    query: new URLSearchParams('blocks=https://evil.example/x&snapshot=https://evil.example/s'),
    accepted: (k) => (k === 'blocks' ? 'https://evil.example/x' : null),
  });
  t(
    '...and used, for the visit, once the person accepted it (each source on its own)',
    ok.use.blocks === 'https://evil.example/x' && ok.use.snapshot === 'https://reef.example/s.dat',
  );
  t(
    'a proposal that is not https is never used even if accepted (snapshot or blocks)',
    SO.resolveSources({ query: new URLSearchParams('blocks=http://x/y'), accepted: () => 'http://x/y' }).use.blocks === SO.DEFAULT_BLOCKS &&
      SO.resolveSources({ query: new URLSearchParams('snapshot=http://x/y'), accepted: () => 'http://x/y' }).use.snapshot ===
        SO.DEFAULT_SNAP,
  );
  t(
    'a stored value that is not an https address, or holds a quote, is ignored',
    SO.resolveSources({ get: () => 'javascript:alert(1)' }).use.snapshot === SO.DEFAULT_SNAP && SO.validUrl('https://x/"y') === null,
  );
  t(
    'options are coerced: only true is true',
    SO.parseOptions('{"torrent":"false","seed":true}').torrent === false &&
      SO.parseOptions('{"seed":true}').seed === true &&
      SO.parseOptions('{"seed":"true"}').seed === false &&
      SO.parseOptions('not json').torrent === false,
  );
  t(
    'the sources in use that are not the defaults are named, with their host',
    SO.nonDefault({ snapshot: SO.DEFAULT_SNAP, blocks: 'https://evil.example/x' }).join() === 'blocks' &&
      SO.hostOf('https://evil.example/x') === 'evil.example',
  );
}
// ---- settings: what OK writes
{
  const defaults = { snapshot: SO.DEFAULT_SNAP, blocks: SO.DEFAULT_BLOCKS };
  t('nothing changed, nothing written', SET.sourceWrites({ fields: defaults, defaults }).length === 0);
  t(
    'a changed field is written to Bight’s key',
    JSON.stringify(SET.sourceWrites({ fields: { ...defaults, blocks: 'https://x/b' }, defaults })) ===
      JSON.stringify([{ key: 'bight:blocks', set: 'https://x/b' }]),
  );
  t(
    'back to the default deletes Bight’s key…',
    JSON.stringify(SET.sourceWrites({ fields: defaults, bight: { blocks: 'https://x/b' }, defaults })) ===
      JSON.stringify([{ key: 'bight:blocks', del: true }]),
  );
  t(
    '…but stores the default when Reef stored another (or Reef’s would come back)',
    JSON.stringify(SET.sourceWrites({ fields: defaults, reef: { blocks: 'https://r/b' }, defaults })) ===
      JSON.stringify([{ key: 'bight:blocks', set: SO.DEFAULT_BLOCKS }]),
  );
  t(
    'an empty field means the default',
    SET.sourceWrites({ fields: { snapshot: '', blocks: ' ' }, bight: { snapshot: 'https://x/s' }, defaults })[0].del === true,
  );
}
// ---- the chain cache
{
  const mk = (h, hash, prev) => ({ height: h, hash, prev });
  const blocks = new Map([
    [10, mk(10, 'a10', 'a9')],
    [11, mk(11, 'a11', 'a10')],
    [12, mk(12, 'a12', 'a11')],
  ]);
  CH.onSynced(blocks, { height: 12, hash: 'a12', applied: 0 });
  t('a sync that applied nothing new keeps the cache', blocks.size === 3);
  CH.onSynced(blocks, { height: 12, hash: 'b12', applied: 1 });
  t('a sync that replaced the tip drops it', !blocks.has(12));
  const b2 = new Map([
    [10, mk(10, 'a10', 'a9')],
    [11, mk(11, 'a11', 'a10')],
  ]);
  CH.onSynced(b2, { height: 10, hash: 'a10', applied: 0 });
  t('a rollback drops what is above the new tip', !b2.has(11) && b2.has(10));
  const b5 = new Map([[12, mk(12, 'a12', 'a11')]]);
  CH.onSynced(b5, { height: 12, hash: 'c12', applied: 0 });
  t('a tip with another hash, though nothing was applied, clears the cache', b5.size === 0);
  const b3 = new Map([[11, mk(11, 'a11', 'a10')]]);
  t(
    'a reply for the tip height with another hash is an old answer: refused',
    CH.acceptBlock(b3, mk(12, 'x12', 'a11'), { tipHeight: 12, tipHash: 'b12' }) === false && !b3.has(12),
  );
  t(
    'a reply that does not link to the cached block below drops that one',
    CH.acceptBlock(b3, mk(12, 'b12', 'b11'), { tipHeight: 12, tipHash: 'b12' }) && !b3.has(11),
  );
  const b4 = new Map([[13, mk(13, 'a13', 'a12')]]);
  CH.acceptBlock(b4, mk(12, 'b12', 'b11'), { tipHeight: 13, tipHash: 'a13' });
  t('…and a cached block above that does not build on the reply goes too', !b4.has(13) && b4.has(12));
  const wanted = new Map();
  const w1 = CH.wantHeights({ height: 152103, blocks: new Map([[152102, {}]]), wanted, now: 1000, floor: 152097 });
  t('the last ones above the snapshot are asked, less what is cached', w1.join() === '152103,152101,152100,152099,152098');
  t('…not again within 30 s', CH.wantHeights({ height: 152103, blocks: new Map(), wanted, now: 30999, floor: 152097 }).length === 1);
  t(
    '…again after 30 s (each by when it was asked)',
    CH.wantHeights({ height: 152103, blocks: new Map(), wanted, now: 31000, floor: 152097 }).length === 5,
  );
  t('at most eight', CH.wantHeights({ height: 200, blocks: new Map(), wanted: new Map(), now: 0, floor: 0 }).length === 8);
  t('no height, nothing asked', CH.wantHeights({ height: null, blocks: new Map(), wanted: new Map(), now: 0, floor: 0 }).length === 0);
  const arr = new Map([[100, 5]]);
  CH.markArrived(arr, { height: 102, applied: 3 }, 9);
  t(
    'every height a sync applied reached the tab then; an earlier arrival is kept',
    arr.get(100) === 5 && arr.get(101) === 9 && arr.get(102) === 9,
  );
}
// ---- the throttle
{
  let clock = 0;
  const timers = [];
  const set = (f, ms) => timers.push({ f, at: clock + ms });
  const run = (to) => {
    clock = to;
    const due = timers.filter((x) => x.at <= to);
    for (const x of due) timers.splice(timers.indexOf(x), 1);
    for (const x of due) x.f();
  };
  let calls = 0;
  const go = SD.throttle(() => calls++, 2000, { now: () => clock, set });
  go();
  run(0);
  t('the first request runs at once', calls === 1);
  for (let ms = 100; ms < 1900; ms += 100) {
    clock = ms;
    go();
  }
  run(1999);
  t('a stream of requests runs again no sooner than 2 s after the last run', calls === 1);
  run(2000);
  t('…and no later', calls === 2);
}
// ---- versions
t(
  'versions compare as numbers, field by field; a stale or malformed one is never newer',
  VS.newer('2026-10-01.10', '2026-10-01.9') &&
    !VS.newer('2026-10-01.9', '2026-10-01.10') &&
    VS.newer('2026-10-02.1', '2026-10-01.99') &&
    !VS.newer('2026-10-01.2', '2026-10-01.2') &&
    !VS.newer('x', '2026-10-01.1'),
);
// ---- markup and names
{
  const b = P.packBlocks([tx('a', 100, 10), tx('b', 300, 2)])[0];
  const p = V.projTile(b, 0, { built: { txs: 2 } });
  t(
    'a projected tile names everything it shows',
    /next block: about 2.0 sat per vB/.test(p.label) &&
      /400 vB · 2 tx · 1,600 sat/.test(p.label) &&
      /built by the node/.test(p.label) &&
      /✓ built/.test(p.html),
  );
  t(
    'one unit set on every tile: vB · tx · sat',
    /400 vB · 2 tx · 1,600 sat/.test(V.projTile(b, 3).html) && !/WU/.test(V.projTile(b, 0, { built: {} }).html),
  );
  t(
    'the empty next block, built: the coinbase only',
    /coinbase only/.test(V.emptyNextTile({ built: true }).html) &&
      /nothing heard yet/.test(V.emptyNextTile({ words: 'nothing heard yet' }).html),
  );
  const m = V.minedTile({ height: 152103, size: 617, nTx: 2 }, { med: 5, known: 1, others: 3, seenWords: '1 of 3 seen first', ageS: 240 });
  t(
    'a mined tile names its block, age, rate (of how many known), size and seen',
    /block 152,103, 4 min ago: ~5.0 sat\/vB \(of 1 known\), 2 transactions, 617 bytes, 1 of 3 seen first/.test(m.label),
    m.label,
  );
  t(
    'a mined tile without known fees says so; an unsigned one says it',
    /fees unknown/.test(V.minedTile({ height: 1, size: 1, nTx: 1 }, {}).html) &&
      /not signed yet/.test(V.minedTile({ height: 1, size: 1, nTx: 1 }, { unsigned: true }).label),
  );
  const seenTx = new Map([[id('b'), { vsize: 10, fee: 20, feeRate: 2, at: 50 }]]);
  const det = V.blockDetail(
    { height: 7, hash: id('h'), time: 100, nTx: 3, size: 900, txids: [id('c'), id('b'), id('d')], arrivedAt: 100 },
    {
      sw: { counted: false, words: 'not listening then', seen: 1, others: 2, knownCount: 1, knownFees: 20 },
      seenTx,
      signedWords: 'x',
      foundTxid: id('b'),
    },
  );
  t(
    'a block found by a search is headed so, its row highlighted',
    /Found in block 7/.test(det) && new RegExp(`data-t="${id('b')}" class="hi"`).test(det),
  );
  t('a transaction not seen while the tab was not listening reads "—", never "never"', !/never/.test(det) && /<td>—<\/td>/.test(det));
  t('external links say where they go', /mempool\.guide \(another site, not checked by this tab\)/.test(det));
  const big = V.blockDetail(
    { height: 7, hash: id('h'), time: 100, nTx: 300, size: 900, txids: Array.from({ length: 300 }, (_, i) => id('e' + i)) },
    { sw: { counted: true, words: '', seen: 0, others: 299, knownCount: 0, knownFees: 0 }, seenTx: new Map(), signedWords: 'x' },
  );
  t('a long block detail is capped, with how many more', (big.match(/<tr data-t/g) ?? []).length === 200 && /and 100 more/.test(big));
  t(
    'not found says where it looked',
    /blocks 5–6 \(the last 2 this tab holds\)/.test(
      V.notFoundWords({ where: 'none', searched: { from: 5, to: 6, count: 2 } }, { count: 9 }),
    ) && /type more/.test(V.notFoundWords({ where: 'many', count: 2 })),
  );
  t(
    'a mempool transaction is escaped',
    !/<script>/.test(
      V.mempoolTxDetail({
        txid: '<script>',
        vsize: 1,
        fee: 1,
        feeRate: 1,
        at: 1,
        inputs: ['<x>:0'],
        outputs: [{ value: 1, scriptPubKey: '<y>' }],
      }),
    ),
  );
}
done();
