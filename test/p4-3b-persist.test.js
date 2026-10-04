// @vitest-environment jsdom
// PLAN-4 3-B (GS-5): state persistence. `App.persist = persist({ key, pick | omit, version,
// migrate, storage, sync, hydrate, debounceMs })` on the root component: a synchronous restore
// merged into initialState (part of INITIALIZE), debounced writes of the picked keys plus a flush
// on pagehide and dispose, `PERSIST: { clear: true }` to remove the stored copy, `sync: true`
// applies other tabs' writes through RESTORE, `hydrate: true` restores in RESTORE after the first
// render (SSR). Failures are SYG642 (warn) and the app continues. renderComponent fakes the
// storage (`storage` option seeds it or is shared, t.storage(key) reads it, t.settle() flushes).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { persist } from '../src/extra/persist.js'
import { undoable } from '../src/extra/undo.js'
import run from '../src/extra/run.js'
import { renderToString } from '../src/extra/ssr.js'
import { getCodeInfo, DEV_CODE_SEVERITY, CODE_TITLES } from '../src/extra/diagnostics/codes.js'
import { _resetDiagnostics, getDiagnostics } from '../src/extra/diagnostics/index.js'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'

let t, t2, app
afterEach(() => {
  t?.dispose(); t2?.dispose(); app?.dispose()
  t = t2 = app = null
  _resetDiagnostics()
  vi.restoreAllMocks()
  try { localStorage.clear(); sessionStorage.clear() } catch (_) {}
  document.body.innerHTML = ''
})
const wait = (ms) => new Promise(r => setTimeout(r, ms))
const codes = () => t.diagnostics.map(d => d.code)

// ─── components ─────────────────────────────────────────────────────────────

const makeTodo = (opts = {}, extra = {}) => {
  function TodoApp({ state }) {
    return h('ul', null, ...state.todos.map(x => h('li', null, x)), h('p', null, state.filter), h('i', null, state.draft))
  }
  TodoApp.initialState = { todos: [], filter: 'all', draft: '' }
  TodoApp.model = {
    ADD: (state, text) => ({ ...state, todos: [...state.todos, text] }),
    FILTER: (state, filter) => ({ ...state, filter }),
    DRAFT: (state, draft) => ({ ...state, draft }),
    RESET: { STATE: () => TodoApp.initialState, PERSIST: { clear: true } },
    ...extra,
  }
  TodoApp.persist = persist({ key: 'todo-app', pick: ['todos', 'filter'], ...opts })
  return TodoApp
}

// ─── registry ───────────────────────────────────────────────────────────────

describe('codes', () => {
  it('SYG223, SYG224 (dev, static) and SYG642 (warn) are registered', () => {
    expect(DEV_CODE_SEVERITY.SYG223).toBe('warn')
    expect(DEV_CODE_SEVERITY.SYG224).toBe('error')
    expect(DEV_CODE_SEVERITY.SYG642).toBe('warn')
    expect(getCodeInfo('SYG642')?.severity).toBe('warn') // (registered by the dev entry, which this file imports)
    expect(CODE_TITLES.SYG223).toMatch(/persist/)
    expect(CODE_TITLES.SYG224).toMatch(/persist/)
    expect(CODE_TITLES.SYG642).toMatch(/persist/i)
  })
})

// ─── restore and save ───────────────────────────────────────────────────────

