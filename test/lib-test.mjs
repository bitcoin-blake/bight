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
  const block = { txids: [id('c'), id('a'), id('z')], nTx: 3 };
  const alone = (at) => ({ at, alone: true });
  t(
    'a block whose whole interval the tab listened for says how much of it was seen first (the coinbase never)',
    SE.blockSeen(block, seen, { followedAt: 1500, arrival: alone(2000), prevArrival: alone(1600) }).words === '1 of 2 seen first',
  );
  t(
    'a block whose previous block came before the tab listened is not counted: "not listening then"',
    SE.blockSeen(block, seen, { followedAt: 1500, arrival: alone(2000), prevArrival: alone(1400) }).words === 'not listening then' &&
      SE.blockSeen(block, seen, { followedAt: 1500, arrival: alone(2000), prevArrival: null }).counted === false &&
      SE.blockSeen(block, seen, { followedAt: 1500, arrival: alone(1000), prevArrival: alone(1600) }).counted === false &&
      SE.blockSeen(block, seen, { followedAt: null, arrival: alone(2000), prevArrival: alone(1600) }).counted === false,
  );
  t(
    'arriving at the same millisecond the listening began is not after it (strictly after, both blocks)',
    SE.blockSeen(block, seen, { followedAt: 1500, arrival: alone(1500), prevArrival: alone(1400) }).counted === false &&
      SE.blockSeen(block, seen, { followedAt: 1500, arrival: alone(2000), prevArrival: alone(1500) }).counted === false &&
      SE.blockSeen(block, seen, { followedAt: 1500, arrival: alone(2000), prevArrival: alone(1501) }).counted === true,
  );
  t(
    'a block that came with others in one catch-up (after sleep, a gap) is not counted, though it arrived after listening began',
    SE.blockSeen(block, seen, { followedAt: 1500, arrival: { at: 2000, alone: false }, prevArrival: alone(1600) }).counted === false,
  );
  t(
    'a block with only its coinbase has no transactions',
    SE.blockSeen({ txids: [id('c')], nTx: 1 }, seen, { followedAt: 1 }).words === 'no transactions',
  );
  t(
    'the coinbase is never counted as seen, even if its txid was',
    SE.blockSeen({ txids: [id('a'), id('z')], nTx: 2 }, seen, { followedAt: 1, arrival: alone(5), prevArrival: alone(3) }).seen === 0,
  );
  const fees = SE.blockSeen({ txids: [id('c'), id('a'), id('b')], nTx: 9 }, seen, {
    followedAt: 1,
    arrival: alone(5),
    prevArrival: alone(2),
  });
  t(
    'the fees known add up, and the transaction count is the block’s, not the list’s',
    fees.knownFees === 20 && fees.knownCount === 2 && fees.others === 8 && fees.counted,
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
  const one = SR.polyline([{ t: 0, count: 3 }], 'count', { W: 10, H: 10 });
  t(
    'one sample is one point (drawn as a dot), in the middle',
    one.runs.length === 1 && one.runs[0].length === 1 && one.runs[0][0][0] === 5,
  );
  t('no samples, nothing', SR.polyline([], 'count', { W: 1, H: 1 }).runs.length === 0);
  const lone = SR.polyline(
    [
      { t: 0, count: 1 },
      { t: 30000, count: 2 },
      { t: 60000, count: 3 },
      { t: 65000, count: 3 },
    ],
    'count',
    { W: 100, H: 10, gapMs: 20000 },
  );
  t('a sample with gaps on both sides is a run of its own', lone.runs.map((r) => r.length).join() === '1,1,2');
  t(
    'a gap is more than gapMs, not equal to it',
    SR.polyline(
      [
        { t: 0, count: 1 },
        { t: 20000, count: 1 },
      ],
      'count',
      { W: 1, H: 1, gapMs: 20000 },
    ).runs.length === 1,
  );
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
      /1.2 GB/.test(ST.plainError('QuotaExceededError')) &&
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
    '…but stores "default" when Reef stored another (or Reef’s would come back)',
    JSON.stringify(SET.sourceWrites({ fields: defaults, reef: { blocks: 'https://r/b' }, defaults })) ===
      JSON.stringify([{ key: 'bight:blocks', set: 'default' }]),
  );
  t(
    'a stored "default" is the default: nothing to write for the default, an address written over it',
    SET.sourceWrites({ fields: defaults, bight: { blocks: 'default' }, reef: { blocks: 'https://r/b' }, defaults }).length === 0 &&
      SET.sourceWrites({ fields: { ...defaults, blocks: 'https://x/b' }, bight: { blocks: 'default' }, defaults })[0].set === 'https://x/b',
  );
  t(
    'Reef storing the default itself needs no "default" from Bight',
    JSON.stringify(
      SET.sourceWrites({ fields: defaults, bight: { blocks: 'https://x/b' }, reef: { blocks: SO.DEFAULT_BLOCKS }, defaults }),
    ) === JSON.stringify([{ key: 'bight:blocks', del: true }]),
  );
  t(
    'a field is trimmed before it is compared',
    SET.sourceWrites({ fields: { ...defaults, blocks: ' ' + SO.DEFAULT_BLOCKS + ' ' }, defaults }).length === 0,
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
  const arr = new Map([
    [99, { at: 5, alone: true }],
    [100, { at: 5, alone: true }],
  ]);
  CH.markArrived(arr, { height: 102, applied: 3 }, 9);
  t(
    'every height a sync applied reached the tab then, replacing what was there (a reorganisation); none of a catch-up is alone',
    arr.get(99).at === 5 &&
      arr.get(100).at === 9 &&
      arr.get(101).at === 9 &&
      arr.get(102).at === 9 &&
      !arr.get(102).alone &&
      !arr.get(100).alone,
  );
  CH.markArrived(arr, { height: 103, applied: 1 }, 12);
  t('a pass that applied one block: that block arrived alone', arr.get(103).alone && arr.get(103).at === 12);
  CH.markArrived(arr, { height: 103, applied: 0 }, 20);
  CH.markArrived(arr, { height: 104, applied: 0 }, 21);
  t(
    'a pass that applied nothing keeps the tip’s arrival, and marks a tip that had none (not alone)',
    arr.get(103).at === 12 && arr.get(104).at === 21 && !arr.get(104).alone,
  );
  CH.markArrived(arr, { height: 101, applied: 0 }, 30);
  t('a rollback forgets the arrivals above the new tip', !arr.has(102) && !arr.has(104) && arr.get(101).at === 9);
  t(
    'requests carry their generation; a search is told apart; anything else is not the page’s',
    CH.parseReq(CH.reqOf(3)).gen === 3 &&
      !CH.parseReq(CH.reqOf(3)).search &&
      CH.parseReq(CH.reqOf(4, true)).search &&
      CH.parseReq(CH.reqOf(4, true)).gen === 4 &&
      CH.parseReq('bight') === null &&
      CH.parseReq('reef:1') === null &&
      CH.parseReq(null) === null,
  );
  const b6 = new Map([
    [10, mk(10, 'a10', 'a9')],
    [11, mk(11, 'a11', 'a10')],
    [12, mk(12, 'a12', 'a11')],
  ]);
  const d6 = CH.onSynced(b6, { height: 12, hash: 'b12', applied: 2 });
  t(
    'a pass that applied two blocks drops exactly those two heights, and says which',
    b6.has(10) && !b6.has(11) && !b6.has(12) && d6.sort().join() === '11,12',
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
    'a mined tile names its block, age, rate in words (of how many known), size and seen; the symbols only on screen',
    /block 152,103, 4 min ago: about 5\.0 sat per vB \(of 1 known\), 2 transactions, 617 bytes, 1 of 3 seen first/.test(m.label) &&
      !/~|\//.test(m.label) &&
      /~5\.0 sat\/vB/.test(m.html),
    m.label,
  );
  t(
    'a mined tile without known fees says so; an unsigned one says it',
    /fees unknown/.test(V.minedTile({ height: 1, size: 1, nTx: 1 }, {}).html) &&
      /not signed yet/.test(V.minedTile({ height: 1, size: 1, nTx: 1 }, { unsigned: true }).label),
  );
  const seenTx = new Map([[id('b'), { vsize: 10, fee: 20, feeRate: 2, at: 50 }]]);
  const det = V.blockDetail(
    { height: 7, hash: id('h'), time: 100, nTx: 3, size: 900, txids: [id('c'), id('b'), id('d')] },
    {
      arrival: { at: 100000, alone: true },
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
    /blocks 5–6 \(the last 2 blocks this tab holds\)/.test(
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
// ---- round 3: the node's real words, the build judged against this mempool, search, status, sources, words, markup
{
  // the refusal line with every source the node passes (lib/mempool.mjs subscribeMempool, the worker's seed), and none
  const line = (from) => `mempool: refused abababababab…${from ? ' from ' + from : ''}: input 0: script failed`;
  const shapes = ['1a2b3c4d… via relay.damus.io', 'the mirror', 'wss://relay.x', ''];
  t(
    'a refusal is read from every source the node names, with spaces in it; the reason whole',
    shapes.every((f) => {
      const r = NT.parseRefusal(line(f));
      return r && r.txid === 'abababababab' && r.from === (f || null) && r.reason === 'input 0: script failed';
    }),
    JSON.stringify(shapes.map((f) => NT.parseRefusal(line(f)))),
  );
  const m = { height: 101, prevHash: id('p'), txs: 2, fees: 1600, weight: 1601, checks: { ok: true, failed: [] }, mempool: { count: 2 } };
  const blk = P.packBlocks([tx('a', 100, 10), tx('b', 300, 2)])[0];
  t('the build’s vB rounds up (1,601 weight is 401 vB)', NT.templateWords(m, 100, id('p')).vb === 401);
  t(
    'a build of this mempool, with the page’s figures: built',
    NT.templateWords(m, 100, id('p'), { count: 2, block: blk }).ok &&
      /^✓ built: 2 tx · 1,600 sat/.test(NT.templateWords(m, 100, id('p'), { count: 2, block: blk }).text),
  );
  const early = NT.templateWords(m, 100, id('p'), { count: 3, block: blk });
  t(
    'a build that saw another count than the page shows: "built on a different mempool" with both counts, never "✓ built"',
    !early.ok &&
      early.otherMempool &&
      /^built on a different mempool \(2 tx in the node's, \d+ here\)/.test(early.text) &&
      !/✓/.test(early.text),
  );
  const diff = NT.templateWords({ ...m, fees: 1500 }, 100, id('p'), { count: 2, block: blk });
  t('the same count but other figures: the node’s build differs, not built', !diff.ok && diff.differs && /differs/.test(diff.text));
  t(
    'an empty mempool: built only if the node’s build is empty too',
    NT.templateWords({ ...m, txs: 0, fees: 0, mempool: { count: 0 } }, 100, null, { count: 0, block: null }).ok &&
      !NT.templateWords({ ...m, mempool: { count: 0 } }, 100, null, { count: 0, block: null }).ok,
  );
  t(
    'a build with no checks at all is not a pass, and says it was not checked',
    !NT.templateWords({ ...m, checks: undefined }, 100).ok &&
      NT.templateWords({ ...m, checks: undefined }, 100).text === "the worker's build was not checked",
  );
  t(
    'a template that does not say its mempool count is judged by its figures alone',
    NT.templateWords({ ...m, mempool: null }, 100, null, { count: 5, block: blk }).ok,
  );
}
{
  t(
    'heights as people write them: commas, spaces, underscores; not more than nine digits',
    SC.parseQuery('152,103').height === 152103 &&
      SC.parseQuery('152 103').height === 152103 &&
      SC.parseQuery('152_103').height === 152103 &&
      SC.parseQuery('1234567890').height === undefined &&
      !!SC.parseQuery(',152').error,
  );
  t('a prefix needs 8 characters: 7 is not one', !!SC.parseQuery('abcdef1').error && SC.parseQuery('abcdef12').prefix === 'abcdef12');
  const blocks = [
    { height: 5, hash: 'beef' + id('h').slice(4), txids: [id('c'), id('b')] },
    { height: 6, hash: id('i'), txids: [id('d')] },
  ];
  t(
    'the start of a block hash finds that block; a start that a txid and a hash share asks for more',
    SC.locate({ prefix: blocks[0].hash.slice(0, 10) }, { blocks }).height === 5 &&
      SC.locate({ prefix: 'iiiiiiii' }, { list: [tx('i', 1, 1)], blocks }).where === 'many',
  );
  t('a prefix matches the start only, not the middle', SC.locate({ prefix: blocks[0].hash.slice(2, 12) }, { blocks }).where === 'none');
  t('the coinbase of a block held can be searched', SC.locate({ id: id('c') }, { blocks }).height === 5);
  t(
    'a height not held says which, and whether the node can be asked',
    SC.locate({ height: 7 }, { blocks }).height === 7 &&
      SC.heightRange(150307, { floor: 150307, tip: 152000 }) === 'below' &&
      SC.heightRange(150308, { floor: 150307, tip: 152000 }) === 'ask' &&
      SC.heightRange(152000, { floor: 150307, tip: 152000 }) === 'ask' &&
      SC.heightRange(152001, { floor: 150307, tip: 152000 }) === 'above' &&
      SC.heightRange(5, { floor: 0, tip: null }) === 'unknown',
  );
  t(
    'out of range in words: before the snapshot, above the tip',
    /at or before the snapshot at 150,307/.test(V.notFoundWords({ where: 'none', height: 100 }, { range: 'below', floor: 150307 })) &&
      /above this tab's tip \(152,000\)/.test(V.notFoundWords({ where: 'none', height: 152001 }, { range: 'above', tip: 152000 })),
  );
}
{
  const NOW = 1_800_000_000_000;
  const base = {
    synced: true,
    height: 100,
    time: NOW / 1000 - 60,
    lastSync: NOW - 5000,
    nostr: { height: 101, agree: 3, diverged: false },
  };
  t(
    'one or two behind the signed tip is said so, amber, never "signed"',
    ST.pillState(base, { now: NOW }).text === 'up to date · 100 · 1 behind the signed tip' &&
      ST.pillState(base, { now: NOW }).level === 'warn' &&
      /2 blocks behind/.test(ST.chainState({ ...base, nostr: { ...base.nostr, height: 102 } }, { now: NOW }).text) &&
      /1 block behind/.test(ST.chainState(base, { now: NOW }).text),
  );
  t(
    'the heartbeat by when the page saw it: fresh though the node’s figure is old; old though the node’s figure is new',
    !ST.feedState({ following: true, feedFileAt: NOW - 60 * 60e3 }, { now: NOW, seenAt: NOW - 60e3 }) &&
      !!ST.feedState({ following: true, feedFileAt: NOW }, { now: NOW, seenAt: NOW - 11 * 60e3 }),
  );
  t(
    'no heartbeat at all: said after five minutes of following, not before',
    !!ST.feedState({ following: true }, { now: NOW, followedAt: NOW - 5 * 60e3 - 1 }) &&
      !ST.feedState({ following: true }, { now: NOW, followedAt: NOW - 5 * 60e3 }) &&
      !ST.feedState({ following: true }, { now: NOW }),
  );
  t(
    'the heartbeat at exactly ten minutes is still fresh',
    !ST.feedState({ following: true }, { now: NOW, seenAt: NOW - 10 * 60e3 }) &&
      !!ST.feedState({ following: true }, { now: NOW, seenAt: NOW - 10 * 60e3 - 1 }),
  );
  t('a node flagged busy (no phase) is idle', ST.pillState({ busy: true }).level === 'idle');
  t(
    'a retry at exactly now is not waiting; 1.2 s is "2 s"',
    ST.pillState({ phase: 'sync', retryAt: NOW }, { now: NOW }).text === 'syncing · 0' &&
      ST.pillState({ phase: 'sync', retryAt: NOW + 1200 }, { now: NOW }).text === 'retrying in 2 s',
  );
  t(
    'a source silent exactly three minutes is not yet silent',
    ST.chainState({ ...base, nostr: null, lastSync: NOW - 180e3 }, { now: NOW }).level === 'none',
  );
  t(
    'the browser’s own names for a held file and a full disk are worded',
    ST.plainError('NoModificationAllowedError: x').startsWith('Another tab') &&
      ST.plainError('InvalidStateError').startsWith('Another tab') &&
      ST.plainError('could not create access handle').startsWith('Another tab') &&
      /1.2 GB/.test(ST.plainError('not enough space')) &&
      /1.2 GB/.test(ST.plainError('quota reached')),
  );
}
{
  const PARAMS = { SNAPSHOT: { file: 'utxo-knots-160000.dat' } };
  const D = SO.defaultsFor(PARAMS);
  t(
    'the default snapshot is the pinned node’s file on the mirror; without one, the built-in',
    D.snapshot === SO.MIRROR + 'utxo-knots-160000.dat' && SO.defaultsFor(null).snapshot === SO.DEFAULT_SNAP,
  );
  const get = (s) => (k) => s[k] ?? null;
  t(
    'a stored "default" is the default of the day, and stops Reef’s source coming back',
    SO.resolveSources({ get: get({ 'bight:snapshot': 'default', 'reef:snapshot': 'https://r/s' }), defaults: D }).use.snapshot ===
      D.snapshot && SO.resolveSources({ get: get({ 'reef:snapshot': 'https://r/s' }), defaults: D }).use.snapshot === 'https://r/s',
  );
  t(
    'Bight’s source before Reef’s, for the snapshot as for the blocks',
    SO.resolveSources({ get: get({ 'bight:snapshot': 'https://b/s', 'reef:snapshot': 'https://r/s' }) }).use.snapshot === 'https://b/s',
  );
  t(
    'a link proposing what is already used proposes nothing; an acceptance of another value accepts nothing',
    !('blocks' in SO.resolveSources({ query: new URLSearchParams('blocks=' + SO.DEFAULT_BLOCKS) }).proposed) &&
      SO.resolveSources({ query: new URLSearchParams('blocks=https://e/x'), accepted: () => 'https://e/y' }).use.blocks ===
        SO.DEFAULT_BLOCKS &&
      SO.resolveSources({ query: new URLSearchParams('snapshot=https://e/x'), accepted: () => 'https://e/y' }).use.snapshot ===
        SO.DEFAULT_SNAP,
  );
  t('what is not an address is shown as it is', SO.hostOf('not a url') === 'not a url');
  t('a stored value is an address, "default", or nothing', SO.storedValue('default') === 'default' && SO.storedValue('x') === null);
}
{
  t(
    'counts with their nouns, and small sizes not shown as nothing',
    FM.pl(1, 'block') === '1 block' &&
      FM.pl(2, 'block') === '2 blocks' &&
      FM.pl(1000, 'transaction') === '1,000 transactions' &&
      FM.pl(0, 'gap') === '0 gaps' &&
      FM.fmtGB(1000) === '< 1 MB' &&
      FM.fmtGB(0) === '0 MB' &&
      FM.fmtGB(869836053) === '870 MB' &&
      FM.fmtGB(1.2e9) === '1.2 GB' &&
      FM.fmtGB(10737418240) === '10.7 GB',
  );
  const list = Array.from({ length: 10 }, (_, i) => tx('r' + i, 50000, 10 - i));
  const blocks = P.packBlocks(list, { maxBlocks: 2 });
  const r = P.remainder(list, blocks);
  t(
    'what the projected blocks leave: its transactions, vB and about how many blocks',
    r.count === 4 && r.vb === 200000 && r.blocks === 2 && P.remainder(list, P.packBlocks(list)).count === 0,
    JSON.stringify(r),
  );
  t('a transaction of 0 vB has rate 0, not a division by zero', P.mempoolList({ all: [[id('z'), 0, 5, 1, 0]] })[0].feeRate === 0);
  t('a transaction of 0 vB does not count toward the median by size', P.weightedMedian([tx('a', 0, 99), tx('b', 10, 1)]) === 1);
  t('the highest rate of a block is its highest, wherever it sits', P.rateStats([tx('a', 1, 2), tx('b', 1, 9), tx('c', 1, 5)]).max === 9);
  const seen = new Map();
  SE.rememberSeen(seen, [tx('f', 300, 2)]);
  t('fees known add fees, not sizes', SE.blockSeen({ txids: [id('c'), id('f')], nTx: 2 }, seen, {}).knownFees === 600);
  const cap = [];
  SR.pushSample(cap, { t: 0 }, 2);
  SR.pushSample(cap, { t: 1 }, 2);
  cap.push({ t: 2 }, { t: 3 });
  SR.pushSample(cap, { t: 4 }, 2);
  t('a sample over a cap that was passed trims back to the cap', cap.length === 2 && cap[0].t === 3);
  t(
    'the span is in minutes up to 89, then hours',
    SR.spanWords([{ t: 0 }, { t: 89 * 60000 }]) === 'the last 89 minutes' &&
      SR.spanWords([{ t: 0 }, { t: 90 * 60000 }]) === 'the last 1.5 hours',
  );
  t(
    'a version is the whole string: nothing before or after',
    !VS.newer('x2026-10-02.1', '2026-10-01.1') && !VS.newer('2026-10-02.1x', '2026-10-01.1') && VS.versionKey('2026-10-02.1').length === 4,
  );
  t('the luminance knee is WCAG’s: a dark grey', Math.abs(F.luminance([10, 10, 10]) - 0.003035) < 1e-5);
  t('hsl to rgb: pure blue and pure green', F.hslToRgb(240, 100, 50).join() === '0,0,255' && F.hslToRgb(120, 100, 50).join() === '0,255,0');
}
// ---- markup: what a tile, a detail and a word say
{
  const now = { height: 152103, size: 617, nTx: 2 };
  t(
    'a mined tile’s age is from when it reached this tab; from its header when it did not arrive on its own, and said so',
    /^block 152,103, 4 min ago:/.test(V.minedTile(now, { ageS: 240 }).label) &&
      /header 4 min ago/.test(V.minedTile(now, { ageS: 240, ageFrom: 'header' }).label) &&
      /header 25 min ahead/.test(V.minedTile(now, { ageS: -1500, ageFrom: 'header' }).html),
  );
  t(
    'unsigned: the age and "not signed yet" together',
    /38 s ago · not signed yet/.test(V.minedTile(now, { ageS: 38, unsigned: true }).html),
  );
  t('a tile is pluralised: 1 transaction, 1 byte', /1 transaction, 1 byte/.test(V.minedTile({ height: 1, size: 1, nTx: 1 }, {}).label));
  t('the height on a tile has its separators', /<span class="h">152,103<\/span>/.test(V.minedTile(now, {}).html));
  t('"of N known" only when fewer were known', !/known/.test(V.minedTile(now, { med: 1, known: 3, others: 3 }).html));
  const b = P.packBlocks([tx('a', 100, 10), tx('b', 300, 2), tx('c', 100, 20)])[0];
  t('a projected tile shows the median by size, not by count', /~2\.0 sat\/vB/.test(V.projTile(b, 0).html) && b.med === 10);
  t(
    'a projected tile carries a word on the node’s build when it is not built',
    /built on a different mempool/.test(V.projTile(b, 0, { note: 'built on a different mempool' }).label),
  );
  const rt = V.remainderTile({ count: 40, vb: 450000, blocks: 3 });
  t('the remainder: "+3 blocks", its vB and transactions', /\+3 blocks/.test(rt.html) && /450,000 vB · 40 tx/.test(rt.html));
  const mt = (o) => V.mempoolTxDetail({ txid: id('a'), vsize: 1, fee: 1, feeRate: 1, at: 1, fed: true, inputs: [], outputs: [] }, o);
  t(
    'a mempool transaction says where it would go and when, and that a node fed it',
    /in the next block/.test(mt({ block: 0 })) &&
      /in projected block 3, in ~60 min/.test(mt({ block: 2 })) &&
      /beyond the projected blocks/.test(mt()) &&
      /from a node’s mempool/.test(mt()),
  );
  const sw = { counted: true, words: '', seen: 0, others: 2, knownCount: 0, knownFees: 0 };
  const bd = V.blockDetail(
    { height: 9, hash: id('h'), time: 100, nTx: 3, size: 900, txids: [id('c'), id('x'), id('y')] },
    {
      sw,
      seenTx: new Map([[id('x'), { vsize: 1, fee: 1, feeRate: 1, at: 140 }]]),
      signedWords: 's',
      inMempool: 2,
      arrival: { at: 200000, alone: true },
    },
  );
  t(
    'a block detail: when it reached this tab, the coinbase not marked unseen, two still listed, the note on history',
    /Reached this tab/.test(bd) &&
      /1 min before the block/.test(bd) &&
      (bd.match(/<td>not seen<\/td>/g) ?? []).length === 1 &&
      /2 still listed/.test(bd) &&
      /keeps no history/.test(bd),
  );
  t(
    'every link out opens apart from this page (noopener)',
    (bd.match(/target="_blank"/g) ?? []).length === (bd.match(/rel="noopener"/g) ?? []).length,
  );
  // every view function, given markup where a value goes, puts out none of it
  const X = '<img src=x onerror=alert(1)>"\'';
  const xtx = { txid: X, vsize: X, fee: X, feeRate: 1, at: 1, inputs: [X + ':0'], outputs: [{ value: X, scriptPubKey: X }] };
  const xb = { txs: [xtx], vsize: X, fees: X, min: 1, max: 2, wmed: 1 };
  const xblock = { height: X, hash: X, time: 1, nTx: X, size: X, txids: [X, X], fees: X };
  const out = [
    V.projTile(xb, 0, { built: { txs: X }, note: X }),
    V.emptyNextTile({ words: X }),
    V.minedTile(xblock, { med: 1, known: 0, others: 5, seenWords: X }),
    V.remainderTile({ count: X, vb: X, blocks: X }),
    {
      html: V.blockDetail(xblock, {
        sw: { counted: false, words: X, seen: X, others: X, knownCount: 1, knownFees: X },
        seenTx: new Map([[X, { vsize: X, fee: X, feeRate: 1, at: 0 }]]),
        signedWords: X,
        inMempool: X,
        foundTxid: X,
        arrival: { at: 1, alone: false },
      }),
    },
    { html: V.projDetail(xb, 0, { tw: { text: X, differs: true }, asOf: X }) },
    { html: V.mempoolTxDetail(xtx, { block: 1 }) },
    { html: V.notFoundWords({ where: 'seen', seen: { at: 1, vsize: X, feeRate: 1 } }) },
  ];
  t(
    'markup in any value is escaped by every view function (tiles, details, words)',
    out.every((o) => !/<img|onerror=alert\(1\)>/.test(o.html)),
    out.findIndex((o) => /<img|onerror=alert\(1\)>/.test(o.html)),
  );
}
// ---- the throttle on the real clock
{
  let calls = 0;
  const go = SD.throttle(() => calls++, 50);
  go();
  go();
  await new Promise((r) => setTimeout(r, 20));
  const first = calls;
  go();
  await new Promise((r) => setTimeout(r, 20));
  const between = calls;
  await new Promise((r) => setTimeout(r, 60));
  t(
    'on the real clock: the first runs at once, a second waits its 50 ms, then runs',
    first === 1 && between === 1 && calls === 2,
    `${first} ${between} ${calls}`,
  );
}
// ---- round 4: the coinbase's fees, arrivals watched or not, pruning, the spacing, search by digits, and the boundaries
// that mutation testing showed untested
{
  t(
    'the subsidy halves every 210,000 blocks from 50 BTC, as the engine counts it',
    CH.subsidyAt(0) === 5e9 &&
      CH.subsidyAt(209999) === 5e9 &&
      CH.subsidyAt(210000) === 2.5e9 &&
      CH.subsidyAt(152101) === 5e9 &&
      CH.subsidyAt(64 * 210000) === 0,
  );
  t(
    'the fees a coinbase claimed: its value less the subsidy; nothing from an older node or an impossible figure',
    CH.feesClaimed(5e9 + 450, 152101) === 450 &&
      CH.feesClaimed(5e9, 152101) === 0 &&
      CH.feesClaimed(undefined, 152101) === null &&
      CH.feesClaimed(4e9, 152101) === null &&
      CH.feesClaimed(2.5e9 + 7, 210000) === 7,
  );
  const ar = new Map();
  CH.markArrived(ar, { height: 10, applied: 1 }, 1000, { watched: false });
  CH.markArrived(ar, { height: 11, applied: 1 }, 2000);
  t(
    'a block that came alone after a gap was not watched arriving; the next one was',
    ar.get(10).alone === false && ar.get(11).alone === true,
  );
  const pm = new Map([
    [5, 1],
    [6, 1],
    [7, 1],
  ]);
  CH.pruneBelow(pm, 6);
  t('pruning forgets the heights below the floor and keeps the floor', [...pm.keys()].join() === '6,7');
  const hb = (h, time) => ({ height: h, time });
  t(
    'the spacing is the median gap between consecutive headers, in minutes; 20 with fewer than 3 gaps',
    FM.spacingMin([hb(1, 0), hb(2, 600), hb(3, 1200), hb(4, 1800)]) === 10 &&
      FM.spacingMin([hb(1, 0), hb(2, 600)]) === 20 &&
      FM.spacingMin([hb(1, 0), hb(3, 600), hb(5, 1200)]) === 20 &&
      FM.spacingMin([hb(1, 0), hb(2, 6), hb(3, 12), hb(4, 18)]) === 1 &&
      FM.spacingMin([hb(1, 0), hb(2, 9000), hb(3, 18000), hb(4, 27000)]) === 60,
  );
  t(
    'the ETA follows the spacing given',
    FM.etaWords(2, 10) === 'in ~30 min' && FM.etaWords(2) === 'in ~60 min' && FM.etaWords(0, 10) === 'next block',
  );
  t(
    'digits alone are a height only up to 7 and without a leading zero; grouping is in threes with one separator',
    SC.parseQuery('00000000').prefix === '00000000' &&
      SC.parseQuery('12345678').prefix === '12345678' &&
      SC.parseQuery('152105').height === 152105 &&
      SC.parseQuery('152 105').height === 152105 &&
      SC.parseQuery('1,234,567').height === 1234567 &&
      !!SC.parseQuery('152,10,5').error &&
      !!SC.parseQuery('1_234,567').error &&
      !!SC.parseQuery('0123').error &&
      SC.parseQuery('0').height === 0,
  );
  // packing: the order is the node's, by fee rate, whatever order the mempool lists them in
  const shuffled = [tx('l', 100, 1), tx('h', 100, 9), tx('m', 100, 5)];
  t(
    'packing sorts by fee rate itself (a mempool listed in another order)',
    P.packBlocks(shuffled)[0]
      .txs.map((x) => x.txid[0])
      .join('') === 'hml',
  );
  t(
    'the size-weighted median is where half the size is reached, not a third',
    P.weightedMedian([tx('a', 100, 1), tx('b', 100, 2), tx('c', 100, 3)]) === 2,
  );
  t(
    'a rate that is not a number does not count toward the median, whatever its size',
    P.weightedMedian([{ txid: 'x', vsize: 1000, feeRate: NaN }, tx('b', 10, 5)]) === 5,
  );
  const rem = (vb) => P.remainder([{ txid: 'r', vsize: vb, fee: 1, feeRate: 1 }], []).blocks;
  t(
    '"+N blocks" counts 199,000 vB to a block (800,000 weight less 4,000, by 4)',
    rem(170000) === 1 && rem(199000) === 1 && rem(199001) === 2,
  );
  // the colours
  t(
    'the hue runs from 210 at 1 sat/vB to 30 at 1,000, on a log scale',
    F.feeHue(1) === 210 && F.feeHue(1000) === 30 && Math.round(F.feeHue(Math.sqrt(1000) * 1)) === 120 && F.feeHue(0.5) === 210,
  );
  const blue = F.feeColors(1);
  t(
    'a colour already readable is kept at 40% lightness, its second stop 12 points darker',
    blue.c1 === 'hsl(210 65% 40%)' && blue.c2 === 'hsl(210 70% 28%)',
    blue.c1 + ' ' + blue.c2,
  );
  // the graph's coordinates
  const pl3 = SR.polyline(
    [
      { t: 1000, v: 0 },
      { t: 1010, v: 5 },
      { t: 1020, v: 10 },
    ],
    'v',
    { W: 100, H: 100, pad: 0 },
  );
  t(
    'graph points are spread over the width by time, and up the height by value',
    JSON.stringify(pl3.runs[0]) ===
      JSON.stringify([
        [0, 100],
        [50, 50],
        [100, 0],
      ]),
    JSON.stringify(pl3.runs),
  );
  t(
    'the span under a minute and at one minute reads "the last minute"',
    SR.spanWords([{ t: 0 }, { t: 20000 }]) === 'the last minute' &&
      SR.spanWords([{ t: 0 }, { t: 60000 }]) === 'the last minute' &&
      SR.spanWords([{ t: 0 }, { t: 120000 }]) === 'the last 2 minutes',
  );
  // seen first: strictly after
  const blk = { txids: [id('c'), id('b')], nTx: 2 };
  const seenAt = (at, prevAt) =>
    SE.blockSeen(blk, new Map(), { followedAt: 100, arrival: { at, alone: true }, prevArrival: { at: prevAt } }).counted;
  t(
    'a block that arrived at the very moment listening began is not counted; a moment later it is',
    !seenAt(100, 101) && !seenAt(101, 100) && seenAt(101, 101),
  );
  // the status boundaries
  const behind = (k) => ST.chainState({ height: 100, nostr: { height: 100 + k, agree: 1 } });
  t(
    'two blocks behind the signed tip is ordinary (it catches up); three is a warning',
    behind(2).level === 'none' && /catches up/.test(behind(2).text) && behind(3).level === 'warn' && /may be stale/.test(behind(3).text),
  );
  t('a mempool of one transaction is not "empty"', ST.emptyWords({ count: 1, stats: { seen: 1 } }) === null);
  t(
    'a node stopped for a wipe, or left stopped by one, is said, never "up to date"',
    ST.pillState({ phase: 'wiped', synced: true, height: 5 }).text === 'stopped for a wipe' &&
      ST.pillState({ phase: 'error', synced: false, error: 'x' }).level === 'bad' &&
      /stopped/.test(ST.pillState({ phase: 'error', synced: false, error: 'x' }).text),
  );
  // the views
  const bd = V.blockDetail(
    { height: 3, hash: id('h'), time: 100, nTx: 2, size: 9, txids: [id('c'), id('b')], fees: 450 },
    {
      sw: { counted: true, seen: 0, others: 1, knownCount: 0, knownFees: 0 },
      seenTx: new Map(),
      signedWords: 's',
      arrival: { at: 200000, alone: false },
    },
  );
  t(
    'a block detail: the coinbase marked, the header time in seconds, a catch-up arrival said so, the fees its coinbase claimed',
    /coinbase<\/span>/.test(bd) &&
      bd.includes(new Date(100 * 1000).toLocaleString()) &&
      /in a catch-up, not watched arriving/.test(bd) &&
      /Fees claimed by its coinbase<\/span><span class="v">450 sat/.test(bd),
  );
  const seenTx2 = new Map([[id('b'), { vsize: 1, fee: 1, feeRate: 1, at: 40 }]]);
  const at = (arrival) =>
    V.blockDetail(
      { height: 3, hash: id('h'), time: 100, nTx: 2, size: 9, txids: [id('c'), id('b')] },
      { sw: { counted: true, seen: 1, others: 1, knownCount: 1, knownFees: 1 }, seenTx: seenTx2, signedWords: 's', arrival },
    );
  t(
    '"before the block" counts from its arrival only when it was watched arriving; else from its header',
    /2 min before the block/.test(at({ at: 160000, alone: true })) && /1 min before the block/.test(at({ at: 999000, alone: false })),
  );
  const pd = (i) =>
    V.projDetail({ txs: [], vsize: 0, fees: 0, min: null, max: null, wmed: null }, i, { tw: { text: 'T', differs: false }, asOf: 'now' });
  t('the node’s own build is a row of the next block only', /The node's own build/.test(pd(0)) && !/The node's own build/.test(pd(1)));
  t(
    'a height while the tab is not up to date says to search again later',
    /not up to date yet/.test(V.notFoundWords({ where: 'none', height: 5 }, { range: 'unknown' })),
  );
  const heard = V.mempoolTxDetail({ txid: id('a'), vsize: 1, fee: 1, feeRate: 1, at: 100 }, { block: 3, spacing: 10 });
  t(
    'a mempool transaction: heard at its time in seconds, its ETA at the chain’s spacing',
    heard.includes(new Date(100 * 1000).toLocaleTimeString()) && /in projected block 4, in ~40 min/.test(heard),
  );
}
done();
