// PLAN-4 CT-1: controls in a real browser (automatic JSX runtime, so the control is rendered by
// the runtime's own pragma copy): X5's todo scenario with no `.sel` workaround, per-item
// controls in a Collection, and a nested child using the same key names.
import { run, Collection, ABORT, controls } from 'sygnal'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Controls (PLAN-4 CT-1)'

async function start(App) {
  const { id, el } = mount()
  const app = run(App, {}, { mountPoint: id })
  await waitFor(() => el.firstElementChild)
  await wait(30)
  return { el, app }
}

async function typeInto(input, text) {
  input.value = text
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))
  await wait(30)
}

const { Draft, Add } = controls({ Draft: 'input', Add: 'button' })
const { Done, Remove } = controls({ Done: 'button', Remove: 'button' })

function Item({ state }) {
  return <li className={state.done ? 'item done' : 'item'} data-id={String(state.id)}>{state.text} <Done>✓</Done> <Remove className="danger">x</Remove></li>
}
Item.intent = ({ DOM }) => ({ DONE: DOM.click(Done), REMOVE: DOM.click(Remove) })
Item.model = { DONE: (s) => ({ ...s, done: true }), REMOVE: () => undefined }

function Todos({ state }) {
  return (
    <div className="todos">
      <Draft className="field" value={state.draft} placeholder="New task" />
      <Add>Add</Add>
      <ul><Collection of={Item} from="todos" /></ul>
      <p className="leaks">{state.leaks}</p>
    </div>
  )
}
Todos.initialState = { draft: '', nextId: 1, todos: [], leaks: 0 }
Todos.intent = ({ DOM }) => ({ DRAFT: DOM.input(Draft).value(), ADD: DOM.click(Add), LEAK: DOM.click(Done) })
Todos.model = {
  DRAFT: (s, draft) => ({ ...s, draft }),
  ADD: (s) => (s.draft.trim() ? { ...s, draft: '', nextId: s.nextId + 1, todos: [...s.todos, { id: s.nextId, text: s.draft, done: false }] } : ABORT),
  LEAK: (s) => ({ ...s, leaks: s.leaks + 1 }),
}

const Inner = controls({ Add: 'button' })
function Child({ state }) { return <div className="child"><Inner.Add>child add</Inner.Add><span className="cn">{state.n}</span></div> }
Child.intent = ({ DOM }) => ({ ADD: DOM.click(Inner.Add) })
Child.model = { ADD: (s) => ({ ...s, n: s.n + 1 }) }
function Parent({ state }) { return <div><Add>parent add</Add><span className="pn">{state.parentN}</span><Child state="child" /></div> }
Parent.initialState = { parentN: 0, child: { n: 0 } }
Parent.intent = ({ DOM }) => ({ ADD: DOM.click(Add) })
Parent.model = { ADD: (s) => ({ ...s, parentN: s.parentN + 1 }) }

export async function controlsTests() {
  await runTest(CAT, "X5: the todo scenario with controls as JSX tags (no '.sel' workaround)", async () => {
    const { el, app } = await start(Todos)
    try {
      const draft = el.querySelector(String(Draft))
      assert(draft && draft.tagName === 'INPUT' && draft.className === 'field', 'Draft renders an input with its className')
      await typeInto(draft, 'Milk'); el.querySelector(`${Add}`).click(); await wait(30)
      await typeInto(el.querySelector(`${Draft}`), 'Eggs'); el.querySelector(`${Add}`).click(); await wait(30)
      assert(el.querySelectorAll(`${Done}`).length === 2, 'two items, each with its Done control')
      el.querySelector(`li:nth-child(2) ${Done}`).click(); await wait(30)
      const items = [...el.querySelectorAll('li')].map(li => li.className)
      assert(items.join('|') === 'item|item done', `only the second item is done: ${items}`)
      el.querySelector(`li:first-child ${Remove}`).click(); await wait(30)
      const left = [...el.querySelectorAll('li')].map(li => li.textContent.split(' ')[0])
      assert(left.join() === 'Eggs', `the first item is removed: ${left}`)
      assert(el.querySelector('.leaks').textContent === '0', 'the parent never hears the items\' Done control (isolation)')
    } finally { app.dispose() }
  })

  await runTest(CAT, 'controls in a Collection: each item hears only its own control', async () => {
    const App = (a) => Todos(a)
    Object.assign(App, { intent: Todos.intent, model: Todos.model, initialState: { ...Todos.initialState, nextId: 4, todos: [1, 2, 3].map(id => ({ id, text: 't' + id, done: false })) } })
    const { el, app } = await start(App)
    try {
      el.querySelector(`[data-id="3"] ${Done}`).click(); await wait(30)
      el.querySelector(`[data-id="1"] ${Done}`).click(); await wait(30)
      const done = [...el.querySelectorAll('li')].map(li => li.classList.contains('done'))
      assert(done.join() === 'true,false,true', `items 1 and 3 done: ${done}`)
      assert(el.querySelector('.leaks').textContent === '0', 'no leak to the parent')
    } finally { app.dispose() }
  })

  await runTest(CAT, 'a nested child using the same key names: each component hears only its own', async () => {
    const { el, app } = await start(Parent)
    try {
      const adds = el.querySelectorAll(String(Add))
      assert(adds.length === 2, 'both controls render data-control="Add"')
      adds[0].click(); await wait(30)
      assert(el.querySelector('.pn').textContent === '1' && el.querySelector('.cn').textContent === '0', 'parent add: parent only')
      el.querySelector(`.child ${Inner.Add}`).click(); await wait(30)
      assert(el.querySelector('.pn').textContent === '1' && el.querySelector('.cn').textContent === '1', 'child add: child only')
    } finally { app.dispose() }
  })
}
