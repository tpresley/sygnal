// PLAN-3 3-A (experimental): the `resources` static and the Resource state slot. Entries derive
// a ResourceRequest (a URL or a request) or falsy from STATE & CALCULATED; `{ refresh }` is an
// HTTP sink value; Resource<T> narrows on status.
import { ABORT } from 'sygnal'
import type { Component, RootComponent, FetchRequest, Resource, ResourceRequest } from 'sygnal'

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
