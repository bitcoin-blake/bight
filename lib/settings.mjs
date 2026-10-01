// What Settings → OK writes for the sources: only a field the person changed, an empty field meaning the default; and the
// default stored explicitly when a source Reef stored would otherwise come back (the page reads Bight's key, then Reef's).
// → [{ key, set } | { key, del: true }]. Pure; tested in test/lib-test.mjs.
export function sourceWrites({ fields, bight = {}, reef = {}, defaults }) {
  const out = [];
  for (const k of ['snapshot', 'blocks']) {
    const want = (fields[k] ?? '').trim() || defaults[k];
    const current = bight[k] ?? reef[k] ?? defaults[k];
    if (want === current) continue;
    if (want === defaults[k])
      out.push(reef[k] && reef[k] !== defaults[k] ? { key: 'bight:' + k, set: want } : { key: 'bight:' + k, del: true });
    else out.push({ key: 'bight:' + k, set: want });
  }
  return out;
}
