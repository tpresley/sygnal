// PLAN-4 3-B2: Astro islands.
//  - item 1: persist() hydrates automatically in a server-rendered island (the `ssr` attribute):
//    the first render is the server state, the stored keys follow in RESTORE. client:only islands
//    restore before the first render, whatever fallback content the island holds.
//  - item 2: the client's Wrapped root forwards the persist, uses, timers and viewTransitions
//    statics (an island with persist and uses works on the client and on the server; the forwarding
//    itself is checked by identity in tooling-astro-props.test.js).
// Runs against the built files (npm run build). The node environment with a JSDOM document set up
// here: under the jsdom environment Vite can't resolve the integration's virtual onError module
// in dist/astro/client.mjs, even mocked.
import { describe, it, expect, afterEach, vi, beforeAll } from 'vitest'
import { JSDOM } from 'jsdom'

vi.mock('virtual:sygnal/astro-on-error', () => ({ default: undefined }))

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
const GLOBALS = ['window', 'document', 'localStorage', 'sessionStorage', 'MutationObserver', 'Node', 'Element', 'HTMLElement', 'DocumentFragment', 'Text', 'Comment', 'SVGElement', 'StorageEvent', 'requestAnimationFrame', 'cancelAnimationFrame']
const saved = {}
beforeAll(() => {
  for (const k of GLOBALS) { saved[k] = Object.getOwnPropertyDescriptor(globalThis, k); Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true }) }
  return () => { for (const k of GLOBALS) saved[k] ? Object.defineProperty(globalThis, k, saved[k]) : delete globalThis[k] }
})

const { persist, defineBehavior, createElement: h } = await import('sygnal')
const { default: client } = await import('../dist/astro/client.mjs')
const { renderToStaticMarkup } = await import('../dist/astro/server.mjs')

let app
afterEach(() => {
  app?.dispose(); app = null
  localStorage.clear()
  document.body.innerHTML = ''
})

const SERVER = { todos: ['from server'], filter: 'all' }
const store = () => localStorage.setItem('todo-app', JSON.stringify({ version: 1, state: { todos: ['stored'], filter: 'all' } }))
const makeApp = (opts = {}) => {
  const seen = []
  function TodoApp({ state }) {
    seen.push(state.todos.join(','))
    return h('ul', null, ...state.todos.map(x => h('li', null, x)))
  }
  TodoApp.initialState = { todos: [], filter: 'all' }
  TodoApp.model = { ADD: (state, x) => ({ ...state, todos: [...state.todos, x] }) }
  TodoApp.persist = persist({ key: 'todo-app', pick: ['todos', 'filter'], ...opts })
  return { App: TodoApp, seen }
}
const island = (attrs, html) => {
  document.body.innerHTML = `<astro-island ${attrs}>${html}</astro-island>`
  return document.querySelector('astro-island')
}
const stored = () => vi.waitFor(() => expect(document.querySelector('li')?.textContent).toBe('stored'), { timeout: 2000, interval: 10 })

describe('item 1: automatic hydration in islands', () => {
  it('a server-rendered island: the first render is the server state, then RESTORE applies the stored keys', async () => {
    const { App, seen } = makeApp()
    const { html } = renderToStaticMarkup(App, { initialState: SERVER })
    expect(html).toContain('from server')
    store()
    const el = island('ssr client="load"', html)
    App.initialState = SERVER
    seen.length = 0
    await client(el)(App, {}, {}, { client: 'load' })
    app = el.__sygnal
    await stored()
    expect(seen[0]).toBe('from server')
    expect(seen.at(-1)).toBe('stored')
  })

  it('client:only: the stored keys are in the first render (even with fallback content in the island)', async () => {
    const { App, seen } = makeApp()
    store()
    const el = island('client="only"', '<p>loading</p>')
    await client(el)(App, {}, {}, { client: 'only' })
    app = el.__sygnal
    await stored()
    expect(seen[0]).toBe('stored')
  })

  it('hydrate: false overrides in a server-rendered island', async () => {
    const { App, seen } = makeApp({ hydrate: false })
    store()
    const el = island('ssr client="load"', renderToStaticMarkup(App, { initialState: SERVER }).html)
    App.initialState = SERVER
    seen.length = 0
    await client(el)(App, {}, {}, { client: 'load' })
    app = el.__sygnal
    await stored()
    expect(seen[0]).toBe('stored')
  })
})

describe('item 2: the island root forwards persist, uses, timers and viewTransitions', () => {
  const counter = defineBehavior({
    initialState: { n: 0 },
    model: { INC: (s) => ({ ...s, n: s.n + 1 }) },
  })
  const makeIsland = () => {
    function Island({ state }) { return h('div', null, h('b', null, String(state.c.n)), h('i', null, state.todos.join(','))) }
    Island.initialState = { todos: [], filter: 'all' }
    Island.model = { ADD: (state, x) => ({ ...state, todos: [...state.todos, x] }) }
    Island.uses = { c: counter() }
    Island.persist = persist({ key: 'todo-app', pick: ['todos'] })
    Island.timers = (state) => ({})
    Island.viewTransitions = ['ADD']
    return Island
  }

  it('client: uses (the behavior slice) and persist (restore) work in an island', async () => {
    store()
    const el = island('client="only"', '')
    await client(el)(makeIsland(), {}, {}, { client: 'only' })
    app = el.__sygnal
    await vi.waitFor(() => {
      expect(document.querySelector('b')?.textContent).toBe('0')
      expect(document.querySelector('i')?.textContent).toBe('stored')
    }, { timeout: 2000, interval: 10 })
  })

  it('server: the island with uses renders its behavior slice', () => {
    const { html } = renderToStaticMarkup(makeIsland(), {})
    expect(html).toBe('<div><b>0</b><i></i></div>')
  })
})
