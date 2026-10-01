// The page's decisions: packing, medians, bands, what was seen first, search, the graph, words, the status, the sources.
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
  t(
    'the median of an even count is the mean of the two middles, of an odd count the middle',
    P.median([1, 2, 3, 4]) === 2.5 && P.median([3, 1, 2]) === 2 && P.median([]) === null,
  );
  t(
    'the size-weighted median is the rate at which half the space is reached',
    P.weightedMedian([tx('x', 100, 1), tx('y', 300, 10)]) === 10 && P.weightedMedian([tx('x', 300, 1), tx('y', 100, 10)]) === 1,
  );
  const cov = P.coverage({ count: 3000, bytes: 330000, txs: Array.from({ length: 1000 }, (_, i) => tx('t' + i, 110, 2)) });
  t(
    'when the worker sends fewer transactions than it holds, that is known',
    cov.truncated && cov.shown === 1000 && cov.total === 3000 && cov.totalVb - cov.shownVb === 220000,
  );
  t('...and when it sends all, it is not', !P.coverage({ count: 2, bytes: 10, txs: [tx('a', 5, 1), tx('b', 5, 1)] }).truncated);
  t(
    'the block index maps each transaction to its projected block',
    P.blockIndex(b).get(id('b')) === 1 && P.blockIndex(b).get(id('c')) === 0,
  );
}
// ---- bands
t(
  'a rate under 1 goes to its own band, not to 1–2',
  F.bandOf(0.5) === 0 && F.bandLabel(0) === '< 1' && F.bandOf(1) === 1 && F.bandOf(1.99) === 1 && F.bandOf(2) === 2,
);
t(
  'the top band holds everything from 1000 up',
  F.bandOf(999) === F.BANDS.length - 2 &&
    F.bandOf(1000) === F.BANDS.length - 1 &&
    F.bandOf(5000) === F.BANDS.length - 1 &&
    F.bandLabel(F.BANDS.length - 1) === '≥ 1000',
);
t(
  'the histogram adds up to the vB it was given',
  F.histogram([tx('a', 100, 0.5), tx('b', 200, 3), tx('c', 300, 3000)]).reduce((a, x) => a + x, 0) === 600,
);
t('the hue runs from blue at 1 to orange at 1000', F.feeHue(1) === 210 && F.feeHue(1000) === 30 && F.feeHue(0.1) === 210);
// ---- seen first
{
  const seen = new Map();
  SE.rememberSeen(seen, [tx('a', 10, 1), tx('b', 10, 1)]);
  const block = { txids: [id('c'), id('a'), id('z')], nTx: 3, arrivedAt: 2000 };
  t(
    'a block found after the mempool was followed says how much of it was seen first (the coinbase never)',
    SE.blockSeen(block, seen, { followedAt: 1500 }).words === '1 of 2 seen first',
  );
  t(
    'a block from before the mempool was followed does not count as unseen',
    SE.blockSeen({ ...block, arrivedAt: 1000 }, seen, { followedAt: 1500 }).words === 'before the mempool was followed' &&
      SE.blockSeen(block, seen, { followedAt: null }).counted === false,
  );
  t(
    'a block with only its coinbase has no transactions',
    SE.blockSeen({ txids: [id('c')], nTx: 1, arrivedAt: 2000 }, seen, { followedAt: 1 }).words === 'no transactions',
  );
  const many = new Map();
  SE.rememberSeen(
    many,
    Array.from({ length: 30 }, (_, i) => tx('k' + i, 1, 1)),
    { cap: 20, evict: 5 },
  );
  t('what was seen is capped, the oldest evicted first', many.size === 25 && !many.has(id('k0')) && many.has(id('k29')));
}
// ---- search
{
  const mp = { count: 2, txs: [tx('a', 1, 1)] };
  t('a query that is not a txid says so', !!SC.parseQuery('abc').error && SC.parseQuery(' ' + id('A') + ' ').txid === id('a'));
  t(
    'found in the mempool, then in a block, then in what was seen',
    SC.locate(id('a'), { mempool: mp }).where === 'mempool' &&
      SC.locate(id('b'), { mempool: mp, blocks: [{ height: 5, txids: [id('b')] }] }).height === 5 &&
      SC.locate(id('s'), { mempool: mp, seen: new Map([[id('s'), {}]]) }).where === 'seen',
  );
  t(
    'not found in a mempool the page sees only part of: said as partial',
    SC.locate(id('q'), { mempool: mp }).partial === true &&
      SC.locate(id('q'), { mempool: { count: 1, txs: [tx('a', 1, 1)] } }).partial === false,
  );
}
// ---- the graph
{
  const s = [];
  for (let i = 0; i < 5; i++) SR.pushSample(s, { t: i * 5000, count: i, vb: i * 10 }, 3);
  t('samples are capped, the oldest dropped', s.length === 3 && s[0].count === 2);
  const g = SR.polyline(
    [
      { t: 0, count: 1 },
      { t: 5000, count: 2 },
      { t: 60000, count: 4 },
      { t: 65000, count: 2 },
    ],
    'count',
    { W: 100, H: 50, gapMs: 20000 },
  );
  t('a gap in the samples breaks the line instead of drawing straight across it', g.runs.length === 2 && g.max === 4);
  t(
    'the span is said in minutes, then hours',
    SR.spanWords([{ t: 0 }, { t: 30 * 60000 }]) === 'the last 30 minutes' &&
      SR.spanWords([{ t: 0 }, { t: 3 * 3600000 }]) === 'the last 3.0 hours',
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
  'links only for a real txid or hash',
  FM.txUrl(id('a')).endsWith('/tx/' + id('a')) && FM.txUrl('javascript:alert(1)') === '#' && FM.blockUrl('x') === '#',
);
t('the next blocks are said by when', FM.etaWords(0) === 'next block' && FM.etaWords(2) === 'in ~60 min');
t(
  'a refusal line is read, with or without a txid and a source',
  NT.parseRefusal('mempool: refused 0123abcd… from relay.x: fee too low').reason === 'fee too low' &&
    NT.parseRefusal('mempool: refused a transaction: bad').txid === null &&
    NT.parseRefusal('other') === null,
);
t(
  'the seed line: accepted of total, or the reason it failed',
  NT.parseSeedLine("mempool: 12 of 15 from the mirror's file at height 152100").accepted === 12 &&
    NT.parseSeedLine('mempool: seed file: 404').ok === false,
);
{
  const m = { height: 101, txs: 3, fees: 900, weight: 4000, checks: { ok: true, failed: [] } };
  t(
    'a current template that passes is "every rule passes"',
    NT.templateWords(m, 100).ok && /every rule passes/.test(NT.templateWords(m, 100).text),
  );
  t(
    'a failing template says which rules fail',
    NT.templateWords({ ...m, checks: { ok: false, failed: ['btc:rule-x'] } }, 100).text === "the worker's build fails: btc:rule-x",
  );
  t('a template built on an old tip is stale, never "as built"', NT.templateWords(m, 101).stale && !NT.templateWords(m, 101).ok);
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
      ST.pillState(base, { now: NOW }).text === 'up to date · 100 · signed',
  );
  t('a disagreeing signed tip is red', ST.chainState({ ...base, nostr: { ...base.nostr, diverged: true } }, { now: NOW }).level === 'bad');
  t(
    'blocks two or more above the signed tip are a warning',
    ST.chainState({ ...base, height: 102 }, { now: NOW }).level === 'warn' &&
      ST.chainState({ ...base, height: 101 }, { now: NOW }).level === 'ok',
  );
  t(
    'a silent source and a stopped chain are warnings',
    ST.chainState({ ...base, lastSync: NOW - 200e3 }, { now: NOW }).level === 'warn' &&
      ST.chainState({ ...base, time: NOW / 1000 - 6000 }, { now: NOW }).level === 'warn',
  );
  t('no signed tip is said, quietly', ST.chainState({ ...base, nostr: null }, { now: NOW }).level === 'none');
  t(
    'the signed height only from an agreeing tip',
    ST.signedHeight(base.nostr) === 100 && ST.signedHeight({ height: 5, agree: 0 }) === null && ST.signedHeight(null) === null,
  );
  t(
    'a feed silent 15 minutes is a warning; not before; not when not following',
    !!ST.feedState({ following: true, lastFeedAt: NOW - 16 * 60e3 }, { now: NOW }) &&
      !ST.feedState({ following: true, lastFeedAt: NOW - 60e3 }, { now: NOW }) &&
      !ST.feedState({ following: false }, { now: NOW }),
  );
  t(
    'a feed never heard counts from when the mempool was followed',
    !!ST.feedState({ following: true }, { now: NOW, followedAt: NOW - 20 * 60e3 }) &&
      !ST.feedState({ following: true }, { now: NOW, followedAt: NOW - 60e3 }),
  );
  t(
    'errors in words',
    /another tab/i.test(ST.plainError('blocks.dat is open in another tab @ x')) &&
      /1.1 GB/.test(ST.plainError('QuotaExceededError')) &&
      /private window/.test(ST.plainError('SecurityError')) &&
      !/@/.test(ST.plainError('x @ stack')),
  );
}
// ---- sources
{
  const store = { 'bight:blocks': 'https://mine.example/b', 'reef:snapshot': 'https://reef.example/s.dat' };
  const get = (k) => store[k] ?? null;
  const r = SO.resolveSources({ get, query: new URLSearchParams('blocks=https://evil.example/x&snapshot=') });
  t(
    "stored sources are used (Bight's, then Reef's, then the defaults)",
    r.stored.blocks === 'https://mine.example/b' && r.stored.snapshot === 'https://reef.example/s.dat',
  );
  t(
    'a source proposed by a link is not used until accepted; an empty one is no proposal',
    r.use.blocks === 'https://mine.example/b' && r.proposed.blocks === 'https://evil.example/x' && !('snapshot' in r.proposed),
  );
  const ok = SO.resolveSources({
    get,
    query: new URLSearchParams('blocks=https://evil.example/x'),
    accepted: (k) => (k === 'blocks' ? 'https://evil.example/x' : null),
  });
  t('...and used, for the visit, once the person accepted it', ok.use.blocks === 'https://evil.example/x');
  t(
    'a proposal that is not https is never used even if accepted',
    SO.resolveSources({ query: new URLSearchParams('blocks=http://x/y'), accepted: () => 'http://x/y' }).use.blocks === SO.DEFAULT_BLOCKS,
  );
  t(
    'a stored value that is not an https address is ignored',
    SO.resolveSources({ get: () => 'javascript:alert(1)' }).use.snapshot === SO.DEFAULT_SNAP,
  );
  t(
    'options are coerced: only true is true',
    SO.parseOptions('{"torrent":"false","seed":true}').torrent === false &&
      SO.parseOptions('{"seed":true}').seed === true &&
      SO.parseOptions('not json').torrent === false,
  );
}
done();
