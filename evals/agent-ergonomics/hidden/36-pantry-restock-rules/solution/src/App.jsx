import { ABORT, set, xs } from 'sygnal'

// A pantry stock list: quantities, a minimum per item ("low" at or below it), an add bar
// (button or Enter), Remove with Undo, All / Low stock tabs and a sort order.

const SORTS = {
  name: (a, b) => a.name.localeCompare(b.name),
  urgency: (a, b) => a.qty - a.min - (b.qty - b.min) || a.name.localeCompare(b.name),
}

export const isLow = (item) => item.qty <= item.min

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase()

// A row of the list (a plain helper called by the view, so its buttons are App's own markup).
function itemRow(item) {
  return (
    <li key={item.id} className={isLow(item) ? 'item low' : 'item'} data={{ id: item.id }}>
      <span className="name">{item.name}</span>
      <span className="qty">{item.qty}</span>
      <span className="min">min {item.min}</span>
      <button className="dec" aria-label={`Use one ${item.name}`} disabled={item.qty === 0}>
        −
      </button>
      <button className="inc" aria-label={`Add one ${item.name}`}>
        +
      </button>
      <button className="remove">Remove</button>
    </li>
  )
}

function App({ state }) {
  return (
    <div className="pantry">
      <h1>Pantry</h1>
      <p className="summary">{`${plural(state.items.length, 'item')} · ${state.lowCount} low`}</p>

      <div className="add-bar">
        <input className="new-item" name="new-item" aria-label="New item" value={state.draft} />
        <button className="add">Add</button>
      </div>
      {state.lastRemoved ? (
        <p className="notice">
          {`Removed ${state.lastRemoved.item.name}.`} <button className="undo">Undo</button>
        </p>
      ) : null}

      <div className="toolbar">
        <div className="list-tabs">
          <button className={state.listMode === 'all' ? 'tab-all active' : 'tab-all'}>All</button>
          <button className={state.listMode === 'low' ? 'tab-low active' : 'tab-low'}>Low stock</button>
        </div>
        <label>
          Sort by{' '}
          <select className="sort" name="sort" value={state.sortBy}>
            <option value="name">Name</option>
            <option value="urgency">Most urgent</option>
          </select>
        </label>
      </div>

      {state.visible.length > 0 ? (
        <ul className="items">{state.visible.map(itemRow)}</ul>
      ) : (
        <p className="empty">Nothing here.</p>
      )}
    </div>
  )
}

App.initialState = {
  items: [
    { id: 1, name: 'Rice', qty: 4, min: 2 },
    { id: 2, name: 'Olive oil', qty: 1, min: 1 },
    { id: 3, name: 'Pasta', qty: 0, min: 2 },
    { id: 4, name: 'Canned tomatoes', qty: 6, min: 3 },
    { id: 5, name: 'Coffee', qty: 1, min: 2 },
    { id: 6, name: 'Black beans', qty: 3, min: 3 },
  ],
  nextId: 7,
  draft: '',
  listMode: 'all',
  sortBy: 'name',
  lastRemoved: null,
}

App.calculated = {
  lowCount: (state) => state.items.filter(isLow).length,
  visible: (state) =>
    state.items.filter((item) => state.listMode === 'all' || isLow(item)).sort(SORTS[state.sortBy]),
}

App.intent = ({ DOM }) => ({
  DRAFT: DOM.input('.new-item').value(),
  ADD: xs.merge(DOM.click('.add'), DOM.keydown('.new-item').key().filter((key) => key === 'Enter')),
  USE_ONE: DOM.click('.dec').data('id', Number),
  ADD_ONE: DOM.click('.inc').data('id', Number),
  REMOVE: DOM.click('.remove').data('id', Number),
  UNDO: DOM.click('.undo'),
  SHOW_ALL: DOM.click('.tab-all'),
  SHOW_LOW: DOM.click('.tab-low'),
  SORT: DOM.change('.sort').value(),
})

const changeQty = (state, id, delta) => ({
  ...state,
  items: state.items.map((item) => (item.id === id ? { ...item, qty: Math.max(0, item.qty + delta) } : item)),
})

App.model = {
  DRAFT: set((state, draft) => ({ draft })),
  ADD: (state) => {
    const name = state.draft.trim()
    if (!name) return ABORT
    const existing = state.items.find((item) => sameName(item.name, name))
    if (existing) return { ...changeQty(state, existing.id, 1), draft: '' }
    return {
      ...state,
      items: [...state.items, { id: state.nextId, name, qty: 1, min: 1 }],
      nextId: state.nextId + 1,
      draft: '',
    }
  },
  USE_ONE: (state, id) => changeQty(state, id, -1),
  ADD_ONE: (state, id) => changeQty(state, id, 1),
  REMOVE: (state, id) => {
    const index = state.items.findIndex((item) => item.id === id)
    if (index < 0) return ABORT
    return {
      ...state,
      items: state.items.filter((item) => item.id !== id),
      lastRemoved: { item: state.items[index], index },
    }
  },
  UNDO: (state) => {
    if (!state.lastRemoved) return ABORT
    const { item, index } = state.lastRemoved
    const items = [...state.items]
    items.splice(Math.min(index, items.length), 0, item)
    return { ...state, items, lastRemoved: null }
  },
  SHOW_ALL: set({ listMode: 'all' }),
  SHOW_LOW: set({ listMode: 'low' }),
  SORT: set((state, sortBy) => ({ sortBy })),
}

export default App