describe('restore and save (renderComponent fake storage)', () => {
  it('restores the stored keys into the initial state: the INITIALIZE action has them', async () => {
    t = renderComponent(makeTodo(), { storage: { 'todo-app': { version: 1, state: { todos: ['milk'], filter: 'done' } } } })
    await t.ready()
    expect(t.state).toEqual({ todos: ['milk'], filter: 'done', draft: '' })
    expect(t.states[0]).toEqual({ todos: ['milk'], filter: 'done', draft: '' })
    expect(t.actions.map(a => a.type)).not.toContain('RESTORE')
  })

  it('only the picked keys are restored, whatever is stored', async () => {
    t = renderComponent(makeTodo(), { storage: { 'todo-app': { version: 1, state: { todos: ['milk'], draft: 'x', extra: 1 } } } })
    await t.ready()
    expect(t.state).toEqual({ todos: ['milk'], filter: 'all', draft: '' })
  })

  it('saves the picked keys, debounced: t.settle() flushes, t.storage() reads', async () => {
    t = renderComponent(makeTodo())
    await t.ready()
    t.simulateAction('ADD', 'eggs')
    t.simulateAction('DRAFT', 'half-typed')
    await t.waitForState(s => s.draft == 'half-typed')
    expect(t.storage('todo-app')?.state?.todos).not.toEqual(['eggs']) // not yet: debounced
    await t.settle()
    expect(t.storage('todo-app')).toEqual({ version: 1, state: { todos: ['eggs'], filter: 'all' } })
  })

  it('omit stores every other top-level key (calculated fields left out)', async () => {
    const App = makeTodo({ pick: undefined, omit: ['draft'] })
    App.calculated = { count: s => s.todos.length }
    t = renderComponent(App)
    await t.ready()
    t.simulateAction('ADD', 'eggs')
    await t.settle()
    expect(t.storage('todo-app').state).toEqual({ todos: ['eggs'], filter: 'all' })
  })

  it('writes once per quiet period (debounceMs) through a storage adapter', async () => {
    const store = new Map()
    const setItem = vi.fn((k, v) => store.set(k, v))
    const adapter = { getItem: k => store.get(k) ?? null, setItem, removeItem: k => store.delete(k) }
    t = renderComponent(makeTodo({ storage: adapter, debounceMs: 30 }))
    await t.ready()
    await wait(60)
    setItem.mockClear()
    t.simulateAction('ADD', 'a')
    t.simulateAction('ADD', 'b')
    t.simulateAction('ADD', 'c')
    await t.waitForState(s => s.todos.length == 3)
    await wait(80)
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(JSON.parse(store.get('todo-app'))).toEqual({ version: 1, state: { todos: ['a', 'b', 'c'], filter: 'all' } })
  })

  it('under fake timers: t.settle() drives the clock and flushes', async () => {
    vi.useFakeTimers()
    try {
      t = renderComponent(makeTodo({ debounceMs: 5000 }))
      await t.ready()
      t.simulateAction('ADD', 'eggs')
      await t.settle()
      expect(t.storage('todo-app').state.todos).toEqual(['eggs'])
    } finally {
      t.dispose(); t = null
      vi.useRealTimers()
    }
  })

  it("the default fake serves 'session' too", async () => {
    t = renderComponent(makeTodo({ storage: 'session' }), { storage: { 'todo-app': { version: 1, state: { todos: ['s'] } } } })
    await t.ready()
    expect(t.state.todos).toEqual(['s'])
  })

  it('an unchanged state is not written again', async () => {
    const seeded = { 'todo-app': '{"version":1,"state":{"todos":["milk"],"filter":"all"}}' }
    t = renderComponent(makeTodo(), { storage: seeded })
    await t.ready()
    await t.settle()
    // still the seeded string: the restored state's picked keys are what is stored
    expect(seeded['todo-app']).toBe('{"version":1,"state":{"todos":["milk"],"filter":"all"}}')
  })
})

// ─── versions ───────────────────────────────────────────────────────────────

describe('version and migrate', () => {
  const migrate = (old, from) => from == 1 ? { todos: old.items.map(i => i.title), filter: 'all' } : undefined

  it('migrates a v1 entry, and saves it as v2', async () => {
    t = renderComponent(makeTodo({ version: 2, migrate }), { storage: { 'todo-app': { version: 1, state: { items: [{ title: 'milk' }] } } } })
    await t.ready()
    expect(t.state).toEqual({ todos: ['milk'], filter: 'all', draft: '' })
    t.simulateAction('ADD', 'eggs')
    await t.settle()
    expect(t.storage('todo-app')).toEqual({ version: 2, state: { todos: ['milk', 'eggs'], filter: 'all' } })
  })

  it('another version with no migrate starts from initialState, quietly', async () => {
    t = renderComponent(makeTodo({ version: 3 }), { storage: { 'todo-app': { version: 1, state: { todos: ['old'] } } } })
    await t.ready()
    expect(t.state.todos).toEqual([])
    expect(codes()).toEqual([])
  })
})

// ─── clear ──────────────────────────────────────────────────────────────────

