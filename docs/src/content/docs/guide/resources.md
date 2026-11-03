---
title: Resources and Caching
description: Declarative reads with the resources static, refetching, the opt-in query cache, SSR seeding, prefetching, invalidation, resetting, writing replies into the cache, retries and validation
---

A **resource** is a read that follows state. The component declares which request each resource needs, and [`makeFetchDriver()`](/guide/http/) fetches it whenever that request changes, writing the result to `state[name]`. There is no model entry for loading or for the reply.

In this demo, a stand-in server has quotes 1 to 3; any other id is a 404:

```js live-server
const quotes = { 1: 'Start where you are.', 2: 'Less, but better.', 3: 'Done is done.' }

export default {
  'GET /api/quotes/:id': ({ params }) => {
    const text = quotes[params.id]
    if (!text) return { status: 404, json: { message: 'No such quote' } }
    return { json: { id: Number(params.id), text }, delayMs: 1000 }
  },
}
```

```jsx live title="Quote.jsx"
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

`state.quote` is `{ status, data, error, refreshing }` (plus `headers` for a request with [`keepHeaders`](#showing-when-the-data-was-computed)):

| `status` | When | `data` / `error` |
|---|---|---|
| `'idle'` | The entry returns a falsy value (or before the first request) | none |
| `'loading'` | A **new** request is in flight (the first one, or the request changed) | none: the previous record is never shown for the new one |
| `'success'` | The 2xx reply arrived | `data` is the parsed body |
| `'error'` | A non-2xx status, a network error, a timeout or a validation failure | `error` is the Error (`error.status`, `error.body`, `error.headers`, `error.issues`); `data` is kept from the last success of the same request |

- **A refetch of the same request keeps what is shown.** `{ refresh: 'quote' }`, an [invalidation](#invalidation), a [focus or reconnect refetch](#focus-reconnect-and-polling), polling, or the same request declared again after a pause keep `status`, `data` and `error`, and set `refreshing: true` until the reply lands. Show a spinner next to the data, or treat `refreshing` like loading when the old data must not be visible.
- **A new request clears it.** When the derived request changes (another id), the resource goes to `'loading'` with no data, and the earlier request is aborted: its reply never lands. For pagination, where the previous page should stay visible, set `keepPrevious: true` on the request: the old `data` stays (with `refreshing: true`) until the new page arrives.
- **Change detection is by value.** A state change that derives an equal request (by JSON) sends nothing. Fields that only change how the request is handled are left out of that comparison: `refetchEvery`, `keepPrevious`, `ok`, `error`, `key`, `category`, `latest`, `timeoutMs`, `retry`, `cache`, `staleTime`, `tags`, `invalidates`, `invalidateOn`, `updates`, `background` and `progress`. Changing one of them takes effect with no fetch and no change to `status` or `data`: `refetchEvery: state.live ? 5000 : undefined` starts and stops [polling](#focus-reconnect-and-polling) while the data stays shown.
- **An entry gets the [bag](/guide/state/#what-every-function-gets)**: `(state, { ...props, state, context, uid })`, what the view gets. A child whose read depends on something its parent knows (a project id, a filter) takes it as a prop: `(state, { projectId }) => `/api/projects/${projectId}/tasks``. A routed page reads `route` from context (`(state, { context: { route } }) => `/api/tasks/${route.params.id}``) instead of keeping a copy of it. The entries are computed again when the state, the context or a prop (compared shallowly) changes ([Router](/guide/router/)). Don't copy a prop into the child's state with an action: that is a second copy that can fall behind.
- **7.2 compatibility.** Before 7.2 the second argument was the context, so `(state, { route })` read a context field. It still works until 8.0, with a dev warning ([SYG458](/reference/errors/#syg458)); a prop of the same name wins. `sygnal-check --fix` rewrites it to `(state, { context: { route } })`.
- `ok` / `error` on the request also dispatch those actions after the write, for side work. Not for collecting pages: see [Infinite list](#infinite-list).
- A Collection item, or any component instance, has its own resources. Removing it aborts them.
- In a hidden [Switchable](/guide/switchable/#hidden-pages-pause-connections-and-resources) page, resources pause: the request in flight is aborted and the resource keeps its last result (`refreshing` off; `'idle'` if nothing had arrived yet). When the page is shown again, the same request is refetched, keeping data. Mark an entry `background: true` to keep it live while hidden.

Writes stay [reply actions](/guide/http/): `{ url, method: 'PUT', json, ok: 'SAVED', error: 'SAVE_FAILED' }`. After a write, [`invalidates`](#invalidation) refetches the reads it changed, and [`updates`](#writing-a-reply-into-the-cache) shows its reply in them at once.

## The query cache

The cache is off by default, and it is a separate export, so an app that only sends requests doesn't ship it. Give the driver one:

```javascript
import { run, makeFetchDriver, queryCache } from 'sygnal'
import App from './App.jsx'

