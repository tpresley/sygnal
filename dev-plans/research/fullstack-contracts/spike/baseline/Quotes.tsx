// Baseline: the same component with today's makeFetchDriver / makeSocketDriver.
import type { Component, Resource, FetchFailure } from 'sygnal'
import type { Quote } from './types.ts'

type State = { tag: string; draft: string; error: string; quotes: Resource<Quote[]>; live: Quote[] }
type Actions = { TYPE: string; ADD: null; ADDED: Quote; FAILED: FetchFailure; ARRIVED: Quote }

export const Quotes: Component<State, {}, {}, Actions> = ({ state }) => (
  <div className="quotes">
    <input className="draft" value={state.draft} aria-label="New quote" />
    <button className="add">Add</button>
    <p className="error">{state.error}</p>
    <ul className="list">{state.quotes.status === 'success' && state.quotes.data.map((q) => <li>{q.text}</li>)}</ul>
    <ul className="live">{state.live.map((q) => <li>{q.text}</li>)}</ul>
  </div>
)
Quotes.initialState = { tag: 'calm', draft: '', error: '', quotes: { status: 'idle' }, live: [] }

Quotes.resources = {
  quotes: (state) => ({ url: '/api/quotes', query: { tag: state.tag }, tags: ['quotes'] }),
}
Quotes.connections = (state) => ({
  feed: { sse: `/api/quotes/feed?tag=${encodeURIComponent(state.tag)}`, headers: { 'x-requested-with': 'fetch' }, message: 'ARRIVED' },
})

Quotes.intent = ({ DOM }) => ({
  TYPE: DOM.input('.draft').value(),
  ADD: DOM.click('.add'),
})

Quotes.model = {
  TYPE: (state, draft) => ({ ...state, draft }),
  ADD: {
    STATE: (state) => ({ ...state, error: '' }),
    HTTP: (state) => ({
      url: '/api/quotes', method: 'POST', json: { text: state.draft, tag: state.tag },
      headers: { 'x-requested-with': 'fetch' }, ok: 'ADDED', error: 'FAILED', invalidates: ['quotes'],
    }),
  },
  ADDED: (state, quote) => ({ ...state, draft: '', error: `Added #${quote.id}` }),
  FAILED: (state, { status, body }) => ({
    ...state,
    error: status === 400 ? body?.issues?.[0]?.message ?? 'Invalid' : body?.message ?? 'Could not add the quote',
  }),
  ARRIVED: (state, quote) => ({ ...state, live: [...state.live, quote].slice(-5) }),
}
