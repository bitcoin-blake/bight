// The page itself in headless Chromium, with the node replaced by test/fake/tabnode.js (and the node's params read from
// the checkout at the pinned commit): consent before the download, the mempool and blocks flow, the template under a busy
// mempool, truncation, seen-first, a failing template, search, the idle tab, the theme, a link that proposes a source.
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
async function profile(seed = {}) {
  const ctx = await browser.newContext();
  await ctx.route('**/*', async (route) => {
    const u = route.request().url();
    let m;
    if ((m = u.match(/^https:\/\/cdn\.jsdelivr\.net\/gh\/bitcoin-blake\/blaketestnode@([0-9a-f]+)\/browser\/tabnode\.js$/)))
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(`${ROOT}test/fake/tabnode.js`) });
    if ((m = u.match(/^https:\/\/cdn\.jsdelivr\.net\/gh\/bitcoin-blake\/blaketestnode@([0-9a-f]+)\/(lib\/params\.mjs)$/)))
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: execSync(`git -C ${BTN} show ${m[1]}:${m[2]}`) });
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
  return { ctx, open, errors };
}
const id = (c, i = 0) => (c + i.toString(16)).padEnd(64, c).slice(0, 64);
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
const mp = (txs, o = {}) => ({
  type: 'mempool',
  height: 152100,
  count: txs.length,
  bytes: txs.reduce((a, x) => a + x.vsize, 0),
  fees: txs.reduce((a, x) => a + x.fee, 0),
  stats: { seen: txs.length, accepted: txs.length, refused: 0, dropped: 0 },
  txs,
  following: true,
  lastFeedAt: Date.now(),
  ...o,
});