run(App, { HTTP: makeFetchDriver({ cache: queryCache() }) })
// or: queryCache({ staleTime: 30000, gcTime: 300000, refetchOnFocus: true, refetchOnReconnect: true })
```

**The cache goes in `main.js` and in each test**: `renderComponent(App, { http: { cache: queryCache() } })` ([Testing](#testing)). A component rendered without one gets no caching. Put `staleTime` on the resource's request (`{ url: '/api/items', staleTime: 2000 }`) rather than on the cache, so the app and its tests use the same freshness; a `staleTime` sent to a driver without a `queryCache()` is reported as [SYG635](/reference/errors/#syg635).

With the cache on:

- **Stale-while-revalidate.** A resource whose request was fetched before shows the cached data at once (`'success'` with `refreshing: true`) and refetches it in the background. Switching back to a list or a record shows it with no spinner.
- **`staleTime`** (default `0`): how long a reply counts as fresh. A fresh entry is served without any request; a `{ refresh }` always fetches.
- **De-duplication.** Identical requests in flight share one fetch, even from different components; each component still gets its own `state[name]` (or its own `ok` action). The fetch is aborted only when no component still wants it.
- **`gcTime`** (default 5 minutes): an entry that no mounted resource uses is dropped after this long.
- The cache key is the method, the URL with its query (sorted), the body and `parse`. Resources' GET and HEAD requests are cached; a request opts out with `cache: false`. With `keepHeaders`, the entry also keeps those response headers, and they are part of the key. A request with a `parse` function or `parse: 'response'` is never cached: the key can't tell two functions apart, and a `Response` can't be kept. To cache a value from a response header, use [`keepHeaders`](#showing-when-the-data-was-computed).
- **`queryCache().clear()`** drops every entry (React Query's `queryClient.clear()`); mounted resources keep what they show. To reset them too, send `{ reset: true }` ([Resetting](#resetting)).

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
// TaskPage.jsx
// the page reads the same request
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

```javascript title="pages/quote/@id/+data.js"
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
// pages/+drivers.js
// client-only; one cache for the session
import { makeFetchDriver, queryCache } from 'sygnal'

export default { HTTP: makeFetchDriver({ cache: queryCache({ staleTime: 30000 }) }) }
```

```jsx title="pages/quote/@id/+Page.jsx"
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

