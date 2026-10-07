# Reads that follow state: `resources`

Declarative reads (`resources` static), refresh vs refetch, invalidation after a write, a cached list/detail with save (`queryCache`, `updates`).

```jsx
function Quote({ state }) {
  const { status, data, error, refreshing } = state.quote  // status: 'idle' | 'loading' | 'success' | 'error'
  const text = status === 'loading' ? 'Loading…' : status === 'error' ? `Failed (${error.status ?? 'network'})` : refreshing ? 'Updating…' : ''
  return <div><button className="next">Next</button><button className="refresh">Refresh</button><p className="status">{text}</p><p className="text">{data?.text}</p></div>
}
Quote.initialState = { id: 1 }
Quote.resources = { quote: (state) => state.id && `/api/quotes/${state.id}` }  // a URL or a request; falsy = idle
Quote.intent = ({ DOM }) => ({ NEXT: DOM.click('.next'), REFRESH: DOM.click('.refresh') })
Quote.model = {
  NEXT:    (state) => ({ ...state, id: state.id + 1 }),  // new request: 'loading' without data; the old one is aborted
  REFRESH: { HTTP: { refresh: 'quote' } },               // same request: data kept, refreshing: true
}
```
- For data a component shows; writes stay reply actions. Needs `makeFetchDriver()` in main.js. The built-in `RESOURCE` action writes `state.quote` (not in initialState). A changed request is fetched and the older one aborted: no ids, `latest` or loading flags. TS: `Resource<Quote>`.
- **A component that reads `state.items` declares `items` in its own `.resources`** (even if another page does): otherwise it is undefined on a direct visit, or what another page loaded; a test that starts on that page hides this. A `queryCache()` serves the repeat at once.
- **A refetch of the same request keeps `data` with `refreshing: true`**: when the old value must not show (Refresh shows "Loading…"), treat `refreshing` as loading. `keepPrevious: true` on the request also keeps it across a request change (pagination). `ok`/`error` on the request also dispatch after the write.
- After a write, `invalidates: ['quotes']` refetches reads tagged `tags: ['quotes']` or under a `'/api/quotes'` prefix; `{ invalidate: 'quotes' }` on the sink does it now.
- Cache, `retry`, `validate`, `refetchEvery`, `{ prefetch }`, SSR: `node_modules/sygnal/dist/guide/resources.md` (or https://sygnal.js.org/guide/resources/)
## List/detail + save, cached
```jsx
// main.js: makeFetchDriver({ cache: queryCache() }); tests: renderComponent(App, { http: { cache: queryCache() } })
const label = (r) => r?.status === 'loading' ? 'Loading…' : r?.refreshing ? 'Updating…' : ''
App.resources = {  // only while shown; shown again: cached at once, refetched once stale
  items: (s) => s.view === 'list' && { url: '/api/items', staleTime: 2000 },
  item:  (s) => s.view === 'detail' && { url: `/api/items/${s.id}`, staleTime: 2000 },
}
App.model = { SAVE: { HTTP: (s) => ({ url: `/api/items/${s.id}`, method: 'PUT', json: { title: s.draft }, ok: 'SAVED', error: 'SAVE_FAILED',
  updates: 'item',  // state.item.data = the reply, now (setQueryData)
  invalidates: '/api/items' }) } }  // then both refetch (refreshing)
```
- `updates` and invalidation abort older reads in flight, so a reply sent before the save never lands. `updates: { items: (list, saved) => newList }` derives it.
