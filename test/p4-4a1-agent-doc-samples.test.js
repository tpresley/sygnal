// @vitest-environment jsdom
// PLAN-4 4-A part 1: every snippet added or changed in llms.txt and skills/sygnal-dev/SKILL.md for
// the PLAN-4 features (except controls) runs (PLAN-4 §1.4 "recipes run verbatim"). Each FRAGMENTS
// entry is the exact text of the file(s) it names (checked first); the whole code blocks are
// extracted from the files. Each is placed in a small module (fixtures around it, the fragment
// itself unchanged), compiled with the automatic JSX runtime (jsxImportSource 'sygnal', as
// sygnal/vite does), imported against the built package (dist: `npm run build` first) and run.
// Every module is also checked with `sygnal-check --strict` (no finding but SYG102 for fixture
// actions driven by simulateAction), so the agent docs
// stay strict-clean and a11y-clean (scripts/check-doc-samples.mjs checks the code blocks too).
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import 'sygnal/diagnostics'
import { renderComponent } from 'sygnal'
import { checkFiles } from '../sygnal-check/src/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const FILES = {
  llms: fs.readFileSync(path.join(repo, 'llms.txt'), 'utf8'),
  skill: fs.readFileSync(path.join(repo, 'skills/sygnal-dev/SKILL.md'), 'utf8'),
}
const BOTH = ['llms', 'skill']

// text → the files that contain it verbatim
const FRAGMENTS = {
  pagerUses: [BOTH, "TaskList.uses = { pager: pager({ pageSize: 10, next: '.newer', prev: '.older' }) }"],
  selection: [BOTH, "selection({ multi: true, item: '.pick', from: 'mails' })"],
  isSelected: [BOTH, 'isSelected(state.sel, id)'],
  undo: [BOTH, "undo({ key: 'doc', undo: '.undo', redo: '.redo' })"],
  disclosure: [BOTH, "const disclosure = defineBehavior({ initialState: { open: false }, intent: ({ DOM }, { toggle }) => ({ TOGGLE: DOM.click(toggle) }), model: { TOGGLE: (slice) => ({ ...slice, open: !slice.open }) } })"],
  disclosureUses: [BOTH, "uses = { more: disclosure({ toggle: '.more' }) }"],
  simulateMore: [BOTH, "t.simulateAction('more.TOGGLE')"],
  submit: [['llms'], "SUBMIT: { STATE: (s) => ({ ...s, errors: validate(s) }), ELEMENT: (s) => (validate(s).email ? { focus: '.email' } : ABORT) }"],
  element: [BOTH, "ELEMENT: (s) => (validate(s).email ? { focus: '.email' } : ABORT)"],
  scroll: [['llms'], "{ scrollIntoView: '.row', block: 'nearest' }"],
  close: [BOTH, "{ close: '.help', returnValue: 'done' }"],
  domClose: [['llms'], "DOM.close('.help')"],
  commands: [BOTH, "t.commands('ELEMENT')"],
  timers: [BOTH, "Clock.timers = (state) => ({ tick: state.running && { every: 1000, action: 'TICK' } })"],
  timerRun: [BOTH, 'run(App, { TIMER: makeTimerDriver() })'],
  persist: [BOTH, "App.persist = persist({ key: 'todo-app', pick: ['todos', 'filter'] })"],
  persistClear: [BOTH, 'PERSIST: { clear: true }'],
  persistTest: [BOTH, "renderComponent(App, { storage: { 'todo-app': { version: 1, state: { todos: [] } } } })"],
  persistRead: [BOTH, "t.storage('todo-app')"],
  watch: [BOTH, 'SAVE: STATE.watch(state => state.text).compose(debounce(1000))'],
  uidLabel: [['llms'], "<label for={uid('email')}>"],
  uidInput: [['llms'], "<input id={uid('email')} />"],
  explain: [BOTH, 't.explain(s => s.count === 5)'],
}
const F = Object.fromEntries(Object.entries(FRAGMENTS).map(([k, [, text]]) => [k, text]))
// evaluate an expression fragment with the given bindings
const run = (fragment, bindings) => new Function(...Object.keys(bindings), 'return ' + fragment)(...Object.values(bindings))

