import {onBrowserSignals} from './browserSignals';
import {withQuery, hit} from './fetchDriver';

/*
 * queryCache(options?) (PLAN-3 D88, 5-5): the opt-in query cache of makeFetchDriver, in its own
 * export so apps that only make requests don't pay for it:
 *
 *   makeFetchDriver({ cache: queryCache({ staleTime, gcTime, refetchOnFocus, refetchOnReconnect, initial }) })
 *
 * It owns the entries (key → { k, q (the request), v (data), at (fetched at), s (marked stale),
 * n (resources using it), g (gc timer) }), gc, freshness (the stale-while-revalidate decision),
 * the fetches identical requests share (de-duplication, `f`), entry invalidation, the focus /
 * reconnect trigger and SSR seeding. The driver calls its hooks (key, fresh, get, put, use,
 * inval, on, list) and keeps resources, polling, retries and validation.
 *
 * - Keys: method + URL as written (the driver's baseUrl left out, query sorted) + body + parse.
 *   Cacheable: a resource's GET/HEAD request, and any request with `cache: true` or `staleTime`
 *   (`cache: false` opts out; a `parse` function / 'response' or a non-string body never is).
 * - SSR seeding (H-7): `dehydrate()` returns a JSON-safe snapshot `[{ key, data, updatedAt, tags }]`
 *   of the entries with data; `hydrate(snapshot)` / `queryCache({ initial })` write it back (an
 *   entry newer than the snapshot's is kept). `set(request, data)` writes one entry (a loader on
 *   the server). Entries keep their `updatedAt`, so a seeded entry is fresh for `staleTime`.
 * - `prefetch(request)`: the attached driver (the last makeFetchDriver given this cache) fetches
 *   the request into the cache without a reply, like the `{ prefetch }` sink command.
 */

const IDEMPOTENT = /^(GET|HEAD)$/i;

export function queryCache(o: any = {}): any {
  const map = new Map<string, any>();
  const now = () => Date.now();
  const gc = (E: any) => {
    clearTimeout(E.g);
    const ms = o.gcTime ?? 3e5;
    // unref: a server's seeded cache never keeps Node alive
    if (ms < 1 / 0) (E.g = setTimeout(() => E.n || map.delete(E.k), ms) as any).unref?.();
  };
  const entry = (k: string, q: any) => {
    let E = map.get(k);
    if (!E) map.set(k, (E = {k, q, n: 0}));
    return E;
  };
  // the key of a cacheable request (else undefined); `res`: a resource's
  const key = (q: any, res?: any) => {
    if (typeof q == 'string') q = {url: q};
    const {method, json, body, parse, query} = q;
    const m = (method || (json !== undefined || body !== undefined ? 'POST' : 'GET')).toUpperCase();
    const b = json !== undefined ? JSON.stringify(json) : body ?? '';
    if (q.cache === false || typeof b != 'string' || typeof parse == 'function' || parse == 'response' ||
      !(q.cache || q.staleTime != null || (res && IDEMPOTENT.test(m)))) return;
    return [m, withQuery(q.url ?? '', query, 1), b, parse].join(' ').trim();
  };
  const fresh = (k: any, q: any) => {
    const E = map.get(k);
    return E?.at > 0 && !E.s && now() - E.at < (q?.staleTime ?? o.staleTime ?? 0);
  };
  const put = (k: string, q: any, v: any, at = now()) => {
    const E = entry(k, q);
    E.v = v;
    E.at = at;
    E.s = 0;
    E.q = q;
    E.n || gc(E);
  };
  const C: any = {
    key,
    fresh,
    put,
    get: (k: any) => map.get(k),
    // the fetches identical cacheable requests share (the driver's flight records), key → flight
    f: new Map(),
    // resource R now uses key k (or none): the entries' subscriber counts, gc when unused
    use: (R: any, k?: string) => {
      if (R.k === k) return;
      const O = map.get(R.k);
      if (O && !--O.n) gc(O);
      if ((R.k = k) !== undefined) {
        const E = entry(k as string, R.q);
        E.n++;
        clearTimeout(E.g);
      }
    },
    // D80: marks the matching entries stale (`dry`: only counts them)
    inval: (x: any, dry?: any) => {
      let n = 0;
      map.forEach(E => { if (hit(x, E.q)) { n++; dry || (E.s = 1); } });
      return n;
    },
    // focus / reconnect call `fn` (the driver refetches its stale mounted resources); `on`: the
    // test fake's signal source
    on: (on: any, fn: () => void) => (on || onBrowserSignals)((sig: string) => {
      o[sig == 'focus' ? 'refetchOnFocus' : 'refetchOnReconnect'] === false || fn();
    }),
    list: () => [...map.values()].map(E => ({key: E.k, age: E.at && now() - E.at, stale: !fresh(E.k, E.q), subscribers: E.n, data: E.v, tags: E.q?.tags})),
    dehydrate: () => [...map.values()].filter(E => E.at > 0).map(E => ({key: E.k, data: E.v, updatedAt: E.at, tags: E.q?.tags})),
    hydrate: (snap: any) => snap?.forEach?.((e: any) => {
      if (!(map.get(e.key)?.at >= e.updatedAt)) put(e.key, {url: e.key.split(' ')[1], tags: e.tags}, e.data, e.updatedAt);
    }),
    set: (q: any, data: any) => {
      const k = key(q, 1);
      if (k !== undefined) put(k, typeof q == 'string' ? {url: q} : q, data);
    },
    prefetch: (q: any) => C.d?.({prefetch: q}),
  };
  C.hydrate(o.initial);
  return C;
}
