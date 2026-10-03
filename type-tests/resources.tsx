// PLAN-3 3-A (experimental): the `resources` static and the Resource state slot. Entries derive
// a ResourceRequest (a URL or a request) or falsy from STATE & CALCULATED; `{ refresh }` is an
// HTTP sink value; Resource<T> narrows on status.
import { ABORT, makeFetchDriver, renderComponent, queryCache, renderToString } from 'sygnal'
import type { Component, RootComponent, FetchRequest, Resource, ResourceRequest, FetchCacheOptions, FakeCacheEntry, StandardSchemaLike, QueryCache, QueryCacheSnapshot } from 'sygnal'

type Quote = { id: number; text: string; author: string }
type QuoteState = { selected: number | null; quote: Resource<Quote> }
type QuoteActions = { SELECT: number; REFRESH: null }

export const App: RootComponent<QuoteState, { HTTP: FetchRequest }, QuoteActions> = ({ state }) => {
  const q = state.quote
  // narrowing on status
  const text: string = q.status === 'success' ? q.data.text : ''
  const status: number | undefined = q.status === 'error' ? q.error.status : undefined
  // @ts-expect-error data may be undefined unless status is 'success'
  const unsafe: string = q.data.text
  return <p>{text}{status}{unsafe}</p>
}
App.initialState = { selected: null, quote: { status: 'idle' } }
App.resources = {
  quote: (state) => state.selected !== null && `/api/quotes/${state.selected}`,
}
App.resources = {
  quote: (state) => state.selected && { url: '/api/quotes', query: { id: state.selected }, ok: 'SELECT' },
}
App.model = {
  SELECT: (state, selected) => selected === state.selected ? ABORT : { ...state, selected },
  REFRESH: { HTTP: { refresh: 'quote' } },
}
App.model = { REFRESH: { HTTP: () => ({ refresh: ['quote'] }) } }

const req: ResourceRequest[] = ['/a', { url: '/b', latest: true }]
export { req }

// @ts-expect-error the state parameter is typed: no such key
App.resources = { quote: (state) => state.missing && '/x' }
// @ts-expect-error an abort is not a resource request
App.resources = { quote: () => ({ abort: true }) }
// @ts-expect-error a resource entry is a function of state
App.resources = { quote: '/api/quotes/1' }

// a sub-component: entries see props-free STATE & CALCULATED
type ItemState = { id: string; quote?: Resource }
export const Item: Component<ItemState, {}, {}, {}, { short: string }> = () => <li />
Item.calculated = { short: (s) => s.id.slice(0, 2) }
Item.resources = { quote: (s) => `/api/q/${s.short}` }
// D85: stays live while the component is in a hidden Switchable page
Item.resources = { quote: (s) => ({ url: `/api/q/${s.short}`, background: true }) }

const r: Resource<number> = { status: 'success', data: 1 }
// @ts-expect-error success needs data of the declared type
const bad: Resource<number> = { status: 'success', data: 'x' }
export { r, bad }

// PLAN-3 5-2b/5-3: D78 refreshing, keepPrevious, refetchEvery, tags, validate; the cache options
const QuoteSchema: StandardSchemaLike = { '~standard': { validate: (v: unknown) => ({ value: v }) } }
Item.resources = { quote: (s) => ({ url: `/api/q/${s.short}`, keepPrevious: true, refetchEvery: 5000, tags: ['quotes'], validate: QuoteSchema, retry: 2 }) }
const refreshing: Resource<number> = { status: 'success', data: 1, refreshing: true }
const failedRefetch: Resource<number> = { status: 'error', data: 1, error: new Error('x') }
export { refreshing, failedRefetch }
const cacheOptions: FetchCacheOptions = { staleTime: 30000, gcTime: Infinity, refetchOnFocus: false, refetchOnReconnect: true }
// D88: the cache is queryCache(); `cache: true` / an options object is an error
// @ts-expect-error cache takes queryCache()
makeFetchDriver({ cache: true })
// @ts-expect-error cache takes queryCache()
makeFetchDriver({ cache: cacheOptions })
const qc: QueryCache = queryCache(cacheOptions)
const driver = makeFetchDriver({ cache: qc, retry: { count: 2, delayMs: 200, jitter: false } })
const same: QueryCache | undefined = driver.cache
// 5-5 (H-7): SSR seeding and prefetch
qc.set('/api/quotes/1', { text: 'x' })
qc.set({ url: '/api/search', query: { q: 'x' } }, [])
const snap: QueryCacheSnapshot = qc.dehydrate()
const seeded = queryCache({ staleTime: 30000, initial: snap })
seeded.hydrate(JSON.parse(JSON.stringify(snap)))
seeded.prefetch('/api/quotes/2')
const html: string = renderToString(App, { cache: seeded })
export { same, html }
const writes: FetchRequest[] = [
  { invalidate: 'quotes' },
  { invalidate: ['quotes', '/api/users'] },
  { invalidate: (req) => req.url.startsWith('/api') },
  { url: '/api/quotes/1', method: 'PUT', json: {}, ok: 'SAVED', invalidates: ['quotes'] },
  // 6-A (G-184): the reply written into resources
  { url: '/api/quotes/1', method: 'PUT', json: {}, ok: 'SAVED', updates: 'quote', invalidates: '/api/quotes' },
  { url: '/api/quotes/1', method: 'PUT', json: {}, updates: ['quote', 'other'] },
  { url: '/api/quotes/1', method: 'PUT', json: {}, updates: { quote: true, quotes: (list: any[], q: any) => list.map((x) => (x.id === q.id ? q : x)) } },
  { url: '/api/user', ok: 'GOT', cache: true, staleTime: 60000, retry: 1 },
  { prefetch: '/api/quotes/2' },
  { prefetch: { url: '/api/search', query: { q: 'x' } } },
]
export { writes }
// @ts-expect-error retry is a count or a policy
makeFetchDriver({ retry: 'twice' })
const tc = renderComponent(App, { http: { cache: queryCache({ staleTime: 1000 }) } })
const entries: FakeCacheEntry[] = tc.cache('HTTP')
tc.focus()
tc.online()
export { entries }