// 1: a first visit asks before the 830 MB download; Start starts the node
{
  const p = await profile();
  const a = await p.open();
  await a.waitForSelector('#welcome[open]', { timeout: 5000 }).catch(() => {});
  t(
    'a first visit asks before downloading, and starts nothing',
    (await a.evaluate(() => !!document.querySelector('#welcome[open]'))) && (await a.evaluate(() => window.__fake.starts)) === 0,
  );
  await a.click('#wl-start');
  await a
    .waitForFunction(() => window.__fake.starts === 1 && localStorage.getItem('reef:started'), null, { timeout: 5000 })
    .catch(() => {});
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
// 2–8: a returning visit: the mempool and the blocks
{
  const p = await profile({ 'reef:started': '1' });
  const a = await p.open();
  await a.waitForFunction(() => window.__fake.starts === 1, null, { timeout: 5000 });
  const txs = Array.from({ length: 5 }, (_, i) => mtx('c', i, 2 + i));
  await a.evaluate((m) => window.__fake.emit('mempool', m), mp(txs));
  await a.evaluate(() => window.__fake.emit('synced', { height: 152101, hash: 'ee'.repeat(32), applied: 1 }));
  await a.waitForTimeout(100);
  const posts = await a.evaluate(() => window.__fake.posts);
  t(
    'up to date: the mempool is followed once, and the last eight blocks are asked for',
    (await a.evaluate(() => window.__fake.follows)) === 1 && posts.filter((m) => m.type === 'block' && m.req === 'bight').length === 8,
  );
  // a busy mempool: an event every 300 ms must not hold the template back
  const t0 = Date.now();
  let asked = false;
  for (let i = 0; i < 10 && !asked; i++) {
    await a.evaluate((m) => window.__fake.emit('mempool', m), mp(txs));
    await a.waitForTimeout(300);
    asked = await a.evaluate(() => window.__fake.posts.some((m) => m.type === 'template'));
  }
  t(
    'the next block is asked of the worker within about 2 s, however busy the mempool',
    asked && Date.now() - t0 < 3000,
    `${Date.now() - t0} ms`,
  );
  await a.evaluate(() =>
    window.__fake.emit('template', {
      height: 152102,
      txs: 5,
      fees: 3000,
      weight: 3000,
      rdts: true,
      checks: { ok: false, failed: ['btc:rule-x'] },
    }),
  );
  await a.waitForTimeout(100);
  t(
    'a template that fails its checks is said, and the next block is not "as built"',
    /fails: btc:rule-x/.test(await a.textContent('#m-next')) && !/as built/.test(await a.textContent('#proj')),
  );
  await a.evaluate(() =>
    window.__fake.emit('template', { height: 152102, txs: 5, fees: 3000, weight: 3000, rdts: true, checks: { ok: true, failed: [] } }),
  );
  await a.waitForTimeout(100);
  t(
    'one that passes gives the next block its figures, "as built"',
    /as built/.test(await a.textContent('#proj')) && /every rule passes/.test(await a.textContent('#m-next')),
  );
  // a block found after the mempool was followed, with one of the seen transactions
  await a.evaluate(
    (txid) =>
      window.__fake.emit('block', {
        req: 'bight',
        height: 152101,
        hash: 'ee'.repeat(32),
        previousblockhash: 'dd'.repeat(32),
        size: 500,
        nTx: 2,
        header: { time: Math.floor(Date.now() / 1000) },
        txids: ['00'.repeat(32), txid],
      }),
    id('c', 1),
  );
  await a.waitForTimeout(100);
  t('a mined block says how much of it was seen first', /1 of 1 seen first/.test(await a.textContent('#mined')));
  // a reorganisation: the tip replaced by another block at the same height
  await a.evaluate(() => window.__fake.emit('synced', { height: 152101, hash: 'ff'.repeat(32), applied: 1 }));
  await a.waitForTimeout(100);
  t(
    'a block replaced by a reorganisation is dropped and asked for again',
    !/1 of 1 seen first/.test(await a.textContent('#mined')) &&
      (await a.evaluate(() => window.__fake.posts.filter((m) => m.type === 'block' && m.height === 152101).length)) >= 1,
  );
  // more in the mempool than the worker sends
  const many = Array.from({ length: 1000 }, (_, i) => mtx('d', i, 1 + (i % 50)));
  await a.evaluate((m) => window.__fake.emit('mempool', m), mp(many, { count: 3000, bytes: 450000 }));
  await a.waitForTimeout(150);
  t(
    'when the page sees only part of the mempool, it says so',
    /top 1,000 of 3,000/.test(await a.textContent('#m-cover')) && /more in the mempool/.test(await a.textContent('#proj')),
  );
  // search
  await a.fill('#q', 'abc');
  await a.click('#search button');
  t('a search that is not a txid says what one is', /64 hex/.test(await a.textContent('#detail')));
  await a.fill('#q', id('d', 7));
  await a.click('#search button');
  await a.waitForTimeout(100);
  t(
    'a txid in the mempool is shown, and its row stays highlighted after the next render',
    /In this tab's mempool/.test(await a.textContent('#detail')) && !!(await a.$(`#rows tr.hi[data-t="${id('d', 7)}"]`)),
  );
  // the signed tip disagrees
  await a.evaluate(() => window.__fake.emit('nostr', { height: 152101, agree: 0, diverged: true }));
  await a.waitForTimeout(100);
  t(
    'a signed chain tip that disagrees turns the pill red with a notice',
    (await a.getAttribute('#pilldot', 'class')) === 'bad' && !!(await a.$('#banners [data-b=chain]')),
  );
  // a second tab while this one holds the lock
  const b = await p.open();
  await b.waitForTimeout(300);
  t('a second tab is idle and says so', /idle/.test(await b.textContent('#pilltxt')) && !!(await b.$('#banners [data-b=idle]')));
  // the theme
  await a.click('#theme');
  t('the theme is kept', ['light', 'dark'].includes(await a.evaluate(() => localStorage.getItem('bight:theme'))));
  t('no page errors', !p.errors.length, p.errors.join(' | '));
  await p.ctx.close();
}
// 9: a link that proposes another block source
{
  const p = await profile({ 'reef:started': '1' });
  const a = await p.open('/index.html?blocks=https://evil.example/x-blocks');
  await a.waitForTimeout(300);
  t('a source proposed by a link is not used without a yes', !!(await a.$('#banners [data-b=src-blocks]')));
  await a.click('#settings');
  t('Settings shows the stored source, not the link’s', (await a.inputValue('#o-blocks')) !== 'https://evil.example/x-blocks');
  await a.click('#o-torrent');
  await a.click('#o-ok');
  t(
    'pressing OK for another setting does not store the link’s source',
    (await a.evaluate(() => localStorage.getItem('bight:blocks'))) === null,
  );
  t('no page errors with a proposed source', !p.errors.length, p.errors.join(' | '));
  await p.ctx.close();
}
await browser.close();
console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
