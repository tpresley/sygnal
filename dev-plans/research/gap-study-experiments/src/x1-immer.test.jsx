// @vitest-environment jsdom
import { it, expect, afterEach } from 'vitest'
import { produce } from 'immer'
import { renderComponent, Collection } from 'sygnal'

function Item({ state }) { return <li className="item">{state.text}{state.done ? ' ✓' : ''}<button className="done">done</button></li> }
Item.intent = ({ DOM }) => ({ DONE: DOM.click('.done') })
Item.model = { DONE: produce((d) => { d.done = true }) }

function Todos({ state }) {
  return <div><input className="draft" value={state.draft} /><button className="add">add</button><button className="noop">noop</button>
    <span className="count">{state.remaining}</span><Collection of={Item} from="todos" /></div>
}
Todos.initialState = { draft: '', nextId: 1, todos: [] }
Todos.calculated = { remaining: (s) => s.todos.filter(t => !t.done).length }
Todos.intent = ({ DOM }) => ({ DRAFT: DOM.input('.draft').value(), ADD: DOM.click('.add'), NOOP: DOM.click('.noop') })
Todos.model = {
  DRAFT: produce((d, v) => { d.draft = v }),
  ADD: produce((d) => { d.todos.push({ id: d.nextId++, text: d.draft, done: false }); d.draft = '' }),
  NOOP: produce(() => {}),
}
let t; afterEach(() => t?.dispose())
it('immer produce works as reducers incl. calculated + Collection item writes', async () => {
  t = renderComponent(Todos, { dom: 'real' })
  await t.ready()
  t.simulateEvent('.draft', 'input', { value: 'a' }); await t.next(s => s.draft === 'a')
  t.simulateEvent('.add', 'click'); await t.next(s => s.todos.length === 1)
  expect(t.state.remaining).toBe(1)
  t.simulateEvent('.done', 'click'); await t.next(s => s.todos[0].done)
  expect(t.state.remaining).toBe(0)
  const n = t.states.length
  t.simulateEvent('.noop', 'click'); await t.settle()
  expect(t.states.length - n).toBe(0)
  expect(t.query('.count').textContent).toBe('0')
})