// the code blocks changed for a11y (aria-label) and GS-4 (the "no change" comment)
const block = (file, marker) => {
  const found = [...FILES[file].matchAll(/```jsx\n([\s\S]*?)```/g)].map(m => m[1]).filter(b => b.includes(marker))
  expect(found, `${file}: one block with ${marker}`).toHaveLength(1)
  return found[0]
}

let dir
let n = 0
const compile = (src, file) => ts.transpileModule(src, { fileName: file, compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'sygnal', module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, allowJs: true,
} }).outputText.replace(/(from\s+['"]\.{1,2}\/[^'"]+?)\.jsx?(['"])/g, '$1.mjs$2')

// Write `files` ({ 'rel/path.jsx': source }) into a fresh folder, compile .js/.jsx to .mjs, import `main`
async function load(files, main) {
  const base = path.join(dir, 'm' + (n++))
  for (const [rel, src] of Object.entries(files)) {
    const file = path.join(base, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, src)
    fs.writeFileSync(file.replace(/\.jsx?$/, '.mjs'), compile(src, rel))
  }
  return import(pathToFileURL(path.join(base, main.replace(/\.jsx?$/, '.mjs'))).href)
}

// sygnal-check --strict on one module (its own .jsx file)
function check(name, code) {
  const file = path.join(dir, 'check', name + '.jsx')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, code)
  return checkFiles([file], { cwd: path.dirname(file), strict: true }).map(d => `${d.code} ${d.message}`)
}

beforeAll(() => { dir = fs.mkdtempSync(path.join(here, '.p4-4a1-samples-')) })
afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }) })

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; vi.useRealTimers(); vi.restoreAllMocks() })

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const until = async (cond, what, ms = 3000) => {
  for (const end = Date.now() + ms; !cond(); await sleep(5)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
  }
}

// ── the modules: fixtures around the fragments ──────────────────────────────

