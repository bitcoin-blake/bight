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
    // version.json as the web server sends it, with its Date (the server's clock, here 30 s behind this browser's)
    if (version && u.startsWith(ORIGIN + '/version.json'))
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ version }),
        headers: { date: new Date(Date.now() - 30000).toUTCString(), 'access-control-expose-headers': 'date' },
      });
    // a page on another site that frames Bight
    if (u === 'http://127.0.0.1:8798/xframe')
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html><iframe src="${ORIGIN}/index.html" width="900" height="700"></iframe>`,
      });
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
// the node's mempool state at b54e498: every transaction compactly in all, the first 1,000 whole in txs
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
// the req the page sent with its latest request for a height (it carries the page's generation)
const reqFor = (page, height) =>
  page.evaluate((h) => window.__fake.posts.filter((m) => m.type === 'block' && m.height === h).at(-1)?.req ?? null, height);
// a block reply for a height, with the req the page asked it with
const reply = async (page, b) => emit(page, 'block', { ...b, req: await reqFor(page, b.height) });
const text = (page, sel) => page.textContent(sel).catch(() => '');

// 1: a first visit asks before the 870 MB download, before it looks at the lock; Start starts the node with the defaults
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
        posts.filter((m) => m.type === 'block' && /^bight:\d+$/.test(m.req)).map((m) => m.height),
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
  await emit(a, 'template', { ...tpl, checks: { ok: true, failed: [] }, mempool: { count: 4 } });
  await until(a, () => /different mempool/.test(document.getElementById('m-next').textContent));
  t(
    'one built from another mempool than the page shows: said with both counts, and no "✓ built"',
    /^built on a different mempool \(4 tx in the node's, 5 here\)/.test(await text(a, '#m-next')) &&
      !/✓ built/.test(await text(a, '#proj')) &&
      /built on a different mempool/.test(await text(a, '#proj')),
    await text(a, '#m-next'),
  );
  await emit(a, 'template', { ...tpl, checks: { ok: true, failed: [] } });
  // a block found after the mempool was followed, and after the block before it: one of the seen transactions
  const block = (hash, txid) => ({
    height: 152101,
    hash,
    previousblockhash: 'dd'.repeat(32),
    size: 500,
    nTx: 2,
    header: { time: Math.floor(Date.now() / 1000) },
    txids: ['00'.repeat(32), txid],
  });
  await reply(a, block('ee'.repeat(32), id('c', 1)));
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
  t(
    'Close sits in the detail’s header, beside its title',
    await a.evaluate(() => !!document.querySelector('#detail .dhead #dtitle + #dclose')),
  );
  await a.click('#dclose');
  t(
    'Close hides the detail and gives the focus back to the tile',
    (await a.evaluate(() => document.getElementById('detail').hidden && document.activeElement?.dataset.k === 'h152101')) &&
      (await a.getAttribute('#mined [data-k=h152101]', 'aria-expanded')) === 'false',
  );
  // Escape closes it too, and gives the focus back the same way
  await a.keyboard.press('Enter');
  await until(a, () => document.activeElement?.id === 'detail');
  await a.keyboard.press('Escape');
  t(
    'Escape closes the detail and gives the focus back to the tile',
    await until(a, () => document.getElementById('detail').hidden && document.activeElement?.dataset.k === 'h152101'),
  );
  // a projected tile says when it is the one open
  await a.click('#proj [data-k=p0]');
  t(
    'a projected block open: its tile is expanded and selected',
    (await until(a, () => document.querySelector('#proj [data-k=p0]')?.getAttribute('aria-expanded') === 'true')) &&
      (await a.$eval('#proj [data-k=p0]', (e) => e.classList.contains('sel'))),
  );
  await a.click('#dclose');
  // a reorganisation: the tip replaced by another block at the same height
  const oldReq = await reqFor(a, 152101);
  await emit(a, 'synced', { height: 152101, hash: 'ff'.repeat(32), applied: 1 });
  await until(a, () => !/1 of 1 seen first/.test(document.getElementById('mined').textContent));
  t(
    'a block replaced by a reorganisation is dropped and asked for again, under a new generation',
    !/1 of 1 seen first/.test(await text(a, '#mined')) &&
      (await a.evaluate(() => window.__fake.posts.filter((m) => m.type === 'block' && m.height === 152101).length)) >= 2 &&
      (await reqFor(a, 152101)) !== oldReq,
  );
  // a late answer to the request from before the reorganisation: ignored
  await emit(a, 'block', { ...block('ee'.repeat(32), id('c', 1)), req: oldReq });
  await a.waitForTimeout(150);
  t('a late reply asked on the replaced branch is ignored', !(await a.$('#mined [data-k=h152101]')));
  await reply(a, block('ff'.repeat(32), id('c', 2)));
  t('…and the reply under the new generation is kept', await until(a, () => !!document.querySelector('#mined [data-k=h152101]')));
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
  await a.fill('#q', '152,101');
  await a.press('#q', 'Enter');
  t(
    'a height this tab holds opens that block (written with a comma)',
    await until(a, () => /^Block 152,101/.test(document.getElementById('dtitle')?.textContent ?? '')),
  );
  // a height between the snapshot and the tip that the tab does not hold: asked of the node, and shown
  await a.fill('#q', '151000');
  await a.press('#q', 'Enter');
  const askedOld = await until(a, () =>
    window.__fake.posts.some((m) => m.type === 'block' && m.height === 151000 && /^bight:s\d+\.\d+$/.test(m.req)),
  );
  await reply(a, {
    height: 151000,
    hash: '5a'.repeat(32),
    previousblockhash: '5b'.repeat(32),
    size: 300,
    nTx: 1,
    header: { time: 1 },
    txids: ['00'.repeat(32)],
  });
  t(
    'an older height is asked of the node and opened when it answers, kept apart from the tiles',
    askedOld &&
      (await until(a, () => /^Block 151,000/.test(document.getElementById('dtitle')?.textContent ?? ''))) &&
      !(await a.$('#mined [data-k=h151000]')),
  );
  await a.fill('#q', '150000');
  await a.press('#q', 'Enter');
  t(
    'a height before the snapshot is said to be before it, and nothing is asked',
    (await until(a, () => /before the snapshot at 150,307/.test(document.getElementById('detail').textContent))) &&
      !(await a.evaluate(() => window.__fake.posts.some((m) => m.type === 'block' && m.height === 150000))),
  );
  await a.fill('#q', '999999');
  await a.press('#q', 'Enter');
  t(
    'a height above the tip is said to be above it',
    await until(a, () => /above this tab's tip/.test(document.getElementById('detail').textContent)),
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
  await a.focus(`#rows button[data-open="${id('d', 9)}"]`);
  await a.keyboard.press('Enter');
  t(
    'a row’s txid opens the detail in the page, with where it would go; the ↗ beside it names the other site',
    (await until(a, (x) => document.getElementById('detail').textContent.includes(x), id('d', 9))) &&
      /Projected/.test(await text(a, '#detail')) &&
      /mempool\.guide/.test(await a.getAttribute(`#rows tr[data-t="${id('d', 9)}"] a.ext`, 'aria-label')),
  );
  await a.click('#dclose');
  t('Close gives the focus back to the row that opened it', await until(a, (x) => document.activeElement?.dataset.open === x, id('d', 9)));
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
    'a second tab is idle and says so once: the card with "Check again", no notice repeating it, the status bar only "idle"',
    (await until(b, () => /idle/.test(document.getElementById('pilltxt').textContent), null, 8000)) &&
      (await b.isVisible('#idle-check')) &&
      !(await b.$('#banners [data-b=idle]')) &&
      (await text(b, '#syncmsg')) === 'idle',
    (await text(b, '#banners')) + ' | ' + (await text(b, '#syncmsg')),
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
  await p.reloaded(a, () => a.click('#o-wipe'));
  t(
    'the second wipes, and the page reloads (the node’s worker and timers end with it); the answer to the download is forgotten, so it asks again',
    (await a.evaluate(() => !localStorage.getItem('reef:started') && !localStorage.getItem('bight:started'))) &&
      (await until(a, () => !!document.querySelector('#welcome[open]'))) &&
      (await a.evaluate(() => window.__fake.starts)) === 0,
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
  await a.waitForTimeout(100);
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
  await a.click('#settings');
  t(
    'after the yes, Settings still shows the stored source, not the one this visit uses',
    (await a.inputValue('#o-blocks')) === DEFAULT_BLOCKS,
  );
  await a.click('#o-ok');
  await a.waitForTimeout(100);
  t(
    '…and OK with nothing changed stores nothing and keeps the visit’s source',
    (await a.evaluate(() => localStorage.getItem('bight:blocks'))) === null &&
      (await a.evaluate(() => window.__fake.opts.blocksUrl)) === PROPOSED &&
      !(await a.evaluate(() => document.getElementById('dlg').open)),
  );
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
    'OK stores "default" for Bight over Reef’s (Reef’s own setting untouched), and the node uses the default',
    (await a.evaluate(() => localStorage.getItem('bight:blocks'))) === 'default' &&
      (await a.evaluate(() => localStorage.getItem('reef:blocks'))) === REEF &&
      (await a.evaluate(() => window.__fake.opts.blocksUrl)) === DEFAULT_BLOCKS &&
      !(await a.$('#banners [data-b=custom-src]')),
  );
  await a.click('#settings');
  await a.fill('#o-blocks', 'http://plain.example/x');
  await a.click('#o-ok');
  t(
    'an address that is not https:// is refused in words, and nothing is stored',
    /https:\/\//.test(await text(a, '#o-err')) && (await a.evaluate(() => localStorage.getItem('bight:blocks'))) === 'default',
  );
  t('no page errors in Settings', !p.errors.length, p.errors.join(' | '));
  await p.ctx.close();
}
// 8: the real order, on a controlled clock: the first sync (a catch-up of many blocks), the mempool followed, then blocks one
// at a time; a catch-up of several after a gap; a gap in listening (the timer late, as after sleep)
{
  const p = await profile({ 'reef:started': '1' });
  const a = await p.open();
  await until(a, () => window.__fake.starts === 1);
  const T0 = Date.UTC(2026, 9, 1, 12);
  const at = (ms) => a.clock.setFixedTime(T0 + ms);
  const X = mtx('7', 1, 5);
  const blk = (h, txids) => ({
    height: h,
    hash: h.toString(16).padStart(64, '0'),
    previousblockhash: (h - 1).toString(16).padStart(64, '0'),
    size: 400,
    nTx: txids.length + 1,
    header: { time: Math.floor(T0 / 1000) - 3600 },
    txids: ['00'.repeat(32), ...txids],
  });
  await at(0);
  await emit(a, 'synced', { height: 152099, hash: (152099).toString(16).padStart(64, '0'), applied: 1792 });
  await at(1000);
  await emit(a, 'mempool', mp([X]));
  await at(2000);
  await emit(a, 'synced', { height: 152100, hash: (152100).toString(16).padStart(64, '0'), applied: 1 });
  await at(3000);
  await emit(a, 'synced', { height: 152101, hash: (152101).toString(16).padStart(64, '0'), applied: 1 });
  await until(a, () => window.__fake.posts.filter((m) => m.type === 'block' && m.height === 152101).length > 0);
  for (const h of [152099, 152100]) await reply(a, blk(h, []));
  await reply(a, blk(152101, [X.txid]));
  await until(a, () => !!document.querySelector('#mined [data-k=h152101]'));
  await at(13000);
  await emit(a, 'mempool', mp([X]));
  await until(a, () => /10 s ago/.test(document.querySelector('#mined [data-k=h152101]')?.textContent ?? ''));
  t(
    'a block that arrived on its own after the listening began, after one that did too: counted',
    /1 of 1 seen first/.test(await text(a, '#mined [data-k=h152101]')),
    await text(a, '#mined [data-k=h152101]'),
  );
  t(
    'its age is from when it reached this tab (10 s), not its header (an hour)',
    /10 s ago/.test(await text(a, '#mined [data-k=h152101]')),
    await text(a, '#mined [data-k=h152101]'),
  );
  t(
    'the block from the first sync is aged by its header, and says so',
    /header 1\.0 h ago/.test(await text(a, '#mined [data-k=h152099]')),
    await text(a, '#mined [data-k=h152099]'),
  );
  // a catch-up of two after a gap: neither counted, though the transaction was heard
  await at(20000);
  await emit(a, 'synced', { height: 152103, hash: (152103).toString(16).padStart(64, '0'), applied: 2 });
  await until(a, () => window.__fake.posts.some((m) => m.type === 'block' && m.height === 152103));
  await reply(a, blk(152102, []));
  await reply(a, blk(152103, [X.txid]));
  t(
    'blocks that came in one catch-up are not counted ("not listening then")',
    (await until(a, () => /not listening then/.test(document.querySelector('#mined [data-k=h152103]')?.textContent ?? ''))) &&
      !/seen first/.test(await text(a, '#mined [data-k=h152103]')),
    await text(a, '#mined [data-k=h152103]'),
  );
  // the timer comes back three minutes late (asleep): the next block's predecessor arrived before the gap, so it is not counted
  const sync1 = (h) => emit(a, 'synced', { height: h, hash: h.toString(16).padStart(64, '0'), applied: 1 });
  await at(25000);
  await sync1(152104);
  await at(200000);
  await a.waitForTimeout(5500); // one tick of the page's 5 s timer sees the clock jump
  await at(201000);
  await sync1(152105);
  await at(202000);
  await sync1(152106);
  await until(a, () => window.__fake.posts.some((m) => m.type === 'block' && m.height === 152106));
  for (const h of [152104, 152105, 152106]) await reply(a, blk(h, [X.txid]));
  await until(a, () => !!document.querySelector('#mined [data-k=h152106]'));
  t(
    'after a gap in listening, the first block whose predecessor came before it is not counted; the next one is',
    /not listening then/.test(await text(a, '#mined [data-k=h152105]')) && /seen first/.test(await text(a, '#mined [data-k=h152106]')),
    (await text(a, '#mined [data-k=h152105]')) + ' | ' + (await text(a, '#mined [data-k=h152106]')),
  );
  // waking with a block the node applied during sleep, before any timer ran: the sync itself sees the gap, so that block
  // (alone in its pass) was not watched arriving and is not counted, nor is the next; the one after is
  await at(400000);
  await sync1(152107);
  await at(401000);
  await sync1(152108);
  await at(402000);
  await sync1(152109);
  // a background tab: its timer runs once a minute, which is not a gap; a block after that minute still counts
  await at(462000);
  await a.waitForTimeout(5500);
  await at(462500);
  await sync1(152110);
  await until(a, () => window.__fake.posts.some((m) => m.type === 'block' && m.height === 152110));
  for (const h of [152107, 152108, 152109, 152110]) await reply(a, blk(h, [X.txid]));
  await until(a, () => !!document.querySelector('#mined [data-k=h152110]'));
  const tile = (h) => text(a, `#mined [data-k=h${h}]`);
  t(
    'a block applied while asleep is not counted though it came alone (the sync sees the gap first); the next, watched arriving, heard only part of its interval; counting resumes after',
    /not listening then/.test(await tile(152107)) &&
      /listening for only part of its interval/.test(await tile(152108)) &&
      /seen first/.test(await tile(152109)),
    [await tile(152107), await tile(152108), await tile(152109)].join(' | '),
  );
  t(
    'a minute without a timer (a background tab) is not a gap: the next block counts',
    /seen first/.test(await tile(152110)),
    await tile(152110),
  );
  t('no page errors on the controlled clock', !p.errors.length, p.errors.join(' | '));
  await p.ctx.close();
}
// 9: "Not now", then a change of mind from the notice
{
  const p = await profile();
  const a = await p.open();
  await until(a, () => !!document.querySelector('#welcome[open]'));
  await a.click('#wl-later');
  t(
    '"Not now" puts the focus on the notice’s way to start later, not on the page',
    await until(a, () => document.activeElement?.closest?.('#banners [data-b=welcome]') != null),
  );
  t(
    '"Not now" starts nothing and leaves a notice to start later',
    (await until(a, () => !!document.querySelector('#banners [data-b=welcome] button'))) &&
      (await a.evaluate(() => window.__fake.starts)) === 0 &&
      !(await a.evaluate(() => localStorage.getItem('reef:started'))),
  );
  await a.click('#banners [data-b=welcome] button');
  await until(a, () => !!document.querySelector('#welcome[open]'));
  await a.click('#wl-start');
  t(
    'a change of mind: Start from the notice starts the node and remembers the answer; the notice goes',
    (await until(a, () => window.__fake.starts === 1)) &&
      !!(await a.evaluate(() => localStorage.getItem('reef:started'))) &&
      !(await a.$('#banners [data-b=welcome]')),
  );
  t('no page errors on a change of mind', !p.errors.length, p.errors.join(' | '));
  await p.ctx.close();
}
// 10: framed by a page on another site: no download, no lock override, no source chosen there; it says to open Bight in its tab
{
  const p = await profile({}, { config: { lockError: 'refused' } });
  const page = await p.ctx.newPage();
  page.on('pageerror', (e) => p.errors.push(e.message));
  await page.goto('http://127.0.0.1:8798/xframe');
  const f = page.frames().find((x) => x !== page.mainFrame());
  await f.waitForFunction(() => window.__fake && !!document.querySelector('#welcome[open]'), null, { timeout: 30000 });
  t('framed by another site, Start becomes "Open Bight in its own tab"', /own tab/.test(await f.textContent('#wl-start')));
  const popup = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
  await f.click('#wl-start');
  const opened = await popup;
  t(
    '…which opens it in a tab and starts nothing here',
    !!opened && (await f.evaluate(() => window.__fake.starts)) === 0 && !(await f.evaluate(() => localStorage.getItem('reef:started'))),
  );
  await opened?.close();
  t('no page errors in a frame on another site', !p.errors.length, p.errors.join(' | '));
  await p.ctx.close();
}
// 11: the node's figures and changes while a detail is open: the clock's offset, the fees a coinbase claimed, a
// transaction a node's mempool takes, a reorganisation under an open block, a late reply below the tip, Escape from a tile,
// and the block row centred on the chain tip at phone width
{
  const p = await profile({ 'reef:started': '1' }, { version: '2026-01-01.1' });
  const a = await p.open();
  await a.setViewportSize({ width: 390, height: 844 });
  await until(a, () => window.__fake.starts === 1);
  t(
    'the clock’s offset against the web server (its Date) is given to the node once it runs',
    await until(a, () => window.__fake.skews.some((s) => Math.abs(s - 30) <= 3)),
    JSON.stringify(await a.evaluate(() => window.__fake.skews)),
  );
  const Y = { ...mtx('9', 1, 3), fed: false };
  const many = Array.from({ length: 3000 }, (_, i) => mtx('8', i, 1 + (i % 40), 400));
  await emit(a, 'mempool', mp([Y, ...many]));
  const hx = (h, c = 'a') => (c + h.toString(16)).padStart(64, '0');
  await emit(a, 'synced', { height: 152101, hash: hx(152101), applied: 1 });
  await until(a, () => window.__fake.posts.filter((m) => m.type === 'block').length >= 8);
  for (let h = 152094; h <= 152101; h++)
    await reply(a, {
      height: h,
      hash: hx(h),
      previousblockhash: hx(h - 1),
      size: 400,
      nTx: 1,
      header: { time: Math.floor(Date.now() / 1000) - (152101 - h) * 1200 },
      txids: ['00'.repeat(32)],
      coinbaseValue: 5e9 + 450,
    });
  await until(a, () => !!document.querySelector('#mined [data-k=h152101]'));
  t(
    'a block with no transaction this tab knew shows the fees its coinbase claimed (its value less the subsidy)',
    /450 sat in fees/.test(await text(a, '#mined [data-k=h152101]')) &&
      /450 sat in fees claimed by its coinbase/.test(await a.getAttribute('#mined [data-k=h152101]', 'aria-label')),
    await text(a, '#mined [data-k=h152101]'),
  );
  t(
    'at phone width the row opens on the next block and the chain tip, not the far end of the projections',
    await until(a, () => {
      const r = document.getElementById('blocksrow');
      const d = r.querySelector('.divider').getBoundingClientRect();
      const box = r.getBoundingClientRect();
      return r.scrollLeft > 0 && d.left >= box.left && d.right <= box.right;
    }),
  );
  await a.click('#mined [data-k=h152101]');
  await until(a, () => /Fees claimed by its coinbase/.test(document.getElementById('detail').textContent));
  t('the block detail names the fees its coinbase claimed', /Fees claimed by its coinbase450 sat/.test(await text(a, '#detail')));
  // a reorganisation while that block is open: said in its place, then the new block shown, without moving the focus
  const oldReq = await reqFor(a, 152100);
  await emit(a, 'synced', { height: 152101, hash: hx(152101, 'b'), applied: 2 });
  t(
    'a reorganisation under an open block: the detail says it was replaced, not "validated"',
    (await until(a, () => /replaced by a reorganisation/.test(document.getElementById('detail').textContent))) &&
      !/Validated by/.test(await text(a, '#detail')),
    await text(a, '#detail'),
  );
  await reply(a, {
    height: 152101,
    hash: hx(152101, 'b'),
    previousblockhash: hx(152100, 'b'),
    size: 400,
    nTx: 1,
    header: { time: Math.floor(Date.now() / 1000) },
    txids: ['00'.repeat(32)],
  });
  t(
    '…and the new block is shown there when the node answers',
    await until(a, (h) => document.getElementById('detail').textContent.includes(h), hx(152101, 'b')),
  );
  // a late reply, below the tip, asked before the reorganisation: ignored (the old generation), not kept as a tile
  await emit(a, 'block', {
    height: 152100,
    hash: hx(152100),
    previousblockhash: hx(152099),
    size: 400,
    nTx: 1,
    header: { time: 1 },
    txids: ['00'.repeat(32)],
    req: oldReq,
  });
  await a.waitForTimeout(200);
  t('a late reply below the tip from the replaced branch is ignored', !(await a.$('#mined [data-k=h152100]')));
  // Escape from a tile (the focus outside the detail) closes it
  await a.focus('#mined [data-k=h152101]');
  await a.keyboard.press('Escape');
  t('Escape closes the detail from a tile too', await until(a, () => document.getElementById('detail').hidden));
  // a transaction a node's mempool takes while it is open: the detail says so without moving the focus
  await a.fill('#q', Y.txid);
  await a.press('#q', 'Enter');
  await until(a, () => /In this tab's mempool/.test(document.getElementById('detail').textContent));
  t('a transaction heard only from a relay does not say a node has it', !/from a node’s mempool/.test(await text(a, '#detail')));
  await a.focus('#q');
  await emit(a, 'mempool', mp([{ ...Y, fed: true }, ...many]));
  t(
    '…and says so once a node’s mempool takes it (the open detail is refreshed, the focus stays)',
    (await until(a, () => /from a node’s mempool/.test(document.getElementById('detail').textContent))) &&
      (await a.evaluate(() => document.activeElement?.id === 'q')),
  );
  // a digit-only start of an id is searched as an id, not read as a height
  await a.fill('#q', '00000000');
  await a.press('#q', 'Enter');
  t(
    'eight zeros are the start of a block hash, not block 0',
    await until(a, () => !/block 0 is/.test(document.getElementById('detail').textContent) && !document.getElementById('detail').hidden),
    await text(a, '#detail'),
  );
  t('no page errors with the node’s new figures', !p.errors.length, p.errors.join(' | '));
  await p.ctx.close();
}
// 12: a wipe that fails the way the loader's does when no node answers: no frozen "up to date" over a stopped node
{
  const p = await profile({ 'reef:started': '1' }, { config: { wipeFail: true } });
  const a = await p.open();
  await until(a, () => window.__fake.starts === 1);
  await emit(a, 'synced', { height: 152101, hash: 'ee'.repeat(32), applied: 1 });
  await until(a, () => /up to date/.test(document.getElementById('pilltxt').textContent));
  await a.click('#settings');
  await a.click('#o-wipe');
  await a.click('#o-wipe');
  t(
    'a failed wipe: said in Settings, a notice that the node stopped, and the pill red',
    (await until(a, () => /not wiped/.test(document.getElementById('o-wipenote').textContent))) &&
      (await until(a, () => !!document.querySelector('#banners [data-b=fatal]'))) &&
      /stopped/.test(await text(a, '#pilltxt')) &&
      (await a.getAttribute('#pilldot', 'class')) === 'bad',
    (await text(a, '#pilltxt')) + ' | ' + (await text(a, '#banners')),
  );
  await a.evaluate(() => document.getElementById('dlg').close());
  await a.waitForTimeout(5600); // a render and a tick: pill() must not add the node's own error beside the fatal notice
  t(
    'the stop is said in one notice, not two with the same words',
    (await a.evaluate(() => document.querySelectorAll('#banners .banner.bad').length)) === 1,
    await text(a, '#banners'),
  );
  t('no page errors after a failed wipe', !p.errors.length, p.errors.join(' | '));
  await p.ctx.close();
}
// 13: a wipe that leaves files behind: named, and the reload left to the person
{
  const p = await profile({ 'reef:started': '1' }, { config: { wipeLeaves: ['blocks.dat'] } });
  const a = await p.open();
  await until(a, () => window.__fake.starts === 1);
  await emit(a, 'synced', { height: 152101, hash: 'ee'.repeat(32), applied: 1 });
  await a.click('#settings');
  await a.click('#o-wipe');
  await a.click('#o-wipe');
  t(
    'a wipe that left a file names it, and the pill says wiped',
    (await until(a, () => /blocks\.dat/.test(document.querySelector('#banners [data-b=wiped]')?.textContent ?? ''))) &&
      /wiped/.test(await text(a, '#pilltxt')),
  );
  await p.ctx.close();
}
// 14: "Run anyway" never skips the welcome: the answer was forgotten (a wipe in another tab) before it was pressed
{
  const p = await profile({ 'reef:started': '1' }, { config: { lockError: 'refused' } });
  const a = await p.open();
  await until(a, () => !!document.querySelector('#banners [data-b=lockfail] button'));
  await a.evaluate(() => {
    localStorage.removeItem('reef:started');
    localStorage.removeItem('bight:started');
  });
  await a.click('#banners [data-b=lockfail] button');
  t(
    'Run anyway with no answer to the download asks first, and starts nothing',
    (await until(a, () => !!document.querySelector('#welcome[open]'))) && (await a.evaluate(() => window.__fake.forced)) === 0,
  );
  await p.ctx.close();
}
// 15: what counts as watched arriving, on a controlled clock: never a block the first sync applied (it replays the files),
// never the first sync after a gap the timer, the browser's online event or a resumed tab saw first; and the publisher's
// heartbeat from a clock ahead of this one is taken as now, so its silence is still noticed
{
  const p = await profile({ 'reef:started': '1' });
  const a = await p.open();
  await until(a, () => window.__fake.starts === 1);
  const T0 = Date.UTC(2026, 9, 1, 12);
  const at = (ms) => a.clock.setFixedTime(T0 + ms);
  const hx = (h) => h.toString(16).padStart(64, '0');
  const blk = (h) => ({
    height: h,
    hash: hx(h),
    previousblockhash: hx(h - 1),
    size: 400,
    nTx: 1,
    header: { time: Math.floor(T0 / 1000) - 3600 },
    txids: ['00'.repeat(32)],
  });
  const tile = (h) => text(a, `#mined [data-k=h${h}]`);
  const sync1 = async (h) => {
    await emit(a, 'synced', { height: h, hash: hx(h), applied: 1 });
    await until(a, (h) => window.__fake.posts.some((m) => m.type === 'block' && m.height === h), h);
    await reply(a, blk(h));
    await until(a, (h) => !!document.querySelector(`#mined [data-k=h${h}]`), h);
  };
  await at(0);
  await sync1(152200);
  // an empty next block before the mempool is followed: not "built", whatever the node's build says
  await emit(a, 'template', {
    height: 152201,
    hash: 'ab'.repeat(32),
    prevHash: hx(152200),
    txs: 0,
    fees: 0,
    weight: 4000,
    rdts: true,
    checks: { ok: true, failed: [] },
  });
  await a.waitForTimeout(300);
  t('before the mempool is heard, an empty next block is not "built"', !/built/.test(await text(a, '#proj')), await text(a, '#proj'));
  t(
    'a block the first sync applied alone was replayed, not watched arriving: aged by its header',
    /header/.test(await tile(152200)),
    await tile(152200),
  );
  await at(1000);
  await emit(a, 'mempool', mp([], { feedFileAt: T0 }));
  await at(2000);
  await sync1(152201);
  t('a block applied alone while listening was watched arriving: aged from then', !/header/.test(await tile(152201)), await tile(152201));
  // asleep: the page's timer sees the gap before the wake sync answers
  await at(300000);
  await a.waitForTimeout(5500);
  await at(301000);
  await sync1(152202);
  t(
    'after a gap the timer saw first, the wake sync’s block is a catch-up: aged by its header',
    /header/.test(await tile(152202)),
    await tile(152202),
  );
  await at(302000);
  await sync1(152203);
  t('…and the sync after it is watched again', !/header/.test(await tile(152203)), await tile(152203));
  await a.evaluate(() => dispatchEvent(new Event('online')));
  await at(303000);
  await sync1(152204);
  t('after the browser is online again, the next sync is a catch-up', /header/.test(await tile(152204)), await tile(152204));
  await a.evaluate(() => document.dispatchEvent(new Event('resume')));
  await at(304000);
  await sync1(152205);
  t('after a frozen tab resumes, the next sync is a catch-up', /header/.test(await tile(152205)), await tile(152205));
  // a heartbeat from a clock half an hour ahead is taken as now: eleven minutes later its silence is said
  await at(400000);
  await emit(a, 'mempool', mp([], { feedFileAt: T0 + 400000 + 30 * 60e3 }));
  await at(400000 + 11 * 60e3);
  t(
    'a publisher’s heartbeat from a clock ahead is taken as now, so eleven minutes of silence is still said',
    await until(a, () => !!document.querySelector('#banners [data-b=feed]'), null, 12000),
    await text(a, '#banners'),
  );
  t('no page errors on the controlled clock (round 5)', !p.errors.length, p.errors.join(' | '));
  await p.ctx.close();
}
// 16: "Block not found" answers the oldest block request out (a tile's before the search's); a reorganisation asks a
// waiting search again under the new generation; a hidden tab asks no template until shown; the caps (blocks kept,
// refusals listed); a reply for another transaction than the one asked; the projected column; a stopped node asked nothing
{
  const p = await profile({ 'reef:started': '1' });
  const a = await p.open();
  await until(a, () => window.__fake.starts === 1);
  const hx = (h, c = '0') => c + h.toString(16).padStart(63, '0');
  const blk = (h, c = '0') => ({
    height: h,
    hash: hx(h, c),
    previousblockhash: hx(h - 1, c),
    size: 400,
    nTx: 1,
    header: { time: Math.floor(Date.now() / 1000) - 60 },
    txids: ['00'.repeat(32)],
  });
  const H = 152300;
  const many = Array.from({ length: 3000 }, (_, i) => mtx('6', i, 1 + (i % 40), 400));
  await emit(a, 'mempool', mp(many));
  await emit(a, 'synced', { height: H, hash: hx(H), applied: 1 });
  await until(a, () => window.__fake.posts.filter((m) => m.type === 'block').length >= 8);
  // on the real clock, with no gap: the block the first sync applied alone was replayed from the files, not watched arriving
  await reply(a, blk(H));
  t(
    'on a steady clock too, the first sync’s block is aged by its header, not watched arriving',
    await until(a, (h) => /header/.test(document.querySelector(`#mined [data-k=h${h}]`)?.textContent ?? ''), H),
    await text(a, `#mined [data-k=h${H}]`),
  );
  // the projected column: in the next block, in a later projected one
  await until(a, () => document.querySelectorAll('#rows tr').length > 100);
  const col = await a.evaluate(() => [...document.querySelectorAll('#rows tr td:last-child')].map((td) => td.textContent));
  t(
    'the table says which projected block each transaction is in: next, #2…',
    col.includes('next') && col.includes('#2'),
    [...new Set(col)].join(','),
  );
  // a tile's request is out when the search asks: the node's "Block not found" for that tile is not the search's answer
  await a.fill('#q', '152000');
  await a.press('#q', 'Enter');
  await until(a, () => window.__fake.posts.some((m) => m.type === 'block' && m.height === 152000));
  // the node's error for a tile's request (its req echoed), and one with no req at all: neither is the search's answer
  await emit(a, 'error', { text: 'Block not found', req: await reqFor(a, H - 1) });
  await emit(a, 'error', { text: 'Block not found' });
  await a.waitForTimeout(200);
  t(
    'a "Block not found" for a tile’s request, or for none, is not taken as the search’s answer',
    /asking the node for block 152,000/.test(await text(a, '#detail')),
    await text(a, '#detail'),
  );
  await emit(a, 'block', { ...blk(152000), req: await reqFor(a, 152000) });
  t('…and the search’s own reply is shown', await until(a, (x) => document.getElementById('detail').textContent.includes(x), hx(152000)));
  // the search's own error (its req echoed) is its answer, and a late one for an earlier search is not the next search's
  for (let h = H; h > H - 8; h--) await reply(a, blk(h));
  await until(a, () => !!document.querySelector(`#mined [data-k=h${152300 - 7}]`));
  await a.fill('#q', '152001');
  await a.press('#q', 'Enter');
  await until(a, () => window.__fake.posts.some((m) => m.type === 'block' && m.height === 152001));
  await emit(a, 'error', { text: 'Block not found @ handle < x', req: await reqFor(a, 152000) });
  await a.waitForTimeout(200);
  t(
    'a late "Block not found" for an earlier search is not the waiting search’s answer',
    /asking the node for block 152,001/.test(await text(a, '#detail')),
    await text(a, '#detail'),
  );
  await emit(a, 'error', { text: 'Block not found @ handle < x', req: await reqFor(a, 152001) });
  t(
    'the search’s own "Block not found" (its req echoed) is its answer',
    await until(a, () => /the node has no block 152,001/.test(document.getElementById('detail').textContent)),
    await text(a, '#detail'),
  );
  // a block a search fetched is of the branch a reorganisation replaced when that pass applied its height: searched again,
  // it is asked of the node again, not shown from the old branch
  const asked = (h) => a.evaluate((h) => window.__fake.posts.filter((m) => m.type === 'block' && m.height === h).length, h);
  const n152000 = await asked(152000);
  await emit(a, 'synced', { height: H, hash: hx(H), applied: H - 152000 + 1 });
  await a.fill('#q', '152000');
  await a.press('#q', 'Enter');
  t(
    'a searched block at a height a reorganisation applied again is asked again, not shown from the old branch',
    await until(a, (n) => window.__fake.posts.filter((m) => m.type === 'block' && m.height === 152000).length > n, n152000),
  );
  for (let h = H; h > H - 8; h--) await reply(a, blk(h));
  await until(a, () => !!document.querySelector(`#mined [data-k=h${152300 - 7}]`));
  // an open block that falls out of the last 8 and is then replaced is asked for as a search would ask it
  await a.click(`#mined [data-k=h${H - 7}]`);
  await until(a, () => !document.getElementById('detail').hidden);
  await emit(a, 'synced', { height: H + 3, hash: hx(H + 3, 'd'), applied: 11 });
  t(
    'an open block older than the last 8 that a reorganisation replaced is asked for again (as a search)',
    await until(a, (h) => window.__fake.posts.some((m) => m.type === 'block' && m.height === h && /^bight:s/.test(m.req)), H - 7),
  );
  await emit(a, 'synced', { height: H, hash: hx(H), applied: 4 });
  for (let h = H; h > H - 8; h--) await reply(a, blk(h));
  // the blocks searches fetched are capped at 10: the eleventh pushes the first out, and it is asked again
  for (let i = 0; i < 11; i++) {
    const h = 151000 + i;
    await a.fill('#q', String(h));
    await a.press('#q', 'Enter');
    await until(a, (h) => window.__fake.posts.some((m) => m.type === 'block' && m.height === h), h);
    await emit(a, 'block', { ...blk(h), req: await reqFor(a, h) });
    await until(a, (x) => document.getElementById('detail').textContent.includes(x), hx(h));
  }
  const n151000 = await asked(151000);
  await a.fill('#q', '151000');
  await a.press('#q', 'Enter');
  t(
    'at most 10 searched blocks are kept: the first of 11 is asked again',
    await until(a, (n) => window.__fake.posts.filter((m) => m.type === 'block' && m.height === 151000).length > n, n151000),
  );
  await emit(a, 'block', { ...blk(151000), req: await reqFor(a, 151000) });
  // a search waiting through a reorganisation is asked again, under the new generation
  await a.fill('#q', '152002');
  await a.press('#q', 'Enter');
  await until(a, () => window.__fake.posts.some((m) => m.type === 'block' && m.height === 152002));
  const firstReq = await reqFor(a, 152002);
  await emit(a, 'synced', { height: H, hash: hx(H, 'b'), applied: 2 });
  t(
    'a reorganisation asks a waiting search again, under the new generation',
    await until(
      a,
      (r) => {
        const p = window.__fake.posts.filter((m) => m.type === 'block' && m.height === 152002);
        return p.length === 2 && p[1].req !== r && /^bight:s\d+\.\d+$/.test(p[1].req);
      },
      firstReq,
    ),
    JSON.stringify(await a.evaluate(() => window.__fake.posts.filter((m) => m.height === 152002))),
  );
  // the new branch's block answers the search; the replaced branch's reply, arriving after it, is not kept for later
  const newReq = await reqFor(a, 152002);
  await emit(a, 'block', { ...blk(152002, 'b'), req: newReq });
  await until(a, (x) => document.getElementById('detail').textContent.includes(x), hx(152002, 'b'));
  await emit(a, 'block', { ...blk(152002), req: firstReq });
  await a.fill('#q', '152002');
  await a.press('#q', 'Enter');
  t(
    'a late reply from the replaced branch is not kept: searched again, the new branch’s block is shown',
    (await until(a, (x) => document.getElementById('detail').textContent.includes(x), hx(152002, 'b'))) &&
      !(await text(a, '#detail')).includes(hx(152002)),
    await text(a, '#detail'),
  );
  // the blocks kept are capped at 40: the oldest go, and a search for one asks the node again
  await emit(a, 'synced', { height: H, hash: hx(H, 'c'), applied: 1 });
  const gen = await a.evaluate(() => window.__fake.posts.filter((m) => m.type === 'block' && /^bight:\d+$/.test(m.req)).at(-1).req);
  for (let h = H - 44; h <= H; h++) await emit(a, 'block', { ...blk(h, 'c'), req: gen });
  const asks = () => a.evaluate((h) => window.__fake.posts.filter((m) => m.type === 'block' && m.height === h).length, H - 44);
  const before = await asks();
  await a.fill('#q', String(H - 44));
  await a.press('#q', 'Enter');
  t(
    'at most 40 blocks are kept: a search for the oldest of 45 asks the node again',
    await until(a, (h) => window.__fake.posts.filter((m) => m.type === 'block' && m.height === h.h).length > h.n, { h: H - 44, n: before }),
  );
  // Escape with the focus on a row (not in the detail, not its opener) closes the detail and leaves the focus on the row
  await a.click(`#mined [data-k=h${H}]`);
  await until(a, () => !document.getElementById('detail').hidden);
  await a.focus('#rows tr .txbtn');
  await a.keyboard.press('Escape');
  t(
    'Escape from a row closes the detail and leaves the focus on that row',
    (await until(a, () => document.getElementById('detail').hidden)) &&
      (await a.evaluate(() => !!document.activeElement?.closest?.('#rows'))),
  );
  // refusals: the last 30 listed
  for (let i = 0; i < 35; i++)
    await emit(a, 'log', { text: `mempool: refused ${i.toString(16).padStart(12, '0')}… from the mirror: input 0: bad`, level: 'info' });
  t(
    'the refusals list keeps the last 30',
    (await a.evaluate(() => document.getElementById('refusals').textContent.split('\n').length)) === 30,
  );
  // a reply for another transaction than the one asked is not shown as it
  const far = many[2000];
  await a.evaluate(
    ([tx, other]) => {
      document.getElementById('q').value = tx;
      document.getElementById('search').requestSubmit();
      window.__fake.emit('mempool-tx', {
        txid: other,
        found: true,
        vsize: 1,
        fee: 1,
        feeRate: 1,
        at: 1,
        req: 'bight',
        inputs: [],
        outputs: [],
      });
    },
    [far.txid, many[2001].txid],
  );
  t(
    'a reply for another transaction than the one asked is ignored; the one asked is shown',
    (await until(a, (x) => document.getElementById('detail').textContent.includes(x), far.txid)) &&
      !(await text(a, '#detail')).includes(many[2001].txid),
    await text(a, '#detail'),
  );
  // a hidden tab asks no template; shown, it asks
  const tpls = () => a.evaluate(() => window.__fake.posts.filter((m) => m.type === 'template').length);
  await a.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
  await a.waitForTimeout(2200);
  const hiddenFrom = await tpls();
  await emit(a, 'mempool', mp(many.slice(0, 10)));
  await a.waitForTimeout(2500);
  t('a hidden tab asks the node for no template', (await tpls()) === hiddenFrom, `${hiddenFrom} → ${await tpls()}`);
  await a.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  t(
    '…and asks once when shown',
    await until(a, (n) => window.__fake.posts.filter((m) => m.type === 'template').length > n, hiddenFrom, 4000),
  );
  // a stopped node: nothing more is asked of it
  const blocksAsked = () => a.evaluate(() => window.__fake.posts.filter((m) => m.type === 'block').length);
  await emit(a, 'error', { text: 'the node did not wipe in time and is stopped', fatal: true });
  const askedBefore = await blocksAsked();
  await emit(a, 'synced', { height: H + 5, hash: hx(H + 5, 'c'), applied: 5 });
  await a.waitForTimeout(5600);
  t(
    'a stopped node is asked for no blocks, and the stop is said once',
    (await blocksAsked()) === askedBefore && (await a.evaluate(() => document.querySelectorAll('#banners .banner.bad').length)) === 1,
    await text(a, '#banners'),
  );
  t('no page errors (round 5)', !p.errors.length, p.errors.join(' | '));
  await p.ctx.close();
}
// 17: a wipe that fails quietly (the node left stopped, no message): nothing more is asked of it
{
  const p = await profile({ 'reef:started': '1' }, { config: { wipeFailQuiet: true } });
  const a = await p.open();
  await until(a, () => window.__fake.starts === 1);
  // the loader knows a height from the first sync's progress before that sync is done: no block is asked meanwhile
  await a.evaluate(() => (window.__fake.node.height = 152390));
  await a.waitForTimeout(5600);
  t(
    'no block is asked before the first sync is done (the node is busy with it)',
    (await a.evaluate(() => window.__fake.posts.filter((m) => m.type === 'block').length)) === 0,
  );
  await emit(a, 'synced', { height: 152400, hash: 'ee'.repeat(32), applied: 1 });
  await a.click('#settings');
  await a.click('#o-wipe');
  await a.click('#o-wipe');
  await until(a, () => /not wiped/.test(document.getElementById('o-wipenote').textContent));
  await a.evaluate(() => document.getElementById('dlg').close());
  t(
    'a wipe that failed quietly with the node stopped: the pill says stopped',
    await until(a, () => /stopped/.test(document.getElementById('pilltxt').textContent)),
  );
  const n0 = await a.evaluate(() => window.__fake.posts.filter((m) => m.type === 'block').length);
  await emit(a, 'synced', { height: 152410, hash: 'ef'.repeat(32), applied: 10 });
  await a.waitForTimeout(5600);
  t(
    '…and no block is asked of it afterwards',
    (await a.evaluate(() => window.__fake.posts.filter((m) => m.type === 'block').length)) === n0,
  );
  await p.ctx.close();
}
// 18: the welcome's "Not now": the pill says not started
{
  const p = await profile();
  const a = await p.open();
  await until(a, () => !!document.querySelector('#welcome[open]'));
  await a.click('#wl-later');
  t(
    'after "Not now" the pill says not started, not "starting"',
    await until(a, () => document.getElementById('pilltxt').textContent === 'not started'),
  );
  t(
    'after "Not now" the next-block tile says the node is not started, not that following waits on being up to date',
    await until(a, () => /not started: start the node/.test(document.getElementById('proj').textContent)),
    await text(a, '#proj'),
  );
  await p.ctx.close();
}
// 19: round 6. A reorganisation over an open searched block; two searches of one height told apart by req; every request
// asked again at once on a new generation; the first message after a clock jump being the mempool's; no template from an
// idle or wiped tab; a template build that throws said as the build failing; a stopped node greyed with its time; a
// block's detail scrolling in its own box on a phone
{
  const hx = (h, c = '0') => c + h.toString(16).padStart(63, '0');
  const blk = (h, c = '0', k = 1) => ({
    height: h,
    hash: hx(h, c),
    previousblockhash: hx(h - 1, c),
    size: 400,
    nTx: k,
    header: { time: Math.floor(Date.now() / 1000) - 60 },
    txids: Array.from({ length: k }, (_, i) => id('7', i)),
  });
  const searchReqs = (page, h) =>
    page.evaluate(
      (h) => window.__fake.posts.filter((m) => m.type === 'block' && m.height === h && /^bight:s/.test(m.req)).map((m) => m.req),
      h,
    );
  {
    const p = await profile({ 'reef:started': '1' });
    const a = await p.open();
    await until(a, () => window.__fake.starts === 1);
    const H = 152400;
    await emit(a, 'mempool', mp([]));
    await emit(a, 'synced', { height: H, hash: hx(H), applied: 1792 });
    await until(a, () => window.__fake.posts.filter((m) => m.type === 'block').length >= 8);
    const first = await a.evaluate(() => window.__fake.posts.filter((m) => m.type === 'block').map((m) => [m.height, m.req]));
    // a reorganisation of the tip before any tile was answered: the replies to the old generation are ignored, and every
    // tile height is asked again at once
    await emit(a, 'synced', { height: H, hash: hx(H, 'e'), applied: 1 });
    for (const [h, req] of first) await emit(a, 'block', { ...blk(h), req });
    const again = await until(
      a,
      (old) => {
        const now = window.__fake.posts.filter((m) => m.type === 'block' && !/^bight:s/.test(m.req) && m.req !== old);
        return new Set(now.map((m) => m.height)).size >= 8;
      },
      first[0][1],
      3000,
    );
    t('a new generation asks every tile height again at once, not after the 30 s retry', again);
    // a searched block, open; a reorganisation over it: said, asked again, the new block shown
    const S = H - 20;
    await a.fill('#q', String(S));
    await a.press('#q', 'Enter');
    await until(a, (h) => window.__fake.posts.some((m) => m.type === 'block' && m.height === h && /^bight:s/.test(m.req)), S);
    const [r1] = await searchReqs(a, S);
    await emit(a, 'block', { ...blk(S, 'a'), req: r1 });
    t('a searched block is shown', await until(a, (x) => document.getElementById('detail').textContent.includes(x), hx(S, 'a')));
    await emit(a, 'synced', { height: H, hash: hx(H, 'f'), applied: 25 });
    t(
      'a reorganisation over the open searched block says so',
      await until(a, () => /replaced by a reorganisation/.test(document.getElementById('detail').textContent)),
      await text(a, '#detail'),
    );
    const askedAgain = await until(
      a,
      ([h, n]) => window.__fake.posts.filter((m) => m.type === 'block' && m.height === h && /^bight:s/.test(m.req)).length > n,
      [S, 1],
    );
    const r2 = (await searchReqs(a, S)).at(-1);
    t('…and asks for it again under the new generation', askedAgain && r2 !== r1, `${r1} ${r2}`);
    await emit(a, 'block', { ...blk(S, 'b'), req: r2 });
    t(
      '…and shows the block now at that height',
      await until(a, (x) => document.getElementById('detail').textContent.includes(x), hx(S, 'b')),
      await text(a, '#detail'),
    );
    // two searches of the same height: only the reply to the one still waiting answers it
    const S2 = H - 30;
    await a.fill('#q', String(S2));
    await a.press('#q', 'Enter');
    await until(a, (h) => window.__fake.posts.some((m) => m.type === 'block' && m.height === h && /^bight:s/.test(m.req)), S2);
    await a.fill('#q', String(S2));
    await a.press('#q', 'Enter');
    await until(
      a,
      (h) => window.__fake.posts.filter((m) => m.type === 'block' && m.height === h && /^bight:s/.test(m.req)).length >= 2,
      S2,
    );
    const [q1, q2] = await searchReqs(a, S2);
    await emit(a, 'block', { ...blk(S2, 'c'), req: q1 });
    await a.waitForTimeout(200);
    await emit(a, 'block', { ...blk(S2, 'd'), req: q2 });
    await until(a, (x) => document.getElementById('detail').textContent.includes(x), hx(S2, 'd'));
    const dt = await text(a, '#detail');
    t(
      'two searches of one height: the reply to the earlier one is not taken for the later one',
      dt.includes(hx(S2, 'd')) && !dt.includes(hx(S2, 'c')),
      dt.slice(0, 200),
    );
    // a template build that throws: an error echoing the template's req, said as the build failing, not as the node failing
    await emit(a, 'mempool', mp([mtx('8', 1, 3), mtx('8', 2, 4)]));
    await emit(a, 'error', { text: 'not enough header context for the difficulty', req: 'bight:t' });
    t(
      'a template build that throws is said on the next block as "build fails", and not as a node error',
      (await until(a, () => /build fails/.test(document.getElementById('proj').textContent))) && !(await a.$('#banners [data-b=nodeerr]')),
      await text(a, '#proj'),
    );
    t(
      'the template is asked with its own req',
      await a.evaluate(() => window.__fake.posts.some((m) => m.type === 'template' && m.req === 'bight:t')),
    );
    // a block's detail on a phone: its table scrolls in its own box, the page does not
    await a.setViewportSize({ width: 390, height: 800 });
    const S3 = H - 3;
    await emit(a, 'block', { ...blk(S3, '0', 30), req: await reqFor(a, S3) });
    await until(a, (h) => !!document.querySelector(`#mined [data-k=h${h}]`), S3);
    await a.click(`#mined [data-k=h${S3}]`);
    await until(a, () => !!document.querySelector('#detail .dtbl'));
    const w = await a.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    t('a block detail on a 390 px phone scrolls in its own box: the page is not wider than the screen', w[0] <= w[1], JSON.stringify(w));
    t(
      'the fixed status bar is kept clear of what has the focus (scroll padding)',
      (await a.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingBottom)) === '48px',
    );
    // a stopped node: greyed, with the time it stopped
    await emit(a, 'error', { text: 'the node did not wipe in time and is stopped', fatal: true });
    t(
      'a stopped node greys what is on screen and says the time it stopped',
      (await until(a, () => document.querySelector('main').classList.contains('stopped'))) &&
        /Stopped at .*not live/.test(await text(a, '#stopnote')) &&
        /as of/.test(await text(a, '#mp-h')),
      await text(a, '#stopnote'),
    );
    t('no page errors (round 6)', !p.errors.length, p.errors.join(' | '));
    await p.ctx.close();
  }
  // the first message after a clock jump is the mempool's: the block the next sync applies is still a catch-up
  {
    const p = await profile({ 'reef:started': '1' });
    const a = await p.open();
    await until(a, () => window.__fake.starts === 1);
    const T0 = Date.UTC(2026, 9, 1, 12);
    const at = (ms) => a.clock.setFixedTime(T0 + ms);
    const tile = (h) => text(a, `#mined [data-k=h${h}]`);
    const blkT = (h) => ({ ...blk(h), header: { time: Math.floor(T0 / 1000) - 3600 } });
    const sync1 = async (h) => {
      await emit(a, 'synced', { height: h, hash: hx(h), applied: 1 });
      await until(a, (h) => window.__fake.posts.some((m) => m.type === 'block' && m.height === h), h);
      await reply(a, blkT(h));
      await until(a, (h) => !!document.querySelector(`#mined [data-k=h${h}]`), h);
    };
    await at(0);
    await sync1(152500);
    await at(1000);
    await emit(a, 'mempool', mp([], { feedFileAt: T0 }));
    await at(2000);
    await sync1(152501);
    t('watched arriving before the jump', !/header/.test(await tile(152501)), await tile(152501));
    await at(182000);
    await emit(a, 'mempool', mp([], { feedFileAt: T0 }));
    await sync1(152502);
    t(
      'after a clock jump first seen by a mempool message, the next sync’s block is a catch-up',
      /header/.test(await tile(152502)),
      await tile(152502),
    );
    await p.ctx.close();
  }
  // no template from an idle tab (another runs the node) or from a wiped one
  {
    const p = await profile({ 'reef:started': '1' });
    const a = await p.open();
    await until(a, () => window.__fake.starts === 1);
    const b = await p.open();
    await until(
      b,
      () => document.body.classList.contains('idle') || /idle/.test(document.getElementById('pilltxt').textContent),
      null,
      8000,
    );
    await emit(b, 'synced', { height: 152600, hash: hx(152600), applied: 1 });
    await emit(b, 'mempool', mp([mtx('9', 1, 3)]));
    await b.waitForTimeout(2600);
    t('an idle tab asks no template', !(await b.evaluate(() => window.__fake.posts.some((m) => m.type === 'template'))));
    await p.ctx.close();
  }
  {
    const p = await profile({ 'reef:started': '1' }, { config: { wipeLeaves: ['blocks.dat'] } });
    const a = await p.open();
    await until(a, () => window.__fake.starts === 1);
    await emit(a, 'synced', { height: 152700, hash: hx(152700), applied: 1 });
    await a.click('#settings');
    await a.click('#o-wipe');
    await a.click('#o-wipe');
    await until(a, () => window.__fake.wipes === 1);
    const before = await a.evaluate(() => window.__fake.posts.filter((m) => m.type === 'template').length);
    await emit(a, 'mempool', mp([mtx('9', 2, 3)]));
    await emit(a, 'synced', { height: 152701, hash: hx(152701), applied: 1 });
    await a.waitForTimeout(2600);
    t('a wiped tab asks no template', (await a.evaluate(() => window.__fake.posts.filter((m) => m.type === 'template').length)) === before);
    await p.ctx.close();
  }
}
await browser.close();
console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
