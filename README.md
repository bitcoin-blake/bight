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

## Name

A bight is the slack curve of a line before it is made fast, which is what a mempool is. Reef is a knot; Bight is the rope beside it.

## Licence

AGPL-3.0-or-later.