describe('PERSIST: { clear: true }', () => {
  it('removes the stored copy; the state the same action produces is not written; later changes are', async () => {
    t = renderComponent(makeTodo(), { storage: { 'todo-app': { version: 1, state: { todos: ['milk'], filter: 'all' } } } })
    await t.ready()
    t.simulateAction('RESET')
    await t.settle()
    expect(t.state.todos).toEqual([])
    expect(t.storage('todo-app')).toBeUndefined()
    t.simulateAction('ADD', 'bread')
    await t.settle()
    expect(t.storage('todo-app').state.todos).toEqual(['bread'])
  })

  // 3-B2 item 4: only the canonical object form is handled (every non-STATE sink is an object key)
  it("the 'ACTION | PERSIST' shorthand is not rewritten: the stored copy stays", async () => {
    const App = makeTodo({}, { WIPE: { STATE: (s) => s }, 'WIPE | PERSIST': { clear: true } })
    t = renderComponent(App, { storage: { 'todo-app': { version: 1, state: { todos: ['milk'] } } } })
    await t.ready()
    t.simulateAction('WIPE')
    await t.settle()
    expect(t.storage('todo-app')?.state.todos).toEqual(['milk'])
  })

  it('a function value and ABORT', async () => {
    const App = makeTodo({}, { MAYBE: { PERSIST: (state, really) => really ? { clear: true } : undefined } })
    t = renderComponent(App, { storage: { 'todo-app': { version: 1, state: { todos: ['milk'] } } } })
    await t.ready()
    t.simulateAction('MAYBE', false)
    await t.settle()
    expect(t.storage('todo-app')).toBeDefined()
    t.simulateAction('MAYBE', true)
    await t.settle()
    expect(t.storage('todo-app')).toBeUndefined()
  })

  it('PERSIST needs no driver: no SYG609 under run() with the dev entry, and RESTORE is not SYG102', async () => {
    setupChecks()
    document.body.innerHTML = '<div id="root"></div>'
    app = run(makeTodo({ hydrate: true }), {}, { mountPoint: '#root', diagnostics: 'collect' })
    await wait(80)
    expect(diagnostics('SYG609')).toEqual([])
    expect(diagnostics('SYG102').map(d => d.data.action)).not.toContain('RESTORE')
  })
})

// ─── sync ───────────────────────────────────────────────────────────────────

describe('sync', () => {
  it('two instances sharing a fake storage: a write in one is applied in the other through RESTORE', async () => {
    const shared = {}
    t = renderComponent(makeTodo({ sync: true }), { storage: shared })
    t2 = renderComponent(makeTodo({ sync: true }), { storage: shared })
    await t.ready(); await t2.ready()
    t.simulateAction('ADD', 'milk')
    await t.settle()
    await t2.waitForState(s => s.todos.length == 1)
    expect(t2.state).toEqual({ todos: ['milk'], filter: 'all', draft: '' })
    expect(t2.actions.map(a => a.type)).toContain('RESTORE')
    // and back
    t2.simulateAction('FILTER', 'done')
    await t2.settle()
    await t.waitForState(s => s.filter == 'done')
    expect(t.state.todos).toEqual(['milk'])
  })

  it('without sync the other instance keeps its state', async () => {
    const shared = {}
    t = renderComponent(makeTodo(), { storage: shared })
    t2 = renderComponent(makeTodo(), { storage: shared })
    await t.ready(); await t2.ready()
    t.simulateAction('ADD', 'milk')
    await t.settle()
    await t2.settle()
    expect(t2.state.todos).toEqual([])
    expect(shared['todo-app'].state.todos).toEqual(['milk'])
  })

  it("real storage: a 'storage' event for the key from another tab is applied", async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const App = makeTodo({ sync: true })
    let last
    const View = App
    app = run(App, {}, { mountPoint: '#root' })
    app.sources.STATE.stream.addListener({ next: s => { last = s } })
    await wait(40)
    const newValue = JSON.stringify({ version: 1, state: { todos: ['from tab 2'], filter: 'all' } })
    localStorage.setItem('todo-app', newValue)
    window.dispatchEvent(new StorageEvent('storage', { key: 'todo-app', newValue, storageArea: localStorage }))
    await wait(40)
    expect(last.todos).toEqual(['from tab 2'])
    void View
  })
})

// ─── failures ───────────────────────────────────────────────────────────────