const MODULES = {
  pager: `import { pager } from 'sygnal'
export function TaskList({ state }) {
  const { offset, pageSize, page, hasPrev, hasNext } = state.pager
  return (
    <div>
      <ul>{state.tasks.slice(offset, offset + pageSize).map(task => <li>{task.title}</li>)}</ul>
      <button className="older" disabled={!hasPrev}>Older</button>
      <span className="page">{page + 1}</span>
      <button className="newer" disabled={!hasNext}>Newer</button>
    </div>
  )
}
TaskList.initialState = { tasks: Array.from({ length: 25 }, (_, i) => ({ id: i + 1, title: 'Task ' + (i + 1) })) }
${F.pagerUses}
`,
  selection: `import { selection, isSelected } from 'sygnal'
const pick = (state, id) => ${F.isSelected}
export function Inbox({ state }) {
  return (
    <ul>
      {state.mails.map(mail => (
        <li><button className="pick" data-id={mail.id} aria-pressed={String(pick(state, mail.id))}>{mail.subject}</button></li>
      ))}
    </ul>
  )
}
Inbox.initialState = { mails: [{ id: 1, subject: 'Lunch?' }, { id: 2, subject: 'Invoice' }] }
Inbox.uses = { sel: ${F.selection} }
`,
  undo: `import { undo } from 'sygnal'
export function Editor({ state }) {
  return (
    <div>
      <label>Note <textarea className="note" value={state.doc.text} /></label>
      <button className="undo" disabled={!state.history.canUndo}>Undo</button>
      <button className="redo" disabled={!state.history.canRedo}>Redo</button>
    </div>
  )
}
Editor.initialState = { doc: { text: '' } }
Editor.uses = { history: ${F.undo} }
Editor.intent = ({ DOM }) => ({ TYPE: DOM.input('.note').value() })
Editor.model = { TYPE: (state, text) => ({ ...state, doc: { ...state.doc, text } }) }
`,
  disclosure: `import { ABORT, defineBehavior } from 'sygnal'
${F.disclosure}
export function Product({ state }) {
  return (
    <section>
      <button className="more" aria-expanded={String(state.more.open)}>Details</button>
      {state.more.open && <p>{state.text}</p>}
      <p className="opened">{state.opened}</p>
    </section>
  )
}
Product.initialState = { text: 'Warm light.', opened: 0 }
Product.${F.disclosureUses}
Product.intent = ({ DOM }) => ({ 'more.TOGGLE': DOM.keydown('document').key().filter(key => key === 'Enter') })
Product.model = { 'more.TOGGLE': (state) => (state.more.open ? { ...state, opened: state.opened + 1 } : ABORT) }
`,
  element: `import { ABORT } from 'sygnal'
const validate = (s) => (s.email.includes('@') ? {} : { email: 'Enter an email address' })
export function Signup({ state }) {
  return (
    <div>
      <label>Email <input className="email" value={state.email} /></label>
      <button className="submit">Sign up</button>
      <ul><li className="row">one</li></ul>
      <dialog className="help"><p>Help</p><button className="done">Done</button></dialog>
      <p className="status">{state.status}</p>
    </div>
  )
}
Signup.initialState = { email: '', errors: {}, status: '' }
Signup.intent = ({ DOM }) => ({
  EMAIL: DOM.input('.email').value(),
  SUBMIT: DOM.click('.submit'),
  CLOSE_HELP: DOM.click('.done'),
  HELP_CLOSED: ${F.domClose},
})
Signup.model = {
  EMAIL: (state, email) => ({ ...state, email }),
  ${F.submit},
  OPEN_HELP: { ELEMENT: { showModal: '.help' } },
  SHOW_ROW: { ELEMENT: ${F.scroll} },
  CLOSE_HELP: { ELEMENT: ${F.close} },
  HELP_CLOSED: (state) => ({ ...state, status: 'closed' }),
}
`,
  elementSkill: `import { ABORT } from 'sygnal'
const validate = (s) => (s.email.includes('@') ? {} : { email: 'Enter an email address' })
export function Signup({ state }) {
  return <label>Email <input className="email" value={state.email} /></label>
}
Signup.initialState = { email: '' }
Signup.intent = ({ DOM }) => ({ EMAIL: DOM.input('.email').value() })
Signup.model = {
  EMAIL: (state, email) => ({ ...state, email }),
  SUBMIT: { ${F.element} },
}
`,
  timers: `export function Clock({ state }) {
  return <p className="ticks">{state.ticks}</p>
}
Clock.initialState = { running: true, ticks: 0, last: null }
${F.timers}
Clock.model = {
  TICK: (state, data) => ({ ...state, ticks: state.ticks + 1, last: data }),
  STOP: (state) => ({ ...state, running: false }),
}
`,
  persist: `import { ABORT, persist } from 'sygnal'
export function App({ state }) {
  return (
    <div>
      <label>New todo <input className="draft" value={state.draft} /></label>
      <button className="add">Add</button>
      <button className="reset">Start over</button>
      <ul>{state.todos.map(todo => <li>{todo}</li>)}</ul>
    </div>
  )
}
App.initialState = { todos: [], filter: 'all', draft: '' }
App.intent = ({ DOM }) => ({ DRAFT: DOM.input('.draft').value(), ADD: DOM.click('.add'), RESET: DOM.click('.reset') })
App.model = {
  DRAFT: (state, draft) => ({ ...state, draft }),
  ADD: (state) => (state.draft ? { ...state, todos: [...state.todos, state.draft], draft: '' } : ABORT),
  RESET: { STATE: (state) => ({ ...state, todos: [] }), ${F.persistClear} },
}
${F.persist}
`,
  watch: `import { debounce } from 'sygnal'
export function Notes({ state }) {
  return <div><label>Notes <textarea className="notes" value={state.text} /></label><p className="saved">{state.saved}</p></div>
}
Notes.initialState = { text: '', saved: '' }
Notes.intent = ({ DOM, STATE }) => ({
  EDIT: DOM.input('.notes').value(),
  ${F.watch},
})
Notes.model = {
  EDIT: (state, text) => ({ ...state, text }),
  SAVE: (state, text) => ({ ...state, saved: text }),
}
`,
  uid: `export function EmailField({ state, uid }) {
  return (
    <p>
      ${F.uidLabel}Email</label>
      ${F.uidInput}
    </p>
  )
}
EmailField.initialState = {}
`,
  counter: `export function Counter({ state }) {
  return <div><span className="count">{state.count}</span><button className="inc">+</button></div>
}
Counter.initialState = { count: 0 }
Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
Counter.model = {
  INC: (state) => ({ ...state, count: state.count + 1 }),
  SET: (state, count) => ({ ...state, count }),
  SAME: (state) => state,
  MUTATE: (state) => { state.count = 99; return state },
}
`,
}

