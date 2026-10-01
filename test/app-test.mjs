// The registry app (bight-app.js) with a stand-in for the document: it frames the page embedded, passes the host's own
// options on, never a source (snapshot, blocks), and removes its frame when the host unmounts it.
import { t, done } from './h.mjs';
const made = [];
globalThis.document = {
  createElement: (tag) => {
    const el = {
      tag,
      style: {},
      removed: false,
      remove() {
        this.removed = true;
      },
    };
    made.push(el);
    return el;
  },
};
const app = await import('../bight-app.js');
const container = {
  innerHTML: 'old',
  kids: [],
  appendChild(el) {
    this.kids.push(el);
  },
};
const off = app.render(container, { params: { theme: 'light', snapshot: 'https://evil.example/s.dat', blocks: 'https://evil.example/b' } });
const f = container.kids[0];
const u = new URL(f.src);
t('it replaces what the container held with one frame', container.innerHTML === '' && container.kids.length === 1 && f.tag === 'iframe');
t(
  'the frame is the published page, embedded',
  u.origin + u.pathname === 'https://bitcoin-blake.github.io/bight/' && u.searchParams.get('embedded') === '1',
);
t('the host’s own options travel', u.searchParams.get('theme') === 'light');
t('a source never travels from a host', !u.searchParams.has('snapshot') && !u.searchParams.has('blocks'), f.src);
t('the frame has a title', f.title === 'Bight');
off();
t('unmounting removes the frame', f.removed === true);
const c2 = {
  innerHTML: '',
  kids: [],
  appendChild(el) {
    this.kids.push(el);
  },
};
app.render(c2);
t('with no options, only embedded=1', c2.kids[0].src === 'https://bitcoin-blake.github.io/bight/?embedded=1');
t(
  'the meta names the app by its published address',
  app.meta.id === 'https://bitcoin-blake.github.io/bight/bight-app.js' && app.default.render === app.render,
);
done();