describe('failures: SYG642 (warn), the app continues on initialState', () => {
  it('a stored value that is not JSON', async () => {
    t = renderComponent(makeTodo(), { storage: { 'todo-app': '{not json' } })
    await t.ready()
    expect(t.state).toEqual({ todos: [], filter: 'all', draft: '' })
    const d = t.diagnostics.find(d => d.code == 'SYG642')
    expect(d.severity).toBe('warn')
    expect(d.message).toMatch(/todo-app/)
  })

  it('migrate throws', async () => {
    t = renderComponent(makeTodo({ version: 2, migrate: () => { throw new Error('boom') } }), { storage: { 'todo-app': { version: 1, state: {} } } })
    await t.ready()
    expect(t.state.todos).toEqual([])
    expect(codes()).toEqual(['SYG642'])
  })

  it('the write fails (quota)', async () => {
    const adapter = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') }, removeItem: () => {} }
    t = renderComponent(makeTodo({ storage: adapter }))
    await t.ready()
    t.simulateAction('ADD', 'x')
    await t.settle()
    expect(t.state.todos).toEqual(['x'])
    expect(codes()).toContain('SYG642')
  })

  it('production (diagnostics off): printed with console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('todo-app', 'nope')
    document.body.innerHTML = '<div id="root"></div>'
    app = run(makeTodo(), {}, { mountPoint: '#root' })
    await wait(40)
    expect(warn.mock.calls.map(c => String(c[0])).join('\n')).toMatch(/SYG642/)
  })
})

// ─── run(): real storage, pagehide, dispose ─────────────────────────────────

describe('under run() (jsdom localStorage)', () => {
  it('restores from localStorage, and flushes the pending write on pagehide', async () => {
    localStorage.setItem('todo-app', JSON.stringify({ version: 1, state: { todos: ['milk'], filter: 'all' } }))
    document.body.innerHTML = '<div id="root"></div>'
    const App = makeTodo({ debounceMs: 10000 }, {})
    App.intent = ({ DOM }) => ({ ADD: DOM.click('.add').mapTo('eggs') })
    const view = App
    function Wrapped(props) { return h('div', null, view(props), h('button', { className: 'add' }, '+')) }
    Object.assign(Wrapped, { initialState: App.initialState, model: App.model, intent: App.intent, persist: App.persist })
    app = run(Wrapped, {}, { mountPoint: '#root' })
    await wait(40)
    expect(document.querySelector('li').textContent).toBe('milk')
    document.querySelector('.add').click()
    await wait(20)
    expect(JSON.parse(localStorage.getItem('todo-app')).state.todos).toEqual(['milk'])
    window.dispatchEvent(new Event('pagehide'))
    expect(JSON.parse(localStorage.getItem('todo-app')).state.todos).toEqual(['milk', 'eggs'])
  })

  it('dispose flushes the pending write and removes the listeners', async () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    document.body.innerHTML = '<div id="root"></div>'
    const App = makeTodo({ debounceMs: 10000, sync: true })
    App.intent = ({ DOM }) => ({ ADD: DOM.click('.add').mapTo('eggs') })
    const view = App
    function Wrapped(props) { return h('div', null, view(props), h('button', { className: 'add' }, '+')) }
    Object.assign(Wrapped, { initialState: App.initialState, model: App.model, intent: App.intent, persist: App.persist })
    app = run(Wrapped, {}, { mountPoint: '#root' })
    await wait(40)
    const mine = add.mock.calls.filter(([type]) => type == 'pagehide' || type == 'storage')
    expect(mine.map(c => c[0]).sort()).toEqual(['pagehide', 'storage'])
    document.querySelector('.add').click()
    await wait(20)
    app.dispose()
    app = null
    expect(JSON.parse(localStorage.getItem('todo-app')).state.todos).toEqual(['eggs'])
    for (const [type, fn] of mine) expect(remove.mock.calls.some(c => c[0] == type && c[1] == fn)).toBe(true)
  })
})

// ─── SSR ────────────────────────────────────────────────────────────────────

