import { run, Collection, Transition, createRef } from 'sygnal'

function Item({ state }) {
  return (
    <li className="grocery">
      <span>{state.name}</span>
      <button type="button" className="remove" aria-label={`Remove ${state.name}`}>✕</button>
    </li>
  )
}
Item.intent = ({ DOM }) => ({ REMOVE: DOM.click('.remove') })
// returning undefined from an item's STATE removes it from the parent's array
Item.model = { REMOVE: () => undefined }

const list = createRef()
const NAMES = ['Apples', 'Bread', 'Cheese', 'Dates', 'Eggs', 'Figs', 'Grapes']

export function Groceries({ state }) {
  return (
    <div>
      <div className="row">
        <button className="add">Add an item</button>
        <button className="inspect">Inspect the &lt;ul&gt;</button>
      </div>
      {/* no wrapper element: the items are the <ul>'s own children, next to its other <li>s */}
      <ul className="groceries" ref={list}>
        <li className="list-head">Shopping list</li>
        <Transition name="pop">
          <Collection of={Item} from="items" />
        </Transition>
        <li className="list-foot">{state.items.length} items</li>
      </ul>
      <output>{state.children ? `ul children: ${state.children}` : 'Click "Inspect" to list the <ul>\'s direct children'}</output>
    </div>
  )
}

Groceries.initialState = { items: [{ id: 1, name: 'Apples' }, { id: 2, name: 'Bread' }], next: 3, children: '' }

Groceries.intent = ({ DOM }) => ({ ADD: DOM.click('.add'), INSPECT: DOM.click('.inspect') })

Groceries.model = {
  ADD: (state) => ({ ...state, next: state.next + 1, items: [...state.items, { id: state.next, name: NAMES[(state.next - 1) % NAMES.length] }] }),
  INSPECT: {
    EFFECT: (state, data, next) => next('CHILDREN', [...list.current.children].map((el) => `${el.tagName.toLowerCase()}.${el.className.split(' ')[0]}`).join(' · ')),
  },
  CHILDREN: (state, children) => ({ ...state, children }),
}

export const start = (mountPoint, uid) => run(Groceries, {}, { mountPoint, uid })
