// Where the node reads the chain from: what Settings stored (Bight's own, then Reef's: the same origin and files), or the
// defaults. A link may propose others (?snapshot=, ?blocks=); they are used only for a visit the person agreed to, and
// never stored. Options are coerced to their types. Pure; tested in test/lib-test.mjs.
export const DEFAULT_SNAP = 'https://melvin.me/public/txbt4/utxo-knots-150307.dat';
export const DEFAULT_BLOCKS = 'https://melvin.me/public/txbt4/txbt4-blocks';
const url = (v) => (typeof v === 'string' && /^https:\/\/[^\s<>"]+$/.test(v.trim()) ? v.trim() : null);
// get(key) reads storage; query: URLSearchParams; accepted(key) → the proposed value the person accepted for this visit
export function resolveSources({ get = () => null, query = new URLSearchParams(), accepted = () => null } = {}) {
  const stored = {
    snapshot: url(get('bight:snapshot')) ?? url(get('reef:snapshot')) ?? DEFAULT_SNAP,
    blocks: url(get('bight:blocks')) ?? url(get('reef:blocks')) ?? DEFAULT_BLOCKS,
  };
  const proposed = {};
  for (const k of ['snapshot', 'blocks']) {
    const v = query.get(k);
    if (v != null && v.trim() !== '' && v.trim() !== stored[k]) proposed[k] = url(v) ?? v.trim();
  }
  const use = {
    snapshot:
      proposed.snapshot && accepted('snapshot') === proposed.snapshot && url(proposed.snapshot) ? proposed.snapshot : stored.snapshot,
    blocks: proposed.blocks && accepted('blocks') === proposed.blocks && url(proposed.blocks) ? proposed.blocks : stored.blocks,
  };
  return { stored, proposed, use };
}
export const OPT_DEFAULTS = { torrent: false, seed: false };
export function parseOptions(raw) {
  let o = {};
  try {
    o = JSON.parse(raw ?? '{}') ?? {};
  } catch {}
  return { torrent: o.torrent === true, seed: o.seed === true };
}
export const validUrl = url;
// the sources in use that are not the defaults (a link accepted for this visit, or one stored in Settings, Bight's or Reef's)
export const nonDefault = (use) =>
  Object.entries({ snapshot: DEFAULT_SNAP, blocks: DEFAULT_BLOCKS })
    .filter(([k, d]) => use[k] && use[k] !== d)
    .map(([k]) => k);
export const hostOf = (v) => {
  try {
    return new URL(v).host;
  } catch {
    return String(v ?? '');
  }
};
