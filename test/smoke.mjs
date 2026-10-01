// The page itself in headless Chromium, with the node replaced by test/fake/tabnode.js (and the node's params read from
// the checkout at the pinned commit): consent before the download and before the lock, a refused lock, the mempool and
// blocks flow, the template under a busy mempool, the signed tip, seen-first, focus kept on a tile and returned by the
// detail, search (txid, prefix asked of the node, height, not found), an empty mempool, the feed's age, an unresponsive
// node, the idle tab, the update notice, a wipe (and none from a frame), a link that proposes a source (end to end), and
// Settings over a source Reef stored.
// Needs playwright-core and a Chromium: CHROME=<path> or `npx playwright-core install chromium-headless-shell`.
//   BLAKETESTNODE=<checkout> node test/smoke.mjs
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BTN = (process.env.BLAKETESTNODE ?? homedir() + '/remote/github.com/bitcoin-blake/blaketestnode').replace(/^~/, homedir());
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  if (process.env.CI) throw new Error('playwright-core is not installed');
  console.log('smoke: skipped (playwright-core is not installed: npm i --no-save playwright-core)');
  process.exit(0);
}
let ok = 0,
  bad = 0;
const t = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `\n        ${detail}`}`);
  cond ? ok++ : bad++;
};
const ORIGIN = 'http://localhost:8798'; // localhost: a secure context, so the page has OPFS and Web Locks
const type = (p) => (p.endsWith('.html') ? 'text/html' : /\.json(ld)?$/.test(p) ? 'application/json' : 'text/javascript');
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const until = (page, fn, arg, timeout = 5000) =>
  page
    .waitForFunction(fn, arg, { timeout })
    .then(() => true)
    .catch(() => false);
const DEFAULT_BLOCKS = 'https://melvin.me/public/txbt4/txbt4-blocks';
async function profile(seed = {}, { config = null, version = null } = {}) {
  const ctx = await browser.newContext();
  if (config) await ctx.addInitScript((c) => (window.__fakeConfig = c), config);
  await ctx.route('**/*', async (route) => {
    const u = route.request().url();
    let m;
    if ((m = u.match(/^https:\/\/cdn\.jsdelivr\.net\/gh\/bitcoin-blake\/blaketestnode@([0-9a-f]+)\/browser\/tabnode\.js$/)))
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(`${ROOT}test/fake/tabnode.js`) });
    if ((m = u.match(/^https:\/\/cdn\.jsdelivr\.net\/gh\/bitcoin-blake\/blaketestnode@([0-9a-f]+)\/(lib\/params\.mjs)$/)))
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: execSync(`git -C ${BTN} show ${m[1]}:${m[2]}`) });
    if (version && u.startsWith(ORIGIN + '/version.json'))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version }) });
    if (u === ORIGIN + '/frame')
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><iframe src="/index.html" width="900" height="700"></iframe>',
      });
    if (u === ORIGIN + '/seed') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>seed</title>' });
    if ((m = u.match(/^http:\/\/localhost:8798\/([^?]*)/))) {
      const p = `${ROOT}${m[1] || 'index.html'}`;
      return existsSync(p)
        ? route.fulfill({ status: 200, contentType: type(p), body: readFileSync(p) })
        : route.fulfill({ status: 404, body: '' });
    }
    return route.fulfill({ status: 404, body: '' }); // nothing leaves the test
  });
  const s = await ctx.newPage();
  await s.goto(ORIGIN + '/seed');
  await s.evaluate((seed) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  }, seed);
  await s.close();
  const errors = [];
  const open = async (path = '/index.html') => {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(ORIGIN + path);
    await page.waitForFunction(() => window.__fake, null, { timeout: 30000 });
    return page;
  };
  // a reload the page makes itself (Settings, a source accepted or dropped): wait for the new page's node
  const reloaded = async (page, act) => {
    await Promise.all([page.waitForEvent('load'), act()]);
    await page.waitForFunction(() => window.__fake, null, { timeout: 30000 });
  };
  return { ctx, open, reloaded, errors };
}
const id = (c, i = 0) => (c + i.toString(16).padStart(6, '0')).padEnd(64, c); // distinct for every i
const mtx = (c, i, rate = 2, vsize = 150) => ({
  txid: id(c, i),
  vsize,
  fee: Math.round(vsize * rate),
  feeRate: rate,
  at: Math.floor(Date.now() / 1000) - i,
  inputs: ['ab'.repeat(32) + ':0'],
  outputs: [{ value: 1000, scriptPubKey: '0014' + '11'.repeat(20) }],
  fed: true,
});
// the node's mempool state at 5550637: every transaction compactly in all, the first 1,000 whole in txs
const mp = (txs, o = {}) => ({
  type: 'mempool',
  height: 152100,
  count: txs.length,
  bytes: txs.reduce((a, x) => a + x.vsize, 0),
  fees: txs.reduce((a, x) => a + x.fee, 0),
  stats: { seen: txs.length, accepted: txs.length, refused: 0, dropped: 0 },
  all: txs.map((x) => [x.txid, x.vsize, x.fee, x.at, x.fed ? 1 : 0]),
  txs: txs.slice(0, 1000),
  following: true,
  lastFeedAt: Date.now(),
  feedFileAt: Date.now(),
  ...o,
});
const emit = (page, type, m) => page.evaluate(([type, m]) => window.__fake.emit(type, m), [type, m]);
const text = (page, sel) => page.textContent(sel).catch(() => '');

// 1: a first visit asks before the 830 MB download, before it looks at the lock; Start starts the node with the defaults
{
  const p = await profile();
  const a = await p.open();
  await until(a, () => !!document.querySelector('#welcome[open]'));
  t(
    'a first visit asks before downloading, and starts nothing',
    (await a.evaluate(() => !!document.querySelector('#welcome[open]'))) && (await a.evaluate(() => window.__fake.starts)) === 0,
  );
  t(
    'the node is created with the default sources and options',
    await a.evaluate(
      (d) =>
        window.__fake.opts.blocksUrl === d &&
        /utxo-knots-150307\.dat$/.test(window.__fake.opts.snapshotUrl) &&
        window.__fake.opts.torrent === false,
      DEFAULT_BLOCKS,
    ),
    JSON.stringify(await a.evaluate(() => window.__fake.opts)),
  );
  await a.click('#wl-start');
  await until(a, () => window.__fake.starts === 1 && localStorage.getItem('reef:started'));
  t(
    'Start starts the node, and the answer is remembered (shared with Reef)',
    (await a.evaluate(() => window.__fake.starts)) === 1 && !!(await a.evaluate(() => localStorage.getItem('reef:started'))),
    JSON.stringify(
      await a.evaluate(() => [window.__fake.starts, localStorage.getItem('reef:started'), document.getElementById('syncmsg').textContent]),
    ),
  );
  t('no page errors on a first visit', !p.errors.length, p.errors.join(' | '));
  await p.ctx.close();
}
// 2: a browser that refuses the lock: the consent still comes first, then the refusal is said, and "Run anyway" runs
{
  const p = await profile({}, { config: { lockError: 'the lock manager is unavailable' } });
  const a = await p.open();
  await until(a, () => !!document.querySelector('#welcome[open]'));
  t(
    'with a refused lock, a first visit still asks first (no lock notice before the yes)',
    (await a.evaluate(() => !!document.querySelector('#welcome[open]'))) && !(await a.$('#banners [data-b=lockfail]')),
  );
  await a.click('#wl-start');
  const said = await until(a, () => !!document.querySelector('#banners [data-b=lockfail]'));
  t(
    'then the refused lock is said, with the pill red',
    said && /lock refused/.test(await text(a, '#pilltxt')) && (await a.getAttribute('#pilldot', 'class')) === 'bad',
    await text(a, '#pilltxt'),
  );
  await a.click('#banners [data-b=lockfail] button');
  t('"Run anyway in this tab" starts the node without the lock', await until(a, () => window.__fake.forced === 1));
  t('no page errors with a refused lock', !p.errors.length, p.errors.join(' | '));
  await p.ctx.close();
}
// 3: a returning visit: the mempool, the blocks, the template, the signed tip, focus, search, the feed, an idle tab, a wipe
{
  const p = await profile({ 'reef:started': '1' }, { version: '2099-01-01.1' });
  const a = await p.open();
  await until(a, () => window.__fake.starts === 1);
  await until(a, () => /nothing heard yet|followed once/.test(document.getElementById('proj').textContent));
  t(
    'before the mempool is heard from, the next block says so',
    /followed once|nothing heard yet/.test(await text(a, '#proj')),
    await text(a, '#proj'),
  );
  const txs = Array.from({ length: 5 }, (_, i) => mtx('c', i, 2 + i));
  await emit(a, 'mempool', mp(txs));
  await emit(a, 'synced', { height: 152100, hash: 'dd'.repeat(32), applied: 1 });
  await emit(a, 'synced', { height: 152101, hash: 'ee'.repeat(32), applied: 1 });
  await until(a, () => window.__fake.posts.filter((m) => m.type === 'block').length >= 8);
  const posts = await a.evaluate(() => window.__fake.posts);
  t(
    'up to date: the mempool is followed once, and the last eight blocks are asked for, each once',
    (await a.evaluate(() => window.__fake.follows.length)) === 1 &&
      ((hs) => new Set(hs).size === hs.length && Array.from({ length: 8 }, (_, i) => 152094 + i).every((h) => hs.includes(h)))(
        posts.filter((m) => m.type === 'block' && m.req === 'bight').map((m) => m.height),
      ),
    JSON.stringify(posts.filter((m) => m.type === 'block').map((m) => m.height)),
  );
  // a busy mempool: an event every 300 ms must not hold the template back
  const t0 = Date.now();
  let asked = false;
  for (let i = 0; i < 10 && !asked; i++) {
    await emit(a, 'mempool', mp(txs));
    asked = await until(a, () => window.__fake.posts.some((m) => m.type === 'template'), null, 300);
  }
  t(
    'the next block is asked of the worker within about 2 s, however busy the mempool',
    asked && Date.now() - t0 < 3000,
    `${Date.now() - t0} ms`,
  );
  const tpl = { height: 152102, prevHash: 'ee'.repeat(32), txs: 5, fees: 3000, weight: 3000, rdts: true };
  await emit(a, 'template', { ...tpl, checks: { ok: false, failed: ['btc:rule-x'] } });
  await until(a, () => /btc:rule-x/.test(document.getElementById('m-next').textContent));
  t(
    'a template that fails its checks is said, and the next block has no "✓ built"',
    /fails: btc:rule-x/.test(await text(a, '#m-next')) && !/✓ built/.test(await text(a, '#proj')),
  );
  await emit(a, 'template', { ...tpl, checks: { ok: true, failed: [] } });
  await until(a, () => /✓ built/.test(document.getElementById('proj').textContent));
  t(
    'one that passes on the current tip: "✓ built" on the next block, with the node’s figures',
    /✓ built/.test(await text(a, '#proj')) &&
      /✓ built: 5 tx · 3,000 sat · 750 vB, every rule it checks passes/.test(await text(a, '#m-next')),
    await text(a, '#m-next'),
  );
  await emit(a, 'template', { ...tpl, prevHash: 'ab'.repeat(32), checks: { ok: true, failed: [] } });
  await until(a, () => !/✓ built/.test(document.getElementById('proj').textContent));
  t(
    'one built on another parent at the same height is stale, not "built"',
    /building on the new tip/.test(await text(a, '#m-next')) && !/✓ built/.test(await text(a, '#proj')),
  );
  await emit(a, 'template', { ...tpl, checks: { ok: true, failed: [] } });
  // a block found after the mempool was followed, and after the block before it: one of the seen transactions
  const block = (hash, txid) => ({
    req: 'bight',
    height: 152101,
    hash,
    previousblockhash: 'dd'.repeat(32),
    size: 500,
    nTx: 2,
    header: { time: Math.floor(Date.now() / 1000) },
    txids: ['00'.repeat(32), txid],
  });
  await emit(a, 'block', block('ee'.repeat(32), id('c', 1)));
  await until(a, () => !!document.querySelector('#mined [data-k=h152101]'));
  t('a mined block says how much of it was seen first', /1 of 1 seen first/.test(await text(a, '#mined')), await text(a, '#mined'));
  t(
    'with no signed chain tip, the block is "not signed yet" and the pill is amber, never green',
    /not signed yet/.test(await text(a, '#mined [data-k=h152101]')) &&
      (await a.$eval('#mined [data-k=h152101]', (e) => e.classList.contains('unsigned'))) &&
      (await a.getAttribute('#pilldot', 'class')) === 'warn',
  );
  await emit(a, 'nostr', { height: 152101, hash: 'ee'.repeat(32), agree: 1, diverged: false, live: true });
  await until(
    a,
    () =>
      / signed$/.test(document.getElementById('pilltxt').textContent) &&
      !document.querySelector('#mined [data-k=h152101]').classList.contains('unsigned'),
  );
  t(
    'a signed tip at the node’s height: "signed", green, the block no longer unsigned',
    / · signed$/.test(await text(a, '#pilltxt')) &&
      (await a.getAttribute('#pilldot', 'class')) === 'ok' &&
      !(await a.$eval('#mined [data-k=h152101]', (e) => e.classList.contains('unsigned'))),
    await text(a, '#pilltxt'),
  );
  await emit(a, 'nostr', { height: 152100, hash: 'dd'.repeat(32), agree: 1, diverged: false, live: true });
  await until(
    a,
    () =>
      /1 above/.test(document.getElementById('pilltxt').textContent) &&
      document.querySelector('#mined [data-k=h152101]').classList.contains('unsigned'),
  );
  t(
    'a signed tip one below: "1 above the signed tip", amber, and that block unsigned',
    /1 above the signed tip/.test(await text(a, '#pilltxt')) &&
      (await a.getAttribute('#pilldot', 'class')) === 'warn' &&
      (await a.$eval('#mined [data-k=h152101]', (e) => e.classList.contains('unsigned'))),
  );
  // focus: a focused tile keeps the focus across renders; opening it moves the focus to the detail; Close gives it back
  await a.focus('#mined [data-k=h152101]');
  await emit(a, 'mempool', mp(txs));
  await a.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  t(
    'a focused block tile keeps the focus when the page re-renders',
    await a.evaluate(() => document.activeElement?.dataset.k === 'h152101'),
  );
  await a.keyboard.press('Enter');
  await until(a, () => !document.getElementById('detail').hidden && document.activeElement?.id === 'detail');
  t(
    'opening a block moves the focus to its detail, and the tile says it is expanded',
    (await a.evaluate(() => document.activeElement?.id === 'detail')) &&
      (await a.getAttribute('#mined [data-k=h152101]', 'aria-expanded')) === 'true' &&
      /Block 152,101/.test(await text(a, '#detail')),
  );
  await a.click('#dclose');
  t(
    'Close hides the detail and gives the focus back to the tile',
    (await a.evaluate(() => document.getElementById('detail').hidden && document.activeElement?.dataset.k === 'h152101')) &&
      (await a.getAttribute('#mined [data-k=h152101]', 'aria-expanded')) === 'false',
  );
  // a reorganisation: the tip replaced by another block at the same height
  await emit(a, 'synced', { height: 152101, hash: 'ff'.repeat(32), applied: 1 });
  await until(a, () => !/1 of 1 seen first/.test(document.getElementById('mined').textContent));
  t(
    'a block replaced by a reorganisation is dropped and asked for again',
    !/1 of 1 seen first/.test(await text(a, '#mined')) &&
      (await a.evaluate(() => window.__fake.posts.filter((m) => m.type === 'block' && m.height === 152101).length)) >= 2,
  );
  await emit(a, 'block', block('ff'.repeat(32), id('c', 2)));
  // a mempool whose last transactions the node did not send whole: found by a prefix, asked of the node
  const big = [...Array.from({ length: 1000 }, (_, i) => mtx('d', i, 2 + (i % 50))), mtx('e', 5, 1)];
  await emit(a, 'mempool', mp(big));
  await until(a, () => document.getElementById('m-count').textContent === '1,001');
  t(
    'with every transaction in all, the page sees the whole mempool and says nothing is left out',
    !(await text(a, '#m-cover')) && !/more in the mempool/.test(await text(a, '#proj')),
  );
  await a.fill('#q', 'abc');
  await a.press('#q', 'Enter');
  t('a search that is not a txid, hash or height says what to search', /first 8 or more characters/.test(await text(a, '#detail')));
  await a.fill('#q', id('d', 7));
  await a.press('#q', 'Enter');
  await until(a, (x) => !!document.querySelector(`#rows tr.hi[data-t="${x}"]`), id('d', 7));
  t(
    'a txid in the mempool is shown in the page, and its row stays highlighted after the next render',
    /In this tab's mempool/.test(await text(a, '#detail')) && !!(await a.$(`#rows tr.hi[data-t="${id('d', 7)}"]`)),
    JSON.stringify(
      await a.evaluate(
        (x) => [
          document.getElementById('dtitle')?.textContent,
          document.querySelectorAll('#rows tr').length,
          !!document.querySelector(`#rows tr[data-t="${x}"]`),
          document.querySelector('#rows tr.hi')?.dataset.t,
        ],
        id('d', 7),
      ),
    ),
  );
  await a.fill('#q', id('e', 5).slice(0, 10));
  await a.press('#q', 'Enter');
  const got = await until(
    a,
    () =>
      /In this tab's mempool/.test(document.getElementById('detail').textContent) &&
      !/asking the node/.test(document.getElementById('detail').textContent),
  );
  t(
    'the start of a txid the node sent only compactly is asked of the node (mempool-get) and shown',
    got &&
      (await a.evaluate((x) => window.__fake.posts.some((m) => m.type === 'mempool-get' && m.txid === x), id('e', 5))) &&
      (await text(a, '#detail')).includes(id('e', 5)),
  );
  await a.fill('#q', id('c', 2));
  await a.press('#q', 'Enter');
  t(
    'a txid in a block this tab holds: "Found in block 152,101"',
    await until(a, () => /Found in block 152,101/.test(document.getElementById('detail').textContent)),
  );
  await a.fill('#q', '152101');
  await a.press('#q', 'Enter');
  t(
    'a height this tab holds opens that block',
    await until(a, () => /^Block 152,101/.test(document.getElementById('dtitle')?.textContent ?? '')),
  );
  await a.fill('#q', '9'.repeat(64));
  await a.press('#q', 'Enter');
  t(
    'not found says where it looked: the mempool and the blocks held',
    await until(a, () =>
      /not in this tab's mempool \(1,001 transactions\), and not in blocks 152,\d+–152,101/.test(
        document.getElementById('detail').textContent,
      ),
    ),
    await text(a, '#detail'),
  );
  // a row opens the in-page detail; the external link is separate and labelled
  await a.click(`#rows button[data-open="${id('d', 9)}"]`);
  t(
    'a row’s txid opens the detail in the page; the ↗ beside it names the other site',
    (await until(a, (x) => document.getElementById('detail').textContent.includes(x), id('d', 9))) &&
      /mempool\.guide/.test(await a.getAttribute(`#rows tr[data-t="${id('d', 9)}"] a.ext`, 'aria-label')),
  );
  // the feed's heartbeat
  await emit(a, 'mempool', mp(big, { feedFileAt: Date.now() - 11 * 60e3 }));
  t(
    'a publisher silent for over ten minutes is a notice, and its age is shown',
    (await until(a, () => !!document.querySelector('#banners [data-b=feed]'))) && /min/.test(await text(a, '#s-feed')),
    await text(a, '#s-feed'),
  );
  await emit(a, 'mempool', mp(big));
  t('…which goes when it reports again', await until(a, () => !document.querySelector('#banners [data-b=feed]')));
  // an unresponsive node is a warning that clears itself
  await emit(a, 'unresponsive', {});
  const slow = await until(a, () => !!document.querySelector('#banners [data-b=slow]'));
  t(
    'an unresponsive node: a notice and an amber "not answering"',
    slow && /not answering/.test(await text(a, '#pilltxt')) && (await a.getAttribute('#pilldot', 'class')) === 'warn',
  );
  await emit(a, 'responsive', {});
  t(
    '…cleared when it answers again',
    await until(
      a,
      () => !document.querySelector('#banners [data-b=slow]') && !/not answering/.test(document.getElementById('pilltxt').textContent),
    ),
  );
  // the signed tip disagrees
  await emit(a, 'nostr', { height: 152101, agree: 0, diverged: true });
  t(
    'a signed chain tip that disagrees turns the pill red with a notice',
    (await until(a, () => document.getElementById('pilldot').className === 'bad')) && !!(await a.$('#banners [data-b=chain]')),
  );
  // a second tab while this one holds the lock
  const b = await p.open();
  t(
    'a second tab is idle and says so',
    (await until(b, () => /idle/.test(document.getElementById('pilltxt').textContent), null, 8000)) &&
      !!(await b.$('#banners [data-b=idle]')),
  );
  await b.close();
  // the theme
  await a.click('#theme');
  t('the theme is kept', ['light', 'dark'].includes(await a.evaluate(() => localStorage.getItem('bight:theme'))));
  // a newer release: offered, not forced (checked ten seconds after start)
  t(
    'a newer Bight is offered with a Reload button',
    (await until(a, () => !!document.querySelector('#banners [data-b=update] button'), null, 15000)) &&
      /2099-01-01\.1/.test(await text(a, '#banners [data-b=update]')),
  );
  // a wipe: armed, then done; the consent is forgotten and nothing more is asked of the node
  await a.click('#settings');
  t('Wipe is offered where the node runs', !(await a.isDisabled('#o-wipe')));
  await a.click('#o-wipe');
  t(
    'the first press arms it and says what it removes',
    /press again/.test(await text(a, '#o-wipenote')) && (await a.evaluate(() => window.__fake.wipes)) === 0,
  );
  await a.click('#o-wipe');
  await until(a, () => !!document.querySelector('#banners [data-b=wiped]'));
  const before = await a.evaluate(() => window.__fake.posts.length);
  await emit(a, 'synced', { height: 152102, hash: 'aa'.repeat(32), applied: 1 });
  await a.waitForTimeout(100);
  t(
    'the second wipes: the answer to the download is forgotten, the pill says so, and the node is asked nothing more',
    (await a.evaluate(() => window.__fake.wipes)) === 1 &&
      (await a.evaluate(() => !localStorage.getItem('reef:started') && !localStorage.getItem('bight:started'))) &&
      /wiped/.test(await text(a, '#pilltxt')) &&
      (await a.evaluate(() => window.__fake.posts.length)) === before,
  );
  t('no page errors', !p.errors.length, p.errors.join(' | '));
  await p.ctx.close();
}
// 4: an empty mempool: nothing heard, then empty
{
  const p = await profile({ 'reef:started': '1' });
  const a = await p.open();
  await until(a, () => window.__fake.starts === 1);
  await emit(a, 'synced', { height: 152101, hash: 'ee'.repeat(32), applied: 1 });
  await emit(a, 'mempool', mp([], { feedFileAt: null }));
  t(
    'a mempool with nothing heard yet says so, not "empty"',
    await until(a, () => /nothing heard yet/.test(document.getElementById('rows').textContent)),
  );
  await emit(a, 'mempool', mp([]));
  await emit(a, 'template', {
    height: 152102,
    prevHash: 'ee'.repeat(32),
    txs: 0,
    fees: 0,
    weight: 800,
    rdts: true,
    checks: { ok: true, failed: [] },
  });
  t(
    'once the publisher reports, it is empty, and the next block is the coinbase alone, built',
    (await until(a, () => /the coinbase only/.test(document.getElementById('proj').textContent))) &&
      /the mempool is empty/.test(await text(a, '#rows')),
  );
  t('no page errors with an empty mempool', !p.errors.length, p.errors.join(' | '));
  await p.ctx.close();
}
// 5: in a frame, Wipe is not offered (a page around it could make the click)
{
  const p = await profile({ 'reef:started': '1' });
  const page = await p.ctx.newPage();
  page.on('pageerror', (e) => p.errors.push(e.message));
  await page.goto(ORIGIN + '/frame');
  const f = page.frames().find((x) => x !== page.mainFrame());
  await f.waitForFunction(() => window.__fake?.starts === 1, null, { timeout: 30000 });
  await f.click('#settings');
  t(
    'in a frame, Wipe is disabled and says to open Bight in its own tab',
    (await f.isDisabled('#o-wipe')) && /own tab/.test(await f.textContent('#o-wipenote')),
  );
  await p.ctx.close();
}
// 6: a link that proposes another block source, end to end
{
  const PROPOSED = 'https://other.example/x-blocks';
  const p = await profile({ 'reef:started': '1' });
  const a = await p.open('/index.html?blocks=' + PROPOSED);
  await until(a, () => !!document.querySelector('#banners [data-b=src-blocks]'));
  t(
    'a source proposed by a link is not used without a yes',
    !!(await a.$('#banners [data-b=src-blocks]')) && (await a.evaluate(() => window.__fake.opts.blocksUrl)) === DEFAULT_BLOCKS,
  );
  await a.click('#settings');
  t('Settings shows the stored source, not the link’s', (await a.inputValue('#o-blocks')) === DEFAULT_BLOCKS);
  await a.click('#o-torrent');
  await a.click('#o-ok');
  t(
    'pressing OK for another setting does not store the link’s source',
    (await a.evaluate(() => localStorage.getItem('bight:blocks'))) === null,
  );
  await p.reloaded(a, () => a.click('#banners [data-b=src-blocks] button'));
  t(
    'with a yes, this visit uses it, says so for as long as it does, and keeps the query on reload',
    (await a.evaluate(() => window.__fake.opts.blocksUrl)) === PROPOSED &&
      (await until(a, () => !!document.querySelector('#banners [data-b=custom-src]'))) &&
      /other\.example/.test(await text(a, '#banners [data-b=custom-src]')),
    JSON.stringify(await a.evaluate(() => [window.__fake.opts.blocksUrl, location.search])),
  );
  t('…and stores nothing', (await a.evaluate(() => localStorage.getItem('bight:blocks'))) === null);
  await p.reloaded(a, () => a.click('#banners [data-b=custom-src] button'));
  t(
    '"Back to the default" drops it: the default source, no notice, no query',
    (await a.evaluate(() => window.__fake.opts.blocksUrl)) === DEFAULT_BLOCKS &&
      !(await a.$('#banners [data-b=custom-src]')) &&
      !(await a.evaluate(() => location.search.includes('blocks='))),
  );
  t('no page errors with a proposed source', !p.errors.length, p.errors.join(' | '));
  await p.ctx.close();
}
// 7: a source Reef stored: used, said, shown in Settings, and Reset → OK puts the default back for Bight
{
  const REEF = 'https://reef.example/r-blocks';
  const p = await profile({ 'reef:started': '1', 'reef:blocks': REEF });
  const a = await p.open();
  t(
    'a source Reef stored is used, and said',
    (await a.evaluate(() => window.__fake.opts.blocksUrl)) === REEF &&
      (await until(a, () => !!document.querySelector('#banners [data-b=custom-src]'))),
  );
  await a.click('#settings');
  t('Settings shows it', (await a.inputValue('#o-blocks')) === REEF);
  await a.click('#o-reset');
  t('Reset fills the defaults', (await a.inputValue('#o-blocks')) === DEFAULT_BLOCKS);
  await p.reloaded(a, () => a.click('#o-ok'));
  t(
    'OK stores the default for Bight over Reef’s (Reef’s own setting untouched), and the node uses it',
    (await a.evaluate(() => localStorage.getItem('bight:blocks'))) === DEFAULT_BLOCKS &&
      (await a.evaluate(() => localStorage.getItem('reef:blocks'))) === REEF &&
      (await a.evaluate(() => window.__fake.opts.blocksUrl)) === DEFAULT_BLOCKS &&
      !(await a.$('#banners [data-b=custom-src]')),
  );
  await a.click('#settings');
  await a.fill('#o-blocks', 'http://plain.example/x');
  await a.click('#o-ok');
  t(
    'an address that is not https:// is refused in words, and nothing is stored',
    /https:\/\//.test(await text(a, '#o-err')) && (await a.evaluate(() => localStorage.getItem('bight:blocks'))) === DEFAULT_BLOCKS,
  );
  t('no page errors in Settings', !p.errors.length, p.errors.join(' | '));
  await p.ctx.close();
}
await browser.close();
console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
