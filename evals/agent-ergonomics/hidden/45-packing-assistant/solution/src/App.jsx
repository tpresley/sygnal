import { ABORT, Collection } from 'sygnal'
import { chat, messageText } from 'sygnal/ai'
import { z } from 'zod'
import Item from './Item.jsx'

function App({ state, uid }) {
  const packed = state.items.filter((item) => item.packed).length
  return (
    <main className="packing">
      <header>
        <h1>Packing list</h1>
        <p className="summary">{`${packed} of ${state.items.length} packed`}</p>
      </header>
      <form className="add-item">
        <label for={uid('name')}>Item</label>
        <input id={uid('name')} name="name" value={state.name} />
        <label for={uid('quantity')}>Quantity</label>
        <input id={uid('quantity')} name="quantity" type="number" min="1" max="99" value={state.quantity} />
        <button type="submit">Add</button>
      </form>
      <ul className="items">
        <Collection of={Item} from="items" />
      </ul>
      {assistantPanel(state.assistant, uid)}
    </main>
  )
}

// The assistant's markup is part of App's view: the chat behavior's selectors are App's own.
function assistantPanel(a, uid) {
  const shown = a.messages.filter((m) => messageText(m) !== '')
  return (
    <section className="assistant">
      <h2>Assistant</h2>
      <ol className="assistant-messages" aria-live="polite">
        {shown.map((m, i) => <li key={i} className={m.role}>{messageText(m)}</li>)}
        {a.draft && <li className="assistant">{a.draft}</li>}
      </ol>
      {a.pending && (
        <div role="alertdialog" aria-labelledby={uid('confirm')}>
          <p id={uid('confirm')}>{`The assistant wants to remove ${a.pending.label}.`}</p>
          <button type="button" className="approve">Allow</button>
          <button type="button" className="deny">Deny</button>
        </div>
      )}
      <form className="ask">
        <label for={uid('ask')}>Ask the assistant</label>
        <input id={uid('ask')} className="prompt" value={a.prompt} />
        <button type="submit">Send</button>
      </form>
    </section>
  )
}

App.initialState = {
  items: [
    { id: 1, name: 'Tent', quantity: 1, packed: false },
    { id: 2, name: 'Socks', quantity: 4, packed: true },
    { id: 3, name: 'Headlamp', quantity: 1, packed: false },
  ],
  nextId: 4,
  name: '',
  quantity: '1',
}

App.uses = {
  assistant: chat({
    form: '.ask',
    prompt: '.prompt',
    approve: '.approve',
    deny: '.deny',
    instructions: 'You help the user with their packing list. Use the tools to change it; keep replies short.',
  }),
}

App.intent = ({ DOM }) => ({
  NAME: DOM.input('[name="name"]').value(),
  QUANTITY: DOM.input('[name="quantity"]').value(),
  ADD: DOM.select('.add-item').events('submit', { preventDefault: true }),
})

const validQuantity = (q) => Number.isInteger(Number(q)) && Number(q) >= 1 && Number(q) <= 99
const addItem = (state, name, quantity) => ({
  ...state,
  items: [...state.items, { id: state.nextId, name, quantity, packed: false }],
  nextId: state.nextId + 1,
})

App.model = {
  NAME: (state, name) => ({ ...state, name }),
  QUANTITY: (state, quantity) => ({ ...state, quantity }),
  ADD: (state) => {
    const name = state.name.trim()
    if (!name || !validQuantity(state.quantity)) return ABORT
    return { ...addItem(state, name, Number(state.quantity)), name: '', quantity: '1' }
  },
  ADD_ITEM: (state, { name, quantity }) => addItem(state, name, quantity),
}

App.agent = {
  name: 'packing',
  description: 'The packing list',
  read: (state) => ({ items: state.items.map(({ id, name, quantity, packed }) => ({ id, name, quantity, packed })) }),
  actions: {
    ADD_ITEM: {
      description: 'Add an item to the list (not packed yet)',
      input: z.object({
        name: z.string().trim().min(1).describe('What to pack'),
        quantity: z.number().int().min(1).max(99).describe('How many, 1 to 99'),
      }),
    },
  },
}

export default App
