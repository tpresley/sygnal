import xs, {Stream} from 'xstream';

/*
 * makeFetchDriver(options?) (PLAN-2 E2): an opt-in HTTP driver over `fetch`. Docs on the
 * declarations in src/index.d.ts and docs/guide/drivers.md. Summary:
 *
 * - Request (sink value): `{ url, category?, method?, headers?, query?, json?, body?, latest?,
 *   timeoutMs?, parse?, init? }` or a URL string. `json` is stringified with a JSON
 *   content-type; method defaults to POST with a body/json, else GET. `query` is appended as a
 *   query string (null/undefined values skipped, arrays repeat the key, before any #fragment).
 *   Other fetch options (credentials, mode, cache, ...) go under `init` (R4-5); other top-level
 *   keys are the app's own: not sent, but returned on `request`.
 * - `{ category?, abort: true }` cancels the component's requests in flight in that category
 *   (all of its requests without a category); a cancelled request delivers nothing.
 * - `latest: true` (per request, or the driver option): a new request aborts the component's
 *   requests still in flight in its category; their late responses/errors are never delivered.
 * - Responses on `select(category?)`: `{ category, value, status, request }`. 2xx only.
 * - Failures on `errors(category?)`: `{ error, category, request, status?, body? }` for a
 *   non-2xx status (`error.status`, `error.body` too), a network error, a body that doesn't
 *   parse, a timeout (`error.name === 'TimeoutError'`) or no fetch. Never delivered for an
 *   aborted/superseded request. Unheard failures are console.error'd.
 * - Isolation (R4-2, D54, like @cycle/http): an isolated component's requests are tagged with
 *   its scope (isolateSink); its select()/errors() see only the replies to its own and its
 *   descendants' requests (isolateSource); latest/abort act per (scope, category). The root
 *   component sees every reply, as an unisolated app always did.
 * - parse: 'auto' (default: JSON when the content-type says json, else text; 204 → null),
 *   'json', 'text', 'response' (the Response itself) or `res => value`. A non-2xx status is
 *   always a failure (its body parsed with 'auto').
 * - Early replies (before anything listens) are held until the first select() listener;
 *   early failures until the first errors() listener or the next macrotask (R4-4, G-092).
 * - dispose / sink completion aborts everything in flight.
 * - `fetch` is read at request time (options.fetch, else globalThis.fetch), so test stubs work.
 */

const EARLY_LIMIT = 100;
// the fetch() init keys a request's `init` may set (the driver owns `signal`)
const INIT_KEYS = ['method', 'headers', 'body', 'mode', 'credentials', 'cache', 'redirect', 'referrer',
  'referrerPolicy', 'integrity', 'keepalive', 'priority', 'window', 'duplex'];

// R4-2: the isolation scope path of a request, outermost first (non-enumerable, so a request
// still toEqual()s what the model returned)
const SCOPE = '__sygnalScope';
export const scopeOfRequest = (req: any): any[] => (req && typeof req == 'object' && req[SCOPE]) || [];
/** a copy of the request tagged with one more (outer) scope */
export const tagRequest = (req: any, scope: any) => {
  const r = typeof req == 'string' ? {url: req} : req && typeof req == 'object' ? {...req} : req;
  if (r && typeof r == 'object') Object.defineProperty(r, SCOPE, {value: [scope, ...scopeOfRequest(req)]});
  return r;
};
/** a source at scope path `ns` sees replies to requests made at or under it */
export const inScope = (ns: any[], req: any) => {
  const rs = scopeOfRequest(req);
  return ns.every((s, i) => rs[i] === s);
};
export const scopeKey = (req: any) => scopeOfRequest(req).join('\u0001');

/** a URL with the query appended (arrays repeat the key) before any #fragment (R4-6) */
export const withQuery = (href: string, query: any) => {
  if (!query) return href;
  const qs = new URLSearchParams();
  Object.keys(query).forEach(k => [].concat(query[k]).forEach((v: any) => v != null && qs.append(k, String(v))));
  const s = qs.toString();
  if (!s) return href;
  const hash = href.indexOf('#');
  const base = hash < 0 ? href : href.slice(0, hash);
  return base + (base.includes('?') ? (/[?&]$/.test(base) ? '' : '&') : '?') + s + (hash < 0 ? '' : href.slice(hash));
};

