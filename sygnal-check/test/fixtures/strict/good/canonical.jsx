// Canonical forms (dev-plans/PLAN-1-canonical-forms.md). Expect: no diagnostics, with --strict.
import { ABORT, Collection, event, set, createCommand } from 'sygnal'
import TaskCard from './parts/TaskCard.jsx'

const player = createCommand()

function Lane({ state, context }) {                                    // C1
  return (
    <div className="lane">
      <h2 className="lane-title">{state.title}</h2>
      <input className="lane-title-input" value={state.title} aria-label="field" />
      <button className="delete-lane-btn">×</button>
      <button className="play">play</button>
      <button className="clear">clear</button>
      <span className={context.theme}>{state.count}</span>
      <Header title={state.title} />
      <Collection of={TaskCard} from="tasks" />
    </div>
  )
}

// two levels of props is fine (C10 only flags 3+)
function Header({ title }) {
  return <h3>{title}</h3>
}

Lane.initialState = { title: '', count: 0, tasks: [] }

Lane.intent = ({ DOM, CHILD }) => ({
  RENAME:      DOM.input('.lane-title-input').map(e => e.target.value),
  DELETE_LANE: DOM.click('.delete-lane-btn'),
  PLAY:        DOM.click('.play'),
  CLEAR:       DOM.click('.clear'),
  DELETE_TASK: CHILD.select(TaskCard).map(e => e.taskId),             // C7
})

Lane.model = {
  RENAME: (state, title) => title.trim()                               // C2
    ? { ...state, title: title.trim() }
    : ABORT,                                                           // C3

  DELETE_LANE: {                                                       // C5, C11
    STATE:  s => ({ ...s, deleting: true }),
    EVENTS: event('DELETE_LANE', s => ({ laneId: s.id })),             // C6
  },

  PLAY: { EFFECT: () => player.send('play') },                         // C4

  CLEAR: (state) => {
    const count = Math.max(0, state.count - 1)                         // a call whose result is used
    if (count === state.count) return ABORT
    return { ...state, count }
  },

  DELETE_TASK: (state, taskId) =>
    ({ ...state, tasks: state.tasks.filter(t => t.id !== taskId) }),
}

Lane.context = { theme: () => 'light' }

function Board() {
  return <div className="board"><Lane /></div>
}
Board.intent = ({ EVENTS }) => ({ DELETE_LANE: EVENTS.select('DELETE_LANE') })
Board.model = { DELETE_LANE: set({ removed: true }) }

export default Board
