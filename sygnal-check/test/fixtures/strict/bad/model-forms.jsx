// SYG504 (shorthand keys), SYG505 (emit() / raw EVENTS), SYG506 (CHILD.select('Name')).
import { emit, Collection, createCommand } from 'sygnal'
import TodoItem from './parts/TodoItem.jsx'

const cmd = createCommand()

function Lane({ state }) {
  return (
    <div className="lane">
      <button className="delete">x</button>
      <button className="play">play</button>
      <button className="ping">ping</button>
      <button className="mark">mark</button>
      <button className="move">move</button>
      <Collection of={TodoItem} from="items" />
    </div>
  )
}

Lane.initialState = { id: 1, items: [] }

Lane.intent = ({ DOM, CHILD }) => ({
  DELETE: DOM.click('.delete'),
  PLAY: DOM.click('.play'),
  PING: DOM.click('.ping'),
  MARK: DOM.click('.mark'),
  MOVE: DOM.click('.move'),
  DONE: CHILD.select('TodoItem'), // expect: SYG506
  OTHER: CHILD.select('Unknown'), // expect: SYG506
})

Lane.model = {
  DELETE: emit('DELETE_LANE', (state) => ({ laneId: state.id })), // expect: SYG505
  'PLAY | EFFECT': () => cmd.send('play'), // expect: SYG504
  'PING | EVENTS': (state) => ({ type: 'PING', data: state.id }), // expect: SYG504, SYG505
  MARK: {
    STATE: (state) => ({ ...state, marked: true }),
    ...emit('MARKED', (state) => state.id), // expect: SYG505
  },
  MOVE: {
    EVENTS: (state) => ({ type: 'MOVE_LANE', data: { laneId: state.id } }), // expect: SYG505
  },
  DONE: (state, id) => ({ ...state, items: state.items.filter(i => i.id !== id) }),
  OTHER: (state) => ({ ...state }),
}

function Board() {
  return <div className="board"><Lane /></div>
}

Board.intent = ({ EVENTS }) => ({
  DELETE_LANE: EVENTS.select('DELETE_LANE'),
  PING: EVENTS.select('PING'),
  MARKED: EVENTS.select('MARKED'),
  MOVE_LANE: EVENTS.select('MOVE_LANE'),
})

Board.model = {
  DELETE_LANE: (state) => ({ ...state }),
  PING: (state) => ({ ...state }),
  MARKED: (state) => ({ ...state }),
  MOVE_LANE: (state) => ({ ...state }),
}

export default Board
