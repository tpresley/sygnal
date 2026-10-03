import xs, {Stream} from 'xstream';
import {senderOf, keepSender, allowed, makeReplies} from './replies';
import {backoff} from './backoff';
import {onBrowserSignals, isHidden} from './browserSignals';
import {validateWith} from './standardSchema';

/*
 * makeFetchDriver(options?) (PLAN-2 E2): an opt-in HTTP driver over `fetch`. Docs on the
 * declarations in src/index.d.ts and docs/guide/drivers.md. Summary:
 *
 * - Request (sink value): `{ url, ok?, error?, key?, category?, method?, headers?, query?, json?,
 *   body?, latest?, timeoutMs?, parse?, init? }` or a URL string. `json` is stringified with a JSON
 *   content-type; method defaults to POST with a body/json, else GET. `query` is appended as a
 *   query string (null/undefined values skipped, arrays repeat the key, before any #fragment).
 *   Other fetch options (credentials, mode, cache, ...) go under `init` (R4-5); other top-level
 *   keys are the app's own: not sent, but returned on `request`.
 * - Reply actions (PLAN-3, D57/D58): a component's request naming `ok` / `error` actions gets its
 *   reply as that action, delivered to exactly the sending instance (./replies.ts), never to
 *   select()/errors(): `ok` data is the parsed body (the Response with parse: 'response'),
 *   `error` data `{ error, status?, body?, request }`. A request naming only one of them sends
 *   the other outcome down the plain path (select()/errors()). `latest` acts per (sender,
 *   `key ?? ok ?? error`); `{ abort: 'LOADED' }` / `{ abort: true, key }` cancel the sender's
 *   requests under that key; when the sender is disposed its requests with reply actions are aborted.
 *   Requests with a `then` / `catch` key are refused (SYG610).
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
 * - Resources (PLAN-3 3-A; D78): the core sends a component's `resources` static as
 *   `{ resources: { name: request | falsy } }` (sender-stamped). Per (sender, name), a request
 *   that changed (by JSON) is fetched with latest semantics (the stale one aborted); falsy aborts
 *   it. Each step is the reply action RESOURCE `{ name, status, data, error, refreshing }`:
 *   - a new request (key change): 'loading', data and error cleared, unless `keepPrevious: true`;
 *   - a refetch of the same request (`{ refresh: name | names }`, invalidation, focus, polling,
 *     or the same request declared again after a pause): `data` and `error` kept, `status`
 *     unchanged, `refreshing: true` (a resource with no result yet stays 'loading');
 *   - 'success' (data: the parsed body, validated), 'error' (error: the Error, with
 *     `status`/`body` for a non-2xx; `data` kept), 'idle' (back to falsy).
 *   `ok` / `error` on the request also dispatch those actions after the RESOURCE write.
 *   G-177 / D85: a name left out of the declaration (a hidden Switchable page) is paused: its
 *   request is aborted and it keeps its last result (`refreshing` off; 'idle' if it had none);
 *   declared again, the same request is a refetch that keeps data, another one a key change.
 * - Cache (D79, opt-in: `cache: true | { staleTime, gcTime, refetchOnFocus, refetchOnReconnect }`):
 *   entries keyed by method + URL (query sorted) + body + parse. Cached: resources' GET/HEAD
 *   requests (cache on), and any request with `cache: true` or `staleTime` (`cache: false` opts
 *   out; a `parse` function / 'response' or a non-string body never is). A resource with a
 *   cached entry shows it at once ('success', `refreshing` while it refetches); an entry younger
 *   than `staleTime` (default 0) is served without a fetch. Identical cacheable requests in
 *   flight share one fetch (each sender gets its own reply); the fetch aborts only when no
 *   request still wants it. Entries no resource uses are evicted after `gcTime` (5 min).
 *   Focus / reconnect (default on with the cache) refetch stale mounted (not paused) resources.
 * - `refetchEvery: ms` on a resource polls (after each result; skipped while the document is hidden).
 * - `{ invalidate: tag | tags | '/url-prefix' | (request) => boolean }` (D80): matching cache
 *   entries go stale and matching mounted resources refetch (keeping data). Tags are explicit
 *   (`tags: ['quotes']` on the request); a string starting with '/' is a URL prefix.
 *   `invalidates: …` on any request does the same after its success.
 * - `retry: n | { count, delayMs, maxDelayMs, jitter }` (default 0; the driver option applies
 *   to GET/HEAD only): network errors, 408, 429 (Retry-After honoured) and 5xx are retried with
 *   the socket driver's backoff; the failure (with `attempts`) is delivered once, at the end.
 * - `validate: schema` (a Standard Schema): the parsed body is validated (and transformed); a
 *   failure is an error with `issues`.
 * - dispose / sink completion aborts everything in flight.
 * - `fetch` is read at request time (options.fetch, else globalThis.fetch), so test stubs work.
 * - PLAN-3 5-1 (H-9): renderComponent's HTTP fake runs this driver over an in-memory fetch;
 *   the internal `_tap(request, resourceName?)` option is called right before each fetch so the
 *   fake can name what is pending. There is no other copy of these rules.
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
  const r = typeof req == 'string' ? {url: req} : req && typeof req == 'object' ? keepSender(req, {...req}) : req;
  if (r && typeof r == 'object') Object.defineProperty(r, SCOPE, {value: [scope, ...scopeOfRequest(req)]});
  return r;
};
/** a source at scope path `ns` sees replies to requests made at or under it */
export const inScope = (ns: any[], req: any) => {
  const rs = scopeOfRequest(req);
  return ns.every((s, i) => rs[i] === s);
};
export const scopeKey = (req: any) => scopeOfRequest(req).join('\u0001');

