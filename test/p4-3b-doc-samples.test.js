// @vitest-environment jsdom
// PLAN-4 3-B (GS-5): the persist() code samples of guide/persistence and advanced/undo, run
// verbatim (PLAN-4 §1.4), as test/p4-4b1-doc-samples.test.js does: each SAMPLES entry is the exact
// code block of its page (checked by "in the docs"), compiled with the automatic JSX runtime
// (jsxImportSource 'sygnal'), imported against the built package (dist: `npm run build` first)
// and exercised. Fragments get a prelude and an epilogue here; the sample text is unchanged.
// Every sample is also checked with `sygnal-check --strict` (whole modules: no finding at all;
// fragments: no strict SYG5xx or a11y SYG7xx finding, as scripts/check-doc-samples.mjs requires).
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import 'sygnal/diagnostics'
import { renderComponent } from 'sygnal'
import { checkFiles } from '../sygnal-check/src/index.js'
import { codesOf } from './support/fences.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const docs = path.join(here, '..', 'docs/src/content/docs')

export const SAMPLES = {
  todoApp: { page: 'guide/persistence.md', code: `// TodoApp.jsx
import { ABORT, persist } from 'sygnal'

export function TodoApp({ state }) {
  const shown = state.filter === 'open' ? state.todos.filter((todo) => !todo.done) : state.todos
  return (
    <main>
      <label>New todo <input className="draft" value={state.draft} /></label>
      <button className="add">Add</button>
      <button className="show-all">All</button>
      <button className="show-open">Open</button>
      <button className="start-over">Start over</button>
      <ul>{shown.map((todo) => <li>{todo.title}</li>)}</ul>
    </main>
  )
}

TodoApp.initialState = { todos: [], filter: 'all', draft: '' }

TodoApp.intent = ({ DOM }) => ({
  DRAFT: DOM.input('.draft').value(),
  ADD: DOM.click('.add'),
  SHOW_ALL: DOM.click('.show-all'),
  SHOW_OPEN: DOM.click('.show-open'),
  START_OVER: DOM.click('.start-over'),
})

TodoApp.model = {
  DRAFT: (state, draft) => ({ ...state, draft }),
  ADD: (state) => state.draft
    ? { ...state, todos: [...state.todos, { title: state.draft, done: false }], draft: '' }
    : ABORT,
  SHOW_ALL: (state) => ({ ...state, filter: 'all' }),
  SHOW_OPEN: (state) => ({ ...state, filter: 'open' }),
  START_OVER: {
    STATE: (state) => ({ ...state, todos: [], filter: 'all' }),
    PERSIST: { clear: true },
  },
}

// Version 1 saved { items: ['milk', ...] }; version 2 saves { todos: [{ title, done }], filter }
TodoApp.persist = persist({
  key: 'todo-app',
  pick: ['todos', 'filter'],
  version: 2,
  migrate: (old, fromVersion) => fromVersion === 1
    ? { todos: old.items.map((title) => ({ title, done: false })), filter: 'all' }
    : undefined,
})
` },

  todoTest: { page: 'guide/persistence.md', code: `// TodoApp.test.jsx
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { TodoApp } from './TodoApp.jsx'

it('restores version 1 todos and saves version 2', async () => {
  const t = renderComponent(TodoApp, {
    storage: { 'todo-app': { version: 1, state: { items: ['milk'] } } },
  })
  await t.ready()
  expect(t.state.todos).toEqual([{ title: 'milk', done: false }])

  t.simulateAction('DRAFT', 'eggs')
  t.simulateAction('ADD')
  await t.settle()
  expect(t.storage('todo-app')).toEqual({
    version: 2,
    state: { todos: [{ title: 'milk', done: false }, { title: 'eggs', done: false }], filter: 'all' },
  })
  t.dispose()
})
` },

  clear: { page: 'guide/persistence.md', code: `Account.model = {
  LOG_OUT: {
    STATE: (state) => ({ ...state, user: null, cart: [] }),
    PERSIST: { clear: true },
  },
}
` },

  sync: { page: 'guide/persistence.md', code: `TodoApp.persist = persist({ key: 'todo-app', pick: ['todos', 'filter'], version: 2, migrate, sync: true })
` },

  memoryStorage: { page: 'guide/persistence.md', code: `const memory = new Map()

export const memoryStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => { memory.set(key, value) },
  removeItem: (key) => { memory.delete(key) },
}
` },

  hydrate: { page: 'guide/persistence.md', code: `App.persist = persist({ key: 'app', pick: ['theme'] })
App.initialState = window.__SYGNAL_STATE__ || App.initialState

run(App, {}, { mountPoint: '#app' })
` },

  undoPersist: { page: 'advanced/undo.md', code: `import { persist } from 'sygnal'

Editor.persist = persist({ key: 'note', pick: ['doc'] })
` },
}

// whole modules (any finding fails); the rest are fragments
const WHOLE = new Set(['todoApp', 'memoryStorage'])

