# Handoff to the PLAN-3 (network) session: additions for 6.0.0

**From:** the ecosystem-research session (worktree `sygnal-component-research-b1873e`, plan [PLAN-4](PLAN-4.md)).
**To:** the PLAN-3 coordinator (worktree `network-call-patterns-bcdf34`, branch `plan3-integration`).
**Date:** 2026-10-02.
**Status:** recommendations. Nothing here is decided until the user accepts it. Use your D-numbers and G-numbers when it is accepted; the H- and R- ids below exist only so this note can be discussed.

## Why this note exists

The user wants as much as makes sense in 6.0.0, without splitting valuable or related features across several releases. The ecosystem research compared Sygnal with the most-used React and Vue libraries. Its networking recommendation was a query cache, matching what TanStack Query provides. TanStack Query has 85.7M weekly downloads for `query-core` and was the most positively rated library in State of React 2025. A comparison with PLAN-3 found two things:

- **Covered, and well:** making a request correctly. That means routing replies to the sender, cancelling stale requests, loading and error status, cleanup on dispose, SSR safety, and test fakes. Sockets go further than the research asked.
- **Not covered:** the caching half. There is no shared cache, no `staleTime`, no de-duplication, no cross-component invalidation, no retries, and no refetch on focus, reconnect or interval. There is no SSR cache hydration. Also, the `resources` prototype clears `data` while it reloads, which is the opposite of what users of SWR and TanStack Query expect.

The user also asked whether the **router** belongs in your session. The recommendation is **yes** (§3). The work here (PLAN-4) has given up everything listed in this note and will not start until PLAN-3 is complete. Both plans land in the same 6.0.0 release.

**Inputs from this side:**
- The research report: https://claude.ai/artifact/3BYaNEUmLK5Z9w25cEHiXD (private to the user).
- Experiment E5 runs `query-core` as a Sygnal driver in about 25 lines, with a cache hit on key switch-back and a refetch after invalidation: [`research/ecosystem-experiments/src/queryDriver.js`](research/ecosystem-experiments/src/queryDriver.js) and `src/e5-query.test.jsx`, in this worktree. It is a reference for semantics only; the recommendation below is native, not query-core.

---

## 1. Decisions to revisit first

| # | Recommendation | Why now |
|---|---|---|
| **H-0a** | **Amend D73 so the eval decides whether `resources` is the canonical form, not whether it ships.** Ship `resources` in 6.0.0 either way: canonical if it meets the bar, documented as an advanced form if it doesn't. | Every caching feature below hangs off `resources`. Parking it parks all of them, so 6.0.0 would have no declarative read at all. It is additive; 6.1 could add it without breaking anything, but the user wants it in 6.0 rather than a 6.x sequence. |
| **H-0b** | **Hold the 4-C eval** (the prepared `p3-final`, `p3-final-haiku` and `p3-resources` runs, about $67) until §2 and §3 have landed. | Running it now and again after the additions doubles the cost, and the first run would measure a design that is about to change (H-1 changes `resources` semantics). |
| **H-0c** | **Re-plan the shared budgets**: the size gate (42,300 B; 69 B of headroom with `resources`) and `llms.txt` (250 lines; 265 with `resources`, test `test/llms-txt.test.js`). | PLAN-4 needs some of both too: a few `llms.txt` lines for `Widget`, forms and web components; its core additions are designed to be tree-shaken (0 B). Everything below is driver-side, so it should add ~0 B to the core. `llms.txt` is the real constraint: propose to the user a 6.0 budget of about 300 lines, with G-166's learn-time watch in the eval, or move recipe detail to guide links. |

## 2. Network additions (in scope for PLAN-3)

Ordered by value. Everything except H-1's core reducer lives in `makeFetchDriver` (0 B when unused). The fakes must follow the same rules (see H-9).

