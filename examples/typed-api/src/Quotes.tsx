// A list (a resource), an add form (a mutation with a typed error), delete buttons, and a live
// feed (an event iterator). No URL, route or reply type is written here: they come from the contract
// (src/contract.ts) and, for Suggest, from a function-first module (src/ideas.server.ts).
import type { Component, Resource, FetchRequest, FetchSource, SocketSource, ActionsOf, IntentSources } from 'sygnal'
import { isContractSkew } from 'sygnal/api'
import type { Output, ApiFailure } from 'sygnal/api'
import { api } from './api'
import { suggest } from './ideas.server'

type Quote = Output<typeof api.quotes.add>

export type State = {
  tag: string
  draft: string
  message: string
  quotes: Resource<Output<typeof api.quotes.list>>
  live: Quote[]
}
type Drivers = { HTTP: { source: FetchSource; sink: FetchRequest }; WS: { source: SocketSource; sink: any } }

const intent = ({ DOM }: IntentSources<State, Drivers>) => ({
  TAG: DOM.select('.tag').events('change').map((e) => (e.target as HTMLSelectElement).value),
  TYPE: DOM.input('.draft').value(),
  ADD: DOM.select('.add-form').events('submit', { preventDefault: true }),
  REMOVE: DOM.click('.remove').data('id', Number),
  SUGGEST: DOM.click('.suggest'),
})
type Actions = ActionsOf<typeof intent> & {
  ADDED: Output<typeof api.quotes.add>
  FAILED: ApiFailure<typeof api.quotes.add>
  REMOVED: Output<typeof api.quotes.remove>
  ARRIVED: Output<typeof api.quotes.feed>
  SUGGESTED: Output<typeof suggest>
  NO_IDEA: ApiFailure<typeof suggest>
}

export const Quotes: Component<State, {}, Drivers, Actions> = ({ state }) => (
  <main className="quotes">
    <select className="tag" value={state.tag} aria-label="Tag">
      <option value="calm">calm</option>
      <option value="work">work</option>
    </select>
    <form className="add-form">
      <input className="draft" value={state.draft} aria-label="New quote" />
      <button type="submit">Add</button>
      <button type="button" className="suggest">Suggest</button>
    </form>
    <p className="message" role="status">{state.message}</p>
    {state.quotes.status === 'loading' && <p className="loading">Loading…</p>}
    <ul className="list">
      {state.quotes.status !== 'idle' && (state.quotes.data ?? []).map((q) => (
        <li>{q.text} <button className="remove" data={{ id: q.id }} aria-label={`Remove ${q.text}`}>×</button></li>
      ))}
    </ul>
    <h2>Just added</h2>
    <ul className="live">{state.live.map((q) => <li>{q.text} ({q.addedAt.slice(11, 19)})</li>)}</ul>
  </main>
)
Quotes.initialState = { tag: 'calm', draft: '', message: '', quotes: { status: 'idle' }, live: [] }
Quotes.intent = intent

Quotes.resources = {
  quotes: (state) => api.quotes.list({ tag: state.tag }),
}
Quotes.connections = (state) => ({
  feed: api.quotes.feed({ tag: state.tag }, { message: 'ARRIVED' }),
})

Quotes.model = {
  TAG: (state, tag) => ({ ...state, tag, live: [] }),
  TYPE: (state, draft) => ({ ...state, draft }),
  ADD: {
    STATE: (state) => ({ ...state, message: '' }),
    HTTP: (state) => api.quotes.add({ text: state.draft, tag: state.tag }, { ok: 'ADDED', error: 'FAILED', invalidates: [api.quotes.list] }),
  },
  ADDED: (state, quote) => ({ ...state, draft: '', message: `Added #${quote.id}` }),
  FAILED: (state, { status, body }) => ({
    ...state,
    message: isContractSkew({ status, body }) ? 'The app was updated: reload the page.'
      : body?.defined ? `${body.message} (#${body.data.id})`
      : status === 400 ? body?.data?.issues?.[0]?.message ?? 'Invalid quote'
      : 'Could not add the quote',
  }),
  REMOVE: { HTTP: (_state, id) => api.quotes.remove({ id }, { ok: 'REMOVED', invalidates: [api.quotes.list] }) },
  REMOVED: (state, { removed }) => ({ ...state, message: removed ? 'Removed' : 'Already gone' }),
  // a function-first call (src/ideas.server.ts): the same request data as the contract's
  SUGGEST: { HTTP: (state) => suggest({ tag: state.tag }, { ok: 'SUGGESTED', error: 'NO_IDEA' }) },
  SUGGESTED: (state, { text }) => ({ ...state, draft: text }),
  NO_IDEA: (state, { body }) => ({ ...state, message: body?.defined ? `${body.message}: ${body.data.tag}` : 'No suggestion' }),
  ARRIVED: (state, quote) => ({ ...state, live: [quote, ...state.live].slice(0, 5) }),
}
