import {Stream} from 'xstream';
import {senderOf, makeReplies} from './replies';

/*
 * makeHeadDriver({ titleTemplate?, document? }) (PLAN-3 §1.7, X-1). Docs: src/index.d.ts and
 * docs guide/head.md. Summary:
 *
 * - Values `{ title?, meta?: { [name | property]: content | null }, link?: [{ rel, href, key?, ... }] }`
 *   come from a component's `head` static (`App.head = state => ({ title })`, sent as
 *   `{ head }`, `__sygnalStatic: 'head'`) or from a model entry (`HEAD: (s, d) => ({ title })`).
 *   Each component instance has one entry, replaced by its next value; a falsy value or the
 *   instance's dispose removes it.
 * - Merge, in mount order (first declaration; a removed entry that comes back goes last): a
 *   later `title` wins, `meta` keys merge (null removes a key), `link`s merge by `key`, else by
 *   `rel` for canonical, else by `rel` + `href`. Meta keys with an `og:`/`article:`/... prefix
 *   use `property`, the others `name`.
 * - DOM: `document.title` (the page's original title when no entry sets one); meta and link
 *   tags it creates carry `data-sygnal-head="<key>"`. An existing unmarked `<meta>` with the same
 *   name is updated and restored when no entry sets it. Marked tags from SSR (`renderHead()`)
 *   are adopted, or removed once no entry sets them.
 * - SSR: `renderToString(App, { head: list })` pushes each rendered component's `head` static
 *   into `list`; `renderHead(list, { titleTemplate })` gives the tags. No document: no-op.
 */

const PROPERTY = /^(og|fb|article|book|profile|music|video|al):/;
const esc = (s: any) => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const attrOf = (k: string) => PROPERTY.test(k) ? 'property' : 'name';

/** merged `{ title, meta: [[key, content]], link: [[key, attrs]] }` of head values, in order */
export function mergeHead(list: any[], titleTemplate?: string) {
  let title: any;
  const meta: Record<string, any> = {}, link: Record<string, any> = {};
  for (const h of list) {
    if (!h || typeof h != 'object') continue;
    if (h.title != null) title = h.title;
    Object.assign(meta, h.meta);
    for (const l of h.link || []) if (l) link['l:' + (l.key ?? (l.rel == 'canonical' ? l.rel : l.rel + ' ' + l.href))] = l;
  }
  return {
    title: title != null && titleTemplate ? titleTemplate.replace('%s', title) : title,
    meta: Object.keys(meta).filter(k => meta[k] != null).map(k => ['m:' + k, k, meta[k]]),
    link: Object.entries(link),
  };
}

/** the `<title>`, `<meta>` and `<link>` tags of head values (SSR) */
export function renderHead(list: any[], options: {titleTemplate?: string} = {}): string {
  const m = mergeHead(list, options.titleTemplate);
  const attrs = (o: any) => Object.keys(o).filter(k => k != 'key' && o[k] != null && o[k] !== false).map(k => ` ${k}="${esc(o[k])}"`).join('');
  return (m.title != null ? `<title>${esc(m.title)}</title>` : '') +
    m.meta.map(([key, k, c]) => `<meta${attrs({[attrOf(k)]: k, content: c})} data-sygnal-head="${esc(key)}">`).join('') +
    m.link.map(([key, l]) => `<link${attrs(l)} data-sygnal-head="${esc(key)}">`).join('');
}

export function makeHeadDriver(options: {titleTemplate?: string, document?: any} = {}) {
  return (sink$: Stream<any>) => {
    const d: any = options.document || (typeof document != 'undefined' ? document : null);
    const entries = new Map<any, any>();
    // key → element this driver manages; adopted: element → its original content
    const made = new Map<string, any>(), adopted = new Map<any, any>();
    const title0 = d?.title;
    d?.querySelectorAll('[data-sygnal-head]').forEach((el: any) => made.set(el.getAttribute('data-sygnal-head'), el));

    const set = (el: any, o: any) => { for (const k in o) if (k != 'key') o[k] == null || o[k] === false ? el.removeAttribute(k) : el.setAttribute(k, o[k]); };
    const apply = () => {
      if (!d) return;
      const m = mergeHead([...entries.values()], options.titleTemplate), want = new Set<string>();
      d.title = m.title ?? title0;
      const put = (key: string, tag: string, o: any, find?: string) => {
        want.add(key);
        let el = made.get(key);
        if (!el) {
          el = find && d.head.querySelector(find);
          if (el) adopted.set(el, el.getAttribute('content'));
          else (el = d.createElement(tag)).setAttribute('data-sygnal-head', key), d.head.appendChild(el);
          made.set(key, el);
        }
        set(el, o);
      };
      for (const [key, k, c] of m.meta) put(key, 'meta', {[attrOf(k)]: k, content: c}, `meta[${attrOf(k)}="${k}"]`);
      for (const [key, l] of m.link) put(key, 'link', l);
      made.forEach((el, key) => {
        if (want.has(key)) return;
        made.delete(key);
        if (adopted.has(el)) set(el, {content: adopted.get(el)}), adopted.delete(el);
        else el.remove();
      });
    };

    const {replies} = makeReplies(s => { if (entries.delete(s)) apply(); });

    sink$.addListener({
      next: (v: any) => {
        if (!v || typeof v != 'object') return;
        const s = senderOf(v), h = 'head' in v ? v.head : v;
        if (h && typeof h == 'object') entries.set(s, h);
        else entries.delete(s);
        apply();
      },
      error: (e: any) => console.error('[Sygnal] head', e),
    });

    const dispose = () => { entries.clear(); apply(); };
    return {...replies, __sygnalStatic: 'head', dispose};
  };
}
