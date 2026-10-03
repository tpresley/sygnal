---
title: Resources and Caching
description: Declarative reads with the resources static, refetching, the opt-in query cache, SSR seeding, prefetching, invalidation, retries and validation
---

A **resource** is a read that follows state. The component declares which request each resource needs, and [`makeFetchDriver()`](/guide/http/) fetches it whenever that request changes, writing the result to `state[name]`. There is no model entry for loading or for the reply.

```jsx
function Quote({ state }) {
  const { status, data, refreshing } = state.quote
  return (
    <div className="quote">
      <button className="next">Next</button>
      <button className="refresh">Refresh</button>
      <p className="status">{status === 'loading' ? 'Loading…' : status === 'error' ? 'Could not load the quote.' : ''}</p>
      <p className="text">{data?.text}</p>
      {refreshing && <p className="busy">Updating…</p>}
    </div>
  )
}
Quote.initialState = { id: 1 }
Quote.resources = {
  quote: (state) => state.id && `/api/quotes/${state.id}`,   // a URL or a request; falsy = idle
}
Quote.intent = ({ DOM }) => ({
  NEXT:    DOM.click('.next'),
  REFRESH: DOM.click('.refresh'),
})
Quote.model = {
  NEXT:    (state) => ({ ...state, id: state.id + 1 }),
  REFRESH: { HTTP: { refresh: 'quote' } },
}
```

`state.quote` is `{ status, data, error, refreshing }`:

| `status` | When | `data` / `error` |
|---|---|---|
| `'idle'` | The entry returns a falsy value (or before the first request) | none |
| `'loading'` | A **new** request is in flight (the first one, or the request changed) | none: the previous record is never shown for the new one |
| `'success'` | The 2xx reply arrived | `data` is the parsed body |
| `'error'` | A non-2xx status, a network error, a timeout or a validation failure | `error` is the Error (`error.status`, `error.body`, `error.issues`); `data` is kept from the last success of the same request |

