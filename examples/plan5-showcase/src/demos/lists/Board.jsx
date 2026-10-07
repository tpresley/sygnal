import { run, Collection, makeViewTransitionDOMDriver } from 'sygnal'

function Card({ state }) {
  return (
    <li className="vt-card">
      <span>{state.title}</span>
      <button type="button" className="move">Move →</button>
    </li>
  )
}
Card.intent = ({ DOM }) => ({ MOVE: DOM.click('.move') })
Card.model = { MOVE: { PARENT: (state) => ({ id: state.id }) } }

export function Board({ state }) {
  return (
    <div>
      <div className="row"><button className="shuffle">Shuffle both lanes</button><button className="reverse">Reverse "To do"</button></div>
      <div className="vt-board">
        <section className="vt-lane">
          <h4>To do</h4>
          {/* every item gets view-transition-name: card-<id>; same prefix in both lanes, so cards fly across */}
          <ul><Collection of={Card} from="todo" viewTransitionName="card" /></ul>
        </section>
        <section className="vt-lane">
          <h4>Done</h4>
          <ul><Collection of={Card} from="done" viewTransitionName="card" /></ul>
        </section>
      </div>
    </div>
  )
}

Board.initialState = {
  todo: [{ id: 1, title: 'Design' }, { id: 2, title: 'Build' }, { id: 3, title: 'Test' }, { id: 4, title: 'Docs' }],
  done: [{ id: 5, title: 'Plan' }],
}

const shuffle = (list) => list.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x)

Board.intent = ({ DOM, CHILD }) => ({
  MOVE: CHILD.select(Card),
  SHUFFLE: DOM.click('.shuffle'),
  REVERSE: DOM.click('.reverse'),
})

Board.model = {
  MOVE: (state, { id }) => {
    const inTodo = state.todo.find((c) => c.id === id)
    return inTodo
      ? { ...state, todo: state.todo.filter((c) => c.id !== id), done: [...state.done, inTodo] }
      : { ...state, done: state.done.filter((c) => c.id !== id), todo: [...state.todo, state.done.find((c) => c.id === id)] }
  },
  SHUFFLE: (state) => ({ ...state, todo: shuffle(state.todo), done: shuffle(state.done) }),
  REVERSE: (state) => ({ ...state, todo: [...state.todo].reverse() }),
}

// the renders these actions cause run inside document.startViewTransition()
Board.viewTransitions = ['MOVE', 'SHUFFLE', 'REVERSE']

export const start = (mountPoint, uid) => run(Board, { DOM: makeViewTransitionDOMDriver(mountPoint) }, { mountPoint, uid })