let dir
let n = 0
const compile = (src, file) => ts.transpileModule(src, { fileName: file, compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'sygnal', module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, allowJs: true,
} }).outputText.replace(/(from\s+['"]\.{1,2}\/[^'"]+?)\.jsx?(['"])/g, '$1.mjs$2')

// Write `files` into a fresh folder, .js/.jsx compiled to .mjs next to them (`shims` repoints
// bare imports of the compiled output); import `main` from it
async function load(files, main, shims = {}) {
  const base = path.join(dir, 'm' + (n++))
  for (const [rel, src] of Object.entries(files)) {
    const file = path.join(base, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, src)
    if (!/\.jsx?$/.test(rel)) continue
    let out = compile(src, rel)
    for (const [from, to] of Object.entries(shims)) out = out.replaceAll(`from '${from}'`, `from '${to}'`).replaceAll(`from "${from}"`, `from "${to}"`)
    fs.writeFileSync(file.replace(/\.jsx?$/, '.mjs'), out)
  }
  return { base, mod: await import(pathToFileURL(path.join(base, main.replace(/\.jsx?$/, '.mjs'))).href) }
}

function check(name, code) {
  const file = path.join(dir, 'check', name + '.jsx')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, code)
  return checkFiles([file], { cwd: path.dirname(file), strict: true }).map(d => `${d.code} ${d.message}`)
}

beforeAll(() => { dir = fs.mkdtempSync(path.join(here, '.p4-3b-samples-')) })
afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }) })

let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  vi.restoreAllMocks()
  try { localStorage.clear() } catch (_) {}
  document.body.innerHTML = ''
})

describe('every sample is in its docs page, verbatim', () => {
  for (const [name, { page, code }] of Object.entries(SAMPLES)) {
    it(`${name} (${page})`, () => {
      expect(codesOf(fs.readFileSync(path.join(docs, page), 'utf8'), 'jsx')).toContain(code)
    })
  }
})

describe('sygnal-check --strict', () => {
  for (const [name, { code }] of Object.entries(SAMPLES)) {
    it(name, () => {
      const found = check(name, code)
      expect(WHOLE.has(name) ? found : found.filter(f => /^SYG[57]\d\d /.test(f))).toEqual([])
    })
  }
})