// ── the fragments are in the files ──────────────────────────────────────────

describe('every fragment is in its agent doc, verbatim', () => {
  for (const [name, [files, text]] of Object.entries(FRAGMENTS)) {
    for (const file of files) {
      it(`${name} (${file})`, () => { expect(FILES[file]).toContain(text) })
    }
  }
  it('the AddTodo and Search blocks are the same in llms.txt and SKILL.md', () => {
    expect(block('skill', 'function AddTodo')).toBe(block('llms', 'function AddTodo'))
    expect(block('skill', 'function Search')).toBe(block('llms', 'function Search'))
  })
  it('no "never return state" rule and no SYG502 left', () => {
    for (const text of Object.values(FILES)) {
      expect(text).not.toMatch(/never `return state`/)
      expect(text).not.toContain('SYG502')
    }
  })
})

// ── static: strict-clean and a11y-clean ─────────────────────────────────────

describe('sygnal-check --strict: no findings', () => {
  for (const [name, code] of Object.entries(MODULES)) {
    it(name, () => {
      const found = check(name, code)
      // SYG102 (info): fixture actions the tests drive with simulateAction (OPEN_HELP, STOP, SET …)
      expect(found.filter(f => !/^SYG102 /.test(f))).toEqual([])
    })
  }
  for (const marker of ['function AddTodo', 'function Search', 'function Chat']) {
    it(`llms.txt block: ${marker}`, () => {
      expect(check(marker.replace(/\W/g, '_'), block('llms', marker)).filter(f => /^SYG[57]\d\d /.test(f))).toEqual([])
    })
  }
})

// ── runtime ─────────────────────────────────────────────────────────────────

describe('changed code blocks', () => {
  it('AddTodo: labelled input; ADD with an empty draft is ABORT (no new state)', async () => {
    const mod = await load({ 'AddTodo.jsx': block('llms', 'function AddTodo') + '\nexport { AddTodo }\n' }, 'AddTodo.jsx')
    t = renderComponent(mod.AddTodo, { strict: true })
    await t.ready()
    expect(t.html()).toContain('aria-label="New todo"')
    const states = t.states.length
    t.simulateEvent('.add', 'click'); await t.settle()
    expect(t.states.length).toBe(states)
    t.simulateEvent('.draft', 'input', { value: 'milk' }); await t.next(s => s.draft === 'milk')
    t.simulateEvent('.add', 'click'); await t.next(s => s.todos.length === 1)
    expect(t.state.todos).toEqual([{ id: 1, text: 'milk' }])
    t.expectNoDiagnostics()
  })

  it('Search: labelled input; debounced request; RESULTS', async () => {
    vi.useFakeTimers()
    const mod = await load({ 'Search.jsx': block('llms', 'function Search') + '\nexport { Search }\n' }, 'Search.jsx')
    t = renderComponent(mod.Search, { strict: true })
    await t.ready()
    expect(t.html()).toContain('aria-label="Search"')
    t.simulateEvent('.q', 'input', { value: 'dune' })
    await t.next(s => s.status === 'Searching…')
    expect(t.requests('HTTP')).toHaveLength(1)
    await t.respond('HTTP', { results: [{ title: 'Dune' }] }, 'RESULTS')
    expect(t.state.results).toEqual([{ title: 'Dune' }])
    t.expectNoDiagnostics()
  })

  it('Chat: labelled input; connects, receives, sends', async () => {
    const mod = await load({ 'Chat.jsx': block('llms', 'function Chat') + '\nexport { Chat }\n' }, 'Chat.jsx')
    t = renderComponent(mod.Chat, { strict: true })
    await t.next(s => s.status === 'online')
    expect(t.html()).toContain('aria-label="Message"')
    await t.push('WS', { text: 'hi' })
    expect(t.state.messages).toEqual([{ text: 'hi' }])
    t.simulateEvent('.draft', 'input', { value: 'yo' }); await t.next(s => s.draft === 'yo')
    t.simulateEvent('.send', 'click'); await t.next(s => s.draft === '')
    expect(t.sent('WS')).toEqual([{ to: 'room', json: { text: 'yo' } }])
    t.expectNoDiagnostics()
  })
})