- `invalidates` on any request runs after a 2xx reply only, unless the request says `invalidateOn: 'settled'` (below).
- `{ invalidate: value }` on the `HTTP` sink invalidates right away, from any component: `HTTP: () => ({ invalidate: 'quotes' })`.
- The value is a tag (`'quotes'`), a URL prefix of the request's `url` (a string starting with `/`: `'/api/quotes'`), an array of them, or a predicate `(request) => boolean`. Tags are explicit: nothing is derived from the URL.
- Matching **mounted** resources refetch, keeping their data (`refreshing: true`); matching cache entries are marked stale, so the next use refetches. Invalidation works with or without the cache.
- **Invalidation aborts older reads.** A refetch aborts the resource's read already in flight, so a reply sent before the save never lands after it: no request ids or sequence numbers. A shared cache fetch in flight for a matching entry still answers the requests waiting on it, but never writes the cache.
- **An `ok` action that navigates is fine.** When the `ok` action changes the resource's request (a `ROUTER` move to the next record), the new request is sent and the invalidation never resends the old one after it.
- An `invalidate` that matches nothing is reported as [SYG632](/reference/errors/#syg632) (info).

**Invalidating after a failure too.** A write that fails can still leave the reads stale, for example after an optimistic update or a save the server applied in part. `invalidateOn: 'settled'` on the request runs its `invalidates` after any final outcome: a 2xx, a non-2xx status, a network error, a timeout or a `validate` failure. This is the equivalent of invalidating in React Query's `onSettled` instead of `onSuccess`. On a failure, the resource's error and the `error` action come first, then the refetch, in the same order as on success. An aborted request (superseded by `latest`, cancelled, or its component disposed) invalidates nothing, and a request with `retry` invalidates once, after its last attempt. To make it the default for every request, use `makeFetchDriver({ invalidateOn: 'settled' })` (in tests: `renderComponent(C, { http: { invalidateOn: 'settled' } })`). A request's own `invalidateOn: 'success'` still wins.

## Resetting

`{ reset: value }` on the `HTTP` sink puts data back to where it started, like React Query's `resetQueries`. Use it when the data no longer applies, such as after a logout or an account switch:

```jsx
Account.model = {
  SWITCH_ORG: {
    STATE: (state, org) => ({ ...state, org }),
    HTTP:  () => ({ reset: true }),
  },
}
```

- `true` matches everything; otherwise the value matches like [`invalidate`](#invalidation): a tag, a URL prefix starting with `/`, an array of them, or a predicate `(request) => boolean`.
- Matching cache entries are dropped, so nothing is served from them, however fresh.
- Matching **mounted** resources go back to `'loading'` with no data and no error, then refetch. Their reads in flight are aborted, so an old reply never lands.
- Matching **paused** resources (in a hidden page) lose the result they kept and become `'idle'`; when the page is shown again they load anew.
- It works with or without the cache, from any component.

Compared with the neighbours: `invalidate` refetches and keeps showing the old data (`refreshing: true`); `reset` hides it until the new reply arrives; `queryCache().clear()` drops the cache entries and leaves the resources as they are.

## Writing a reply into the cache

`updates` on a request writes its 2xx reply into this component's resources, like React Query's `setQueryData`. The saved record shows at once, without waiting for a refetch:

```jsx
Item.model = {
  SAVE: {
    HTTP: (state) => ({
      url: `/api/items/${state.id}`, method: 'PUT', json: { title: state.draft },
      ok: 'SAVED', error: 'SAVE_FAILED',
      updates: 'item',              // the reply becomes state.item.data now
      invalidates: '/api/items',    // then the item and the list refetch, keeping data
    }),
  },
  SAVED: (state) => ({ ...state, editing: false }),
  SAVE_FAILED: (state) => ({ ...state, saveError: 'Could not save the item.' }),
}
```

- The value names resources of the component that sends the request: `'item'`, `['item', 'detail']`, or an object whose functions derive the new data from the current one: `updates: { item: true, items: (list, saved) => list.map((i) => (i.id === saved.id ? { ...i, title: saved.title } : i)) }`.
- The write comes first: the resource becomes `'success'` with the new data, its cache entry is set, and its read in flight (if any) is aborted. Then the `ok` action runs, then `invalidates`. An invalidated resource refetches keeping the written data (`refreshing: true`), and the server's reply replaces it.
- Other mounted resources reading the same cache entry show the new data too. A resource that is idle (its entry returned a falsy value) is skipped; a paused one (a hidden page) is updated.
- Nothing is written when the request fails. The `ok` action still gets the reply.

## Focus, reconnect and polling

- With a `queryCache()`, when the window regains focus (or the tab becomes visible) and when the browser comes back online, every **stale** mounted resource refetches, keeping its data. Turn either off with `refetchOnFocus: false` / `refetchOnReconnect: false`. Resources in hidden pages don't refetch.
- `refetchEvery: ms` on a resource request polls: it refetches that long after each reply, and skips while the document is hidden. It works with or without the cache.
- `refetchEvery` can follow state. Turning it on or changing it schedules the next refetch that long from now; turning it off (`undefined`) stops polling. Neither sends a request or clears the data: `refetchEvery` isn't part of what is fetched.

```jsx
Prices.resources = {
  prices: (state) => ({ url: '/api/prices', query: { market: state.market }, refetchEvery: state.live ? 10000 : undefined }),
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

`keepPrevious: true` keeps the current page on screen, with `refreshing: true`, while the next one loads. In this demo, a stand-in server pages through 12 items, 5 at a time:

```js live-server
const items = Array.from({ length: 12 }, (_, i) => ({ title: `Item ${i + 1}` }))

export default {
  'GET /api/items': ({ query }) => {
    const start = (Number(query.page) - 1) * 5
    return { json: { items: items.slice(start, start + 5) }, delayMs: 1000 }
  },
}
```

```css live
.rows.stale { opacity: 0.5; }
```

```jsx live title="Pages.jsx"
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

Give each loaded page its own resource, `page0`, `page1`, …, and derive the list from them. Page `i` starts at the cursor page `i - 1` returned, and "Load more" adds a page:

```jsx
import { ABORT } from 'sygnal'

const pageName = (i) => `page${i}`
const pagesOf = (state) => Array.from({ length: state.pages }, (_, i) => state[pageName(i)])
// the first page has no cursor; a later one waits (undefined) until the page before it arrives
const cursorFor = (state, i) => (i === 0 ? null : state[pageName(i - 1)]?.data?.nextCursor)

function Feed({ state }) {
  return (
    <div>
      <ul>{state.items.map(item => <li>{item.title}</li>)}</ul>
      {pagesOf(state).at(-1)?.status === 'loading' && <p className="loading">Loading…</p>}
      {state.hasMore && <button className="more">Load more</button>}
    </div>
  )
}
Feed.initialState = { pages: 1 }
Feed.resources = (state) => Object.fromEntries(
  Array.from({ length: state.pages }, (_, i) => {
    const after = cursorFor(state, i)
    return [pageName(i), after !== undefined && { url: '/api/feed', query: { after }, tags: ['feed'], keepPrevious: true }]
  })
)
Feed.calculated = {
  // a row that moved to a later page while the pages refetched is shown once
  items: (state) => {
    const seen = new Set()
    return pagesOf(state).flatMap(page => page?.data?.items ?? []).filter(item => !seen.has(item.id) && seen.add(item.id))
  },
  hasMore: (state) => pagesOf(state).at(-1)?.data?.nextCursor != null,
}
Feed.intent = ({ DOM }) => ({ MORE: DOM.click('.more') })
Feed.model = {
  MORE: (state) => (pagesOf(state).at(-1)?.status !== 'success' || !state.hasMore ? ABORT : { ...state, pages: state.pages + 1 }),
}
```

A refetch (an invalidation of `'feed'`, a focus refetch, polling) refetches every loaded page, from the first, so new rows appear at the top and each later page gets the cursor of the fresh page before it. Nothing depends on an `ok` action, so a refetch or a cached revisit can't append a page twice or miss one: the list is whatever the pages hold. Rows pushed past the last loaded page by new ones drop off the end until "Load more" fetches them; `hasMore` stays true. For a page-number API, `cursorFor` is `(state, i) => i + 1` and `hasMore` reads the last page's own flag. To start over, set `pages: 1`. A remounted `Feed` starts at one page, shown at once from a `queryCache()` while it refetches.

Don't accumulate pages in an `ok` action (`items: [...state.items, ...body.items]`): a resource refetches its current request, the last page, so its rows repeat, new rows never reach the top, and a reply served from the cache runs no `ok` at all.

### List and detail with a save

Each view declares its read only while it is shown, the cache shows a known list or item at once, and a save writes the reply and refetches both. In this demo, a stand-in server keeps three items, refuses an empty title, and the driver has a `queryCache()` (the `options` export):

```js live-server
import { queryCache } from 'sygnal'

export const options = { cache: queryCache() }

const items = [
  { id: 1, title: 'Buy milk' },
  { id: 2, title: 'Call Ana' },
  { id: 3, title: 'Book flights' },
]
const find = (id) => items.find((i) => i.id === Number(id))

export default {
  'GET /api/items': () => ({ json: items }),
  'GET /api/items/:id': ({ params }) => ({ json: find(params.id) }),
  'PUT /api/items/:id': ({ params, json }) => (json.title.trim() === ''
    ? { status: 422, json: { title: 'Required' } }
    : { json: Object.assign(find(params.id), { title: json.title }) }),
}
```

```jsx live title="App.jsx"
const statusOf = (r) => (r?.status === 'loading' ? 'Loading…' : r?.refreshing ? 'Updating…' : '')

function App({ state }) {
  if (state.view === 'list') {
    return (
      <section className="list">
        <p className="status">{statusOf(state.items)}</p>
        <ul className="items">
          {(state.items?.data ?? []).map((item) => <li><button className="open" data-id={String(item.id)}>{item.title}</button></li>)}
        </ul>
      </section>
    )
  }
  return (
    <section className="detail">
      <button className="back">Back to list</button>
      <p className="status">{statusOf(state.item)}</p>
      <h2 className="item-title">{state.item?.data?.title}</h2>
      <input name="title" aria-label="Title" value={state.draft} />
      <button className="save">Save</button>
      <p className="save-error">{state.saveError}</p>
    </section>
  )
}
App.initialState = { view: 'list', id: null, draft: '', saveError: '' }
App.resources = {
  items: (state) => state.view === 'list' && { url: '/api/items', staleTime: 2000 },
  item: (state) => state.view === 'detail' && { url: `/api/items/${state.id}`, staleTime: 2000 },
}
App.intent = ({ DOM }) => ({
  OPEN: DOM.click('.open').data('id', Number),
  BACK: DOM.click('.back'),
  TYPE: DOM.input('input[name="title"]').value(),
  SAVE: DOM.click('.save'),
})
App.model = {
  OPEN: (state, id) => ({ ...state, view: 'detail', id, draft: '', saveError: '' }),
  BACK: (state) => ({ ...state, view: 'list' }),
  TYPE: (state, draft) => ({ ...state, draft }),
  SAVE: {
    STATE: (state) => ({ ...state, saveError: '' }),
    HTTP: (state) => ({
      url: `/api/items/${state.id}`, method: 'PUT', json: { title: state.draft },
      ok: 'SAVED', error: 'SAVE_FAILED', updates: 'item', invalidates: '/api/items',
    }),
  },
  SAVED: (state) => ({ ...state, draft: '' }),
  SAVE_FAILED: (state) => ({ ...state, saveError: 'Could not save the item.' }),
}
```

```javascript
// main.js
// the tests use renderComponent(App, { http: { cache: queryCache() } })
run(App, { HTTP: makeFetchDriver({ cache: queryCache() }) })
```

- `state.items` and `state.item` are undefined until their first write, hence the `?.`.
- A hidden view's resource goes `'idle'`. Shown again within `staleTime`, the cached data is shown with no request; later it is shown at once and refetched (`'Updating…'`).
- The save shows the new title at once (`updates`), and the list and item refetch (`invalidates`). A read in flight from before the save is aborted, so its reply never overwrites the saved title.

### Showing when the data was computed

A server that computes a report says when in a response header. `keepHeaders` keeps it next to the data, through refetches and the cache:

```jsx title="Report.jsx"
function Report({ state }) {
  const { status, data, headers, refreshing } = state.report
  if (status === 'loading') return <p>Loading…</p>
  if (status === 'error' && !data) return <p>Could not load the report.</p>
  return (
    <section>
      <p className="total">{data?.total} open tasks</p>
      <p className="as-of">As of {headers?.['x-computed-at'] ?? 'unknown'}{refreshing ? ' (updating…)' : ''}</p>
      <button className="refresh">Refresh</button>
    </section>
  )
}
Report.initialState = {}
Report.resources = {
  report: () => ({ url: '/api/report', keepHeaders: ['X-Computed-At'], refetchEvery: 60000 }),
}
Report.intent = ({ DOM }) => ({ REFRESH: DOM.click('.refresh') })
Report.model = { REFRESH: { HTTP: { refresh: 'report' } } }
```

- `headers` holds the names asked for, lowercased, each a string or `null` when the response didn't send it.
- While a refetch is in flight (`refreshing`), the old time stays with the old data; the new reply replaces both. A failed refetch keeps both.
- With a `queryCache()`, the entry keeps the headers: coming back to the report shows its cached data with the time it was computed, and so do `dehydrate()` / `hydrate()` and server rendering. A server loader seeds both: `cache.set({ url: '/api/report', keepHeaders: ['X-Computed-At'] }, report, { 'X-Computed-At': computedAt })`.
- In a test: `await t.respond('HTTP', new Response(JSON.stringify({ total: 3 }), { headers: { 'content-type': 'application/json', 'X-Computed-At': '10:00' } }), 'report')`, then `t.state.report.headers['x-computed-at']` is `'10:00'`; `t.cache('HTTP')` lists the entry's `headers`.

### Logout

On logout, nothing fetched for the old user may be shown or served again. When the components that read user data stay mounted (a header with the user's name, a dashboard that turns into its signed-out version), reset everything: each mounted resource goes back to `'loading'` and refetches as the signed-out user, and every cache entry is dropped:

```jsx title="Account.jsx"
function Account({ state }) {
  return <button className="logout" disabled={state.leaving}>Log out</button>
}
Account.initialState = { leaving: false }
Account.intent = ({ DOM }) => ({ LOGOUT: DOM.click('.logout') })
Account.model = {
  LOGOUT: {
    STATE: (state) => ({ ...state, leaving: true }),
    HTTP:  () => ({ url: '/api/logout', method: 'POST', ok: 'LOGGED_OUT', error: 'LOGGED_OUT' }),
  },
  LOGGED_OUT: {
    STATE: (state) => ({ ...state, leaving: false }),
    HTTP:  () => ({ reset: true }),
  },
}
```

When logout replaces the whole app with a sign-in page, the user-data components are removed (their requests are aborted), so there is nothing to refetch: clear the cache instead. Keep the `queryCache()` in a module that `main.js` and the component both import, and call `clear()` from an `EFFECT`:

```jsx title="SignOut.jsx"
import { event } from 'sygnal'
import { cache } from './cache.js'   // export const cache = queryCache(), given to makeFetchDriver in main.js

function SignOut() {
  return <button className="sign-out">Sign out</button>
}
SignOut.intent = ({ DOM }) => ({ SIGN_OUT: DOM.click('.sign-out') })
SignOut.model = {
  SIGN_OUT: {
    EFFECT: () => cache.clear(),
    EVENTS: event('SIGNED_OUT'),      // the app's root shows the sign-in page
  },
}
```

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
- `renderComponent(C, { http })` passes driver options (`cache: queryCache()`, `retry`, `timeoutMs`, …) to the fake: give it the same `queryCache()` as `main.js`, or the test runs without a cache. A seeded cache: `queryCache({ initial: snapshot })`.
- `t.cache('HTTP')` lists the cache entries: `{ key, age, stale, subscribers, data, tags, headers }` (`headers` with `keepHeaders`).
- A `{ prefetch }` fetch is listed in `t.requests('HTTP')` as `{ url, ...request, prefetch: true }`; answer it like any other, e.g. `t.respond('HTTP', data, '/api/quotes/2')`.
- `t.focus()` and `t.online()` simulate the browser events; the test's own window events never trigger refetches.
- Retries and `refetchEvery` run on the test's timers, fake timers included. `t.requests('HTTP')` lists what the component sent (and each resource fetch), not each retry.
