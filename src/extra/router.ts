import {Stream} from 'xstream';
import {senderOf, makeReplies} from './replies';

/*
 * makeRouter({ routes, base?, mode?, scroll?, focus?, prefetch?, navigate?, window?, ... })
 * (PLAN-3 §1.7, D81, D84). Public docs: src/index.d.ts and docs guide/router.md. Summary:
 *
 * - `routes`: { name: '/path/:param' | '*' }. First match wins; '*' is the not-found route.
 *   Matching ignores a trailing slash and empty segments; the reported `path` is normalised
 *   (no trailing slash, base removed). `href()` never adds a trailing slash.
 * - The returned object: `href(name, params?, query?, hash?)` and `match(url)` are pure (SSR);
 *   `current(url?)` reads the location (or `url`: SSR passes the request URL); `driver` is the
 *   driver for `run(App, { ROUTER: router.driver })`; `options` is what the 5-4c fake reuses.
 * - Reading: a component declares `App.route = 'ROUTE'` (a string static, `__sygnalStatic:
 *   'route'`); the driver replies ROUTE with `{ name, params, query, hash, path }` on
 *   declaration and on every change. `{ route }` is the declaration: commands never use it.
 * - Redirect order (G-168): the FIRST declarer (the outermost one: declarations are kept in
 *   mount order) is the guard owner. It gets each new route at once; the other declarers get it
 *   one macrotask later, and only if no newer navigation (a redirect from the guard's ROUTE
 *   entry, e.g. `ROUTER: { to: 'login', replace: true }`) happened in between.
 * - Commands: `{ to: name, params?, query?, hash?, replace?, scroll? }`, `{ url, replace? }`,
 *   `{ back: true }`, `{ forward: true }`, `{ go: n }`, `{ block: 'ACTION' | false }`,
 *   `{ prefetch: name | url, params?, query? }` (calls options.prefetch(route, url); else a
 *   no-op hook until the fetch cache, 5-5). `force: true` skips a block.
 * - Block: while a component has `{ block: 'ACTION' }`, an attempted navigation (link click,
 *   command, back/forward) is not made; the last blocker gets ACTION with `{ to, route,
 *   proceed }` (`proceed` is the command that makes it anyway). A back/forward is undone with
 *   history.go(-delta) first. beforeunload is prevented while any block is set.
 * - Links: document-level click interception of same-origin `<a href>` (HTML and SVG,
 *   inside shadow roots via composedPath(), resolved against <base>), except modified or
 *   non-left clicks, `target` other than _self, `download`, `rel="external"`,
 *   `data-router-ignore`, defaultPrevented, outside `base`, and (history mode) a hash-only link
 *   to the current page. Forms are left alone.
 * - Scroll (option `scroll`, default true): `history.state` carries `{ key, i }`; positions are
 *   kept per key in memory. Push: top (or the hash target after render); back/forward: the saved
 *   position after render; replace: unchanged (or the hash target). Reload: the browser's own
 *   (scrollRestoration goes back to 'auto' on pagehide).
 * - Focus (option `focus`, default '[data-router-focus],main h1,h1'; false disables): after a push or a
 *   back/forward, once the DOM has been quiet for `settleMs` (MutationObserver; capped at 1 s),
 *   the first match of the comma-separated selectors, tried in order, gets focus (tabindex=-1
 *   added when needed, preventScroll). Content that renders later (data still loading) is
 *   missed; the scroll restore has the same limit.
 * - No window (SSR): no listeners, no history, no replies; href/match/current(url) still work.
 * - Vike (`navigate` option, Vike's navigate()): no link interception (Vike owns links),
 *   navigation calls navigate(url, { overwriteLastHistoryEntry }), scroll is left to Vike, and
 *   the route is re-read on popstate and on the 'sygnal:navigate' event the Vike client hook
 *   dispatches before each client-side render.
 */

type Routes = Record<string, string>;

