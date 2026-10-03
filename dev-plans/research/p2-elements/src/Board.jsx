// The Sygnal component published as <task-board> (canonical forms).
export default function Board({ state }) {
  return (
    <div className="board">
      <h3 className="title">Board: {state.heading}</h3>
      <p className="meta">{`${state.tasks.length}|${state.readonly}|${state.clicks}`}</p>
      <ul>{state.tasks.map((t) => <li className="task" data-id={t.id}>{t.name}</li>)}</ul>
      <button className="btn">+</button>
    </div>
  )
}
Board.initialState = { heading: '', tasks: [], readonly: false, clicks: 0 }
Board.intent = ({ DOM }) => ({
  CLICK: DOM.select('.btn').events('click'),
  PICK: DOM.select('.task').events('click').map((e) => e.target.dataset.id),
})
Board.model = {
  CLICK: (state) => ({ ...state, clicks: state.clicks + 1 }),
  PICK: { PARENT: (state, id) => ({ id }) },
}
