import { run, Collection, focusWithin } from 'sygnal'

function Row({ state }) {
  return (
    <li data-id={state.id} className="check-row">
      <input className="title" aria-label={`Item ${state.id}`} value={state.title} placeholder="What needs doing?" />
    </li>
  )
}
Row.intent = ({ DOM }) => ({ TITLE: DOM.input('.title').value() })
Row.model = { TITLE: (state, title) => ({ ...state, title }) }

export function Checklist({ state }) {
  return (
    <div>
      <div className="row"><button className="add">Add item</button></div>
      <ul className="sortable-list"><Collection of={Row} from="rows" /></ul>
    </div>
  )
}

Checklist.initialState = { rows: [{ id: 1, title: 'Milk' }], next: 2 }
Checklist.intent = ({ DOM }) => ({ ADD: DOM.click('.add') })
Checklist.model = {
  ADD: {
    STATE: (state) => ({ ...state, rows: [...state.rows, { id: state.next, title: '' }], next: state.next + 1 }),
    // a parent focuses an element inside a child (the new row renders in the same patch)
    ELEMENT: (state) => ({ focus: focusWithin(`[data-id="${state.next}"] .title`) }),
  },
}

export const start = (mountPoint, uid) => run(Checklist, {}, { mountPoint, uid })
