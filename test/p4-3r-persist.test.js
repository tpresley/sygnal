// @vitest-environment jsdom
// PLAN-4 3-R persist follow-ups.
// - item 4: a storage that fails on every write reports SYG642 once per kind (restore / save /
//   clear), not on every debounced write (it prints in production too). A failed save is retried
//   on the next state change, silently; a save that succeeds again re-arms the report.
// - item 5: run() over a mount point with markup counts as hydrating only when that markup was
//   rendered by renderToString (its root carries `data-sygnal-ssr`); a client-only app's loading
//   placeholder isn't server markup, so the stored state is part of the first render (no flicker).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { persist } from '../src/extra/persist.js'
import run from '../src/extra/run.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

let t, app
afterEach(() => {
  t?.dispose(); app?.dispose()
  t = app = null
  _resetDiagnostics()
  vi.restoreAllMocks()
  try { localStorage.clear() } catch (_) {}
  document.body.innerHTML = ''
})
const wait = (ms) => new Promise(r => setTimeout(r, ms))

const makeTodo = (opts = {}) => {
  function TodoApp({ state }) {
    return h('ul', null, ...state.todos.map(x => h('li', null, x)))
  }
  TodoApp.initialState = { todos: [] }
  TodoApp.model = {
    ADD: (state, text) => ({ ...state, todos: [...state.todos, text] }),
    RESET: { STATE: () => TodoApp.initialState, PERSIST: { clear: true } },
  }
  TodoApp.persist = persist({ key: 'todo-app', debounceMs: 5, ...opts })
  return TodoApp
}

describe('3-R item 4: SYG642 once per kind', () => {
  it('a storage that throws on every write reports once, and keeps retrying silently', async () => {
    let fail = true
    const store = {}
    const adapter = {
      getItem: (k) => store[k] ?? null,
      setItem: vi.fn((k, v) => { if (fail) throw new Error('QuotaExceededError'); store[k] = v }),
      removeItem: () => { throw new Error('SecurityError') },
    }
    t = renderComponent(makeTodo({ storage: adapter }))
    await t.ready()
    for (const x of ['a', 'b', 'c']) {
      t.simulateAction('ADD', x)
      await t.settle()
    }
    expect(adapter.setItem).toHaveBeenCalledTimes(3)
    const saves = () => t.diagnostics.filter(d => d.code == 'SYG642' && /save/.test(d.message))
    expect(saves().length).toBe(1)
    // the other kinds still report, once each
    t.simulateAction('RESET')
    await t.settle()
    t.simulateAction('RESET')
    await t.settle()
    expect(t.diagnostics.filter(d => d.code == 'SYG642' && /clear/.test(d.message)).length).toBe(1)
    // the storage recovers: the next change is saved; a later failure is reported again
    fail = false
    t.simulateAction('ADD', 'd')
    await t.settle()
    expect(JSON.parse(store['todo-app']).state.todos).toEqual(['d'])
    fail = true
    t.simulateAction('ADD', 'e')
    await t.settle()
    expect(saves().length).toBe(2)
  })

  it('production (diagnostics off): console.warn once, not per write', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const adapter = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') }, removeItem: () => {} }
    const App = makeTodo({ storage: adapter })
    App.intent = ({ DOM }) => ({ ADD: DOM.click('.add').mapTo('x') })
    const view = App
    function Wrapped(props) { return h('div', null, view(props), h('button', { className: 'add' }, '+')) }
    Object.assign(Wrapped, { initialState: App.initialState, model: App.model, intent: App.intent, persist: App.persist })
    document.body.innerHTML = '<div id="root"></div>'
    app = run(Wrapped, {}, { mountPoint: '#root' })
    await wait(30)
    for (let i = 0; i < 3; i++) {
      document.querySelector('.add').click()
      await wait(30)
    }
    expect(document.querySelectorAll('li').length).toBe(3)
    expect(warn.mock.calls.filter(c => /SYG642/.test(String(c[0]))).length).toBe(1)
  })
})
