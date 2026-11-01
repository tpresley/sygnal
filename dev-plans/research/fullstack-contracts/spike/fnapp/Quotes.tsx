// The client: a list (a resource), an add form (a mutation) and a live feed (a stream).
// Function-first variant: the imports are the server functions themselves (stubbed by the plugin).
import type { Component, Resource } from 'sygnal'
import { listQuotes, addQuote, quoteFeed, type Quote } from './quotes.server.ts'
import { reply, failure } from '../lib/contract.ts'

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
  quotes: (state) => listQuotes({ tag: state.tag }),
}
Quotes.connections = (state) => ({
  feed: quoteFeed({ tag: state.tag }, { message: 'ARRIVED' }),
})

Quotes.intent = ({ DOM }) => ({
  TYPE: DOM.input('.draft').value(),
  ADD: DOM.click('.add'),
})

Quotes.model = {
  TYPE: (state, draft) => ({ ...state, draft }),
  ADD: {
    STATE: (state) => ({ ...state, error: '' }),
    HTTP: (state) => addQuote({ text: state.draft, tag: state.tag }, { ok: 'ADDED', error: 'FAILED', invalidates: [listQuotes] }),
  },
  ADDED: reply(addQuote, (state, quote) => ({ ...state, draft: '', error: `Added #${quote.id}` })),
  FAILED: failure((state, { status, body }) => ({
    ...state,
    error: status === 400 ? body?.issues?.[0]?.message ?? 'Invalid' : body?.message ?? 'Could not add the quote',
  })),
  ARRIVED: reply(quoteFeed, (state, quote) => ({ ...state, live: [...state.live, quote].slice(-5) })),
}