describe('behaviors', () => {
  it('pager with selector options: state.pager, calculated fields, pager.NEXT on a click', async () => {
    const { TaskList } = await load({ 'TaskList.jsx': MODULES.pager }, 'TaskList.jsx')
    t = renderComponent(TaskList)
    await t.ready()
    expect(t.state.pager).toMatchObject({ page: 0, pageSize: 10, offset: 0, hasPrev: false })
    t.simulateEvent('.newer', 'click'); await t.next(s => s.pager.page === 1)
    expect(t.state.pager).toMatchObject({ offset: 10, hasPrev: true })
    expect(t.actions.at(-1)).toMatchObject({ type: 'pager.NEXT', cause: 'behavior' })
    t.simulateEvent('.older', 'click'); await t.next(s => s.pager.page === 0)
    t.expectNoDiagnostics()
  })

  it('selection: item clicks by selector and data-id; isSelected', async () => {
    const { Inbox } = await load({ 'Inbox.jsx': MODULES.selection }, 'Inbox.jsx')
    t = renderComponent(Inbox, { dom: 'real' })
    await t.ready()
    t.simulateEvent('.pick[data-id="2"]', 'click'); await t.next(s => s.sel.count === 1)
    t.simulateEvent('.pick[data-id="1"]', 'click'); await t.next(s => s.sel.count === 2)
    expect(t.state.sel.selected).toEqual(['2', '1'])
    expect(t.query('.pick[data-id="1"]').getAttribute('aria-pressed')).toBe('true')
    t.simulateEvent('.pick[data-id="2"]', 'click'); await t.next(s => s.sel.count === 1)
    t.expectNoDiagnostics()
  })

  it('undo with selector options: history.UNDO / REDO, canUndo', async () => {
    const { Editor } = await load({ 'Editor.jsx': MODULES.undo }, 'Editor.jsx')
    t = renderComponent(Editor)
    await t.ready()
    expect(t.state.history.canUndo).toBe(false)
    t.simulateEvent('.note', 'input', { value: 'hello' }); await t.next(s => s.history.canUndo)
    t.simulateEvent('.undo', 'click'); await t.next(s => s.doc.text === '')
    expect(t.state.history.canRedo).toBe(true)
    t.simulateEvent('.redo', 'click'); await t.next(s => s.doc.text === 'hello')
    t.expectNoDiagnostics()
  })

  it('defineBehavior + uses with a selector; host intent and model under the namespaced name; simulateAction', async () => {
    const { Product } = await load({ 'Product.jsx': MODULES.disclosure }, 'Product.jsx')
    t = renderComponent(Product)
    await t.ready()
    expect(t.state.more).toEqual({ open: false })
    const states = t.states.length
    t.simulateEvent('.more', 'click'); await t.settle()                 // the host's intent replaced this trigger
    expect(t.states.length).toBe(states)
    t.simulateEvent('document', 'keydown', { key: 'Enter' }); await t.next(s => s.more.open)   // the host's trigger
    expect(t.state.opened).toBe(1)                                      // the host entry ran after the behavior's
    t.simulateEvent('document', 'keydown', { key: 'Enter' }); await t.next(s => !s.more.open)
    run(F.simulateMore, { t }); await t.next(s => s.more.open)
    expect(t.state.opened).toBe(2)
    expect(t.actions.at(-1)).toMatchObject({ type: 'more.TOGGLE', cause: 'simulateAction' })
    t.expectNoDiagnostics()
  })
})

