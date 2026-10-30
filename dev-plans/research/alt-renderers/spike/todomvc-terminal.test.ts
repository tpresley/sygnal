/**
 * Experiment A: examples/todomvc as it is (its views, intents, models, Collection, Transition,
 * refs, processForm) in a terminal. Only the drivers change: DOM → the terminal's host driver,
 * STORE / ROUTER → in-memory ones.
 */
import {describe, it, expect, afterEach} from 'vitest'
import {run} from 'sygnal'
import APP from '../../../../examples/todomvc/app'
import {createTerminal} from './terminal'
import {todoStyles} from './todomvc-styles'
import {makeMemoryStore, makeMemoryRouter} from './drivers'


const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
let app: any
afterEach(() => app?.dispose())

function start(seed?: any) {
  const term = createTerminal({styles: todoStyles, onNavigate: (h) => router.go(h)})
  const store = makeMemoryStore(seed ? {todos: seed} : {})
  const router = makeMemoryRouter()
  app = run(APP, {DOM: term.driver, STORE: store.driver, ROUTER: router.driver})
  return {term, store, router}
}

describe('todomvc, unchanged, in a terminal', () => {
  it('renders the stored todos', async () => {
    const {term} = start([{id: 1, title: 'Write the spike', completed: false}, {id: 2, title: 'Measure the core', completed: true}])
    await tick()
    expect(term.frame()).toMatchInlineSnapshot(`
      "TODOS
      [What needs to be done?]
      [ ]
        • [ ] Write the spike [Delete]
        • [x] Measure the core ✓ [Delete]
      1 item left
      *All* Active Completed
      [Clear completed]"
    `)
  })

  it('adds a todo through the form (processForm) and clears the input (a ref in an EFFECT)', async () => {
    const {term, store} = start()
    await tick()
    term.focus('.new-todo')
    term.type('Port to a TUI')
    term.press('enter')
    await tick()
    expect(term.frame()).toContain('• [ ] Port to a TUI')
    expect((term.doc.body.querySelector('.new-todo') as any).value).toBe('')
    await tick()
    expect(store.data.get('todos')).toEqual([{id: 1, title: 'Port to a TUI', completed: false}])
  })

  it('toggles, edits (dblclick, input, enter) and filters (a link → the router driver)', async () => {
    const {term} = start([{id: 1, title: 'a', completed: false}, {id: 2, title: 'b', completed: false}])
    // BOOTSTRAP registers the routes with next('ADD_ROUTE', …): 10 ms by default
    await tick(20)
    term.focus('.todo-1 .toggle')
    term.press('space')
    await tick()
    expect(term.frame()).toContain('[x] a ✓')

    term.focus('.todo-2 label')
    term.press('f2')
    await tick(); await tick()
    // autoFocus={editing} moved the focus into the edit field (requestAnimationFrame + focus())
    expect(term.doc.activeElement?.className).toBe('edit')
    term.press('backspace')
    term.type('bee')
    term.press('enter')
    await tick()
    expect(term.frame()).toContain('• [ ] bee')

    const active = term.doc.body.querySelector('a[href="#/active"]')!
    active.focus()
    term.press('enter')
    await tick()
    const f = term.frame()
    expect(f).toContain('*Active*')
    expect(f).toContain('bee')
    // the item filtered out is leaving: <Transition duration={300}> keeps it, with its classes
    expect(f).toMatch(/\[x\] a ✓ \[Delete\]\s+\(leaving\)/)
    await tick(350)
    expect(term.frame()).not.toContain('[x] a')
  })

  it('total isolation: a parent selector does not see an item\'s elements', async () => {
    const {term} = start([{id: 1, title: 'a', completed: false}])
    await tick()
    // .toggle-all (root's) vs .toggle (the item's): clicking the item's toggle must not toggle all
    term.focus('.todo-1 .toggle')
    term.press('enter')
    await tick()
    expect(term.frame()).toContain('[x] a ✓')
    term.focus('.toggle-all')
    term.press('enter')
    await tick()
    expect(term.frame()).toContain('[ ] a')
  })
})
