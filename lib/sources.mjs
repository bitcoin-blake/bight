// Where the node reads the chain from: what Settings stored (Bight's own, then Reef's: the same origin and files), or the
// defaults. A link may propose others (?snapshot=, ?blocks=); they are used only for a visit the person agreed to, and
// never stored. The default snapshot is the one the pinned node expects (its params' SNAPSHOT.file on the mirror), so a node
// with a new snapshot moves the default with it; a stored "default" means whatever the default is then, not a URL frozen
// at the time. Options are coerced to their types. Pure; tested in test/lib-test.mjs.
export const MIRROR = 'https://melvin.me/public/txbt4/';
export const DEFAULT_SNAP = MIRROR + 'utxo-knots-150307.dat'; // the node's at the pin (test/release-test.mjs checks it)
export const DEFAULT_BLOCKS = MIRROR + 'txbt4-blocks';
export const defaultsFor = (params) => ({
  snapshot: params?.SNAPSHOT?.file ? MIRROR + params.SNAPSHOT.file : DEFAULT_SNAP,
  blocks: DEFAULT_BLOCKS,
});
const url = (v) => (typeof v === 'string' && /^https:\/\/[^\s<>"]+$/.test(v.trim()) ? v.trim() : null);
// a stored source: an https address, the word "default", or nothing usable (null)
export const storedValue = (v) => (v === 'default' ? 'default' : url(v));
// get(key) reads storage; query: URLSearchParams; accepted(key) → the proposed value the person accepted for this visit
export function resolveSources({
  get = () => null,
  query = new URLSearchParams(),
  accepted = () => null,
  defaults = { snapshot: DEFAULT_SNAP, blocks: DEFAULT_BLOCKS },
} = {}) {
  const pick = (k) => {
    const v = storedValue(get('bight:' + k)) ?? storedValue(get('reef:' + k));
    return v == null || v === 'default' ? defaults[k] : v;
  };
  const stored = { snapshot: pick('snapshot'), blocks: pick('blocks') };
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
export const nonDefault = (use, defaults = { snapshot: DEFAULT_SNAP, blocks: DEFAULT_BLOCKS }) =>
  Object.entries(defaults)
    .filter(([k, d]) => use[k] && use[k] !== d)
    .map(([k]) => k);
export const hostOf = (v) => {
  try {
    return new URL(v).host;
  } catch {
    return String(v ?? '');
  }
};