const enc = encodeURIComponent;
const dec = (s: string) => { try { return decodeURIComponent(s); } catch (_) { return s; } };
const g: any = globalThis;
const PARAM = /:(\w+)/g;

/** the names of the params a pattern requires */
export const paramsOf = (pat: string) => (pat.match(PARAM) || []).map(p => p.slice(1));

// the core's coded error() (published on the diagnostics bridge): no import, so the router
// costs nothing more standalone; prints in production too (like SYG611)
const bad = (v: any, msg: string, fix: string) => (g.__SYGNAL_DIAGNOSTICS__?.error || console.error)('SYG620', v.__emitterName, `router: ${msg}; not navigated`, fix, v);

export function makeRouter(options: any = {}) {
  const {mode, prefetch, navigate} = options, routes: Routes = options.routes || {};
  const base = (options.base || '').replace(/\/$/, '');
  const hashMode = mode == 'hash';
  const focusSel = options.focus ?? '[data-router-focus],main h1,h1';
  const doScroll = options.scroll ?? !navigate;

  const href = (name: string, params: any = {}, query?: any, hash?: string) => {
    // dev entry only (SYG130: unknown name, missing or extra params)
    g.__SYGNAL_DIAGNOSTICS__?.routerHref?.(routes, name, params);
    const pat = routes[name];
    const path = pat == null || pat == '*' ? '/' : pat.replace(PARAM, (_, k) => enc(params[k] ?? ''));
    const q = query && new URLSearchParams(Object.entries(query).filter(([, v]) => v != null) as any) + '';
    return base + (hashMode ? (base ? '/#' : '#') : '') + path + (q ? '?' + q : '') + (hash ? '#' + hash : '');
  };

  const matchPath = (path: string) => {
    const segs = path.split('/').filter(Boolean);
    let notFound: any = null;
    for (const name in routes) {
      const pat = routes[name];
      if (pat == '*') { notFound ??= name; continue; }
      const ps = pat.split('/').filter(Boolean), params: any = {};
      if (ps.length == segs.length && ps.every((p, i) => p[0] == ':' ? (params[p.slice(1)] = dec(segs[i]), 1) : p == segs[i])) return {name, params};
    }
    return {name: notFound, params: {}};
  };

  /** `{ name, params, query, hash, path }` for a URL (a path, or absolute) */
  const match = (url: string) => {
    let u = new URL(url, 'http://x');
    if (hashMode) u = new URL(u.hash.slice(1) || '/', 'http://x');
    let p = u.pathname;
    if (!hashMode && base && (p == base || p.startsWith(base + '/'))) p = p.slice(base.length);
    const path = '/' + p.split('/').filter(Boolean).join('/');
    return {...matchPath(path), query: Object.fromEntries(new URLSearchParams(u.search)), hash: dec(u.hash.slice(1)), path};
  };

  const win = () => options.window || (typeof window != 'undefined' ? window : null);
  const current = (url?: string) => {
    const w = win();
    return match(url ?? (w ? (options.location || w.location).href : '/'));
  };

  const driver = (sink$: Stream<any>) => {
    const w: any = win();
    const L: any = w && (options.location || w.location);
    const H: any = w && (options.history || w.history);
    const D: any = w && (options.document || w.document);
    // sender → reply action; insertion (mount) order: the first is the guard owner (G-168)
    const declared = new Map<any, string>();
    // sender → block action; the last one set gets the attempted navigation
    const blocks = new Map<any, string>();
    const pos = new Map<string, number[]>();
    let ver = 0, idx = 0, key = '', last = '', force = 0, undo = 0, n = 0;
    let cur: any = null, cancel: any = null, pendingKind = '';

    const newKey = () => Date.now().toString(36) + (n++);
    const stamp = (i: number) => ({key: (key = newKey()), i: (idx = i)});

    const settle = (kind: string) => {
      if (!D) return;
      pendingKind = cancel && kind == 'replace' ? pendingKind : kind;
      cancel?.();
      let t: any, mo: any;
      const done = () => {
        cancel?.();
        const k = pendingKind, h = cur.hash && D.getElementById(cur.hash), p = k == 'pop' && pos.get(key);
        if (doScroll) p ? w.scrollTo(p[0], p[1]) : h?.scrollIntoView?.();
        if (focusSel && k != 'replace') for (const sel of focusSel.split(',')) {
          const el = D.querySelector(sel);
          if (el) {
            if (el.tabIndex < 0 && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
            el.focus({preventScroll: true});
            break;
          }
        }
      };
      const quiet = () => { clearTimeout(t); t = setTimeout(done, options.settleMs ?? 30); };
      const cap = setTimeout(done, 1000);
      if (w.MutationObserver) (mo = new w.MutationObserver(quiet)).observe(D.body || D.documentElement, {childList: true, subtree: true, characterData: true});
      cancel = () => { clearTimeout(t); clearTimeout(cap); mo?.disconnect(); cancel = null; };
      quiet();
    };

    const emit = (kind: string) => {
      last = L.href;
      const r = (cur = current()), list = [...declared], v = ++ver;
      if (list.length) {
        reply(list[0][0], list[0][1], r);
        setTimeout(() => { if (ver == v) for (const [s, a] of list.slice(1)) if (declared.get(s) == a) reply(s, a, r); });
      }
      if (kind != 'start') settle(kind);
    };

    const blocked = (data: any) => {
      const b = [...blocks].pop();
      return b && (reply(b[0], b[1], data), 1);
    };

    const go = (url: string, replace?: boolean, scroll?: boolean, f?: any) => {
      if (!f && blocked({to: url, route: match(url), proceed: {url, replace, force: true}})) return;
      if (navigate) return navigate(url, {overwriteLastHistoryEntry: !!replace});
      pos.set(key, [w.scrollX, w.scrollY]);
      H[replace ? 'replaceState' : 'pushState'](stamp(replace ? idx : idx + 1), '', url);
      if (doScroll && !replace && scroll !== false) w.scrollTo(0, 0);
      emit(replace ? 'replace' : 'push');
    };

    const onPop = () => {
      const st = H.state, i = st?.i ?? idx + 1;
      if (undo) return void (undo = 0);
      if (!force && blocked({to: L.href, route: current(), proceed: {go: i - idx, force: true}})) {
        undo = 1;
        return H.go(idx - i);
      }
      force = 0;
      pos.set(key, [w.scrollX, w.scrollY]);
      if (st?.key) { key = st.key; idx = i; }
      else H.replaceState({...st, ...stamp(i)}, '');
      if (L.href != last) emit('pop');
    };

    const onClick = (e: any) => {
      if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.composedPath?.() || []).find((x: any) => x.localName == 'a') || e.target?.closest?.('a');
      const at = (k: string) => a.getAttribute(k);
      const raw = a && (at('href') ?? a.getAttributeNS?.('http://www.w3.org/1999/xlink', 'href'));
      if (raw == null || (at('target') || '_self') != '_self' || a.hasAttribute('download') ||
          a.hasAttribute('data-router-ignore') || /(^|\s)external(\s|$)/i.test(at('rel') || '')) return;
      const u = new URL(raw, D.baseURI || L.href), same = u.pathname == L.pathname && u.search == L.search;
      if (u.origin != L.origin) return;
      if (hashMode ? !(same && u.hash.startsWith('#/')) : (base && u.pathname != base && !u.pathname.startsWith(base + '/')) || (u.hash && same)) return;
      e.preventDefault();
      go(u.pathname + u.search + u.hash);
    };

    const onUnload = (e: any) => { e.preventDefault(); e.returnValue = ''; };
    const onHide = () => { H.scrollRestoration = 'auto'; };
    const listen = (on: boolean) => {
      const m = on ? 'addEventListener' : 'removeEventListener';
      w[m]('popstate', onPop);
      if (hashMode) w[m]('hashchange', onPop);
      if (navigate) w[m]('sygnal:navigate', onNav);
      else D[m]('click', onClick);
      if (doScroll) w[m]('pagehide', onHide);
    };
    const syncUnload = () => w?.[blocks.size ? 'addEventListener' : 'removeEventListener']('beforeunload', onUnload);
    // Vike: the client hook says a navigation happened (Vike already updated the URL)
    // (once the hook's microtasks ran, and again a task later in case the URL changes after it)
    const onNav = () => { const f = () => L.href != last && emit('push'); queueMicrotask(f); setTimeout(f); };

    const {replies, reply} = makeReplies(s => {
      declared.delete(s);
      if (blocks.delete(s)) syncUnload();
    });

    const stop = () => {
      if (!w) return;
      listen(false);
      blocks.clear();
      syncUnload();
      cancel?.();
      onHide();
    };

    if (w) {
      const st = H.state;
      if (st?.key) { key = st.key; idx = st.i; }
      else H.replaceState({...st, ...stamp(0)}, '');
      if (doScroll && 'scrollRestoration' in H) H.scrollRestoration = 'manual';
      listen(true);
      emit('start');
    }

    const target = (v: any, name: any) => {
      if (!(name in routes) || routes[name] == '*') return bad(v, `no route named '${name}'`, `Use one of: ${Object.keys(routes).filter(k => routes[k] != '*').join(', ')}`);
      const missing = paramsOf(routes[name]).filter(k => v.params?.[k] == null);
      if (missing.length) return bad(v, `route '${name}' (${routes[name]}) needs params: ${missing.join(', ')}`, `{ to: '${name}', params: { ${missing.join(', ')} } }`);
      return href(name, v.params, v.query, v.hash);
    };

    sink$.addListener({
      next: (v: any) => {
        if (!v || typeof v != 'object') return;
        const s = senderOf(v);
        if ('route' in v) {
          // the core sends { route: 'ACTION' } (or a falsy value) for a component's `route` static
          if (Object.keys(v).length > 1 || v.route in routes) return bad(v, '`route` is the declaration key', "Navigate with { to: 'name', params }");
          if (!v.route || s === undefined) return void declared.delete(s);
          declared.set(s, v.route);
          // the guard owner (first declarer) at once; the others after it could redirect
          const v0 = ver, f = () => declared.get(s) == v.route && ver == v0 && reply(s, v.route, cur);
          if (cur) declared.keys().next().value === s ? queueMicrotask(f) : setTimeout(f);
        } else if ('block' in v) {
          v.block ? blocks.set(s, v.block) : blocks.delete(s);
          syncUnload();
        } else if ('prefetch' in v) {
          const url = v.prefetch in routes ? target({...v, to: v.prefetch}, v.prefetch) : v.prefetch;
          if (url) prefetch?.(match(url), url);
        } else if (!w) return;
        else if (v.back || v.forward || v.go) {
          force = v.force ? 1 : 0;
          H.go(v.back ? -1 : v.forward ? 1 : v.go);
        } else if (v.to != null || v.url != null) {
          const url = v.url ?? target(v, v.to);
          if (url) go(url, v.replace, v.scroll, v.force);
        } else bad(v, 'unknown command', "{ to: 'name', params?, query?, hash?, replace? }, { back: true }, { forward: true }, { block: 'ACTION' } or { prefetch: 'name' }");
      },
      error: (e: any) => console.error('[Sygnal] router', e),
      complete: stop,
    });

    return {...replies, __sygnalStatic: 'route', __sygnalRouter: options, current: () => cur, href, dispose: stop};
  };

  return {routes, href, match, current, driver, options};
}

/** `makeRouter(options).driver`: for a router whose href() the app doesn't need */
export const makeRouterDriver = (options: any) => makeRouter(options).driver;