describe('element commands', () => {
  it('SUBMIT focuses the invalid field; t.commands lists it (mock DOM)', async () => {
    const { Signup } = await load({ 'Signup.jsx': MODULES.element }, 'Signup.jsx')
    t = renderComponent(Signup)
    await t.ready()
    t.simulateEvent('.submit', 'click'); await t.next(s => !!s.errors.email); await t.settle()
    expect(run(F.commands, { t })).toEqual([{ focus: '.email' }])
    t.expectNoDiagnostics()
  })

  it('dom: real runs them: focus, scrollIntoView with options, showModal, close with returnValue, DOM.close', async () => {
    const { Signup } = await load({ 'Signup.jsx': MODULES.element }, 'Signup.jsx')
    t = renderComponent(Signup, { dom: 'real' })
    await t.ready()
    t.simulateEvent('.submit', 'click'); await t.next(s => !!s.errors.email); await t.settle()
    expect(document.activeElement).toBe(t.query('.email'))
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    t.simulateAction('SHOW_ROW'); await t.settle()
    expect(scroll.mock.calls).toEqual([[{ block: 'nearest' }]])
    expect(scroll.mock.instances[0]).toBe(t.query('.row'))
    t.simulateAction('OPEN_HELP'); await t.settle()
    expect(t.query('.help').open).toBe(true)
    t.simulateEvent('.done', 'click'); await t.next(s => s.status === 'closed')
    expect(t.query('.help').open).toBe(false)
    expect(t.query('.help').returnValue).toBe('done')
    t.simulateEvent('.email', 'input', { value: 'a@b.c' }); await t.next(s => s.email === 'a@b.c')
    const before = t.commands('ELEMENT').length
    t.simulateEvent('.submit', 'click'); await t.next(s => !s.errors.email); await t.settle()
    expect(t.commands('ELEMENT')).toHaveLength(before)   // valid: ABORT sends nothing
    t.expectNoDiagnostics()
  })

  it("SKILL.md's ELEMENT reducer", async () => {
    const { Signup } = await load({ 'Signup.jsx': MODULES.elementSkill }, 'Signup.jsx')
    t = renderComponent(Signup, { dom: 'real' })
    await t.ready()
    t.simulateAction('SUBMIT'); await t.settle()
    expect(document.activeElement).toBe(t.query('.email'))
    t.expectNoDiagnostics()
  })
})

describe('timers', () => {
  it('ticks with { n, t } while running; falsy stops; t.timers()', async () => {
    vi.useFakeTimers()
    const { Clock } = await load({ 'Clock.jsx': MODULES.timers }, 'Clock.jsx')
    t = renderComponent(Clock)
    await t.ready()
    expect(t.timers()).toEqual([{ name: 'tick', every: 1000, action: 'TICK', component: 'Clock' }])
    await vi.advanceTimersByTimeAsync(3000)
    expect(t.state.ticks).toBe(3)
    expect(t.state.last).toMatchObject({ n: 3 })
    expect(typeof t.state.last.t).toBe('number')
    t.simulateAction('STOP'); await t.next(s => !s.running)
    await vi.advanceTimersByTimeAsync(3000)
    expect(t.state.ticks).toBe(3)
    expect(t.timers()).toEqual([])
    t.expectNoDiagnostics()
  })

  it('run(App, { TIMER: makeTimerDriver() }) ticks in an app', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const app = `import { run, makeTimerDriver } from 'sygnal'
import { Clock as App } from './Clock.jsx'
export const instance = ${F.timerRun}
`
    const { instance } = await load({ 'Clock.jsx': MODULES.timers, 'main.js': app }, 'main.js')
    try {
      await until(() => document.querySelector('.ticks')?.textContent === '1', 'one tick', 3000)
    } finally {
      instance.dispose()
    }
  })
})

