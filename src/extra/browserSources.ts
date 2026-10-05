import {makeReplies} from './replies';
import {defHooks} from '../core/registry';

/*
 * PLAN-5 B-3: browser sources, in the timers declaration shape (GS-7, S-8). A component declares
 * what it watches as a function of its state; each entry's events come back as its own actions:
 *
 *   Card.browser = (state) => ({
 *     seen:  !state.seen && { intersection: '.cover', action: 'SEEN' },
 *     dark:  { media: '(prefers-color-scheme: dark)', action: 'DARK' },
 *   })
 *   run(App, { BROWSER: makeBrowserDriver() })
 *
 * - Declaration: `C.browser = (state) => ({ [name]: spec | falsy })` (or an object of such
 *   functions), the spec's kind being the source key it has (the first of KINDS): `intersection` / `resize` (a selector in
 *   the component's own DOM, or `true` for its root element), `media` (a query), `storage` (a key;
 *   `area: 'session'`, `json: true`), `visibility: true`, `online: true`, `geolocation` (true or
 *   PositionOptions). `action` names the action; `error` (geolocation, storage) the failure one.
 * - Diffed per (instance, name), comparing specs structurally, as timers: a new name starts, a
 *   removed or falsy one stops, a changed spec restarts. The core sends only `background: true`
 *   entries while the instance is on a hidden Switchable page (they restart when it's shown);
 *   dispose stops them, app dispose stops all; SSR runs no drivers.
 * - Sources that have a current value (media, storage, visibility, online) send it when they
 *   start; intersection / resize send what their observer reports (each element once at first).
 * - Commands, sent on the driver's sink from a model entry (the first key is the method):
 *   `{ copy: text, ok?, error? }` and `{ paste: true, ok, error? }` (the clipboard, data
 *   `{ text }`), `{ setItem: key, value, area?, json? }` / `{ removeItem: key, area? }` (storage;
 *   this page's `storage` declarations see the change: a synthetic `storage` event).
 * - The core has no code for any of it (0 B): the driver's source is marked `__sygnalStatic:
 *   'browser'` (statics.ts) and answers with reply actions (replies.ts). A component's DOM
 *   (intersection, resize) reaches the driver through a definition hook registered by the first
 *   driver made (renderComponent's fake too): it binds each declaring instance's DOM source at
 *   its creation (G-383: a definition cached before the hook existed is made again, define.ts).
 * - Unused sources cost nothing with makeBrowserDriverWith(intersectionSource, ...);
 *   makeBrowserDriver() has them all.
 * - Diagnostics (dev entry, through the `browserSource` hook): SYG663 an invalid spec or command,
 *   SYG664 a kind the driver wasn't made with, SYG665 a failure with no `error` action, SYG666
 *   an intersection / resize declaration with nothing to observe (no DOM source bound). A
 *   component declaring `browser` with no driver is SYG643, as timers.
 */

const g: any = globalThis;
const noop = () => {};
const KINDS = ['intersection', 'resize', 'media', 'storage', 'visibility', 'online', 'geolocation'];
const diag = (...a: any[]) => g.__SYGNAL_DIAGNOSTICS__?.browserSource?.(...a);

/** What a declared source gets: the instance's DOM source, its action, its failure */
export interface BrowserCtx {
  dom: any;
  send: (data: any) => void;
  fail: (data: any) => void;
  /** G-383: a DOM-backed source that has nothing to observe reports it (SYG666; dev entry) */
  miss: (why: string) => void;
}
/** A browser source: the declaration kinds (`d`) and sink commands (`c`) it adds to the driver */
export interface BrowserSource {
  d?: Record<string, (spec: any, ctx: BrowserCtx) => (() => void) | void>;
  c?: Record<string, (cmd: any, ok: (data: any) => void, fail: (data: any) => void) => void>;
}

// the driver names in use (the definition hook looks each up in a declaring instance's sources)
const names = new Set<string>();
let hooked: any;
const hook = () => hooked ||= defHooks.push((src: any, view: any) => view.browser == null ? undefined : {
  ...src,
  intent: (so: any) => {
    for (const n of names) if (n in so) so[n]?.__b?.(so.DOM);
    return src.intent ? src.intent(so) : {};
  },
});

/** `{ ...el.dataset }` and its place among the target's elements */
const where = (els: any[], el: any) => ({index: els.indexOf(el), dataset: {...el.dataset}});

/**
 * Observe the elements `target` selects in the instance's DOM (`true`: its root element) with an
 * observer made by `make` (IntersectionObserver, ResizeObserver): new ones are observed and gone
 * ones unobserved after every patch. Nothing without a DOM source or the observer.
 */
