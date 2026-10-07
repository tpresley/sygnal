import { run, Collection } from 'sygnal'

// A Collection item that returns a fragment: a <dt>/<dd> pair inside the parent's <dl>.
// The fragment is keyed by the item, so the pair moves as one when the list is reordered.
function Term({ state }) {
  return (
    <>
      <dt>{state.term}</dt>
      <dd>
        {state.meaning}
        <input className="note" aria-label={`Note on ${state.term}`} placeholder="type a note, then reorder" />
        {state.starred && <strong className="ok"> ★ starred</strong>}
      </dd>
    </>
  )
}
Term.intent = ({ DOM }) => ({ STAR: DOM.dblclick('dt') })
Term.model = { STAR: (state) => ({ ...state, starred: !state.starred }) }

export function Glossary({ state }) {
  return (
    <div>
      <div className="row">
        <button className="reverse">Reverse</button>
        <button className="sort">Sort A–Z</button>
        <span className="muted">Double-click a term to star it (the item's own intent)</span>
      </div>
      <dl className="glossary"><Collection of={Term} from="terms" /></dl>
    </div>
  )
}

Glossary.initialState = {
  terms: [
    { id: 'v', term: 'View', meaning: 'A function of state that returns JSX.', starred: false },
    { id: 'i', term: 'Intent', meaning: 'Turns DOM events into actions.', starred: false },
    { id: 'm', term: 'Model', meaning: 'Reducers per action.', starred: false },
  ],
}
Glossary.intent = ({ DOM }) => ({ REVERSE: DOM.click('.reverse'), SORT: DOM.click('.sort') })
Glossary.model = {
  REVERSE: (state) => ({ ...state, terms: [...state.terms].reverse() }),
  SORT: (state) => ({ ...state, terms: [...state.terms].sort((a, b) => a.term.localeCompare(b.term)) }),
}

export const start = (mountPoint, uid) => run(Glossary, {}, { mountPoint, uid })
