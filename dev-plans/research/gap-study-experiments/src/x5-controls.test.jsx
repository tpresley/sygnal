// @vitest-environment jsdom
import { it, expect, afterEach } from 'vitest'
import { renderComponent, Collection, ABORT } from 'sygnal'
import { controls } from './controls.js'

const { Draft, Add } = controls({ Draft: 'input', Add: 'button' })
const { Done, Remove } = controls({ Done: 'button', Remove: 'button' })

function Item({ state }) {
  return <li className={state.done ? 'item done' : 'item'}>{state.text} <Done>✓</Done> <Remove className="danger">x</Remove></li>
}
Item.intent = ({ DOM }) => ({ DONE: DOM.click(Done.sel), REMOVE: DOM.click(Remove.sel) })
Item.model = { DONE: (s) => ({ ...s, done: true }), REMOVE: () => undefined }

function Todos({ state }) {
  return (
    <div className="todos">
      <Draft className="field" value={state.draft} placeholder="New task" />
      <Add>Add</Add>
      <Collection of={Item} from="todos" />
    </div>
  )
}
Todos.initialState = { draft: '', nextId: 1, todos: [] }
Todos.intent = ({ DOM }) => ({ DRAFT: DOM.input(Draft.sel).value(), ADD: DOM.click(Add.sel) })
Todos.model = {
  DRAFT: (s, draft) => ({ ...s, draft }),
  ADD: (s) => (s.draft.trim() ? { ...s, draft: '', nextId: s.nextId + 1, todos: [...s.todos, { id: s.nextId, text: s.draft, done: false }] } : ABORT),
}

let t; afterEach(() => t?.dispose())
for (const dom of ['mock', 'real']) {
  it(`controls as JSX tags work (${dom} DOM)`, async () => {
    t = renderComponent(Todos, dom === 'real' ? { dom: 'real' } : {})
    await t.ready()
    t.simulateEvent(Draft.sel, 'input', { value: 'Milk' }); await t.next(s => s.draft === 'Milk')
    t.simulateEvent(Add.sel, 'click'); await t.next(s => s.todos.length === 1)
    t.simulateEvent(Draft.sel, 'input', { value: 'Eggs' }); await t.next(s => s.draft === 'Eggs')
    t.simulateEvent(Add.sel, 'click'); await t.next(s => s.todos.length === 2)
    t.simulateEvent(`li:nth-child(2) ${Done.sel}`, 'click'); await t.next(s => s.todos[1].done)
    expect(t.state.todos[0].done).toBe(false)
    t.simulateEvent(`li:first-child ${Remove.sel}`, 'click'); await t.next(s => s.todos.length === 1)
    expect(t.html()).toContain('data-sygnal-control="Remove"')
    t.expectNoDiagnostics()
  })
}
