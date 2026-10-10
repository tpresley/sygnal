import { ABORT, Collection } from 'sygnal'
import { z } from 'zod'
import Card from './Card.jsx'
import { COLUMNS, COLUMN_IDS } from './columns.js'

function App({ state, uid }) {
  return (
    <main className="board-page">
      <header>
        <h1>Team board</h1>
        <p className="card-count">{`${state.cards.length} cards`}</p>
      </header>
      <form className="add-card">
        <label for={uid('title')}>Title</label>
        <input id={uid('title')} name="title" value={state.title} />
        <label for={uid('column')}>Column</label>
        <select id={uid('column')} name="column" value={state.column}>
          {COLUMNS.map((c) => <option value={c.id}>{c.label}</option>)}
        </select>
        <button type="submit">Add card</button>
      </form>
      <div className="board">
        {COLUMNS.map((c) => (
          <section className="column" data-column={c.id}>
            <h2>{c.label}</h2>
            <ul className="cards">
              <Collection of={Card} from="cards" filter={(card) => card.column === c.id} />
            </ul>
          </section>
        ))}
      </div>
    </main>
  )
}

App.initialState = {
  cards: [
    { id: 1, title: 'Fix login bug', column: 'todo' },
    { id: 2, title: 'Plan the sprint', column: 'doing' },
    { id: 3, title: 'Old idea', column: 'todo' },
    { id: 4, title: 'Ship v2', column: 'done' },
    { id: 5, title: 'Design review', column: 'todo' },
  ],
  nextId: 6,
  title: '',
  column: 'todo',
}

App.intent = ({ DOM }) => ({
  TITLE: DOM.input('[name="title"]').value(),
  COLUMN: DOM.change('[name="column"]').value(),
  ADD: DOM.select('.add-card').events('submit', { preventDefault: true }),
})

App.model = {
  TITLE: (state, title) => ({ ...state, title }),
  COLUMN: (state, column) => ({ ...state, column }),
  ADD: (state) => {
    const title = state.title.trim()
    if (!title) return ABORT
    return {
      ...state,
      cards: [...state.cards, { id: state.nextId, title, column: state.column }],
      nextId: state.nextId + 1,
      title: '',
    }
  },
  ADD_CARD: (state, { title, column }) => ({
    ...state,
    cards: [...state.cards, { id: state.nextId, title, column }],
    nextId: state.nextId + 1,
  }),
}

App.agent = {
  name: 'board',
  description: 'The team board: cards in the columns todo (To do), doing (Doing) and done (Done)',
  read: (state) => ({ cards: state.cards.map(({ id, title, column }) => ({ id, title, column })) }),
  untrusted: true,
  actions: {
    ADD_CARD: {
      description: 'Add a card to a column of the board',
      input: z.object({
        title: z.string().trim().min(1).describe('The card title'),
        column: z.enum(COLUMN_IDS).describe('The column: todo, doing or done'),
      }),
    },
  },
}

export default App
