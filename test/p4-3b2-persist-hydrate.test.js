// @vitest-environment jsdom
// PLAN-4 3-B2 item 1: persist() hydrates automatically. When the app starts over server-rendered
// markup, the first render uses the server's state and the stored keys follow in a RESTORE
// action, without `hydrate: true`:
//   - plain run(): the mount point already has content when run() starts
//   - Vike (a Page with no Layout/Wrapper is the root): onRenderClient on a hydration
//   - Astro: an island the server rendered (p4-3b2-persist-astro.test.js)
// `hydrate: true / false` still overrides. Runs against the built files (npm run build).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { run, persist, renderToString, createElement as h } from 'sygnal'


const wait = (ms) => new Promise(r => setTimeout(r, ms))
let app
afterEach(() => {
  app?.dispose(); app = null
  localStorage.clear()
  document.body.innerHTML = ''
  delete window.__VIKE_SYGNAL_STATE__
})

const SERVER = { todos: ['from server'], filter: 'all' }
const store = () => localStorage.setItem('todo-app', JSON.stringify({ version: 1, state: { todos: ['stored'], filter: 'all' } }))

// a persisting root that records the todos each render saw
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
const stored = () => vi.waitFor(() => expect(document.querySelector('li')?.textContent).toBe('stored'), { timeout: 2000, interval: 10 })

describe('plain run()', () => {
  it('over server markup: the first render is the server state, then RESTORE applies the stored keys', async () => {
    const { App, seen } = makeApp()
    const html = renderToString(App, { state: SERVER })
    store()
    document.body.innerHTML = `<div id="root">${html}</div>`
    seen.length = 0
    App.initialState = SERVER
    app = run(App, {}, { mountPoint: '#root' })
    await stored()
    expect(seen[0]).toBe('from server')
    expect(seen.at(-1)).toBe('stored')
  })

  it('an empty mount point: the stored keys are in the first render', async () => {
    const { App, seen } = makeApp()
    store()
    document.body.innerHTML = '<div id="root">\n</div>'
    app = run(App, {}, { mountPoint: '#root' })
    await stored()
    expect(seen[0]).toBe('stored')
  })

  it('hydrate: false overrides: over server markup the stored keys are in the first render', async () => {
    const { App, seen } = makeApp({ hydrate: false })
    store()
    document.body.innerHTML = `<div id="root">${renderToString(App, { state: SERVER })}</div>`
    seen.length = 0
    App.initialState = SERVER
    app = run(App, {}, { mountPoint: '#root' })
    await stored()
    expect(seen[0]).toBe('stored')
  })

  it('hydrate: true overrides: on an empty mount point the first render is initialState', async () => {
    const { App, seen } = makeApp({ hydrate: true })
    store()
    document.body.innerHTML = '<div id="root"></div>'
    app = run(App, {}, { mountPoint: '#root' })
    await stored()
    expect(seen[0]).toBe('')
  })

  it('the stored keys are saved again after the RESTORE (and the server state is not written)', async () => {
    const { App } = makeApp({ debounceMs: 5 })
    store()
    document.body.innerHTML = `<div id="root">${renderToString(App, { state: SERVER })}</div>`
    App.initialState = SERVER
    app = run(App, {}, { mountPoint: '#root' })
    await stored()
    await wait(40)
    expect(JSON.parse(localStorage.getItem('todo-app')).state.todos).toEqual(['stored'])
  })
})

describe('Vike (a Page with no Layout or Wrapper is the root)', () => {
  const load = async () => {
    vi.resetModules()
    return Promise.all([import('../dist/vike/onRenderClient.mjs'), import('../dist/vike/onRenderHtml.mjs')])
  }

  it('hydration: the first render is the server state, then RESTORE applies the stored keys', async () => {
    const [{ onRenderClient }, { onRenderHtml }] = await load()
    const { App, seen } = makeApp()
    App.initialState = SERVER
    const doc = onRenderHtml({ Page: App, data: {}, config: {} }).documentHtml._escaped
    const html = doc.match(/<div id="page-view">([\s\S]*?)<\/div>\s*<script/)?.[1] ?? doc.match(/<div id="page-view">([\s\S]*)<\/div>/)[1]
    window.__VIKE_SYGNAL_STATE__ = JSON.parse(doc.match(/window\.__VIKE_SYGNAL_STATE__=(.*?)<\/script>/)[1])
    store()
    document.body.innerHTML = `<div id="page-view">${html.replace(/<script>.*?<\/script>/g, '')}</div>`
    App.initialState = { todos: [], filter: 'all' }
    seen.length = 0
    onRenderClient({ Page: App, data: {}, config: {}, isHydration: true })
    await stored()
    expect(seen[0]).toBe('from server')
    expect(seen.at(-1)).toBe('stored')
  })

  it("a client-side navigation isn't a hydration, though the previous page's markup is in #page-view", async () => {
    const [{ onRenderClient }] = await load()
    function Other() { return h('p', null, 'other page') }
    Other.initialState = {}
    document.body.innerHTML = '<div id="page-view"><p>other page</p></div>'
    onRenderClient({ Page: Other, data: {}, config: {}, isHydration: true })
    await wait(30)
    const { App, seen } = makeApp()
    store()
    onRenderClient({ Page: App, data: {}, config: {}, isHydration: false })
    await stored()
    expect(seen[0]).toBe('stored')
    // the module keeps the current app: dispose it through a last navigation
    onRenderClient({ Page: Other, data: {}, config: {}, isHydration: false })
  })

  it('no server HTML (SPA mode): the stored keys are in the first render', async () => {
    const [{ onRenderClient }] = await load()
    const { App, seen } = makeApp()
    store()
    document.body.innerHTML = '<div id="page-view"></div>'
    onRenderClient({ Page: App, data: {}, config: {}, isHydration: false })
    await stored()
    expect(seen[0]).toBe('stored')
  })
})
