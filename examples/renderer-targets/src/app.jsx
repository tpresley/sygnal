// The app: one component tree for every target. Intents select controls (identities, not CSS
// structure), so the same intent works whatever a target's layout; the views are plain HTML,
// which the web, the terminal and the agent UI all render.
import { Collection, controls, processForm, set, toggle, ABORT } from 'sygnal'

export const { AddForm, Name, Category, Show, ClearDone } = controls({
  AddForm: 'form',
  Name: 'input',
  Category: 'select',
  Show: 'select',
  ClearDone: 'button',
})
export const { Done, Remove } = controls({ Done: 'input', Remove: 'button' })

export const CATEGORIES = ['produce', 'dairy', 'bakery', 'other']
const SHOW = { all: () => true, open: (item) => !item.done, done: (item) => item.done }

export function Item({ state }) {
  return (
    <li className={state.done ? 'item done' : 'item'}>
      <label>
        <Done type="checkbox" checked={state.done} />
        {state.name}
      </label>
      <span className="category">{state.category}</span>
      <Remove aria-label={`Remove ${state.name}`}>×</Remove>
    </li>
  )
}

Item.intent = ({ DOM }) => ({
  TOGGLE: DOM.change(Done),
  REMOVE: DOM.click(Remove),
})

Item.model = {
  TOGGLE: toggle('done'),
  REMOVE: () => undefined,
}

export default function Groceries({ state }) {
  return (
    <main className="groceries">
      <h1>Groceries</h1>
      <AddForm>
        <label>
          Item <Name name="name" value={state.draft} placeholder="Milk, bread, …" autocomplete="off" />
        </label>
        <label>
          Aisle{' '}
          <Category name="category" value={state.category}>
            {CATEGORIES.map((c) => <option value={c}>{c}</option>)}
          </Category>
        </label>
        <button type="submit">Add</button>
      </AddForm>
      <ul className="items">
        <Collection of={Item} from="items" filter={SHOW[state.show]} />
      </ul>
      <footer>
        <span className="count">{state.open} to buy</span>
        <label>
          Show{' '}
          <Show value={state.show}>
            <option value="all">all</option>
            <option value="open">to buy</option>
            <option value="done">in the cart</option>
          </Show>
        </label>
        {state.inCart > 0 && <ClearDone>Clear the cart</ClearDone>}
      </footer>
    </main>
  )
}

Groceries.initialState = {
  draft: '',
  category: 'produce',
  show: 'all',
  items: [
    { id: 1, name: 'Apples', category: 'produce', done: false },
    { id: 2, name: 'Milk', category: 'dairy', done: true },
  ],
}

Groceries.calculated = {
  open: (state) => state.items.filter((item) => !item.done).length,
  inCart: (state) => state.items.filter((item) => item.done).length,
}

Groceries.intent = ({ DOM }) => ({
  DRAFT: DOM.input(Name).value(),
  CATEGORY: DOM.change(Category).value(),
  ADD: processForm(DOM.select(AddForm), { events: 'submit' }),
  SHOW: DOM.change(Show).value(),
  CLEAR_DONE: DOM.click(ClearDone),
})

Groceries.model = {
  DRAFT: set((_state, draft) => ({ draft })),
  CATEGORY: set((_state, category) => ({ category })),
  SHOW: set((_state, show) => ({ show })),
  ADD: (state, values) => {
    const name = values.name.trim()
    if (!name) return ABORT
    const id = state.items.reduce((max, item) => Math.max(max, item.id), 0) + 1
    return { ...state, draft: '', items: [...state.items, { id, name, category: values.category, done: false }] }
  },
  CLEAR_DONE: set((state) => ({ items: state.items.filter((item) => !item.done) })),
}
