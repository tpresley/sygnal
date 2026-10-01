import { ABORT, Collection } from 'sygnal'
import List from './List.jsx'

function App({ state }) {
  return (
    <div className="board">
      <header className="board-header">
        <h1>Project board</h1>
        <p className="total">Cards: {state.totalCards}</p>
      </header>
      <Collection of={List} from="lists" className="lists" />
    </div>
  )
}

App.initialState = {
  lists: [
    {
      id: 'todo',
      title: 'To do',
      cards: [
        { id: 1, title: 'Write spec', done: false },
        { id: 2, title: 'Design schema', done: false },
        { id: 3, title: 'Set up CI', done: true },
      ],
    },
    {
      id: 'doing',
      title: 'Doing',
      cards: [{ id: 4, title: 'Build API', done: false }],
    },
    {
      id: 'done',
      title: 'Done',
      cards: [{ id: 5, title: 'Kickoff meeting', done: true }],
    },
  ],
}

App.calculated = {
  totalCards: (state) => state.lists.reduce((sum, list) => sum + list.cards.length, 0),
}

App.intent = ({ CHILD }) => ({
  MOVE_CARD: CHILD.select(List).filter((msg) => msg.type === 'MOVE'),
})

App.model = {
  MOVE_CARD: (state, { listId, cardId, offset }) => {
    const from = state.lists.findIndex((list) => list.id === listId)
    const to = from + offset
    if (from < 0 || to < 0 || to >= state.lists.length) return ABORT
    const card = state.lists[from].cards.find((c) => c.id === cardId)
    if (!card) return ABORT
    const lists = state.lists.map((list, i) => {
      if (i === from) return { ...list, cards: list.cards.filter((c) => c.id !== cardId) }
      if (i === to) return { ...list, cards: [...list.cards, card] }
      return list
    })
    return { ...state, lists }
  },
}

export default App
