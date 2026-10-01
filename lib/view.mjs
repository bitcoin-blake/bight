// The page's pieces as markup strings and words: the block tiles (their content and accessible names), the block and
// projected-block details, a mempool transaction, a search that found nothing. Every value is escaped here. Pure; tested in
// test/lib-test.mjs. The page only puts these into the document, patching in place so focus and selection survive.
import { esc, n, fmtAge, etaWords, txUrl, blockUrl } from './fmt.mjs';
const rate = (x) => (x == null ? '—' : x.toFixed(1));
const ext = (url, what) =>
  `<a class="ext" href="${esc(url)}" target="_blank" rel="noopener" aria-label="${esc(what)} on mempool.guide (another site, not checked by this tab)" title="on mempool.guide: another site, not checked by this tab">↗</a>`;
// a projected block: built = the worker's own build figures when current and passing (block 0 only)
export function projTile(b, i, { built = null, failed = false } = {}) {
  const head = etaWords(i);
  const units = `${n(b.vsize)} vB · ${n(b.txs.length)} tx · ${n(b.fees)} sat`;
  const html = `<span class="h">${esc(head)}${built ? ' <span class="badge">✓ built</span>' : ''}</span><span class="r">~${esc(rate(b.wmed))} sat/vB</span><span class="s">${esc(rate(b.min))} – ${esc(rate(b.max))} sat/vB</span><span class="s">${esc(units)}</span>${failed ? '<span class="s">build fails</span>' : ''}`;
  const label = `${head}: about ${rate(b.wmed)} sat per vB (by size), ${rate(b.min)} to ${rate(b.max)}; ${units}${built ? '; built by the node, every rule it checks passes' : ''}${failed ? '; the node’s build fails' : ''}`;
  return { html, label };
}
// the next block when the mempool is empty: the coinbase alone, built when the worker's build passes
export function emptyNextTile({ built = false, words = 'the mempool is empty' } = {}) {
  return {
    html: `<span class="h">next block${built ? ' <span class="badge">✓ built</span>' : ''}</span><span class="s">${esc(built ? 'empty: the coinbase only' : words)}</span>`,
    label: `next block: ${built ? 'empty, the coinbase only, built by the node' : words}`,
  };
}
// a mined block: med = size-weighted median of the transactions this tab knew (known of others)
export function minedTile(b, { med = null, known = 0, others = 0, seenWords = '', unsigned = false, ageS = 0 } = {}) {
  const rateWords = med != null ? `~${rate(med)} sat/vB` : 'fees unknown';
  const of = med != null && known < others ? ` (of ${n(known)} known)` : '';
  const html = `<span class="h">${esc(n(b.height))}</span><span class="r">${esc(rateWords)}<span class="sub">${esc(of)}</span></span><span class="s">${esc(n(b.size))} B · ${esc(n(b.nTx))} tx</span><span class="s">${esc(seenWords)}</span><span class="s">${unsigned ? 'not signed yet' : `${esc(fmtAge(ageS))} ago`}</span>`;
  const label = `block ${n(b.height)}${unsigned ? ', not signed yet' : `, ${fmtAge(ageS)} ago`}: ${rateWords}${of}, ${n(b.nTx)} transactions, ${n(b.size)} bytes, ${seenWords}`;
  return { html, label };
}
// the detail of a mined block; sw = seen.blockSeen; foundTxid: the transaction a search found in it (highlighted)
export function blockDetail(b, { sw, seenTx, signedWords, inMempool = 0, foundTxid = null, cap = 200 }) {
  const rows = b.txids
    .slice(0, cap)
    .map((t, i) => {
      const f = seenTx.get(t);
      const seenCol = f
        ? `${fmtAge(Math.max(0, (b.arrivedAt ?? b.time) - f.at))} before the block`
        : i === 0
          ? ''
          : sw.counted
            ? 'not seen'
            : '—';
      return `<tr data-t="${esc(t)}"${t === foundTxid ? ' class="hi"' : ''}><td class="mono">${esc(t.slice(0, 20))}…${i === 0 ? ' <span class="mut">coinbase</span>' : ''} ${ext(txUrl(t), 'transaction ' + t.slice(0, 12))}</td><td class="amt">${f ? esc(n(f.vsize)) : '—'}</td><td class="amt">${f ? esc(n(f.fee)) : '—'}</td><td class="amt">${f ? esc(rate(f.feeRate)) : '—'}</td><td>${esc(seenCol)}</td></tr>`;
    })
    .join('');
  const more = b.txids.length > cap ? `<p class="note">and ${esc(n(b.txids.length - cap))} more</p>` : '';
  return `<h2 id="dtitle">${foundTxid ? `Found in block ${esc(n(b.height))}` : `Block ${esc(n(b.height))}`}</h2><div class="kv"><span class="l">Hash</span><span class="v mono" style="text-align:left">${esc(b.hash)} ${ext(blockUrl(b.hash), 'block ' + n(b.height))}</span><span class="l">Time (the miner's)</span><span class="v">${esc(new Date(b.time * 1000).toLocaleString())}</span><span class="l">Transactions</span><span class="v">${esc(n(b.nTx))} (${esc(n(b.size))} bytes)</span><span class="l">Seen in this tab's mempool first</span><span class="v">${esc(sw.counted ? `${sw.seen} of ${sw.others}` : sw.words)}${inMempool ? ` · ${inMempool} still listed until the next check` : ''}</span>${sw.knownCount ? `<span class="l">Fees this tab knew</span><span class="v">${esc(n(sw.knownFees))} sat over ${esc(sw.knownCount)} tx</span>` : ''}<span class="l">Validated by</span><span class="v">this tab · ${esc(signedWords)}</span></div>${sw.knownCount < sw.others ? `<p class="note">Fees are shown for the transactions this tab had in its mempool before the block; a UTXO node keeps no history for the rest.</p>` : ''}<table><caption class="sr">Transactions in block ${esc(n(b.height))}</caption><thead><tr><th scope="col">Transaction</th><th scope="col" class="amt">vB</th><th scope="col" class="amt">Fee</th><th scope="col" class="amt">sat/vB</th><th scope="col">Seen</th></tr></thead><tbody>${rows}</tbody></table>${more}`;
}
// the detail of a projected block; tw = node-text.templateWords for block 0
export function projDetail(b, i, { tw = null, asOf = '', built = null, cap = 200 }) {
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
          built && (built.txs !== b.txs.length || Math.abs(Math.ceil(built.weight / 4) - b.vsize) > b.txs.length * 3 + 1000)
            ? `<span class="l">Why they differ</span><span class="v" style="text-align:left">the page packs by size in vB and the node by exact weight, with its coinbase; near a full block the two can choose differently</span>`
            : ''
        }`
      : '';
  return `<h2 id="dtitle">${i === 0 ? 'The next block, as this tab would build it' : `Projected block ${i + 1}`} <span class="mut">as of ${esc(asOf)}</span></h2><div class="kv"><span class="l">Packed by this page</span><span class="v">${esc(n(b.txs.length))} tx · ${esc(n(b.vsize))} vB · ${esc(n(b.fees))} sat</span><span class="l">Fee rates</span><span class="v">${esc(rate(b.min))} – ${esc(rate(b.max))} sat/vB, median ${esc(rate(b.wmed))} (by size)</span>${builtRows}</div><p class="note">Packed by fee rate from the mempool this tab holds, the way the node builds its block: what does not fit is skipped and the next tried. The first is also built in full by the node (coinbase, witness commitment, header) and checked against the block rules it knows.</p><table><caption class="sr">Transactions in ${i === 0 ? 'the next block' : 'projected block ' + (i + 1)}</caption><thead><tr><th scope="col">Transaction</th><th scope="col" class="amt">vB</th><th scope="col" class="amt">Fee</th><th scope="col" class="amt">sat/vB</th></tr></thead><tbody>${rows}</tbody></table>${more}`;
}
// one transaction of the mempool (as the node's mempool-tx reply, or the page's own copy)
export function mempoolTxDetail(tx) {
  const ins = (tx.inputs ?? []).map((k) => `${esc(String(k).slice(0, 16))}…:${esc(String(k).split(':')[1] ?? '')}`).join(', ') || '—';
  const outs = (tx.outputs ?? []).map((o) => `${esc(n(o.value))} sat → ${esc(String(o.scriptPubKey).slice(0, 20))}…`).join('<br>') || '—';
  return `<h2 id="dtitle">In this tab's mempool</h2><div class="kv"><span class="l">Transaction</span><span class="v mono" style="text-align:left">${esc(tx.txid)} ${ext(txUrl(tx.txid), 'transaction')}</span><span class="l">Size</span><span class="v">${esc(n(tx.vsize))} vB</span><span class="l">Fee</span><span class="v">${esc(n(tx.fee))} sat · ${esc(rate(tx.feeRate))} sat/vB</span><span class="l">Heard</span><span class="v">${esc(new Date(tx.at * 1000).toLocaleTimeString())}${tx.fed ? ' · from a node’s mempool' : ''}</span><span class="l">Inputs</span><span class="v" style="text-align:left">${ins}</span><span class="l">Outputs</span><span class="v" style="text-align:left">${outs}</span></div>`;
}
// a search that found nothing, in words that say where it looked
export function notFoundWords(r, { count = 0 } = {}) {
  if (r.where === 'seen')
    return `this tab had it in its mempool at ${new Date(r.seen.at * 1000).toLocaleTimeString()} (${n(r.seen.vsize)} vB, ${rate(r.seen.feeRate)} sat/vB); it has since been confirmed or dropped`;
  if (r.where === 'many') return `${n(r.count)} transactions in the mempool start with that: type more of the id`;
  const blocks = r.searched?.count
    ? `blocks ${n(r.searched.from)}–${n(r.searched.to)} (the last ${r.searched.count} this tab holds)`
    : 'no blocks yet';
  return `not in this tab's mempool (${n(count)} transactions), and not in ${blocks}; a tab keeps no history beyond that`;
}
