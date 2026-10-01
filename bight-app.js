// Bight as a solid-apps registry App (hub-pod app interface): meta + render. The node runs inside the page in an
// iframe, so its storage (the snapshot in OPFS) belongs to Reef's own origin and one copy serves every host.
export const meta = {
  id: 'https://bitcoin-blake.github.io/reef/bight-app.js',
  name: 'Bight',
  icon: '🌊',
  description:
    "A mempool monitor in a tab, in the mempool.space shape: every transaction validated by the tab's own node, and the next block is the one this tab would build. BLAKE2b testnet4.",
};
export function render(container, ctx = {}) {
  container.innerHTML = '';
  const f = document.createElement('iframe');
  f.src = 'https://bitcoin-blake.github.io/bight/?embedded=1' + (ctx.params ? '&' + new URLSearchParams(ctx.params) : '');
  f.title = 'Bight';
  f.allow = 'clipboard-write';
  f.style.cssText = 'width:100%;height:100%;min-height:640px;border:0;background:#d9dde3';
  container.appendChild(f);
  // File → Exit inside the pane asks the host to minimize it; a host with a dock can act on this, others ignore it
  const onMsg = (e) => {
    if (e.source === f.contentWindow && e.data?.source === 'reef' && e.data.type === 'minimize') ctx.minimize?.();
  };
  addEventListener('message', onMsg);
  return () => {
    removeEventListener('message', onMsg);
    f.remove();
  };
}
export default { meta, render };