const track = (c: BrowserCtx, target: any, Obs: any, opts: any, data: (e: any) => any) => {
  if (!c.dom) return c.miss('dom');
  if (!Obs) return;
  let els: any[] = [];
  const o = new Obs((es: any[]) => es.forEach(e => c.send({...data(e), ...where(els, e.target)})), opts);
  const $ = c.dom.select(target === true ? '' : '' + target).elements();
  const l = {next: (now: any[]) => {
    for (const e of now) els.includes(e) || o.observe(e);
    for (const e of els) now.includes(e) || o.unobserve(e);
    els = [...now];
  }};
  $.addListener(l);
  return () => { $.removeListener(l); o.disconnect(); };
};

/** Element visibility: `{ intersection: '.cover' | true, action, threshold?, rootMargin? }`, data `{ visible, ratio, index, dataset }` */
export const intersectionSource: BrowserSource = {d: {
  intersection: (s, c) => track(c, s.intersection, g.IntersectionObserver, {threshold: s.threshold, rootMargin: s.rootMargin},
    (e) => ({visible: e.isIntersecting, ratio: e.intersectionRatio})),
}};

/** Element size: `{ resize: '.chart' | true, action }`, data `{ width, height, index, dataset }` (the content box) */
export const resizeSource: BrowserSource = {d: {
  resize: (s, c) => track(c, s.resize, g.ResizeObserver, undefined,
    (e) => ({width: e.contentRect.width, height: e.contentRect.height})),
}};

/** A media query: `{ media: '(prefers-color-scheme: dark)', action }`, data `{ matches, media }` */
export const mediaSource: BrowserSource = {d: {
  media: (s, c) => {
    const m = g.matchMedia?.(s.media);
    if (!m) return;
    const f = () => c.send({matches: m.matches, media: s.media});
    f();
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  },
}};

const area = (s: any) => g[s.area == 'session' ? 'sessionStorage' : 'localStorage'];
const failed = (e: any) => ({name: e?.name, message: e?.message});

/**
 * A storage key (read and observed, other tabs' writes included): `{ storage: 'theme', action,
 * area?: 'session', json?: true, error? }`, data `{ key, value }` (null when absent; parsed with
 * `json`). Commands `{ setItem: key, value, area?, json? }`, `{ removeItem: key, area? }`.
 * For a component's state that should survive a reload, use persist() instead.
 */
export const storageSource: BrowserSource = {
  d: {storage: (s, c) => {
    const key = s.storage;
    const f = (e?: any) => {
      try {
        const a = area(s);
        if (e && (e.storageArea != a || e.key != null && e.key != key)) return;
        let v = a.getItem(key);
        if (s.json && v != null) v = JSON.parse(v);
        c.send({key, value: v});
      } catch (x) { c.fail(failed(x)); }
    };
    f();
    g.addEventListener?.('storage', f);
    return () => g.removeEventListener?.('storage', f);
  }},
  c: (() => {
    const write = (v: any, value: any, ok: any, fail: any) => {
      try {
        const a = area(v), key = v.setItem ?? v.removeItem, old = a.getItem(key);
        value == null ? a.removeItem(key) : a.setItem(key, value);
        // this page's own observers (the browser fires `storage` in the other tabs only)
        g.dispatchEvent?.(new g.StorageEvent('storage', {key, oldValue: old, newValue: value ?? null, storageArea: a}));
        ok({key});
      } catch (x) { fail(failed(x)); }
    };
    return {
      setItem: (v, ok, fail) => write(v, v.json ? JSON.stringify(v.value) : '' + v.value, ok, fail),
      removeItem: (v, ok, fail) => write(v, null, ok, fail),
    };
  })(),
};

/** The document's visibility: `{ visibility: true, action }`, data `{ visible }` */
export const visibilitySource: BrowserSource = {d: {
  visibility: (_, c) => {
    const d = g.document;
    if (!d) return;
    const f = () => c.send({visible: d.visibilityState != 'hidden'});
    f();
    d.addEventListener('visibilitychange', f);
    return () => d.removeEventListener('visibilitychange', f);
  },
}};

/** The network: `{ online: true, action }`, data `{ online }` */
export const onlineSource: BrowserSource = {d: {
  online: (_, c) => {
    if (!g.navigator || !g.addEventListener) return;
    const f = () => c.send({online: g.navigator.onLine});
    f();
    g.addEventListener('online', f);
    g.addEventListener('offline', f);
    return () => { g.removeEventListener('online', f); g.removeEventListener('offline', f); };
  },
}};

/**
 * The position (permission-gated): `{ geolocation: true | PositionOptions, action, error? }`,
 * data `{ latitude, longitude, accuracy, altitude, altitudeAccuracy, heading, speed, timestamp }`;
 * a failure (denied, unavailable, timeout) `{ code, message }` to `error`.
 */
