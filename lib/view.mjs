// The page's pieces as markup strings and words: the block tiles (their content and accessible names), the block and
// projected-block details, a mempool transaction, a search that found nothing. Every value is escaped here. Pure; tested in
// test/lib-test.mjs. The page only puts these into the document, patching in place so focus and selection survive.
// fmt.mjs with this module's own query (the page loads its modules as ?v=<version>): the same instance and release as the
// page's, never a cached one from another release
const { esc, n, fmtAge, etaWords, txUrl, blockUrl, pl } = await import('./fmt.mjs' + new URL(import.meta.url).search);
const rate = (x) => (x == null ? '—' : x.toFixed(1));
const ext = (url, what) =>
  `<a class="ext" href="${esc(url)}" target="_blank" rel="noopener" aria-label="${esc(what)} on mempool.guide (another site, not checked by this tab)" title="on mempool.guide: another site, not checked by this tab">↗</a>`;
// a projected block: built = the worker's own build figures when current, passing and of this mempool (block 0 only);
// note: a short word on the node's build when it is not that ("build fails", "built on a different mempool")
// spacing: minutes between blocks lately (fmt.spacingMin), for the ETA
export function projTile(b, i, { built = null, note = '', spacing } = {}) {
  const head = etaWords(i, spacing);
  const units = `${n(b.vsize)} vB · ${n(b.txs.length)} tx · ${n(b.fees)} sat`;
  const html = `<span class="h">${esc(head)}${built ? ' <span class="badge">✓ built</span>' : ''}</span><span class="r">~${esc(rate(b.wmed))} sat/vB</span><span class="s">${esc(rate(b.min))} – ${esc(rate(b.max))} sat/vB</span><span class="s">${esc(units)}</span>${note ? `<span class="s">${esc(note)}</span>` : ''}`;
  const label = `${head}: about ${rate(b.wmed)} sat per vB (by size), ${rate(b.min)} to ${rate(b.max)}; ${units}${built ? '; built by the node, every rule it checks passes' : ''}${note ? `; ${note}` : ''}`;
  return { html, label };
}
// the next block when the mempool is empty: the coinbase alone, built when the worker's build passes
export function emptyNextTile({ built = false, words = 'the mempool is empty' } = {}) {
  return {
    html: `<span class="h">next block${built ? ' <span class="badge">✓ built</span>' : ''}</span><span class="s">${esc(built ? 'empty: the coinbase only' : words)}</span>`,
    label: `next block: ${built ? 'empty, the coinbase only, built by the node' : words}`,
  };
}
// a mined block: med = size-weighted median of the transactions this tab knew (known of others); ageS = how long ago it
// reached this tab, or (ageFrom 'header', for a block that came before the tab listened) by the miner's header time,
// which can be ahead of the clock. With no rate known, the fees its coinbase claimed (b.fees) when the node says them.
// The visible text uses symbols; the accessible name says the same in words.
export function minedTile(b, { med = null, known = 0, others = 0, seenWords = '', unsigned = false, ageS = 0, ageFrom = 'arrival' } = {}) {
  const claimed = med == null && b.fees != null;
  const rateWords = med != null ? `~${rate(med)} sat/vB` : claimed ? `${n(b.fees)} sat in fees` : 'fees unknown';
  const rateSaid =
    med != null ? `about ${rate(med)} sat per vB` : claimed ? `${n(b.fees)} sat in fees claimed by its coinbase` : 'fees unknown';
  const of = med != null && known < others ? ` (of ${n(known)} known)` : '';
  const age =
    ageFrom === 'header' ? (ageS < 0 ? `header ${fmtAge(-ageS)} ahead` : `header ${fmtAge(ageS)} ago`) : `${fmtAge(Math.max(0, ageS))} ago`;
  const when = `${age}${unsigned ? ' · not signed yet' : ''}`;
  const html = `<span class="h">${esc(n(b.height))}</span><span class="r">${esc(rateWords)}<span class="sub">${esc(of)}</span></span><span class="s">${esc(n(b.size))} B · ${esc(n(b.nTx))} tx</span><span class="s">${esc(seenWords)}</span><span class="s">${esc(when)}</span>`;
  const label = `block ${n(b.height)}, ${age}${unsigned ? ', not signed yet' : ''}: ${rateSaid}${of}, ${pl(b.nTx, 'transaction')}, ${pl(b.size, 'byte')}, ${seenWords}`;
  return { html, label };
}
// what the projected blocks leave (pack.remainder): "+N blocks · X vB"
export function remainderTile(r) {
  const head = `+${pl(r.blocks, 'block')}`;
  const words = `${n(r.vb)} vB · ${n(r.count)} tx`;
  return {
    html: `<span class="h">${esc(head)}</span><span class="s">${esc(words)}</span><span class="s">beyond the blocks shown</span>`,
    label: `${head} beyond the blocks shown: ${n(r.vb)} vB, ${pl(r.count, 'transaction')}`,
  };
}
// the detail of a mined block (its fees only as its coinbase claimed them, when the node says: a UTXO node cannot add up
// fees it never saw); sw = seen.blockSeen; arrival: chain.markArrived's { at (ms), alone } for it, or null; foundTxid: the
// transaction a search found in it (highlighted). "Seen … before the block" counts from when the block reached this tab
// only when it was watched arriving on its own; a block from a catch-up (after sleep, at start) is measured from its header.
export function blockDetail(b, { sw, seenTx, signedWords, inMempool = 0, foundTxid = null, cap = 200, arrival = null }) {
  const watched = !!arrival?.alone && arrival.at != null;
  const reached = watched ? arrival.at / 1000 : b.time; // s: when it reached this tab, else its header
  const reachedRow =
    arrival?.at != null
      ? `<span class="l">Reached this tab</span><span class="v">${esc(new Date(arrival.at).toLocaleString())}${watched ? '' : esc(' · in a catch-up, not watched arriving')}</span>`
      : '';
  const rows = b.txids
    .slice(0, cap)
    .map((t, i) => {
      const f = seenTx.get(t);
      const seenCol = f
        ? `${fmtAge(Math.max(0, Math.round(reached - f.at)))} before the block`
        : i === 0
          ? ''
          : sw.counted
            ? 'not seen'
            : '—';
      return `<tr data-t="${esc(t)}"${t === foundTxid ? ' class="hi"' : ''}><td class="mono">${esc(t.slice(0, 20))}…${i === 0 ? ' <span class="mut">coinbase</span>' : ''} ${ext(txUrl(t), 'transaction ' + t.slice(0, 12))}</td><td class="amt">${f ? esc(n(f.vsize)) : '—'}</td><td class="amt">${f ? esc(n(f.fee)) : '—'}</td><td class="amt">${f ? esc(rate(f.feeRate)) : '—'}</td><td>${esc(seenCol)}</td></tr>`;
    })
    .join('');
  const more = b.txids.length > cap ? `<p class="note">and ${esc(n(b.txids.length - cap))} more</p>` : '';
  return `<h2 id="dtitle">${foundTxid ? `Found in block ${esc(n(b.height))}` : `Block ${esc(n(b.height))}`}</h2><div class="kv"><span class="l">Hash</span><span class="v mono">${esc(b.hash)} ${ext(blockUrl(b.hash), 'block ' + n(b.height))}</span>${reachedRow}<span class="l">Time in its header (the miner's)</span><span class="v">${esc(new Date(b.time * 1000).toLocaleString())}</span><span class="l">Transactions</span><span class="v">${esc(n(b.nTx))} (${esc(pl(b.size, 'byte'))})</span>${b.fees != null ? `<span class="l">Fees claimed by its coinbase</span><span class="v">${esc(n(b.fees))} sat</span>` : ''}<span class="l">Seen in this tab's mempool first</span><span class="v">${esc(sw.counted ? `${sw.seen} of ${sw.others}` : sw.words)}${inMempool ? esc(` · ${n(inMempool)} still listed until the next check`) : ''}</span>${sw.knownCount ? `<span class="l">Fees this tab knew</span><span class="v">${esc(n(sw.knownFees))} sat over ${esc(pl(sw.knownCount, 'transaction'))}</span>` : ''}<span class="l">Validated by</span><span class="v">this tab · ${esc(signedWords)}</span></div>${sw.knownCount < sw.others ? `<p class="note">${b.fees != null ? 'Per-transaction fees are shown only for' : 'Fees are shown for'} the transactions this tab had in its mempool before the block; a UTXO node keeps no history for the rest.</p>` : ''}<div class="dtbl" tabindex="0" role="region" aria-label="Transactions in block ${esc(n(b.height))}"><table><caption class="sr">Transactions in block ${esc(n(b.height))}</caption><thead><tr><th scope="col">Transaction</th><th scope="col" class="amt">vB</th><th scope="col" class="amt">Fee</th><th scope="col" class="amt">sat/vB</th><th scope="col">Seen</th></tr></thead><tbody>${rows}</tbody></table></div>${more}`;
}
// the detail of a projected block; tw = node-text.templateWords for block 0 (with the page's mempool, so it says whether
// the node's build is of the same mempool and has the same figures)
export function projDetail(b, i, { tw = null, asOf = '', cap = 200 }) {
  const rows = b.txs
    .slice(0, cap)
    .map(
      (t) =>
        `<tr data-t="${esc(t.txid)}"><td class="mono">${esc(t.txid.slice(0, 20))}… ${ext(txUrl(t.txid), 'transaction ' + t.txid.slice(0, 12))}</td><td class="amt">${esc(n(t.vsize))}</td><td class="amt">${esc(n(t.fee))}</td><td class="amt">${esc(rate(t.feeRate))}</td></tr>`,
    )
    .join('');
  const more = b.txs.length > cap ? `<p class="note">and ${esc(n(b.txs.length - cap))} more</p>` : '';
  const builtRows =
    i === 0 && tw
      ? `<span class="l">The node's own build</span><span class="v">${esc(tw.text)}</span>${
          tw.differs
            ? `<span class="l">Why they differ</span><span class="v">the page packs by size in vB and the node by exact weight, with its coinbase; near a full block the two can choose differently</span>`
            : ''
        }`
      : '';
  return `<h2 id="dtitle">${i === 0 ? 'The next block, as this tab would build it' : `Projected block ${i + 1}`} <span class="mut">as of ${esc(asOf)}</span></h2><div class="kv"><span class="l">Packed by this page</span><span class="v">${esc(n(b.txs.length))} tx · ${esc(n(b.vsize))} vB · ${esc(n(b.fees))} sat</span><span class="l">Fee rates</span><span class="v">${esc(rate(b.min))} – ${esc(rate(b.max))} sat/vB, median ${esc(rate(b.wmed))} (by size)</span>${builtRows}</div><p class="note">Packed by fee rate from the mempool this tab holds, the way the node builds its block: what does not fit is skipped and the next tried. The first is also built in full by the node (coinbase, witness commitment, header) and checked against the block rules it knows.</p><div class="dtbl" tabindex="0" role="region" aria-label="Transactions in ${i === 0 ? 'the next block' : 'projected block ' + (i + 1)}"><table><caption class="sr">Transactions in ${i === 0 ? 'the next block' : 'projected block ' + (i + 1)}</caption><thead><tr><th scope="col">Transaction</th><th scope="col" class="amt">vB</th><th scope="col" class="amt">Fee</th><th scope="col" class="amt">sat/vB</th></tr></thead><tbody>${rows}</tbody></table></div>${more}`;
}
// one transaction of the mempool (as the node's mempool-tx reply, or the page's own copy); block: the index of the projected
// block it is in (pack.blockIndex), or null when it is beyond the blocks shown
export function mempoolTxDetail(tx, { block = null, spacing } = {}) {
  const ins = (tx.inputs ?? []).map((k) => `${esc(String(k).slice(0, 16))}…:${esc(String(k).split(':')[1] ?? '')}`).join(', ') || '—';
  const outs = (tx.outputs ?? []).map((o) => `${esc(n(o.value))} sat → ${esc(String(o.scriptPubKey).slice(0, 20))}…`).join('<br>') || '—';
  const where =
    block == null
      ? 'beyond the projected blocks: not soon at this fee rate'
      : block === 0
        ? 'in the next block, as this tab would build it'
        : `in projected block ${n(block + 1)}, ${etaWords(block, spacing)}`;
  return `<h2 id="dtitle">In this tab's mempool</h2><div class="kv"><span class="l">Transaction</span><span class="v mono">${esc(tx.txid)} ${ext(txUrl(tx.txid), 'transaction')}</span><span class="l">Size</span><span class="v">${esc(n(tx.vsize))} vB</span><span class="l">Fee</span><span class="v">${esc(n(tx.fee))} sat · ${esc(rate(tx.feeRate))} sat/vB</span><span class="l">Projected</span><span class="v">${esc(where)}</span><span class="l">Heard</span><span class="v">${esc(new Date(tx.at * 1000).toLocaleTimeString())}${tx.fed ? ' · from a node’s mempool' : ''}</span><span class="l">Inputs</span><span class="v">${ins}</span><span class="l">Outputs</span><span class="v">${outs}</span></div>`;
}
// a search that found nothing, in words that say where it looked; range: search.heightRange for a height not held
export function notFoundWords(r, { count = 0, range = null, floor = null, tip = null } = {}) {
  if (r.where === 'seen')
    return `this tab had it in its mempool at ${new Date(r.seen.at * 1000).toLocaleTimeString()} (${n(r.seen.vsize)} vB, ${rate(r.seen.feeRate)} sat/vB); it has since been confirmed or dropped`;
  if (r.where === 'many') {
    // the kinds found, by name: "3 transactions", "2 blocks", "2 transactions and 1 block"
    const tx = r.txs ?? 0,
      bl = r.blocks ?? 0;
    const what =
      tx && bl
        ? `${pl(tx, 'transaction')} and ${pl(bl, 'block')}`
        : bl
          ? pl(bl, 'block')
          : tx
            ? pl(tx, 'transaction')
            : pl(r.count, 'transaction or block', 'transactions and blocks');
    return `${what} start with that: type more of the id`;
  }
  if (r.height != null && range === 'below')
    return `block ${n(r.height)} is at or before the snapshot at ${n(floor)}: this tab started from the snapshot's coins and holds no blocks before it`;
  if (r.height != null && range === 'above')
    return `block ${n(r.height)} is above this tab's tip (${n(tip)}): not mined yet, or not yet here`;
  if (r.height != null && range === 'unknown') return `block ${n(r.height)}: this tab is not up to date yet; search again when it is`;
  const blocks = r.searched?.count
    ? `blocks ${n(r.searched.from)}–${n(r.searched.to)} (the last ${pl(r.searched.count, 'block')} this tab holds)`
    : 'no blocks yet';
  return `not in this tab's mempool (${pl(count, 'transaction')}), and not in ${blocks}; a tab keeps no history beyond that`;
}
