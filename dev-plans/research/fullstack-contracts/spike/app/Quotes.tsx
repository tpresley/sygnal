// The client: a list (a resource), an add form (a mutation) and a live feed (a stream).
// No URL, no route, no hand-written reply type: everything comes from ./api.ts.
import type { Component, Resource } from 'sygnal'
import { api, replies, type Quote } from './api.ts'

type State = { tag: string; draft: string; error: string; quotes: Resource<Quote[]>; live: Quote[] }

export const Quotes: Component<State> = ({ state }) => (
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
  quotes: (state) => api.listQuotes({ tag: state.tag }),
}
Quotes.connections = (state) => ({
  feed: api.quoteFeed({ tag: state.tag }, { message: 'ARRIVED' }),
})

Quotes.intent = ({ DOM }) => ({
  TYPE: DOM.input('.draft').value(),
  ADD: DOM.click('.add'),
})

Quotes.model = {
  TYPE: (state, draft) => ({ ...state, draft }),
  ADD: {
    STATE: (state) => ({ ...state, error: '' }),
    HTTP: (state) => api.addQuote({ text: state.draft, tag: state.tag }, { ok: 'ADDED', error: 'FAILED' }),
  },
  ADDED: replies.addQuote((state, quote) => ({ ...state, draft: '', error: `Added #${quote.id}` })),
  FAILED: replies.error((state, { status, body }) => ({
    ...state,
    error: status === 400 ? body?.issues?.[0]?.message ?? 'Invalid' : body?.message ?? 'Could not add the quote',
  })),
  ARRIVED: replies.quoteFeed((state, quote) => ({ ...state, live: [...state.live, quote].slice(-5) })),
}