- **A refetch of the same request keeps what is shown.** `{ refresh: 'quote' }`, an [invalidation](#invalidation), a [focus or reconnect refetch](#focus-reconnect-and-polling), polling, or the same request declared again after a pause keep `status`, `data` and `error`, and set `refreshing: true` until the reply lands. Show a spinner next to the data, or treat `refreshing` like loading when the old data must not be visible.
- **A new request clears it.** When the derived request changes (another id), the resource goes to `'loading'` with no data, and the earlier request is aborted: its reply never lands. For pagination, where the previous page should stay visible, set `keepPrevious: true` on the request: the old `data` stays (with `refreshing: true`) until the new page arrives.
- **Change detection is by value.** A state change that derives an equal request (by JSON) sends nothing.
- `ok` / `error` on the request also dispatch those actions after the write, for side work such as appending pages.
- A Collection item, or any component instance, has its own resources. Removing it aborts them.
- In a hidden [Switchable](/guide/switchable/#hidden-pages-pause-connections-and-resources) page, resources pause: the request in flight is aborted and the resource keeps its last result (`refreshing` off; `'idle'` if nothing had arrived yet). When the page is shown again, the same request is refetched, keeping data. Mark an entry `background: true` to keep it live while hidden.

Writes stay [reply actions](/guide/http/): `{ url, method: 'PUT', json, ok: 'SAVED', error: 'SAVE_FAILED' }`.

## The query cache

The cache is off by default, and it is a separate export, so an app that only sends requests doesn't ship it. Give the driver one:

```javascript
import { run, makeFetchDriver, queryCache } from 'sygnal'
import App from './App.jsx'

run(App, { HTTP: makeFetchDriver({ cache: queryCache() }) })
// or: queryCache({ staleTime: 30000, gcTime: 300000, refetchOnFocus: true, refetchOnReconnect: true })
```

With the cache on:

- **Stale-while-revalidate.** A resource whose request was fetched before shows the cached data at once (`'success'` with `refreshing: true`) and refetches it in the background. Switching back to a list or a record shows it with no spinner.
- **`staleTime`** (default `0`): how long a reply counts as fresh. A fresh entry is served without any request; a `{ refresh }` always fetches.
- **De-duplication.** Identical requests in flight share one fetch, even from different components; each component still gets its own `state[name]` (or its own `ok` action). The fetch is aborted only when no component still wants it.
- **`gcTime`** (default 5 minutes): an entry that no mounted resource uses is dropped after this long.
- The cache key is the method, the URL with its query (sorted), the body and `parse`. Resources' GET and HEAD requests are cached; a request opts out with `cache: false`.

Requests with reply actions keep one-send-one-request semantics unless they ask for the cache with `cache: true` or `staleTime`:

```jsx
User.model = {
  LOAD:   { HTTP: (state) => ({ url: `/api/users/${state.id}`, ok: 'LOADED', staleTime: 60000 }) },
  LOADED: (state, user) => ({ ...state, user }),
}
```

Cache reads only. A POST, PUT, PATCH or DELETE with `cache` or `staleTime` is reported as [SYG630](/reference/errors/#syg630): its writes would be answered from the cache. Without a `queryCache()` on the driver, `cache`, `staleTime` and `{ prefetch }` do nothing, which is reported as [SYG635](/reference/errors/#syg635).

## Prefetching

`{ prefetch: request }` on the `HTTP` sink fetches a request into the cache without a reply. A resource that reads it later starts at `'success'`, and while the entry is fresh (`staleTime`) it sends nothing. A fresh entry, or the same fetch already in flight, is not fetched again.

```jsx
QuoteList.model = {
  HOVER: { HTTP: (state, id) => ({ prefetch: `/api/quotes/${id}` }) },
}
```

`cache.prefetch(request)` does the same from outside a component, through the driver that was given the cache.

### Prefetching a route's data

There is no loader API: route pages derive their resources from `state.route`. To warm a page's data on link hover, keep the page's requests in one map and use it twice, in the page's `resources` and in the [router](/guide/router/#prefetching)'s `prefetch` option:

```javascript
// data.js
import { makeRouter, queryCache } from 'sygnal'

export const cache = queryCache({ staleTime: 30000 })
export const routeData = {
  task: (route) => [`/api/tasks/${route.params.id}`],
}
export const router = makeRouter({
  routes: { home: '/', task: '/tasks/:id', notFound: '*' },
  prefetch: (route) => routeData[route.name]?.(route).forEach(cache.prefetch),
})
```

```jsx
// TaskPage.jsx: the page reads the same request
TaskPage.resources = { task: (state) => routeData.task(state.route)[0] }

// App.jsx: { prefetch } on the ROUTER sink, e.g. on hover, warms the route's data
App.model = {
  HOVER_TASK: { ROUTER: (state, id) => ({ prefetch: 'task', params: { id } }) },
}
```

Register the driver with the same cache: `run(App, { ROUTER: router.driver, HTTP: makeFetchDriver({ cache }) })`. Navigating to the task then renders it at once, with no request while the entry is fresh.

## Server rendering

Requests are never sent during server rendering. To render a resource with data on the server, a loader fetches it into a cache, and the snapshot travels to the client:

- `cache.set(request, data)` writes one entry, keyed like the request the component declares.
- `renderToString(App, { cache })` renders each resource found in the cache as `{ status: 'success', data }`; any other request renders as `'loading'`.
- `cache.dehydrate()` returns a snapshot, `[{ key, data, updatedAt, tags }]`, that is safe to serialise. `queryCache({ initial: snapshot })` or `cache.hydrate(snapshot)` loads it on the client.

A seeded entry keeps its `updatedAt`, so it stays fresh for `staleTime` after the server fetched it. While it is fresh, the client's first paint is `'success'` with no request. A stale entry is shown at once and refetched (`refreshing: true`). Give the client cache a `staleTime`, or every seeded page refetches right after hydration.

### With Vike

A `+data` hook seeds a cache and puts its snapshot on `pageContext.queryCache`. The Sygnal Vike extension renders the page's resources from it, passes it to the client, and hydrates the cache of every fetch driver in the `drivers` config before the page runs. On client-side navigation it does the same with the next page's snapshot.

```javascript
// pages/quote/@id/+data.js
import { queryCache } from 'sygnal'

export async function data(pageContext) {
  const id = Number(pageContext.routeParams.id)
  const cache = queryCache()
  const quote = await (await fetch(`https://api.example.com/quotes/${id}`)).json()
  cache.set(`/api/quotes/${id}`, quote)   // the request the page's resource declares
  pageContext.queryCache = cache.dehydrate()
  return { id }
}
```

```javascript
// pages/+drivers.js: client-only; one cache for the session
import { makeFetchDriver, queryCache } from 'sygnal'

export default { HTTP: makeFetchDriver({ cache: queryCache({ staleTime: 30000 }) }) }
```

```jsx
// pages/quote/@id/+Page.jsx
function Page({ state }) {
  const { status, data } = state.quote
  return <p className="quote">{status === 'success' ? data.text : 'Loading…'}</p>
}
Page.initialState = { id: 1 }
Page.resources = { quote: (state) => `/api/quotes/${state.id}` }
export default Page
```

The server HTML contains the quote, and the client hydrates without fetching it again.

## Invalidation

After a write, refresh the reads it changed. Tag the reads, and invalidate the tag:

```jsx
QuoteList.resources = {
  quotes: () => ({ url: '/api/quotes', tags: ['quotes'] }),
}

QuoteEditor.model = {
  SAVE: {
    HTTP: (state) => ({ url: `/api/quotes/${state.id}`, method: 'PUT', json: state.draft, ok: 'SAVED', invalidates: ['quotes'] }),
  },
  SAVED: (state) => ({ ...state, saved: true }),
}
```

- `invalidates` on any request runs after a 2xx reply only.
- `{ invalidate: value }` on the `HTTP` sink invalidates right away, from any component: `HTTP: () => ({ invalidate: 'quotes' })`.
- The value is a tag (`'quotes'`), a URL prefix of the request's `url` (a string starting with `/`: `'/api/quotes'`), an array of them, or a predicate `(request) => boolean`. Tags are explicit: nothing is derived from the URL.
- Matching **mounted** resources refetch, keeping their data (`refreshing: true`); matching cache entries are marked stale, so the next use refetches. Invalidation works with or without the cache.
- An `invalidate` that matches nothing is reported as [SYG632](/reference/errors/#syg632) (info).

## Focus, reconnect and polling

- With a `queryCache()`, when the window regains focus (or the tab becomes visible) and when the browser comes back online, every **stale** mounted resource refetches, keeping its data. Turn either off with `refetchOnFocus: false` / `refetchOnReconnect: false`. Resources in hidden pages don't refetch.
- `refetchEvery: ms` on a resource request polls: it refetches that long after each reply, and skips while the document is hidden. It works with or without the cache.

```jsx
Prices.resources = {
  prices: (state) => ({ url: '/api/prices', query: { market: state.market }, refetchEvery: 10000 }),
}
```

## Retries

Requests are not retried by default. Ask for it per request, or for every GET and HEAD with the driver option:

```javascript
makeFetchDriver({ retry: 2 })                                         // GET/HEAD only
// on a request (any method): retry: 3, or retry: { count: 3, delayMs: 500, maxDelayMs: 10000, jitter: 0.2 }
```

- Network errors, 408, 429 and 5xx are retried; other 4xx never are. A `Retry-After` header (in seconds) sets the wait; otherwise the delay doubles from `delayMs` up to `maxDelayMs`, varied by `jitter` (the same backoff as the socket driver's `reconnect`).
- The `error` action (or the resource's `'error'`) arrives once, after the last attempt, with `attempts`.
- `latest`, `{ abort }` and removing the component cancel a pending retry.

## Validation

`validate` takes any [Standard Schema](https://standardschema.dev) (zod, valibot, arktype, …) and checks the parsed body before it is delivered. The delivered value is the schema's output, so transforms apply:

```jsx
import { z } from 'zod'

const QuoteSchema = z.object({ id: z.number(), text: z.string(), author: z.string() })

Quote.resources = {
  quote: (state) => state.id && { url: `/api/quotes/${state.id}`, validate: QuoteSchema },
}
```

A body that fails goes to `'error'` (or the `error` action) with the schema's `issues`: `{ error, status, issues, request }`. A `validate` that isn't a Standard Schema fails the request and is reported as [SYG631](/reference/errors/#syg631).

## Recipes

### Pagination

`keepPrevious: true` keeps the current page on screen, with `refreshing: true`, while the next one loads:

```jsx
function Pages({ state }) {
  const { data, refreshing } = state.list
  return (
    <div>
      <ul className={refreshing ? 'rows stale' : 'rows'}>{(data?.items ?? []).map(item => <li>{item.title}</li>)}</ul>
      <button className="prev" disabled={state.page === 1}>Previous</button>
      <span className="page">Page {state.page}</span>
      <button className="next">Next</button>
    </div>
  )
}
Pages.initialState = { page: 1 }
Pages.resources = {
  list: (state) => ({ url: '/api/items', query: { page: state.page }, keepPrevious: true }),
}
Pages.intent = ({ DOM }) => ({ PREV: DOM.click('.prev'), NEXT: DOM.click('.next') })
Pages.model = {
  PREV: (state) => ({ ...state, page: Math.max(1, state.page - 1) }),
  NEXT: (state) => ({ ...state, page: state.page + 1 }),
}
```

With a `queryCache()`, going back to a page fetched less than `staleTime` ago shows it without a request.

### Infinite list

The resource fetches the current page; its `ok` action appends each page to a list the component owns:

```jsx
import { ABORT } from 'sygnal'

function Feed({ state }) {
  return (
    <div>
      <ul>{state.items.map(item => <li>{item.title}</li>)}</ul>
      {state.feed.status === 'loading' && <p className="loading">Loading…</p>}
      {state.hasMore && <button className="more">Load more</button>}
    </div>
  )
}
Feed.initialState = { page: 1, items: [], hasMore: true }
Feed.resources = {
  feed: (state) => ({ url: '/api/feed', query: { page: state.page }, ok: 'PAGE' }),
}
Feed.intent = ({ DOM }) => ({ MORE: DOM.click('.more') })
Feed.model = {
  MORE: (state) => (state.feed.status === 'loading' ? ABORT : { ...state, page: state.page + 1 }),
  PAGE: (state, body) => ({ ...state, items: [...state.items, ...body.items], hasMore: body.hasMore }),
}
```

`PAGE` runs on every successful fetch of the request, refetches included, so leave the cache's focus refetch off for such a list (`queryCache({ refetchOnFocus: false })`) or de-duplicate by id in `PAGE`.

For writes, see the [optimistic update and save status recipes](/guide/http/#recipes).

## Testing

`renderComponent` runs the real driver over an in-memory `fetch` ([Testing](/integration/testing/#resources)), so every rule on this page applies in tests. Each fetch stays pending until `t.respond` or `t.fail` answers it, by the resource name, its URL or a partial request:

```js
import { it, expect } from 'vitest'
import { renderComponent, queryCache } from 'sygnal'
import Quote from './Quote.jsx'

it('refreshes in place, and shows the cached quote when coming back', async () => {
  const t = renderComponent(Quote, { http: { cache: queryCache() } })
  await t.waitForState((s) => s.quote.status === 'loading')
  await t.respond('HTTP', { text: 'One' }, 'quote')

  t.simulateAction('REFRESH')
  await t.waitForState((s) => s.quote.refreshing)
  expect(t.html()).toContain('One')                  // still shown while it refetches
  await t.respond('HTTP', { text: 'One, edited' }, 'quote')

  t.simulateAction('NEXT')                            // not cached yet: loading
  await t.waitForState((s) => s.quote.status === 'loading')
  await t.respond('HTTP', { text: 'Two' }, 'quote')
  expect(t.cache('HTTP').map((e) => e.key)).toEqual(['GET /api/quotes/1', 'GET /api/quotes/2'])
  t.dispose()
})
```

- A resource's request is sent after the state changes, not during the event that caused it. `t.respond` / `t.fail` by resource name right after a `simulateEvent` / `simulateAction` that hasn't produced its state yet waits (up to 1 s) for that fetch; otherwise, as for any request, they throw at the call when nothing matches.
- `renderComponent(C, { http })` passes driver options (`cache: queryCache()`, `retry`, `timeoutMs`, …) to the fake. A seeded cache: `queryCache({ initial: snapshot })`.
- `t.cache('HTTP')` lists the cache entries: `{ key, age, stale, subscribers, data, tags }`.
- A `{ prefetch }` fetch is listed in `t.requests('HTTP')` as `{ url, ...request, prefetch: true }`; answer it like any other, e.g. `t.respond('HTTP', data, '/api/quotes/2')`.
- `t.focus()` and `t.online()` simulate the browser events; the test's own window events never trigger refetches.
- Retries and `refetchEvery` run on the test's timers, fake timers included. `t.requests('HTTP')` lists what the component sent (and each resource fetch), not each retry.
