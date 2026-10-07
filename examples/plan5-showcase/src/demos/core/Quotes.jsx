import { run, Collection, makeFetchDriver } from 'sygnal'
import { fakeFetch } from '../../shared/fakeServer.js'

// Each card declares its own resource: Sygnal keeps state.quote as
// { status, data, error, refreshing }; removing the card aborts its request.
function QuoteCard({ state }) {
  // (a new card's array entry has no quote yet)
  const { status, data, refreshing } = state.quote || { status: 'idle' }
  return (
    <li className="quote-card">
      {status === 'success'
        ? <blockquote>“{data.text}” <cite>{data.author}</cite></blockquote>
        : <p className="muted">{status === 'error' ? 'Could not load quote ' + state.qid : 'Loading quote ' + state.qid + '…'}</p>}
      <div className="row">
        <button className="next">Next quote</button>
        <button className="refresh" disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
        <button className="remove">Remove</button>
      </div>
    </li>
  )
}
QuoteCard.resources = { quote: (state) => `/api/quotes/${state.qid}` }
QuoteCard.intent = ({ DOM }) => ({ NEXT: DOM.click('.next'), REFRESH: DOM.click('.refresh'), REMOVE: DOM.click('.remove') })
QuoteCard.model = {
  // a changed request is fetched with latest semantics: a stale reply is never shown
  NEXT: (state) => ({ ...state, qid: (state.qid % 4) + 1 }),
  REFRESH: { HTTP: { refresh: 'quote' } },
  REMOVE: () => undefined,
}

export function Quotes({ state }) {
  return (
    <div>
      <div className="row"><button className="add">Add a card</button><span className="muted">Quote 4 doesn't exist (404)</span></div>
      <ul className="quotes"><Collection of={QuoteCard} from="cards" /></ul>
    </div>
  )
}

Quotes.initialState = { cards: [{ id: 1, qid: 1 }], next: 2 }
Quotes.intent = ({ DOM }) => ({ ADD: DOM.click('.add') })
Quotes.model = {
  ADD: (state) => ({ ...state, next: state.next + 1, cards: [...state.cards, { id: state.next, qid: ((state.next - 1) % 3) + 1 }] }),
}

export const start = (mountPoint, uid) => run(Quotes, { HTTP: makeFetchDriver({ fetch: fakeFetch }) }, { mountPoint, uid })
