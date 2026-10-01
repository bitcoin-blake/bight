# Bight

**A mempool monitor in a browser tab.** The shape everyone knows from mempool.space, the projected blocks on the left of the chain tip and the mined ones on the right, but every transaction on the page was validated by the tab's own node, and the next block is the one this tab would build.

Live: https://bitcoin-blake.github.io/bight/

## What it is

One page over [blaketestnode](https://github.com/bitcoin-blake/blaketestnode)'s browser node, through the same loader [Reef](https://github.com/bitcoin-blake/reef) uses (`browser/tabnode.js`, pinned by commit): the tab fetches the fork-point UTXO snapshot of txbt4 (the BLAKE2b testnet4), checks its hashes, validates every block since the fork and follows the chain tip. Then it keeps its own mempool: transactions arrive as kind 23404 events (a node publishing its mempool, one transaction per event), as kind 23503 events (sends from sidestr wallets), and from the mirror's mempool file on start; each is checked against the tab's own UTXO set (inputs unspent and mature, values, scripts, a fee floor) before it counts, and the tab never relays one onward.

On the page:
- **Blocks.** The next blocks packed by fee rate from the tab's mempool; the first is also built in full by the node worker (coinbase, witness commitment, header) and checked against every block rule it knows, so "next block" is a block, not a picture. To the right, the last blocks the tab validated, with how many of their transactions the tab had seen in its mempool first. Click a block for its transactions.
- **Mempool.** Count, size, fees waiting, median rate, and the fee bands.
- **Where it comes from.** The relays followed, how many transactions were heard, accepted, refused and dropped, what the mirror's file gave on start, and the last refusals with the reason.
- **Over time.** Transactions and vB through the session.
- **Search** a txid: the mempool, then the blocks the tab has looked at.

A UTXO node keeps no history: fees of transactions the tab never had are shown as unknown rather than guessed, and a search beyond the last blocks says so.

Bight and Reef publish under the same origin, so they share one copy of the snapshot in the browser's storage. Settings (⚙) hold the snapshot and blocks URLs, the swarm fetch (WebTorrent, the mirror as webseed), seeding, and Wipe.

## Before you open it

The first visit downloads the chain's state at block 150,307 (830 MB) and needs about 1.1 GB of the browser's storage for this site; Bight asks first (one answer for Bight and Reef). The files are shared with Reef, Winch and Hitch on the same site, and one tab of the four runs the node at a time: a second tab says it is idle and takes over when the other closes. A private window cannot run the node. Settings → Wipe removes the node's files for all four (the key in Reef is not touched).

A link may propose another snapshot or block source (`?snapshot=`, `?blocks=`): it is shown in a notice and used only for the visit you agree to, never stored.

## What the page can and cannot say

- **Signed chain tip.** The node checks the block source against a NIP-333 signed tip. The pill reads "signed" when they agree, warns when the source runs two or more blocks above the tip (those blocks are marked "not signed yet"), and turns red when they disagree.
- **Part of the mempool.** The node sends the page the first 1,000 transactions by fee rate; when it holds more, the page says "the top 1,000 of N" and the bands, median, projected blocks, table and search cover those.
- **The next block.** Projected blocks are packed the way the node packs its own (by fee rate, skipping what does not fit). The first carries the worker's own figures, "as built", only when that build is current and passes every block rule; otherwise it says which rules fail.
- **Seen first.** Counted only for blocks found after the page began following the mempool.

## Services Bight depends on

| Service | What it provides | What the page says when it is down |
|---|---|---|
| The block mirror (melvin.me) | the snapshot, the block file and index, context headers, the mempool seed | a node error in words; after sync "no answer from the block source since …" and "no new block for N minutes"; the seed "not loaded: …" |
| The NIP-333 tip publisher | the signed chain tip | "no signed chain tip reached this browser" |
| The estate's mempool feed (kind 23404) | a node's own mempool | "no node's mempool heard since …" after 15 minutes |
| Nostr relays | the feed and wallet sends | the relay count followed, and the counts heard |
| cdn.jsdelivr.net | the node's code, pinned by commit | "could not load its code"; "the node has said nothing for a minute" |
| GitHub Pages | the page | the browser's own error |

## Tests and releasing

`npm test` runs the page's decisions (`test/lib-test.mjs`: packing, medians, bands, seen-first, search, the graph, words, status, sources) and the release checks (`test/release-test.mjs`: the version in its three places, the security policy against the node pin and the libraries its worker imports, and the node's messages and log lines the page reads, from a checkout at the pin: `BLAKETESTNODE=<path>`). `node test/smoke.mjs` loads the page in headless Chromium with a fake node (`test/fake/tabnode.js`; needs `npm i --no-save playwright-core`).

1. Change the code; bump `VERSION` in `bight.js`, `version.json` and `bight.js?v=` in `index.html` together (CI fails a code change whose version did not go up).
2. A new node pin goes into `bight.js` and the policy in `index.html`, and into Reef, Winch and Hitch in the same sitting: the four share the node's files and its lock.
3. Push to `main`: `.github/workflows/test.yml` runs the tests, the formatting check, the site check and the smoke test, deploys to Pages only when all pass, then checks the four published apps pin the same node.
4. Rolling back: revert, bump the version above the current one, push.

## Name

A bight is the slack curve of a line before it is made fast, which is what a mempool is. Reef is a knot; Bight is the rope beside it.

## Licence

AGPL-3.0-or-later.