const autoParse = async (res: any) => {
  if (res.status == 204) return null;
  const h = res.headers;
  const ct = h && typeof h.get == 'function' ? h.get('content-type') || '' : null;
  // a non-standard fetch stub without headers: prefer json() when it has one
  if (ct === null) return typeof res.json == 'function' ? res.json() : res.text();
  if (!/[/+]json\b/i.test(ct)) return res.text();
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};

const PARSERS: Record<string, (res: any) => any> = {
  auto: autoParse,
  json: res => res.json(),
  text: res => res.text(),
  response: res => res,
};

const pickInit = (init: any) => {
  const out: any = {};
  if (init && typeof init == 'object') INIT_KEYS.forEach(k => { if (init[k] !== undefined) out[k] = init[k]; });
  return out;
};

/** headers merged case-insensitively (R4-5); plain objects and Headers instances */
const mergeHeaders = (...all: any[]) => {
  if (typeof Headers != 'function') return Object.assign({}, ...all);
  const h = new Headers();
  all.forEach(x => x && new Headers(x).forEach((v, k) => h.set(k, v)));
  const out: Record<string, string> = {};
  h.forEach((v, k) => { out[k] = v; });
  return out;
};

export function makeFetchDriver(options: any = {}) {
  return (request$: Stream<any>) => {
    let seq = 0;
    let disposed = false;
    // requests in flight: id → { category, scope (key), ctl (AbortController), timer }
    const inflight = new Map<number, {category: any; scope: string; ctl?: AbortController; timer?: any}>();
    const subs = new Set<{l: any; sel: any; err: boolean; ns: any[]}>();
    // R4-4: replies held until the first select() listener, failures until the first errors()
    // listener (or the next macrotask, when they're logged if nothing listens)
    const started = [false, false];
    const early: any[][] = [[], []];

    const matches = (s: any, v: any) =>
      inScope(s.ns, v.request) && (s.sel === undefined || (typeof s.sel == 'function' ? s.sel(v) : v.category === s.sel));
    const dispatch = (err: boolean, v: any) => {
      let heard = false;
      subs.forEach(s => {
        let hit = false;
        try { hit = s.err === err && matches(s, v); } catch (_) {}
        if (!hit) return;
        heard = true;
        // R4-3: a throwing listener doesn't stop the others
        try { s.l.next(v); } catch (e) { console.error('[Sygnal] makeFetchDriver: a listener threw', e); }
      });
      if (err && !heard) console.error(`[Sygnal] makeFetchDriver: request${v.category === undefined ? '' : ` '${v.category}'`} failed (nothing listens to errors()):`, v.error);
    };
    const flush = (k: number) => {
      started[k] = true;
      const q = early[k];
      early[k] = [];
      q.forEach(v => dispatch(!!k, v));
    };
    const emit = (err: boolean, v: any) => {
      if (disposed) return;
      const k = +err;
      if (started[k]) return dispatch(err, v);
      if (early[k].push(v) > EARLY_LIMIT) early[k].shift();
      if (err && early[k].length == 1) setTimeout(() => started[k] || flush(k));
    };
    const source = (ns: any[]): any => {
      const make = (err: boolean) => (sel?: any) => {
        let sub: any;
        return xs.create<any>({
          start: l => {
            subs.add((sub = {l, sel, err, ns}));
            const k = +err;
            if (!started[k]) { started[k] = true; queueMicrotask(() => flush(k)); }
          },
          stop: () => { subs.delete(sub); },
        });
      };
      return {
        select: make(false),
        errors: make(true),
        isolateSource: (_: any, scope: any) => source(ns.concat(scope)),
        isolateSink: (sink$: any, scope: any) => sink$.map((req: any) => tagRequest(req, scope)),
        // R4-7: not a legacy HTTP source (no HYDRATE 'initial' subscription)
        __sygnalFetch: true,
      };
    };

    // ends a request: true if it was still live (so its result may be delivered)
    const finish = (id: number, abort?: boolean) => {
      const r = inflight.get(id);
      if (!r) return false;
      inflight.delete(id);
      clearTimeout(r.timer);
      if (abort) try { r.ctl?.abort(); } catch (_) {}
      return true;
    };
    const cancel = (which: (r: any) => boolean) =>
      inflight.forEach((r, id) => { if (which(r)) finish(id, true); });

    const send = (req: any) => {
      if (typeof req == 'string') req = {url: req};
      if (!req || typeof req != 'object' || disposed) return;
      const {url, category, method, headers, query, json, body, latest, timeoutMs, parse, abort, init} = req;
      const scope = scopeKey(req);
      // per (scope, category): another component's requests are never cancelled
      if (abort) return cancel(r => r.scope === scope && (!('category' in req) || r.category === category));
      if (latest ?? options.latest) cancel(r => r.scope === scope && r.category === category);

      const href = withQuery((options.baseUrl || '') + (url ?? ''), query);
      const base = options.init, own = init;
      const h = mergeHeaders(options.headers, base?.headers, own?.headers, headers);
      let b = body ?? own?.body;
      if (json !== undefined) {
        b = JSON.stringify(json);
        if (!Object.keys(h).some(k => k.toLowerCase() == 'content-type')) h['content-type'] = 'application/json';
      }
      const id = ++seq;
      const ctl = typeof AbortController == 'function' ? new AbortController() : undefined;
      const r: any = {category, scope, ctl};
      inflight.set(id, r);
      const fail = (error: any, extra?: any) => finish(id) && emit(true, {error, category, request: req, ...extra});
      const ms = timeoutMs ?? options.timeoutMs;
      if (ms > 0) {
        r.timer = setTimeout(() => {
          const e: any = new Error(`Request timed out after ${ms}ms: ${href}`);
          e.name = 'TimeoutError';
          if (inflight.has(id)) { fail(e); try { ctl?.abort(); } catch (_) {} }
        }, ms);
      }
      const pz = parse || options.parse || 'auto';
      const parser = typeof pz == 'function' ? pz : PARSERS[pz] || autoParse;
      // the global fetch is called as a method: a detached window.fetch throws "Illegal invocation"
      const g: any = globalThis;
      const doFetch = options.fetch || (typeof g.fetch == 'function' && ((u: string, i: any) => g.fetch(u, i)));
      let p: Promise<any>;
      try {
        if (typeof doFetch != 'function') throw new Error('fetch is not available in this environment (pass makeFetchDriver({ fetch }))');
        // called synchronously, so a test sees the call right after the sink emitted
        p = Promise.resolve(doFetch(href, {
          ...pickInit(base),
          ...pickInit(own),
          method: method || own?.method || base?.method || (b !== undefined ? 'POST' : 'GET'),
          headers: h,
          body: b,
          signal: ctl?.signal,
        }));
      } catch (e) {
        p = Promise.reject(e);
      }
      p.then(async (res: any) => {
        if (!inflight.has(id)) return;
        // R4-3: anything that throws here (a non-Response, a parser) fails the request
        try {
          if (res.ok === false || res.status < 200 || res.status > 299) {
            let errBody: any;
            try { errBody = await autoParse(res); } catch (_) {}
            const e: any = new Error(`HTTP ${res.status}${res.statusText ? ' ' + res.statusText : ''}: ${href}`);
            e.status = res.status;
            e.body = errBody;
            return fail(e, {status: res.status, body: errBody});
          }
          let value: any;
          try { value = await parser(res); } catch (e) { return fail(e, {status: res.status}); }
          if (finish(id)) emit(false, {category, value, status: res.status, request: req});
        } catch (e) {
          fail(e);
        } finally {
          finish(id);
        }
      }, fail);
    };

    request$.addListener({
      next: (req: any) => { try { send(req); } catch (e) { console.error('[Sygnal] makeFetchDriver: invalid request', req, e); } },
      error: (e: any) => console.error('[Sygnal] makeFetchDriver: the request stream errored', e),
      complete: () => cancel(() => true),
    });

    return {...source([]), dispose: () => { cancel(() => true); disposed = true; }};
  };
}
