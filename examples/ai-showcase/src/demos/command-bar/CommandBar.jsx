// The widget: the model picker (decision models only) and the Board for the picked model. The
// app holds the cards and the decision log; each Board shares them (Board.jsx).
import { providersResource, pickerState, pickerIntent, pickerModel, choicesOf, pickedModel, modelPicker } from '../../shared/picker.jsx'
import { boardFor } from './Board.jsx'

const PICK = { need: 'decision' }

export default function CommandBar({ state }) {
  const backend = choicesOf(state, PICK).find((c) => c.id === pickedModel(state, PICK))
  const Board = backend && boardFor(backend)
  const cmd = state.cmd
  return (
    <div className="w command-bar">
      <div className="w-toolbar">
        {modelPicker(state, PICK, { label: 'Decision model', disabled: cmd?.status === 'deciding' || cmd?.status === 'running' })}
        <span className="grow" />
        <span className="badge blue" title="commandBar({ below: 0.6 })">runs at ≥ 60% sure</span>
        <span className="badge warn" title="consequential: true">asks before deleting</span>
      </div>
      {Board ? <Board key={backend.id} /> : <p className="status-line">{state.providers?.status === 'success' ? 'No decision model: pull nimble into Ollama, or add a TypeSafe key.' : 'Looking for decision models…'}</p>}
    </div>
  )
}

CommandBar.initialState = {
  ...pickerState,
  cards: [
    { id: 1, title: 'Write docs', column: 'doing', starred: false },
    { id: 2, title: 'Design the logo', column: 'todo', starred: true },
    { id: 3, title: 'Plan the launch party', column: 'todo', starred: false },
    { id: 4, title: 'Fix the login bug', column: 'doing', starred: false },
    { id: 5, title: 'Set up CI', column: 'done', starred: false },
  ],
  nextId: 6,
  log: [],                 // the latest decisions, newest first (Board.jsx)
}

CommandBar.resources = providersResource
CommandBar.intent = ({ DOM }) => pickerIntent(DOM)
CommandBar.model = pickerModel
