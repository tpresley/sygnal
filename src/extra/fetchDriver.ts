import xs, {Stream} from 'xstream';

/*
 * makeFetchDriver(options?) (PLAN-2 E2): an opt-in HTTP driver over `fetch`. Docs on the
 * declarations in src/index.d.ts and docs/guide/drivers.md. Summary:
 *
 * - Request (sink value): `{ url, category?, method?, headers?, query?, json?, body?, latest?,
 *   timeoutMs?, parse?, ...fetchInit }` or a URL string. `json` is stringified with a JSON
 *   content-type; method defaults to POST with a body/json, else GET. `query` is appended as a
 *   query string (null/undefined values skipped). Other keys are passed to fetch() as init.
 * - `{ category?, abort: true }` cancels the requests in flight in that category (all without a
 *   category); a cancelled request delivers nothing.
 * - `latest: true` (per request, or the driver option): a new request aborts the ones still in
 *   flight in its category; their late responses/errors are never delivered.
 * - Responses on `select(category?)`: `{ category, value, status, request }`. 2xx only.
 * - Failures on `errors(category?)`: `{ error, category, request, status?, body? }` for a
 *   non-2xx status (`error.status`, `error.body` too), a network error, a body that doesn't
 *   parse, a timeout (`error.name === 'TimeoutError'`) or no fetch. Never delivered for an
 *   aborted/superseded request. Unheard failures are console.error'd.
 * - parse: 'auto' (default: JSON when the content-type says json, else text; 204 → null),
 *   'json', 'text', 'response' (the Response itself) or `res => value`. A non-2xx status is
 *   always a failure (its body parsed with 'auto').
 * - Early replies (before anything listens) are held until the first listener (G-069-style).
 * - dispose / sink completion aborts everything in flight.
 * - `fetch` is read at request time (options.fetch, else globalThis.fetch), so test stubs work.
 */

const EARLY_LIMIT = 100;

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

export function makeFetchDriver(options: any = {}) {
  return (request$: Stream<any>) => {
    let seq = 0;
    let disposed = false;
    // requests in flight: id → { category, ctl (AbortController), timer }
    const inflight = new Map<number, {category: any; ctl?: AbortController; timer?: any}>();
    const subs = new Set<{l: any; sel: any; err: boolean}>();
    let started = false;
    let early: Array<[boolean, any]> = [];

    const matches = (sel: any, v: any) =>
      sel === undefined || (typeof sel == 'function' ? sel(v) : v.category === sel);
    const dispatch = (err: boolean, v: any) => {
      let heard = false;
      subs.forEach(s => {
        let hit = false;
        try { hit = s.err === err && matches(s.sel, v); } catch (_) {}
        if (hit) { heard = true; s.l.next(v); }
      });
      if (err && !heard) console.error(`[Sygnal] makeFetchDriver: request${v.category === undefined ? '' : ` '${v.category}'`} failed (nothing listens to errors()):`, v.error);
    };
    const emit = (err: boolean, v: any) => {
      if (disposed) return;
      if (started) return dispatch(err, v);
      if (early.push([err, v]) > EARLY_LIMIT) early.shift();
    };
    const source = (err: boolean) => (sel?: any) => {
      let sub: any;
      return xs.create<any>({
        start: l => {
          subs.add((sub = {l, sel, err}));
          if (!started) {
            started = true;
            queueMicrotask(() => { const q = early; early = []; q.forEach(([e, v]) => dispatch(e, v)); });
          }
        },
        stop: () => { subs.delete(sub); },
      });
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
    const cancel = (all: boolean, category?: any) =>
      inflight.forEach((r, id) => { if (all || r.category === category) finish(id, true); });

    const send = (req: any) => {
      if (typeof req == 'string') req = {url: req};
      if (!req || typeof req != 'object' || disposed) return;
      const {url, category, method, headers, query, json, body, latest, timeoutMs, parse, abort, ...init} = req;
      if (abort) return cancel(!('category' in req), category);
      if (latest ?? options.latest) cancel(false, category);

      let href = (options.baseUrl || '') + (url ?? '');
      if (query) {
        const qs = new URLSearchParams(
          Object.keys(query).filter(k => query[k] != null).map(k => [k, String(query[k])])
        ).toString();
        if (qs) href += (href.includes('?') ? '&' : '?') + qs;
      }
      const h: Record<string, string> = {...options.headers, ...headers};
      let b = body;
      if (json !== undefined) {
        b = JSON.stringify(json);
        if (!Object.keys(h).some(k => k.toLowerCase() == 'content-type')) h['Content-Type'] = 'application/json';
      }
      const id = ++seq;
      const ctl = typeof AbortController == 'function' ? new AbortController() : undefined;
      const r: any = {category, ctl};
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
          ...init,
          method: method || (b !== undefined ? 'POST' : 'GET'),
          headers: h,
          body: b,
          signal: ctl?.signal,
        }));
      } catch (e) {
        p = Promise.reject(e);
      }
      p.then(async (res: any) => {
          if (!inflight.has(id)) return;
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
        }, fail);
    };

    request$.addListener({
      next: (req: any) => { try { send(req); } catch (e) { console.error('[Sygnal] makeFetchDriver: invalid request', req, e); } },
      error: (e: any) => console.error('[Sygnal] makeFetchDriver: the request stream errored', e),
      complete: () => cancel(true),
    });

    return {
      select: source(false),
      errors: source(true),
      dispose: () => { cancel(true); disposed = true; },
    };
  };
}