describe('persist', () => {
  it('restores the seeded keys, saves picked keys, PERSIST clear removes the copy', async () => {
    const { App } = await load({ 'App.jsx': MODULES.persist }, 'App.jsx')
    const storage = { 'todo-app': { version: 1, state: { todos: ['milk'] } } }
    t = renderComponent(App, { storage })
    await t.ready()
    expect(t.state.todos).toEqual(['milk'])
    t.dispose()
    t = run(F.persistTest, { renderComponent, App })
    await t.ready()
    expect(t.state.todos).toEqual([])
    t.simulateEvent('.draft', 'input', { value: 'eggs' }); await t.next(s => s.draft === 'eggs')
    t.simulateEvent('.add', 'click'); await t.next(s => s.todos.length === 1)
    await t.settle()
    expect(run(F.persistRead, { t })).toEqual({ version: 1, state: { todos: ['eggs'], filter: 'all' } })
    t.simulateEvent('.reset', 'click'); await t.next(s => s.todos.length === 0)
    await t.settle()
    expect(t.storage('todo-app') ?? null).toBeNull()
    t.expectNoDiagnostics()
  })
})

describe('STATE.watch, uid, onError, t.actions, same-object "no change"', () => {
  it('STATE.watch: SAVE gets the text once, a second after typing stops', async () => {
    vi.useFakeTimers()
    const { Notes } = await load({ 'Notes.jsx': MODULES.watch }, 'Notes.jsx')
    t = renderComponent(Notes)
    await t.ready()
    t.simulateEvent('.notes', 'input', { value: 'a' }); await t.next(s => s.text === 'a')
    t.simulateEvent('.notes', 'input', { value: 'ab' }); await t.next(s => s.text === 'ab')
    expect(t.state.saved).toBe('')
    await t.next(s => s.saved === 'ab')
    const saves = t.actions.filter(a => a.type === 'SAVE')
    expect(saves.map(a => a.data)).toEqual(['ab'])
    expect(saves[0].at - t.actions.filter(a => a.type === 'EDIT').at(-1).at).toBeGreaterThanOrEqual(1000)
    t.expectNoDiagnostics()
  })

  it('uid: label for and input id match', async () => {
    const { EmailField } = await load({ 'EmailField.jsx': MODULES.uid }, 'EmailField.jsx')
    t = renderComponent(EmailField, { dom: 'real' })
    await t.ready()
    expect(t.query('label').getAttribute('for')).toBe(t.query('input').id)
    expect(t.query('input').id).not.toBe('')
  })

  it("run(…, { onError }): (error, { componentName, action, phase })", async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const main = `import { run } from 'sygnal'
function App({ state }) { return <p>{state.n}</p> }
App.initialState = { n: 0 }
App.model = { BOOTSTRAP: () => { throw new Error('boom') } }
export const reported = []
export const instance = run(App, {}, { onError: (error, { componentName, action, phase }) => reported.push({ message: error.message, componentName, action, phase }) })
`
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { reported, instance } = await load({ 'main.jsx': main }, 'main.jsx')
    try {
      await until(() => reported.length > 0, 'the reducer error')
      expect(reported[0]).toEqual({ message: 'boom', componentName: 'App', action: 'BOOTSTRAP', phase: 'reducer' })
    } finally {
      instance.dispose()
    }
  })

  it('t.actions and t.explain; returning the same state is no change; a mutation is SYG222', async () => {
    const { Counter } = await load({ 'Counter.jsx': MODULES.counter }, 'Counter.jsx')
    t = renderComponent(Counter)
    await t.ready()
    t.simulateEvent('.inc', 'click')
    t.simulateAction('SET', 5)
    await t.waitForState(s => s.count === 5)
    expect(t.actions.map(a => [a.type, a.cause])).toEqual([['INITIALIZE', 'built-in'], ['INC', 'intent'], ['SET', 'simulateAction']])
    expect(t.actions[1]).toMatchObject({ component: 'Counter', sinks: ['STATE'] })
    expect(run(F.explain, { t })).toMatchObject({ type: 'SET', cause: 'simulateAction', state: { count: 5 } })
    const states = t.states.length
    t.simulateAction('SAME'); await t.settle()
    expect(t.states.length).toBe(states)
    expect(t.actions.at(-1)).toMatchObject({ type: 'SAME', sinks: [] })
    t.expectNoDiagnostics()
    t.simulateAction('MUTATE'); await t.settle()
    expect(t.states.length).toBe(states)
    expect(t.diagnostics.map(d => d.code)).toContain('SYG222')
  })
})
