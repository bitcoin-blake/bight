// Words and links: escaping for markup, ages, block ETAs, the explorer.
export const esc = (x) =>
  String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const fmtAge = (s) => (s < 60 ? `${s} s` : s < 3570 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);
export const BLOCK_MIN = 20; // the chain's target spacing, in minutes
export const etaWords = (i) => (i === 0 ? 'next block' : `in ~${(i + 1) * BLOCK_MIN} min`);
export const EXPLORER = 'https://mempool.guide/testnet4';
export const hex64 = (x) => /^[0-9a-f]{64}$/.test(String(x));
export const txUrl = (txid) => (hex64(txid) ? `${EXPLORER}/tx/${txid}` : '#');
export const blockUrl = (hash) => (hex64(hash) ? `${EXPLORER}/block/${hash}` : '#');
export const n = (x) => Number(x).toLocaleString('en-US');