/**
 * a URL with the query appended (arrays repeat the key) before any #fragment (R4-6); `sort`:
 * sorted by name (the cache key)
 */
export const withQuery = (href: string, query: any, sort?: any) => {
  if (!query) return href;
  const qs = new URLSearchParams();
  Object.keys(query).forEach(k => [].concat(query[k]).forEach((v: any) => v != null && qs.append(k, String(v))));
  if (sort) qs.sort();
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

const IDEMPOTENT = /^(GET|HEAD)$/i;
// a settled resource status ('success' / 'error')
const SETTLED = /^[se]/;

export function makeFetchDriver(options: any = {}) {
  return (request$: Stream<any>) => {
    let seq = 0;
    let disposed = false;
    const co = options.cache, copt = co && typeof co == 'object' ? co : {};
    // requests in flight: id → { category, scope (key), sender, rk (reply key), rn (resource),
    // q (the request), timer, f (the fetch it waits on), ok / ko (its outcomes) }
    const inflight = new Map<number, any>();
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
        // the core sends a component's `resources` static here (PLAN-3 3-A)
        __sygnalStatic: 'resources',
        // 5-3: what is in flight, cached and declared (t.cache, inspect()); how many cache
        // entries / mounted resources an `invalidate` value matches (dev diagnostics)
        __inspect: inspect,
        __matches: (x: any) => inval(x, 1),
        ...replies,
      };
    };

    // D79: the cache, key → { k, q (the request), v (data), at (fetched at), s (marked stale),
    // n (resources using it), g (gc timer) }; and the fetches identical requests share, key → fetch
    const cache = new Map<string, any>();
    const flights = new Map<string, any>();
    const now = () => Date.now();
    const fresh = (E: any, q: any) => E?.at > 0 && !E.s && now() - E.at < (q.staleTime ?? copt.staleTime ?? 0);
    const gc = (E: any) => {
      clearTimeout(E.g);
      const ms = copt.gcTime ?? 3e5;
      if (ms < 1 / 0) E.g = setTimeout(() => E.n || cache.delete(E.k), ms);
    };
    const entry = (k: string, q: any) => {
      let E = cache.get(k);
      if (!E) cache.set(k, (E = {k, q, n: 0}));
      return E;
    };
    // resource R now uses cache key k (or none): the entries' subscriber counts
    const use = (R: any, k?: string) => {
      if (R.k === k) return;
      const O = cache.get(R.k);
      if (O && !--O.n) gc(O);
      if ((R.k = k) !== undefined) {
        const E = entry(k as string, R.q);
        E.n++;
        clearTimeout(E.g);
      }
    };
    // the cache key of a cacheable request (else undefined); `res`: a resource's
    const keyOf = (q: any, res?: any) => {
      const {method, json, body, parse, query} = q;
      const m = (method || (json !== undefined || body !== undefined ? 'POST' : 'GET')).toUpperCase();
      const b = json !== undefined ? JSON.stringify(json) : body ?? '';
      if (q.cache === false || typeof b != 'string' || typeof parse == 'function' || parse == 'response' ||
        !(q.cache || q.staleTime != null || (res && co && IDEMPOTENT.test(m)))) return;
      return [m, withQuery((options.baseUrl || '') + (q.url ?? ''), query, 1), b, parse].join(' ').trim();
    };
    // D80: an invalidate value matches a request by tag, URL prefix ('/…') or predicate
    const hit = (x: any, q: any) => {
      try {
        return typeof x == 'function' ? !!x(q) : [].concat(x).some((t: any) =>
          t[0] == '/' ? String(q.url).startsWith(t) : [].concat(q.tags).includes(t as never));
      } catch (_) { return false; }
    };
    // marks matching cache entries stale and refetches matching mounted resources (keeping
    // data); `dry`: only counts them
    const inval = (x: any, dry?: any) => {
      let n = 0;
      const m = seq;
      cache.forEach(E => { if (hit(x, E.q)) { n++; dry || (E.s = 1); } });
      rsrc.forEach((cur, s) => cur.forEach((R, name) => { if (!R.p && R.q && hit(x, R.q)) { n++; dry || load(s, name, R, 1, m); } }));
      return n;
    };

    // ends a request: true if it was still live (so its result may be delivered). D79: its fetch
    // is aborted when no request still wants it
    const finish = (id: number) => {
      const r = inflight.get(id);
      if (!r) return false;
      inflight.delete(id);
      clearTimeout(r.timer);
      const F = r.f;
      if (F && !F.x && F.s.delete(r) && !F.s.size) {
        done(F);
        try { F.c.abort?.(); } catch (_) {}
      }
      return true;
    };
    const done = (F: any) => {
      F.x = 1;
      clearTimeout(F.t);
      if (flights.get(F.k) === F) flights.delete(F.k);
    };
    const cancel = (which: (r: any) => boolean) =>
      inflight.forEach((r, id) => { if (which(r)) finish(id); });

    // 3-A: sender → resource name → R { j (JSON of its request), q (the request), k (cache key),
    // last (the last write), p (paused), t (poll timer), i (its request id) }
    const rsrc = new Map<any, Map<string, any>>();
    const stop = (s: any, n: string, R: any) => {
      clearTimeout(R.t);
      cancel(r => r.sender === s && r.rk === '\0' + n);
    };
    // a disposed sender's requests with reply actions (and resources) are aborted
    const {replies, reply} = makeReplies(sender => {
      rsrc.get(sender)?.forEach(R => { clearTimeout(R.t); use(R); });
      rsrc.delete(sender);
      cancel(r => r.rk !== undefined && r.sender === sender);
    });
    const write = (s: any, n: string, R: any, status: string, data?: any, error?: any, refreshing?: any) => {
      reply(s, 'RESOURCE', {name: n, ...(R.last = {status, data, error, refreshing: refreshing || undefined})});
      // refetchEvery: polls after each result, skipping while the document is hidden
      clearTimeout(R.t);
      const ms = R.q?.refetchEvery;
      if (ms > 0 && !R.p && !refreshing && SETTLED.test(status))
        R.t = setTimeout(function tick() { isHidden() ? (R.t = setTimeout(tick, ms)) : load(s, n, R, 1, seq); }, ms);
    };
    // D78: (re)loads resource R. `same`: the same request again (keeps data); `after` (a
    // refetch: refresh, invalidation, focus, polling) skips the cache and fetches anew
    const load = (s: any, n: string, R: any, same?: any, after?: number) => {
      const q = R.q, k = keyOf(q, 1), E = cache.get(k as string), L = R.last, go = after !== undefined || !fresh(E, q);
      stop(s, n, R);
      use(R, k as any);
      if (E && 'v' in E && !q.validate) write(s, n, R, 'success', E.v, undefined, go);
      else if ((same || q.keepPrevious) && L && SETTLED.test(L.status)) write(s, n, R, L.status, L.data, L.error, true);
      else write(s, n, R, 'loading');
      if (go || q.validate) R.i = send(q, s, n, after, R);
    };

    const send = (req: any, sender = senderOf(req), rn?: string, after = -1, R?: any): any => {
      if (typeof req == 'string') req = {url: req};
      if (!req || typeof req != 'object' || disposed || !allowed(req, 'makeFetchDriver')) return;
      const {url, category, method, headers, query, json, body, latest, timeoutMs, parse, abort, init, ok, error, key, resources, refresh, invalidates, retry, validate} = req;
      if ('invalidate' in req) return inval(req.invalidate);
      if (resources || refresh) {
        if (sender === undefined) return;
        const cur = rsrc.get(sender) || new Map();
        rsrc.set(sender, cur);
        if (refresh) return [].concat(refresh).forEach((n: string) => { const R = cur.get(n); R?.q && !R.p && load(sender, n, R, 1, seq); });
        new Set([...cur.keys(), ...Object.keys(resources)]).forEach(n => {
          let R = cur.get(n);
          // D85 / G-177: left out (a hidden Switchable page): paused, keeping its last result
          if (!(n in resources)) {
            if (R && !R.p) {
              R.p = 1;
              stop(sender, n, R);
              use(R);
              const L = R.last;
              if (!L || !SETTLED.test(L.status)) write(sender, n, R, 'idle');
              else if (L.refreshing) write(sender, n, R, L.status, L.data, L.error);
            }
            return;
          }
          let q = resources[n];
          if (typeof q == 'string') q = {url: q};
          const j = q ? JSON.stringify(q) : '', paused = R?.p;
          if (!R) cur.set(n, (R = {j: ''}));
          R.p = 0;
          if (R.j === j && !paused) return;
          const same = R.j === j;
          R.j = j;
          R.q = q;
          if (q) load(sender, n, R, same);
          else { stop(sender, n, R); use(R); write(sender, n, R, 'idle'); }
        });
        return;
      }
      const scope = scopeKey(req);
      // reply actions: keyed per (sender, key ?? ok ?? error); a resource per (sender, '\0' + name)
      const rk = rn !== undefined ? '\0' + rn : sender !== undefined && (ok || error) ? key ?? ok ?? error : undefined;
      if (sender !== undefined && (typeof abort == 'string' || (abort && key !== undefined)))
        return cancel(r => r.sender === sender && r.rk === (key ?? abort));
      // per (scope, category): another component's requests are never cancelled
      if (abort) return cancel(r => r.scope === scope && (!('category' in req) || r.category === category));
      if (rn !== undefined || (latest ?? options.latest)) cancel(rk === undefined ? r => r.rk === undefined && r.scope === scope && r.category === category : r => r.sender === sender && r.rk === rk);

      const href = withQuery((options.baseUrl || '') + (url ?? ''), query);
      const base = options.init, own = init;
      const h = mergeHeaders(options.headers, base?.headers, own?.headers, headers);
      let b = body ?? own?.body;
      if (json !== undefined) {
        b = JSON.stringify(json);
        if (!Object.keys(h).some(k => k.toLowerCase() == 'content-type')) h['content-type'] = 'application/json';
      }
      const m = method || own?.method || base?.method || (b !== undefined ? 'POST' : 'GET');
      const k = keyOf(req, rn !== undefined);
      const id = ++seq;
      const r: any = {category, scope, sender, rk};
      inflight.set(id, r);
      // an outcome with a reply action goes to the sender's actions, the other to errors()/select()
      const fail = r.ko = (e: any, extra?: any) => finish(id) && (R && write(sender, rn!, R, 'error', R.last?.data, e),
        rk !== undefined && error ? reply(sender, error, {error: e, request: req, ...extra}) : rn === undefined && emit(true, {error: e, category, request: req, ...extra}));
      r.ok = async (v: any, status: number) => {
        if (validate) try { v = await validateWith(validate, v); } catch (e: any) { return fail(e, {status, issues: e.issues}); }
        if (!finish(id)) return;
        if (R) write(sender, rn!, R, 'success', v);
        rk !== undefined && ok ? reply(sender, ok, v) : rn === undefined && emit(false, {category, value: v, status, request: req});
        if (invalidates) inval(invalidates);
      };
      const ms = timeoutMs ?? options.timeoutMs;
      if (ms > 0) {
        r.timer = setTimeout(() => {
          const e: any = new Error(`Request timed out after ${ms}ms: ${href}`);
          e.name = 'TimeoutError';
          fail(e);
        }, ms);
      }
      // D79: a fresh cache entry answers without a fetch
      const E = cache.get(k as string);
      if (after < 0 && fresh(E, req)) return queueMicrotask(() => r.ok(E.v, 200)), id;
      // D79: identical cacheable requests share a fetch (a refetch only one started after it asked)
      let F = flights.get(k as string);
      if (!F || F.id <= after) {
        const rp = retry ?? (IDEMPOTENT.test(m) ? options.retry : 0);
        const pol = rp && typeof rp == 'object' ? rp : {count: +rp || 0};
        const tries = pol.count ?? 3;
        F = {id, k, s: new Set(), n: 0};
        if (k !== undefined) flights.set(k, F);
        const pz = parse || options.parse || 'auto';
        const parser = typeof pz == 'function' ? pz : PARSERS[pz] || autoParse;
        // the global fetch is called as a method: a detached window.fetch throws "Illegal invocation"
        const g: any = globalThis;
        const doFetch = options.fetch || (typeof g.fetch == 'function' && ((u: string, i: any) => g.fetch(u, i)));
        const fetchInit = {
          ...pickInit(base),
          ...pickInit(own),
          method: m,
          headers: h,
          body: b,
        };
        // the outcome, to every request waiting on this fetch (the failure once, after the last attempt)
        const end = (e: any, x?: any, status?: number) => {
          done(F);
          F.s.forEach((w: any) => e ? w.ko(e, tries ? {...x, attempts: F.n} : x) : w.ok(x, status));
        };
        const go = () => {
          const ctl: any = F.c = typeof AbortController == "function" ? new AbortController() : {};
          const live = () => F.c === ctl && !F.x;
          // D80: retries left: the next attempt is scheduled (a Retry-After in seconds wins)
          const again = (res?: any) => {
            if (F.n > tries) return false;
            F.t = setTimeout(go, res?.headers?.get?.('retry-after') * 1e3 || backoff(pol, F.n - 1));
            return true;
          };
          F.n++;
          let p: Promise<any>;
          try {
            if (typeof doFetch != 'function') throw new Error('fetch is not available in this environment (pass makeFetchDriver({ fetch }))');
            // 5-1 (H-9): renderComponent's fake learns which request (and resource) the next fetch is for
            options._tap?.(req, rn);
            // called synchronously, so a test sees the call right after the sink emitted
            p = Promise.resolve(doFetch(href, {...fetchInit, signal: ctl.signal}));
          } catch (e) {
            p = Promise.reject(e);
          }
          p.then(async (res: any) => {
            if (!live()) return;
            // R4-3: anything that throws here (a non-Response, a parser) fails the request
            try {
              const st = res.status;
              if (res.ok === false || st < 200 || st > 299) {
                let errBody: any;
                try { errBody = await autoParse(res); } catch (_) {}
                if (!live() || ((st == 408 || st == 429 || st > 499) && again(res))) return;
                const e: any = new Error(`HTTP ${st}${res.statusText ? ' ' + res.statusText : ''}: ${href}`);
                e.status = st;
                e.body = errBody;
                return end(e, {status: st, body: errBody});
              }
              let v: any;
              try { v = await parser(res); } catch (e) { return live() && end(e, {status: st}); }
              if (!live()) return;
              if (k !== undefined) {
                const C = entry(k, req);
                C.v = v;
                C.at = now();
                C.s = 0;
                C.q = req;
                C.n || gc(C);
              }
              end(0, v, st);
            } catch (e) {
              live() && end(e);
            }
          }, (e: any) => { live() && !again() && end(e); });
        };
        go();
      }
      F.s.add(r);
      r.f = F;
      return id;
    };

    // D79: focus / reconnect refetch the stale mounted resources (cache on; the fake passes `_on`)
    const off = co && (options._on || onBrowserSignals)((sig: string) => {
      if (copt[sig == 'focus' ? 'refetchOnFocus' : 'refetchOnReconnect'] === false) return;
      const m = seq;
      rsrc.forEach((cur, s) => cur.forEach((R, n) => {
        if (!R.p && R.q && R.k !== undefined && !inflight.has(R.i) && !fresh(cache.get(R.k), R.q)) load(s, n, R, 1, m);
      }));
    });
    const inspect = () => ({
      cache: [...cache.values()].map(E => ({key: E.k, age: E.at && now() - E.at, stale: !fresh(E, E.q), subscribers: E.n, data: E.v})),
    });
    const shut = () => {
      cancel(() => true);
      off?.();
      cache.forEach(E => clearTimeout(E.g));
      rsrc.forEach(cur => cur.forEach(R => clearTimeout(R.t)));
    };

    request$.addListener({
      next: (req: any) => { try { send(req); } catch (e) { console.error('[Sygnal] makeFetchDriver: invalid request', req, e); } },
      error: (e: any) => console.error('[Sygnal] makeFetchDriver: the request stream errored', e),
      complete: shut,
    });

    return {...source([]), dispose: () => { shut(); disposed = true; }};
  };
}