export const geolocationSource: BrowserSource = {d: {
  geolocation: (s, c) => {
    const geo = g.navigator?.geolocation;
    if (!geo) return c.fail({code: 2, message: 'Geolocation is not available'});
    const id = geo.watchPosition((p: any) => {
      const {latitude, longitude, accuracy, altitude, altitudeAccuracy, heading, speed} = p.coords;
      c.send({latitude, longitude, accuracy, altitude, altitudeAccuracy, heading, speed, timestamp: p.timestamp});
    }, (e: any) => c.fail({code: e.code, message: e.message}), s.geolocation === true ? undefined : s.geolocation);
    return () => geo.clearWatch(id);
  },
}};

/**
 * The clipboard (permission-gated), as commands: `{ copy: text, ok?, error? }` and
 * `{ paste: true, ok, error? }`, data `{ text }`; a failure `{ name, message }` to `error`.
 */
export const clipboardSource: BrowserSource = {c: {
  copy: (v, ok, fail) => {
    const text = '' + v.copy, cb = g.navigator?.clipboard;
    cb ? cb.writeText(text).then(() => ok({text}), (e: any) => fail(failed(e))) : fail({name: 'NotSupportedError', message: 'Clipboard is not available'});
  },
  paste: (_, ok, fail) => {
    const cb = g.navigator?.clipboard;
    cb ? cb.readText().then((text: string) => ok({text}), (e: any) => fail(failed(e))) : fail({name: 'NotSupportedError', message: 'Clipboard is not available'});
  },
}};

/**
 * The driver over `sources` and `runners` (sender → { c: component name, on: { [name]: entry } },
 * an entry being { k: the spec's JSON, s: the spec, x: stop }). renderComponent's fake passes its
 * own sources and map.
 */
export const browserDriver = (sources: BrowserSource[], runners: Map<any, any>) => (sink$: any, name?: string) => {
  const d: any = {}, cmd: any = {}, doms = new Map<any, any>();
  for (const s of sources) { Object.assign(d, s.d); Object.assign(cmd, s.c); }
  const update = (id: any, decl: any, comp?: any) => {
    let r = runners.get(id);
    if (!r) runners.set(id, r = {c: comp, on: {}});
    const on = r.on;
    for (const n in on) if (on[n].k != JSON.stringify(decl?.[n])) on[n].x(), delete on[n];
    for (const n in decl) {
      const s = decl[n];
      if (!s || on[n]) continue;
      const e: any = on[n] = {k: JSON.stringify(s), s, x: noop};
      const k = typeof s == 'object' && KINDS.find(k => k in s);
      if (!k || !s.action || typeof s.action != 'string' || (k == 'intersection' || k == 'resize') && s[k] !== true && (typeof s[k] != 'string' || !s[k])) diag('SYG663', n, s, comp);
      else if (!d[k]) diag('SYG664', n, s, comp, k);
      else e.x = d[k](s, {
        dom: doms.get(id),
        send: (v: any) => reply(id, s.action, v),
        fail: (v: any) => s.error ? reply(id, s.error, v) : diag('SYG665', n, s, comp, v),
        miss: (why: string) => diag('SYG666', n, s, comp, why),
      }) || noop;
    }
    if (!decl) runners.delete(id);
  };
  const stopAll = () => runners.forEach((_, id) => update(id, 0));
  const {replies, reply} = makeReplies(id => { update(id, 0); doms.delete(id); });
  hook();
  if (name) names.add(name);
  sink$.addListener({
    next: (v: any) => {
      if (!v || typeof v != 'object') return;
      const id = v.__emitterId;
      if ('browser' in v && id !== undefined) return update(id, v.browser, v.__emitterName);
      const m = Object.keys(v)[0], f = cmd[m];
      if (!f) return diag('SYG663', m, v, v.__emitterName, 0, Object.keys(cmd));
      f(v, (x: any) => v.ok && reply(id, v.ok, x), (x: any) => v.error ? reply(id, v.error, x) : diag('SYG665', m, v, v.__emitterName, x));
    },
    error: noop,
    complete: stopAll,
  });
  // a declaring instance's own source (its DOM bound by the definition hook)
  const src = (): any => {
    const o: any = {...replies, __sygnalStatic: 'browser', replies: (id: any) => (o.i = id, replies.replies(id)), isolateSource: src, __b: (dom: any) => doms.set(o.i, dom)};
    return o;
  };
  return {...src(), dispose: stopAll};
};

/**
 * A driver for the components' `browser` declarations and the BROWSER sink commands, with only
 * the given sources: `run(App, { BROWSER: makeBrowserDriverWith(intersectionSource, mediaSource) })`.
 */
export const makeBrowserDriverWith = (...sources: BrowserSource[]) => browserDriver(sources, new Map());

/** Every browser source: `run(App, { BROWSER: makeBrowserDriver() })` */
export const makeBrowserDriver = () => makeBrowserDriverWith(intersectionSource, resizeSource, mediaSource, storageSource, visibilitySource, onlineSource, geolocationSource, clipboardSource);
