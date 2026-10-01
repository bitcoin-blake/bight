// Bight as a solid-apps registry App (hub-pod app interface): meta + render. The node runs inside the page in an iframe.
// Its storage (the snapshot in OPFS, the node lock) belongs to bitcoin-blake.github.io as embedded in the host: browsers that
// partition storage by top-level site give a host on another site its own copy (a second 830 MB download) and its own lock.
export const meta = {
  id: 'https://bitcoin-blake.github.io/bight/bight-app.js',
  name: 'Bight',
  icon: '🌊',
  description:
    "A mempool monitor in a tab, in the mempool.space shape: every transaction validated by the tab's own node, and the next block is the one this tab would build. BLAKE2b testnet4.",
};
export function render(container, ctx = {}) {
  container.innerHTML = '';
  const f = document.createElement('iframe');
  // only the page's own options travel: the sources (snapshot, blocks) are never set by a host
  const params = new URLSearchParams(ctx.params ?? {});
  params.delete('snapshot');
  params.delete('blocks');
  f.src = 'https://bitcoin-blake.github.io/bight/?embedded=1' + (params.size ? '&' + params : '');
  f.title = 'Bight';
  f.style.cssText = 'width:100%;height:100%;min-height:640px;border:0;background:#0d0f1a';
  container.appendChild(f);
  return () => f.remove();
}
export default { meta, render };