describe('guide/persistence', () => {
  it('the todo recipe: restore v1 through migrate, save v2 picked keys, start over clears', async () => {
    const { mod: { TodoApp } } = await load({ 'TodoApp.jsx': SAMPLES.todoApp.code }, 'TodoApp.jsx')
    const store = { 'todo-app': { version: 1, state: { items: ['milk', 'bread'] } } }
    t = renderComponent(TodoApp, { storage: store })
    await t.ready()
    expect(t.state).toEqual({ todos: [{ title: 'milk', done: false }, { title: 'bread', done: false }], filter: 'all', draft: '' })
    t.simulateAction('DRAFT', 'eggs')
    t.simulateAction('ADD')
    t.simulateAction('SHOW_OPEN')
    t.simulateAction('DRAFT', 'half')
    await t.settle()
    expect(store['todo-app']).toEqual({ version: 2, state: { todos: [{ title: 'milk', done: false }, { title: 'bread', done: false }, { title: 'eggs', done: false }], filter: 'open' } })
    expect(t.html()).toContain('<li>eggs</li>')
    t.simulateAction('START_OVER')
    await t.settle()
    expect(t.state.todos).toEqual([])
    expect(store['todo-app']).toBeUndefined()
    t.expectNoDiagnostics()
  })

  it('the todo recipe under run(): clicks, a reload restores from localStorage', async () => {
    const { run } = await import('sygnal')
    const { mod: { TodoApp } } = await load({ 'TodoApp.jsx': SAMPLES.todoApp.code }, 'TodoApp.jsx')
    document.body.innerHTML = '<div id="root"></div>'
    let app = run(TodoApp, {}, { mountPoint: '#root' })
    await vi.waitFor(() => expect(document.querySelector('.add')).toBeTruthy())
    const input = document.querySelector('.draft')
    input.value = 'milk'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('.add').click()
    await vi.waitFor(() => expect(document.querySelector('li')?.textContent).toBe('milk'))
    app.dispose() // flushes the pending write
    expect(JSON.parse(localStorage.getItem('todo-app'))).toEqual({ version: 2, state: { todos: [{ title: 'milk', done: false }], filter: 'all' } })
    document.body.innerHTML = '<div id="root"></div>'
    app = run(TodoApp, {}, { mountPoint: '#root' })
    await vi.waitFor(() => expect(document.querySelector('li')?.textContent).toBe('milk'))
    app.dispose()
  })

  it('the test sample runs', async () => {
    const files = {
      'TodoApp.jsx': SAMPLES.todoApp.code,
      'TodoApp.test.jsx': SAMPLES.todoTest.code,
      'vitest-shim.mjs': `export { expect } from 'vitest'
export const registered = { tests: [] }
export const it = (name, fn) => { registered.tests.push(fn) }
`,
    }
    const { base } = await load(files, 'TodoApp.test.jsx', { vitest: './vitest-shim.mjs' })
    const { registered } = await import(pathToFileURL(path.join(base, 'vitest-shim.mjs')).href)
    expect(registered.tests).toHaveLength(1)
    await registered.tests[0]()
  })

  it('clear: the LOG_OUT entry removes the stored copy', async () => {
    const prelude = `import { persist } from 'sygnal'
export function Account({ state }) { return <p>{state.user} {state.cart.length}</p> }
Account.initialState = { user: 'ada', cart: [] }
Account.persist = persist({ key: 'account', pick: ['user', 'cart'] })
`
    const { mod: { Account } } = await load({ 'Account.jsx': prelude + SAMPLES.clear.code }, 'Account.jsx')
    const store = { account: { version: 1, state: { user: 'grace', cart: ['tea'] } } }
    t = renderComponent(Account, { storage: store })
    await t.ready()
    expect(t.state.user).toBe('grace')
    t.simulateAction('LOG_OUT')
    await t.settle()
    expect(t.state.user).toBe(null)
    expect(store.account).toBeUndefined()
  })

  it('sync: two instances sharing a storage', async () => {
    const { mod: { TodoApp } } = await load({
      'TodoApp.jsx': SAMPLES.todoApp.code,
      'synced.jsx': `import { persist } from 'sygnal'\nimport { TodoApp } from './TodoApp.jsx'\nconst migrate = undefined\n` + SAMPLES.sync.code + 'export { TodoApp }\n',
    }, 'synced.jsx')
    const shared = {}
    t = renderComponent(TodoApp, { storage: shared })
    const t2 = renderComponent(TodoApp, { storage: shared })
    try {
      await t.ready(); await t2.ready()
      t.simulateAction('DRAFT', 'milk')
      t.simulateAction('ADD')
      await t.settle()
      await t2.waitForState(s => s.todos.length == 1)
      expect(t2.state.todos).toEqual([{ title: 'milk', done: false }])
    } finally { t2.dispose() }
  })

  it('memoryStorage: an adapter', async () => {
    const { mod: { memoryStorage } } = await load({ 'memory.js': SAMPLES.memoryStorage.code }, 'memory.js')
    const { mod: { TodoApp } } = await load({
      'TodoApp.jsx': SAMPLES.todoApp.code,
      'main.jsx': `import { persist } from 'sygnal'\nimport { TodoApp } from './TodoApp.jsx'\nimport { memoryStorage } from './memory.js'\nTodoApp.persist = persist({ key: 'todo-app', pick: ['todos'], storage: memoryStorage })\nexport { TodoApp }\n`,
      'memory.js': SAMPLES.memoryStorage.code,
    }, 'main.jsx')
    t = renderComponent(TodoApp)
    await t.ready()
    t.simulateAction('DRAFT', 'x')
    t.simulateAction('ADD')
    await t.settle()
    expect(t.storage('todo-app')).toBeUndefined() // not the fake: the adapter
    expect(memoryStorage.getItem('nothing')).toBe(null)
  })

  it('hydrate: the first render is the server state, then RESTORE', async () => {
    const { renderToString } = await import('sygnal')
    const prelude = `import { persist, run } from 'sygnal'
export const seen = []
export function App({ state }) { seen.push(state.theme); return <p>{state.theme}</p> }
App.initialState = { theme: 'light' }
export const go = () => {
`
    localStorage.setItem('app', JSON.stringify({ version: 1, state: { theme: 'dark' } }))
    const server = { theme: 'light' }
    window.__SYGNAL_STATE__ = server
    const { mod } = await load({ 'client.jsx': prelude + SAMPLES.hydrate.code + '}\n' }, 'client.jsx')
    document.body.innerHTML = `<div id="app">${renderToString(mod.App, { state: server })}</div>`
    mod.seen.length = 0
    mod.go()
    try {
      await vi.waitFor(() => expect(document.querySelector('#app p')?.textContent).toBe('dark'))
      expect(mod.seen[0]).toBe('light')
    } finally {
      delete window.__SYGNAL_STATE__
    }
  })
})

describe('advanced/undo', () => {
  it('persist the doc, not the history', async () => {
    const prelude = `import { undoable } from 'sygnal'
export function Editor({ state }) { return <p>{state.doc.text}</p> }
Editor.initialState = { doc: { text: '' } }
Editor.model = undoable({ TYPE: (state, text) => ({ ...state, doc: { ...state.doc, text } }) }, { key: 'doc' })
`
    const { mod: { Editor } } = await load({ 'Editor.jsx': prelude + SAMPLES.undoPersist.code }, 'Editor.jsx')
    const store = {}
    t = renderComponent(Editor, { storage: store })
    await t.ready()
    t.simulateAction('TYPE', 'a')
    t.simulateAction('TYPE', 'ab')
    await t.settle()
    expect(t.state.history.past).toHaveLength(2)
    expect(store.note).toEqual({ version: 1, state: { doc: { text: 'ab' } } })
    t.dispose()
    t = renderComponent(Editor, { storage: store })
    await t.ready()
    expect(t.state.doc.text).toBe('ab')
    expect(t.state.history?.past ?? []).toEqual([])
  })
})
