import { Collection } from 'sygnal'
import type { Component } from 'sygnal'
import List from './List'
import type { AppState } from './types'

const ListCollection = Collection<{ className?: string }, AppState>

const App: Component<AppState> = () => (
  <div className="board">
    <header className="board-header">
      <h1>Project board</h1>
    </header>
    <ListCollection of={List} from="lists" className="lists" />
  </div>
)

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

export default App