describe('SSR: hydrate: true restores in RESTORE after the first render', () => {
  it('the first render is the server state (the server HTML); RESTORE then applies the stored keys', async () => {
    const App = makeTodo({ hydrate: true })
    const seen = []
    function Page(props) { seen.push(props.state.todos.join(',')); return App(props) }
    Object.assign(Page, { initialState: App.initialState, model: App.model, persist: App.persist })
    const server = { todos: ['from server'], filter: 'all', draft: '' }
    const html = renderToString(Page, { state: server })
    localStorage.setItem('todo-app', JSON.stringify({ version: 1, state: { todos: ['stored'], filter: 'all' } }))
    document.body.innerHTML = `<div id="root">${html}</div>`
    seen.length = 0
    Page.initialState = server
    app = run(Page, {}, { mountPoint: '#root' })
    await vi.waitFor(() => expect(document.querySelector('li')?.textContent).toBe('stored'), { timeout: 2000, interval: 10 })
    expect(seen[0]).toBe('from server')
    expect(seen.at(-1)).toBe('stored')
  })

  it('without hydrate the stored keys are in the first render', async () => {
    const App = makeTodo()
    const seen = []
    function Page(props) { seen.push(props.state.todos.join(',')); return App(props) }
    Object.assign(Page, { initialState: { todos: ['from server'], filter: 'all', draft: '' }, model: App.model, persist: App.persist })
    localStorage.setItem('todo-app', JSON.stringify({ version: 1, state: { todos: ['stored'], filter: 'all' } }))
    document.body.innerHTML = '<div id="root"></div>'
    app = run(Page, {}, { mountPoint: '#root' })
    await wait(40)
    expect(seen[0]).toBe('stored')
  })

  it('renderToString runs no persistence (no storage access on the server)', () => {
    const getItem = vi.fn(() => null)
    const App = makeTodo({ storage: { getItem, setItem: getItem, removeItem: getItem } })
    expect(renderToString(App)).toContain('<p>all</p>')
    expect(getItem).not.toHaveBeenCalled()
  })
})

// ─── root only, checks ──────────────────────────────────────────────────────

describe('root only: SYG224; SYG223 (dev entry)', () => {
  beforeEach(() => setupChecks())

  it('persist on a sub-component does nothing and is SYG224 (error)', async () => {
    const Child = makeTodo()
    Child.initialState = undefined // its state is the parent's 'list' slice
    function Root({ state }) { return h('div', null, h(Child, { state: 'list' })) }
    Root.initialState = { list: { todos: [], filter: 'all', draft: '' } }
    const store = { 'todo-app': { version: 1, state: { todos: ['milk'] } } }
    t = renderComponent(Root, { storage: store })
    await t.ready()
    await t.settle()
    expect(t.state.list.todos).toEqual([])
    const d = t.diagnostics.find(d => d.code == 'SYG224')
    expect(d?.severity).toBe('error')
    expect(d.message).toMatch(/TodoApp/)
  })

  it('a pick / omit key that is not in initialState is SYG223 (warn)', async () => {
    t = renderComponent(makeTodo({ pick: ['todos', 'filtr'] }))
    await t.ready()
    const d = t.diagnostics.find(d => d.code == 'SYG223')
    expect(d?.severity).toBe('warn')
    expect(d.message).toMatch(/filtr/)
    expect(d.message).toMatch(/did you mean 'filter'/)
  })
})

// ─── combined with undo (GS-8) ──────────────────────────────────────────────

describe('combined with undoable(): persist doc, not history', () => {
  function Editor({ state }) { return h('p', null, state.doc.text) }
  Editor.initialState = { doc: { text: '' } }
  Editor.model = undoable({ TYPE: (state, text) => ({ ...state, doc: { ...state.doc, text } }) }, { key: 'doc' })
  Editor.persist = persist({ key: 'editor', pick: ['doc'] })

  it('round-trips the doc; the history starts empty', async () => {
    const shared = {}
    t = renderComponent(Editor, { storage: shared })
    await t.ready()
    t.simulateAction('TYPE', 'hello')
    t.simulateAction('TYPE', 'hello world')
    await t.settle()
    expect(t.state.history.past.length).toBe(2)
    expect(shared.editor).toEqual({ version: 1, state: { doc: { text: 'hello world' } } })
    t.dispose(); t = null
    t2 = renderComponent(Editor, { storage: shared })
    await t2.ready()
    expect(t2.state.doc.text).toBe('hello world')
    expect(t2.state.history?.past || []).toEqual([])
    t2.simulateAction('UNDO')
    await t2.settle()
    expect(t2.state.doc.text).toBe('hello world')
  })
})

// ─── unused ─────────────────────────────────────────────────────────────────

describe('a component without persist', () => {
  it('has no RESTORE entry and touches no storage', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    function Plain({ state }) { return h('p', null, state.n) }
    Plain.initialState = { n: 1 }
    Plain.model = { INC: s => ({ ...s, n: s.n + 1 }) }
    document.body.innerHTML = '<div id="root"></div>'
    app = run(Plain, {}, { mountPoint: '#root' })
    await wait(30)
    expect(getItem).not.toHaveBeenCalled()
    expect(getDiagnostics()).toEqual([])
  })
})