| # | Addition | Shape (a proposal, adjust freely) | Notes |
|---|---|---|---|
| **H-1** | **Keep data while a resource reloads** | During `loading`, keep `data` (and the last `error`) from the previous result. Readers tell a first load from a reload by `data !== undefined`. Optionally add `refreshing: true` or `status: 'refreshing'`. | **Before the eval.** This matters for refresh, id changes, pagination and route changes; it is the SWR "keep showing the old data" behaviour. The driver already knows the last result per (sender, name), so it can send it with the `loading` write; no core change needed. Update the `llms.txt`/SKILL lines that say data is "cleared while loading". |
| **H-2** | **Shared response cache** with `staleTime` | One cache per driver instance, keyed by the normalised request (method + URL + query + body; `GET` by default). Fresh entries are served without a request. Stale entries are served **immediately as `success`**, then refetched in the background (stale-while-revalidate). `gcTime` evicts unused entries. Options: driver-level `cache: { staleTime, gcTime }`, overridable per request/resource (`staleTime: 30_000`, `cache: false`). | Default **on for `resources`** with `staleTime: 0`, which still shows cached data instantly and refetches. Default **off for plain routed requests**, so they keep their one-send-one-request semantics: `latest`, `t.requests` counts and the PLAN-2 evals all rely on it. |
| **H-3** | **De-duplicate in-flight requests** across instances | Identical concurrent cacheable requests share one `fetch`, and the reply fans out to every sender. Aborting one sender (`latest`, dispose) aborts the fetch only when no other sender still wants it. | Fixes "two components need the same user, two fetches". It must keep the exact-instance routing guarantee for each sender. |
| **H-4** | **Invalidation across components** | Sink command `{ invalidate: tag \| tags \| (req) => boolean }` from any component. Resources and cache entries carry `tags: ['quotes']`, defaulting to the path prefix. Matching entries are marked stale; mounted resources refetch, keeping data (H-1). Sugar on a write: `{ url, method: 'POST', json, ok: 'SAVED', invalidates: ['quotes'] }` invalidates on success only. | `{ refresh: 'quote' }` stays as the same-instance form. This replaces the EVENTS round trip an app needs today when a save in one component should refresh a list in another. It is the `invalidates` option the research doc (RESEARCH-network-calls §C) already proposed. |
| **H-5** | **Retries with backoff** | `retry: n \| { count, delayMs, maxDelayMs, jitter }`. Retry network errors, 408, 429 (honouring `Retry-After`) and 5xx, never other 4xx. Only `GET`/`HEAD`, unless `retry` is set explicitly on the request. Driver default 0 for routed requests; suggest 2 for `resources`. | Use the same backoff semantics as `makeSocketDriver`'s `reconnect`, one concept for both. The `error` action fires once, after the last attempt, with `{ attempts }` on the payload. `latest`/abort cancels a pending retry timer. |
| **H-6** | **Automatic refetch triggers** for resources | Driver options `refetchOnFocus` and `refetchOnReconnect` (window `focus`/`visibilitychange`, and `online`) refetch **stale** mounted resources. Per resource, `refetchEvery: ms` polls, pausing while the document is hidden. | Defaults: focus/reconnect on for `resources` (TanStack's defaults), polling opt-in. Fakes: off unless the test enables them, so tests stay deterministic. PLAN-3 §1.3 put timer declarations out of scope; `refetchEvery` is the narrow case that matters for HTTP. Put the focus/online/visibility listeners in a small internal module; PLAN-4's browser-sources pack (B-3) will reuse it. |
| **H-7** | **Cache seeding for SSR and route data** | `makeFetchDriver({ initialCache })` plus a serialisable snapshot of the cache (`dehydrate`/`hydrate` on the driver). Requests stay skipped during SSR, but a Vike `+data` hook (or the router's loader, R-6) can prefetch into the cache, and the client starts with fresh entries instead of a loading flash. | This replaces what the removed `HYDRATE` was meant for (D66) and is the "resources prefetch through `+data`" item already in PLAN-3 §1.4. A `{ prefetch: request }` sink command warms the cache without routing a reply; the router uses it on link hover. |
| **H-8** | **Response validation (Standard Schema)** | `validate: schema` on a request or resource: any Standard Schema (zod, valibot, arktype). A failure goes to `error` with `{ issues }`; a success passes the parsed, possibly transformed, value. | Optional, but cheap: `schema['~standard'].validate(value)`, with no dependency. Put the helper in its own module (`src/extra/standardSchema.ts`). PLAN-4's forms work (F-1) will reuse it, and §1.5's server functions need the same validator. |
| **H-9** | **Make the HTTP fake run the real driver** | Like the socket fake (2-C): run `makeFetchDriver` over an in-memory `fetch` that `t.respond`/`t.fail` resolve. That replaces the private copies of the cancel rules (1-C). | Otherwise every cache, dedupe, retry and invalidation rule above needs a second copy in `testing.ts`, and the two will drift. New fake helpers: `t.cache('HTTP')` to inspect, `t.invalidate` is just a sink value, `t.focus()`/`t.online()` to trigger H-6. Retries run on fake timers. |
| **H-10** | **Recipes, not new APIs** | (a) optimistic update with rollback: STATE applies the change, `error` restores it from the error payload's `request`; (b) pagination keeping the previous page (falls out of H-1 and H-2); (c) infinite list: resource with an `ok` hook that appends; (d) mutation status. | Guide pages; add to `llms.txt` only if the eval shows agents need them. |
| **H-11** | **Devtools/inspect** | `getDevTools()` and `t.inspect()` list in-flight requests, cache entries (key, age, stale, subscribers) and resources per instance. | Low priority. It is the Sygnal counterpart of TanStack Query Devtools, and cheap once the cache exists. |

**Diagnostics to consider:** a resource or cached request that is not idempotent (`POST` with `staleTime` or `cache: true`); `invalidate` matching nothing in dev (warn, quiet by default); `validate` that isn't a Standard Schema object.

**Eval additions for the `net` tier:**
- **24-list-detail-cache:** a list and a detail view sharing data; editing in the detail invalidates the list; switching back shows cached data with no spinner.
- **25 (the router task):** see R-8.

The React arm uses TanStack Query (and React Router for 25), which is the realistic comparison.

## 3. The router: recommended for PLAN-3

**Recommendation: the PLAN-3 session builds the router in 6.0.0.** The research found it is the largest functional gap for single-page apps: today routing only exists through Vike. It is not a network feature, but it fits your session better than this one:

1. **It is a driver.** The URL is external state, like a socket. It reuses the machinery you just built: requests routed to the sending component, the declaration-static mechanism (`__sygnalStatic`), test fakes that run the real driver, SSR no-ops, and the 0 B-unless-used size discipline.
2. **Route data is network data.** Changing route should start that route's reads, and React Router and TanStack Router "loaders" are cache prefetches. With `resources` that falls out naturally: route params live in state, so the page's `resources` refetch on their own. Link-hover prefetch is H-7's `{ prefetch }`. Designing the router and the cache separately would end in two loading models.
3. **SSR and Vike** are already yours (HYDRATE removal, `+data`, server functions, G-165). The router must defer to Vike's router inside Vike apps; ideally one link/navigate API works in both.
4. **One eval cycle.** The `net` tier, the React-arm baselines and the user's terminal runs already exist; one more task beats a second eval cycle later.

PLAN-4 gives up the router entirely.

**Design notes (a starting point, not decisions):**

| # | Topic | Suggestion |
|---|---|---|
| R-1 | Driver | `run(App, { ROUTER: makeRouterDriver({ routes: { home: '/', task: '/tasks/:id', notFound: '*' }, base, mode: 'history' \| 'hash' }) })`. A named-route table makes typed links and diagnostics possible. |
| R-2 | Reading the route | Route in state, written by an action: `{ name, params, query, hash, path }`. The canonical form needs a decision. Option (a) is a routed action the root declares (`App.route = 'ROUTE_CHANGED'`, the declaration-static pattern). Option (b) is `ROUTER.route()` in intent, the stream form. (a) matches the "no `select()` round trip" direction of 6.0. |
| R-3 | Rendering | `<Switchable of={{ home: Home, task: Task }} current={state.route.name} />`. Switchable's 6.0 keep-alive pages (CHANGELOG "Switchable pages stay alive") already give "back" its expected instant feel; decide whether route pages opt out per page. |
| R-4 | Navigating | Sink commands: `ROUTER: (s, id) => ({ to: 'task', params: { id } })`, plus `{ back: true }` and `{ replace: true }`. Links stay plain `<a href={href('task', { id })}>`. **The driver intercepts same-origin anchor clicks at the document level**, so views still bind no events (PLAN-1 rule) and links work with modifier keys, middle-click and SSR. |
| R-5 | Guards and redirects | In the model: the route-changed action can return a `ROUTER: { to, replace: true }` redirect. Unsaved-changes blocking: `{ block: 'CONFIRM_LEAVE' }` routes the attempted navigation to an action. |
| R-6 | Data | No loader API. Pages derive `resources` from `state.route.params`; hover prefetch through H-7; SSR seeds the cache (H-7). |
| R-7 | Extras | Scroll restoration; focus management after navigation (an accessibility requirement); `document.title` per route. A `HEAD` sink could do the title, and PLAN-4 hands that to you as an option: see "Also handed over" below. |
| R-8 | Tests and eval | Fakes `t.navigate('/tasks/2')`, `t.location`, `t.back()`; the fake runs the real driver over an in-memory history. Eval task: a list/detail/edit SPA with params, the back button, a not-found route, and an unsaved-changes guard; React arm on React Router. |
| R-9 | Diagnostics | Unknown route name; a missing or extra param in `{ to, params }` / `href()`; a `<Switchable current>` value that isn't a route name; `makeRouterDriver` used inside a Vike app (use Vike's router). |
| R-10 | Naming | 6.0 already uses "routed requests" and `src/extra/routing.ts` for reply delivery. A router next to "routing" will confuse agents and docs. Name the router module `router.ts`, and consider calling the request feature "replies" or "continuation actions" in the docs. |
| R-11 | Vike | Ideally one link/navigate API: in Vike apps, the `ROUTER` sink maps to Vike's `navigate()` and the route state is filled from `pageContext`. Otherwise, document a clear "in Vike, use Vike's routing" split. |

## 4. Also handed over (optional; your call)

| # | Item | Why it fits PLAN-3 |
|---|---|---|
| X-1 | **`HEAD` driver** (title, meta, link; SSR-aware) | Needed by the router (R-7) and by SSR/Vike, which you own. Small. If you don't take it, PLAN-4 builds it. |

## 5. What PLAN-4 needs from PLAN-3 (please keep or document)

- **The generic `__sygnalStatic` mechanism** from 3-A, landed even if `resources` were not. PLAN-4's browser-sources pack (B-3) is planned as another declaration static.
- **H-8's Standard Schema helper**, as its own module, for forms (F-1).
- **H-6's focus/online/visibility listeners**, as an internal module that B-3 can reuse.
- **Budget notes** in your tracker when you finish: core bytes and `llms.txt` lines left, so PLAN-4 can plan within them.
- **Your docs layout** for the router and cache pages, so PLAN-4's guide pages (web components, widgets, forms) fit around them.

## 6. Suggested order inside PLAN-3

1. H-0a/b/c decisions with the user.
2. H-9 (real driver under the fake), first, because everything else is tested through it.
3. H-1, then H-2, H-3, H-4, H-5, H-6 in the fetch driver.
4. Router R-1…R-9 in parallel with step 3 (separate files: `router.ts` and its fake).
5. H-7 (needs H-2 and R-6), then H-8, then H-10 docs and H-11.
6. `llms.txt`/SKILL sync, then the single 4-C eval with tasks 24 and 25 added, then REPORT-v3.
