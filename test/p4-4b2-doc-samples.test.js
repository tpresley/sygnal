// @vitest-environment jsdom
// PLAN-4 4-B part 2: the code samples of the site docs for element commands, timers, DevTools and
// the reference pages, run verbatim (PLAN-4 §1.4). Each SAMPLES entry is the exact code block of
// its docs page (the "in the docs" test checks that the page still contains it), compiled with
// the automatic JSX runtime (jsxImportSource 'sygnal', as sygnal/vite does), imported against the
// built package (dist: run `npm run build` first) and exercised. Fragments get a prelude
// (fixtures, imports) and an epilogue (exports) here; the sample text itself is unchanged. Every
// sample is also checked with `sygnal-check --strict` (no strict SYG5xx or a11y SYG7xx finding,
// as scripts/check-doc-samples.mjs requires; whole components: no finding at all). Signature
// blocks (reference pages) are parsed and their function names checked against the exports.
//
// The recipes of 3-A (test/p4-3a-recipes.test.js) and 3-C (test/p4-3c-recipe.test.js) run in
// their own tests; here they are checked to be on their pages verbatim, and the testing samples
// run against them. The "Copy as test" sample is test/copied/signup-form.copied.test.js (run by
// vitest itself), checked to be on the debugging page verbatim.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import 'sygnal/diagnostics'
import * as sygnal from 'sygnal'
import { renderComponent } from 'sygnal'
import { checkFiles } from '../sygnal-check/src/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const docs = path.join(repo, 'docs/src/content/docs')

export const SAMPLES = {
  ecIntro: { page: 'guide/element-commands.md', lang: 'jsx', code: `Signup.model = {
  SUBMIT: {
    STATE: (state) => ({ ...state, errors: validate(state) }),
    ELEMENT: (state) => (validate(state).email ? { focus: '.email' } : ABORT),
  },
  OPEN_HELP: { ELEMENT: { showModal: '.help' } },
}
` },
  ecCommands: { page: 'guide/element-commands.md', lang: 'jsx', code: `Form.model = {
  EDIT_EMAIL:   { ELEMENT: { focus: '.email' } },                          // email.focus({})
  QUIET_FOCUS:  { ELEMENT: { focus: '.email', preventScroll: true } },     // email.focus({ preventScroll: true })
  SHOW_LAST:    { ELEMENT: { scrollIntoView: '.row', block: 'nearest' } }, // row.scrollIntoView({ block: 'nearest' })
  CLOSE_HELP:   { ELEMENT: { close: '.help', returnValue: 'done' } },      // dialog.close('done')
}
` },
  ecArray: { page: 'guide/element-commands.md', lang: 'jsx', code: `Search.model = {
  // put the cursor in the search box and select what is in it
  EDIT_QUERY: { ELEMENT: [{ focus: '.query' }, { select: '.query' }] },
}
` },
  ecRegistry: { page: 'guide/element-commands.md', lang: 'ts', code: `// sygnal-commands.d.ts
import 'sygnal'

declare module 'sygnal' {
  interface ElementCommandRegistry { play: {}; showPicker: {} }
}
` },
  focusInvalid: { page: 'guide/element-commands.md', lang: 'jsx', code: `import { ABORT } from 'sygnal'

const validate = ({ name, email }) => ({
  ...(name.trim() ? {} : { name: 'Enter your name' }),
  ...(email.includes('@') ? {} : { email: 'Enter an email address' }),
})

export function Signup({ state }) {
  return (
    <form>
      <label>Name <input className="name" value={state.name} /></label>
      {state.errors.name && <p className="error">{state.errors.name}</p>}
      <label>Email <input className="email" type="email" value={state.email} /></label>
      {state.errors.email && <p className="error">{state.errors.email}</p>}
      <button className="submit" type="button">Sign up</button>
    </form>
  )
}

Signup.initialState = { name: '', email: '', errors: {} }

Signup.intent = ({ DOM }) => ({
  NAME: DOM.input('.name').value(),
  EMAIL: DOM.input('.email').value(),
  SUBMIT: DOM.click('.submit'),
})

Signup.model = {
  NAME: (state, name) => ({ ...state, name }),
  EMAIL: (state, email) => ({ ...state, email }),
  SUBMIT: {
    STATE: (state) => ({ ...state, errors: validate(state) }),
    // runs after the errors have rendered; the first invalid field gets the focus
    ELEMENT: (state) => {
      const errors = validate(state)
      if (errors.name) return { focus: '.name' }
      if (errors.email) return { focus: '.email' }
      return ABORT
    },
  },
}
` },
  dialog: { page: 'guide/element-commands.md', lang: 'jsx', code: `export function Help({ state }) {
  return (
    <div>
      <button className="open-help">Keyboard shortcuts</button>
      <dialog className="help">
        <h2>Keyboard shortcuts</h2>
        <p>Press N for a new card.</p>
        <button className="close-help">Close</button>
      </dialog>
      <p className="status">{state.status}</p>
    </div>
  )
}

Help.initialState = { status: 'Help is closed' }

Help.intent = ({ DOM }) => ({
  OPEN_HELP: DOM.click('.open-help'),
  CLOSE_HELP: DOM.click('.close-help'),
  // close doesn't bubble; Sygnal listens on the dialog itself (Escape closes it too)
  HELP_CLOSED: DOM.close('.help'),
})

Help.model = {
  OPEN_HELP: {
    STATE: (state) => ({ ...state, status: 'Help is open' }),
    ELEMENT: { showModal: '.help' },
  },
  CLOSE_HELP: { ELEMENT: { close: '.help', returnValue: 'done' } },
  HELP_CLOSED: (state) => ({ ...state, status: 'Help is closed' }),
}
` },
  scrollRow: { page: 'guide/element-commands.md', lang: 'jsx', code: `import { ABORT, Collection } from 'sygnal'

function TaskRow({ state }) {
  return <li className="row">{state.text}</li>
}

TaskRow.model = {
  // only rows added by ADD scroll; the ones there at the start don't
  BOOTSTRAP: { ELEMENT: (state) => (state.added ? { scrollIntoView: '.row', block: 'nearest' } : ABORT) },
}

export function TaskList() {
  return (
    <div>
      <button className="add-task">Add a task</button>
      <ul>
        <Collection of={TaskRow} from="tasks" />
      </ul>
    </div>
  )
}

TaskList.initialState = { tasks: [{ id: 1, text: 'Water the plants' }] }

TaskList.intent = ({ DOM }) => ({ ADD: DOM.click('.add-task') })

TaskList.model = {
  ADD: (state) => {
    const id = state.tasks.length + 1
    return { ...state, tasks: [...state.tasks, { id, text: \`Task \${id}\`, added: true }] }
  },
}
` },
  ecTest: { page: 'guide/element-commands.md', lang: 'jsx', code: `// @vitest-environment jsdom
import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import { Signup } from './Signup.jsx'

let t
afterEach(() => t?.dispose())

it('asks for the focus on the first invalid field', async () => {
  t = renderComponent(Signup)
  await t.ready()
  t.simulateEvent('.submit', 'click')
  await t.next(s => !!s.errors.name)
  await t.settle()
  expect(t.commands('ELEMENT')).toEqual([{ focus: '.name' }])
})

it('moves the focus there (real DOM)', async () => {
  t = renderComponent(Signup, { dom: 'real' })
  await t.ready()
  t.simulateEvent('.submit', 'click')
  await t.next(s => !!s.errors.name)
  await t.settle()
  expect(document.activeElement).toBe(t.query('.name'))
})
` },
  tIntro: { page: 'guide/timers.md', lang: 'jsx', code: `Stopwatch.timers = (state) => ({
  tick: state.running && { every: 100, action: 'TICK' },
})
` },
  tSetup: { page: 'guide/timers.md', lang: 'jsx', code: `import { run, makeTimerDriver } from 'sygnal'
import App from './App.jsx'

run(App, { TIMER: makeTimerDriver() })
` },
  tShape: { page: 'guide/timers.md', lang: 'jsx', code: `Game.timers = (state) => ({
  tick: state.running && { every: 100, action: 'TICK' },
  done: state.armed && { after: 5000, action: 'EXPIRE' },
  frame: state.animating && { frame: 'FRAME' },
})
` },
  stopwatch: { page: 'guide/timers.md', lang: 'jsx', code: `const pad = (n) => String(n).padStart(2, '0')
const format = (ms) => {
  const tenths = Math.floor(ms / 100)
  return \`\${pad(Math.floor(tenths / 600))}:\${pad(Math.floor(tenths / 10) % 60)}.\${tenths % 10}\`
}

// the running time at clock time \`at\`: the finished runs plus the current one
const elapsed = (state, at) => state.done + (state.status === 'running' ? at - state.since : 0)

export function Stopwatch({ state }) {
  const label = { idle: 'Start', running: 'Pause', paused: 'Resume' }[state.status]
  return (
    <section className="stopwatch">
      <p className="time">{format(elapsed(state, state.now))}</p>
      <button className="toggle">{label}</button>
      <button className="lap" disabled={state.status !== 'running'}>Lap</button>
      <button className="reset" disabled={state.status !== 'paused'}>Reset</button>
      <ol className="laps">
        {state.laps.map((lap, i) => <li>{\`Lap \${i + 1}: \${format(lap)}\`}</li>)}
      </ol>
    </section>
  )
}

const INITIAL = { status: 'idle', done: 0, since: 0, now: 0, lapStart: 0, laps: [] }

Stopwatch.initialState = INITIAL
// a tick every 100 ms while running; stopped when it pauses, resets or unmounts
Stopwatch.timers = (state) => ({ tick: state.status === 'running' && { every: 100, action: 'TICK' } })
Stopwatch.intent = ({ DOM }) => ({
  TOGGLE: DOM.click('.toggle').map(() => Date.now()),
  LAP: DOM.click('.lap').map(() => Date.now()),
  RESET: DOM.click('.reset'),
})
Stopwatch.model = {
  TOGGLE: (state, at) => state.status === 'running'
    ? { ...state, status: 'paused', done: elapsed(state, at), now: at }
    : { ...state, status: 'running', since: at, now: at },
  TICK: (state, { t }) => ({ ...state, now: t }),
  LAP: (state, at) => {
    const total = elapsed(state, at)
    return { ...state, now: at, laps: [...state.laps, total - state.lapStart], lapStart: total }
  },
  RESET: () => INITIAL,
}
` },
  tBackground: { page: 'guide/timers.md', lang: 'jsx', code: `Inbox.timers = () => ({
  // keeps checking for new mail while another page is shown
  poll: { every: 30000, action: 'CHECK_MAIL', background: true },
})
` },
  tTest: { page: 'guide/timers.md', lang: 'jsx', code: `// @vitest-environment jsdom
import { it, expect, afterEach, vi } from 'vitest'
import { renderComponent } from 'sygnal'
import { Stopwatch } from './Stopwatch.jsx'

let t
afterEach(() => {
  t?.dispose()
  vi.useRealTimers()
})

it('ticks while running and stops when paused', async () => {
  vi.useFakeTimers()
  t = renderComponent(Stopwatch)
  await t.ready()
  expect(t.timers()).toEqual([])

  t.simulateEvent('.toggle', 'click')
  await t.next(s => s.status === 'running')
  expect(t.timers()).toEqual([{ name: 'tick', every: 100, action: 'TICK', component: 'Stopwatch' }])

  await vi.advanceTimersByTimeAsync(1000)
  expect(t.state.now - t.state.since).toBe(1000)

  t.simulateEvent('.toggle', 'click')
  await t.next(s => s.status === 'paused')
  expect(t.timers()).toEqual([])
})
` },
  copiedTest: { page: 'integration/debugging.md', lang: 'javascript', code: `// Copied from a sygnal/devtools session of SignupForm (7 recorded actions, 6 replayed)
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import SignupForm from './signup-form.js'

it('signup form: a recorded session with replies replays (copied from sygnal/devtools)', async () => {
  const t = renderComponent(SignupForm)
  try {
    await t.ready()
    t.simulateAction('EMAIL', 'ada')
    // SUBMIT: DOM event/element data as a stub (type, key, target dataset/value/checked/id)
    t.simulateAction('SUBMIT', { type: 'click' })
    await t.fail('HTTP', 422, { request: (r) => r.error === 'SIGNUP_FAILED', body: { message: 'Email is invalid' } })
    t.simulateAction('EMAIL', 'ada@example.com')
    // SUBMIT: DOM event/element data as a stub (type, key, target dataset/value/checked/id)
    t.simulateAction('SUBMIT', { type: 'click' })
    await t.respond('HTTP', { id: 1, name: 'Ada', email: 'ada@example.com' }, 'SIGNED_UP')
    await t.settle()
    expect(t.state).toEqual({
      email: 'ada@example.com',
      saving: false,
      user: { id: 1, name: 'Ada', email: 'ada@example.com' },
      error: null,
    })
  } finally {
    t.dispose()
  }
})
` },
  dtConfigure: { page: 'integration/debugging.md', lang: 'javascript', code: `import { getDevTools } from 'sygnal/devtools'

getDevTools().configureCopyAsTest({
  componentImport: "import App from './App.jsx'",
  imports: ["import { mockDragDriver } from './test-helpers.js'"],
  drivers: { DND: 'mockDragDriver().driver' },
  environment: 'jsdom',
})
` },
  dtFromCode: { page: 'integration/debugging.md', lang: 'javascript', code: `// main.dev.js: the development entry
import { copyAsTest, getActions } from 'sygnal/devtools'
import { run } from 'sygnal'
import App from './App.jsx'

const app = run(App)

// in the browser console: actions() lists what happened, copyTest() prints it as a test
window.actions = () => console.table(getActions({ cause: 'intent' }).map(a => ({ type: a.type, component: a.component, sinks: a.sinks.join(' ') })))
window.copyTest = () => console.log(copyAsTest(app, { componentImport: "import App from './App.jsx'", environment: 'jsdom' }))
` },
  dtVite: { page: 'integration/debugging.md', lang: 'javascript', code: `// vite.config.js
import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [sygnal({ devtools: { redux: true } })],
})
` },
  dtRedux: { page: 'integration/debugging.md', lang: 'javascript', code: `// main.dev.js: the development entry
import { connectReduxDevtools } from 'sygnal/devtools'
import { run } from 'sygnal'
import App from './App.jsx'

const app = run(App)
connectReduxDevtools(app, { name: 'My app' })
` },
  uIsSelected: { page: 'reference/utilities.md', lang: 'typescript', code: `function isSelected(slice: { selected: string[] } | null | undefined, id: string | number): boolean
` },
  uUndoable: { page: 'reference/utilities.md', lang: 'typescript', code: `function undoable(model: Model, options: { key: string; limit?: number; track?: string[]; coalesceMs?: number; resetOn?: string[] }): Model
` },
  apiElementType: { page: 'reference/api.md', lang: 'typescript', code: `// the value of an ELEMENT entry: a command, an array of them, or a reducer returning either (or ABORT)
type ElementSinkValue =
  | ElementCommand
  | ElementCommand[]
  | ((state, data, next, props) => ElementCommand | ElementCommand[] | typeof ABORT)
// ElementCommand: { <method>: target, ...options }; target: a control or a selector
` },
  apiDefineBehavior: { page: 'reference/api.md', lang: 'typescript', code: `function defineBehavior(definition: {
  initialState: Slice;
  intent?: (sources, options) => { [action: string]: Stream<any> };
  model?: { [action: string]: Reducer | { [sink: string]: Reducer } };   // reducers get the slice
  calculated?: { [field: string]: (slice) => any };
}): (options?) => Behavior
` },
  apiPager: { page: 'reference/api.md', lang: 'typescript', code: `function pager(options?: { pageSize?: number; page?: number; total?: number | null; next?: Control | string; prev?: Control | string }): Behavior
` },
  apiSelection: { page: 'reference/api.md', lang: 'typescript', code: `function selection(options?: { multi?: boolean; item?: Control | string; all?: Control | string; clear?: Control | string; attr?: string; from?: string; idField?: string }): Behavior
function isSelected(slice: { selected: string[] }, id: string | number): boolean
` },
  apiUndo: { page: 'reference/api.md', lang: 'typescript', code: `function undo(options: { key: string; limit?: number; track?: string[]; coalesceMs?: number; resetOn?: string[]; undo?: Control | string; redo?: Control | string }): Behavior
function undoable(model: Model, options: { key: string; limit?: number; track?: string[]; coalesceMs?: number; resetOn?: string[] }): Model
` },
  apiTimerDriver: { page: 'reference/api.md', lang: 'typescript', code: `function makeTimerDriver(): Driver
` },
  apiTimerRun: { page: 'reference/api.md', lang: 'javascript', code: `run(App, { TIMER: makeTimerDriver() })
` },
  apiTimersStatic: { page: 'reference/api.md', lang: 'typescript', code: `// (state: State & Calculated) => { [name]: spec | falsy }
Stopwatch.timers = (state) => ({
  tick: state.running && { every: 100, action: 'TICK' },
})
` },
  apiUid: { page: 'reference/api.md', lang: 'typescript', code: `function uid(): string               // this instance's id, e.g. 'u'
function uid(name: string): string   // an id derived from it, e.g. 'u-email'
` },
  apiWatchSig: { page: 'reference/api.md', lang: 'typescript', code: `interface StateSource<State> {
  watch<T>(selector: (state: State) => T, options?: { immediate?: boolean }): Stream<T>
}
` },
  apiWatch: { page: 'reference/api.md', lang: 'jsx', code: `Notes.intent = ({ STATE }) => ({
  SAVE: STATE.watch(state => state.text).compose(debounce(1000)),
})
` },
  apiRunTimer: { page: 'reference/api.md', lang: 'javascript', code: `// With timers (the timers static needs its driver)
import { makeTimerDriver } from 'sygnal'
run(RootComponent, { TIMER: makeTimerDriver() })
` },
}

let dir
let n = 0
const compile = (src, file) => ts.transpileModule(src, { fileName: file, compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'sygnal', module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, allowJs: true,
} }).outputText.replace(/^((?:import|export)\b[^'"\n]*['"]\.{1,2}\/[^'"\n]+?)\.jsx?(['"])/gm, '$1.mjs$2')

// Write `files` ({ 'rel/path.jsx': source }) into a fresh folder, .js/.jsx compiled to .mjs next to
// them (`shims` repoints bare imports of the compiled output); import `main` from it
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
  const mod = await import(pathToFileURL(path.join(base, main.replace(/\.jsx?$/, '.mjs'))).href)
  return { mod, base }
}

// A sample that is a test file: its it() / afterEach() are collected by a shim (the import
// specifier 'vitest' is pointed at it; the sample is unchanged) and run here, in order
const VITEST_SHIM = `export { expect, vi } from 'vitest'
export const registered = { tests: [], after: [] }
export const it = (name, fn) => { registered.tests.push([name, fn]) }
export const afterEach = (fn) => { registered.after.push(fn) }
`
async function runTestFile(files, main) {
  const { base } = await load({ ...files, 'vitest-shim.mjs': VITEST_SHIM }, main, { vitest: './vitest-shim.mjs' })
  const { registered } = await import(pathToFileURL(path.join(base, 'vitest-shim.mjs')).href)
  for (const [, fn] of registered.tests) {
    try { await fn() } finally { for (const f of registered.after) await f() }
  }
  return registered.tests.map(([name]) => name)
}

// sygnal-check --strict on one sample, as check-doc-samples does (a file of its own)
function check(name, code, ext = '.jsx') {
  const file = path.join(dir, 'check', name + ext)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, code)
  return checkFiles([file], { cwd: path.dirname(file), strict: true }).map(d => `${d.code} ${d.message}`)
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(here, '.p4-4b2-samples-'))
  // 'vite' for the vite.config.js sample (defineConfig is the identity in Vite)
  const nm = path.join(dir, 'node_modules')
  fs.mkdirSync(path.join(nm, 'vite'), { recursive: true })
  fs.writeFileSync(path.join(nm, 'vite/package.json'), JSON.stringify({ name: 'vite', type: 'module', exports: './index.js' }))
  fs.writeFileSync(path.join(nm, 'vite/index.js'), 'export const defineConfig = (config) => config\n')
})
afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }) })

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; vi.useRealTimers(); vi.restoreAllMocks() })

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const until = async (cond, what, ms = 3000) => {
  for (const end = Date.now() + ms; !cond(); await sleep(5)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
  }
}
const advance = (ms) => vi.advanceTimersByTimeAsync(ms)

// ── the samples are in their docs pages ─────────────────────────────────────

// a template literal of a recipe test file, as its source text
const unescape = (s) => s.replace(/\\`/g, '`').replace(/\\\$/g, '$').replace(/\\\\/g, '\\')

describe('every sample is in its docs page, verbatim', () => {
  for (const [name, { page, code }] of Object.entries(SAMPLES)) {
    it(`${name} (${page})`, () => {
      expect(fs.readFileSync(path.join(docs, page), 'utf8')).toContain(code)
    })
  }

  it("3-A's recipes are guide/element-commands' samples", () => {
    const src = fs.readFileSync(path.join(here, 'p4-3a-recipes.test.js'), 'utf8')
    const found = Object.fromEntries([...src.matchAll(/^  (\w+): `([\s\S]*?)(?<!\\)`,$/gm)].map(m => [m[1], unescape(m[2])]))
    expect(Object.keys(found)).toEqual(['focusInvalid', 'dialog'])
    expect(SAMPLES.focusInvalid.code).toBe(found.focusInvalid)
    expect(SAMPLES.dialog.code).toBe(found.dialog)
  })

  it("3-C's recipe is guide/timers' stopwatch", () => {
    const src = fs.readFileSync(path.join(here, 'p4-3c-recipe.test.js'), 'utf8')
    const m = src.match(/^export const RECIPE = `([\s\S]*?)(?<!\\)`$/m)
    expect(SAMPLES.stopwatch.code).toBe(unescape(m[1]))
  })

  it("the copied test on the debugging page is 3-E's committed signup-form test", () => {
    expect(SAMPLES.copiedTest.code).toBe(fs.readFileSync(path.join(here, 'copied/signup-form.copied.test.js'), 'utf8'))
  })
})

// ── static: strict-clean and a11y-clean ─────────────────────────────────────

// samples that are whole modules or components (any finding fails); the rest are fragments
// (only SYG5xx / SYG7xx fail, as in check-doc-samples)
const WHOLE = new Set(['focusInvalid', 'dialog', 'scrollRow', 'stopwatch'])
const SIGNATURES = new Set(['apiElementType', 'apiDefineBehavior', 'apiPager', 'apiSelection', 'apiUndo', 'apiTimerDriver', 'apiUid', 'apiWatchSig', 'uIsSelected', 'uUndoable'])

describe('sygnal-check --strict: no strict or a11y findings', () => {
  for (const [name, { code, lang }] of Object.entries(SAMPLES)) {
    it(name, () => {
      const found = check(name, code, /^t/.test(lang) ? '.tsx' : '.jsx')
      expect(WHOLE.has(name) ? found : found.filter(f => /^SYG[57]\d\d /.test(f))).toEqual([])
    })
  }
})

describe('reference signatures: valid TypeScript, naming real exports', () => {
  for (const name of SIGNATURES) {
    it(name, () => {
      const { code } = SAMPLES[name]
      const sf = ts.createSourceFile(name + '.ts', code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
      expect(sf.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([])
      const fns = [...code.matchAll(/^function (\w+)/gm)].map(m => m[1]).filter(f => f !== 'uid')   // uid is a prop
      for (const f of fns) expect(typeof sygnal[f], f).toBe('function')
    })
  }
})

// ── guide/element-commands ──────────────────────────────────────────────────

describe('guide/element-commands', () => {
  it('the intro: focus the invalid email; open the help dialog', async () => {
    const prelude = `import { ABORT } from 'sygnal'
const validate = (state) => (state.email.includes('@') ? {} : { email: 'Enter an email address' })
function Signup({ state }) {
  return <div><label>Email <input className="email" value={state.email} /></label><dialog className="help"><p>Help</p></dialog></div>
}
Signup.initialState = { email: '', errors: {} }
`
    const { mod } = await load({ 'Signup.jsx': prelude + SAMPLES.ecIntro.code + '\nexport { Signup }\n' }, 'Signup.jsx')
    t = renderComponent(mod.Signup, { dom: 'real' })
    await t.ready()
    t.simulateAction('SUBMIT'); await t.next(s => !!s.errors.email); await t.settle()
    expect(document.activeElement).toBe(t.query('.email'))
    t.simulateAction('OPEN_HELP'); await t.settle()
    expect(t.query('.help').open).toBe(true)
    t.expectNoDiagnostics()
  })

  it('the command objects: options as one object; close gets returnValue', async () => {
    const prelude = `function Form() {
  return <div><label>Email <input className="email" /></label><ul><li className="row">one</li></ul><dialog className="help"><p>Help</p></dialog></div>
}
Form.initialState = {}
`
    const { mod } = await load({ 'Form.jsx': prelude + SAMPLES.ecCommands.code + '\nexport { Form }\n' }, 'Form.jsx')
    t = renderComponent(mod.Form, { dom: 'real' })
    await t.ready()
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    t.simulateAction('EDIT_EMAIL'); await t.settle()
    t.simulateAction('QUIET_FOCUS'); await t.settle()
    expect(focus.mock.calls).toEqual([[{}], [{ preventScroll: true }]])
    expect(focus.mock.instances[0]).toBe(t.query('.email'))
    t.simulateAction('SHOW_LAST'); await t.settle()
    expect(scroll.mock.calls).toEqual([[{ block: 'nearest' }]])
    const dialog = t.query('.help')
    dialog.showModal()
    t.simulateAction('CLOSE_HELP'); await t.settle()
    expect(dialog.open).toBe(false)
    expect(dialog.returnValue).toBe('done')
    t.expectNoDiagnostics()
  })

  it('an array: focus, then select the query', async () => {
    const prelude = `function Search({ state }) { return <label>Search <input className="query" value={state.q} /></label> }
Search.initialState = { q: 'sygnal' }
`
    const { mod } = await load({ 'Search.jsx': prelude + SAMPLES.ecArray.code + '\nexport { Search }\n' }, 'Search.jsx')
    t = renderComponent(mod.Search, { dom: 'real' })
    await t.ready()
    t.simulateAction('EDIT_QUERY'); await t.settle()
    const q = t.query('.query')
    expect(document.activeElement).toBe(q)
    expect([q.selectionStart, q.selectionEnd]).toEqual([0, 6])
    expect(t.commands('ELEMENT').map(c => Object.keys(c)[0])).toEqual(['focus', 'select'])
  })

  it('ElementCommandRegistry: the augmentation types another method (tsc)', () => {
    const files = {
      'sygnal-commands.d.ts': SAMPLES.ecRegistry.code,
      'player.tsx': `import type { Component } from 'sygnal'
export const Video: Component<{}> = () => <div><video className="player" /></div>
Video.model = { PLAY: { ELEMENT: { play: '.player' } }, PICK: { ELEMENT: { showPicker: '.date' } } }
`,
    }
    const base = path.join(dir, 'tsc')
    fs.mkdirSync(base, { recursive: true })
    for (const [f, src] of Object.entries(files)) fs.writeFileSync(path.join(base, f), src)
    const options = {
      target: ts.ScriptTarget.ES2020, lib: ['lib.es2021.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, noEmit: true, skipLibCheck: true, jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: 'sygnal', baseUrl: base,
      paths: { sygnal: [path.join(repo, 'src/index.d.ts')], 'sygnal/jsx-runtime': [path.join(repo, 'src/jsx-runtime.d.ts')], xstream: [path.join(repo, 'node_modules/xstream')], 'xstream/*': [path.join(repo, 'node_modules/xstream/*')] },
    }
    const errors = (names) => ts.getPreEmitDiagnostics(ts.createProgram(names.map(f => path.join(base, f)), options))
      .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
    expect(errors(['sygnal-commands.d.ts', 'player.tsx'])).toEqual([])
    // without the augmentation, play is not a command
    expect(errors(['player.tsx']).length).toBeGreaterThan(0)
  }, 30_000)

  it('scroll a new row into view: only the added row scrolls itself, with its options', async () => {
    const { mod } = await load({ 'TaskList.jsx': SAMPLES.scrollRow.code }, 'TaskList.jsx')
    t = renderComponent(mod.TaskList, { dom: 'real' })
    await t.ready()
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
    t.simulateEvent('.add-task', 'click')
    await t.waitForState(s => s.tasks.length === 2)
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(spy.mock.instances[0]).toBe(t.queryAll('.row')[1])
    expect(spy.mock.calls[0]).toEqual([{ block: 'nearest' }])
    expect(t.queryAll('.row').map(r => r.textContent)).toEqual(['Water the plants', 'Task 2'])
    await t.settle()
    expect(spy).toHaveBeenCalledTimes(1)
    t.expectNoDiagnostics()
  })

  it('the testing sample runs against the focus recipe (mock DOM and dom: real)', async () => {
    const names = await runTestFile({ 'Signup.jsx': SAMPLES.focusInvalid.code, 'Signup.test.jsx': SAMPLES.ecTest.code }, 'Signup.test.jsx')
    expect(names).toEqual(['asks for the focus on the first invalid field', 'moves the focus there (real DOM)'])
  })
})

// ── guide/timers ────────────────────────────────────────────────────────────

describe('guide/timers', () => {
  it('the intro: a tick every 100 ms while running', async () => {
    vi.useFakeTimers()
    const prelude = `function Stopwatch({ state }) { return <p>{state.ticks}</p> }
Stopwatch.initialState = { running: true, ticks: 0 }
Stopwatch.model = {
  TICK: (state) => ({ ...state, ticks: state.ticks + 1 }),
  STOP: (state) => ({ ...state, running: false }),
}
`
    const { mod } = await load({ 'Stopwatch.jsx': prelude + SAMPLES.tIntro.code + '\nexport { Stopwatch }\n' }, 'Stopwatch.jsx')
    t = renderComponent(mod.Stopwatch)
    await t.ready()
    await advance(1000)
    expect(t.state.ticks).toBe(10)
    t.simulateAction('STOP'); await t.next(s => !s.running)
    await advance(1000)
    expect(t.state.ticks).toBe(10)
    expect(t.timers()).toEqual([])
  })

  it('the static: every { n, t }, after { t } once, frame { t, dt }', async () => {
    vi.useFakeTimers()
    const prelude = `function Game({ state }) { return <p>{state.log.length}</p> }
Game.initialState = { running: false, armed: false, animating: false, log: [] }
Game.model = {
  RUN: (state) => ({ ...state, running: true }),
  ARM: (state) => ({ ...state, armed: true }),
  ANIMATE: (state) => ({ ...state, animating: true }),
  TICK: (state, data) => ({ ...state, running: data.n < 2, log: [...state.log, ['TICK', data]] }),
  EXPIRE: (state, data) => ({ ...state, log: [...state.log, ['EXPIRE', data]] }),
  FRAME: (state, data) => ({ ...state, animating: state.log.filter(([type]) => type === 'FRAME').length < 2, log: [...state.log, ['FRAME', data]] }),
}
`
    const { mod } = await load({ 'Game.jsx': prelude + SAMPLES.tShape.code + '\nexport { Game }\n' }, 'Game.jsx')
    t = renderComponent(mod.Game)
    await t.ready()
    expect(t.timers()).toEqual([])
    t.simulateAction('RUN'); await t.next(s => s.running)
    const t0 = Date.now()
    await advance(1000)
    const ticks = t.state.log.filter(([type]) => type === 'TICK').map(([, d]) => d)
    expect(ticks.map(d => d.n)).toEqual([1, 2])
    expect(ticks[1].t - ticks[0].t).toBe(100)
    expect(ticks[0].t - t0).toBeLessThan(100)
    t.simulateAction('ARM'); await t.next(s => s.armed)
    expect(t.timers()).toEqual([{ name: 'done', after: 5000, action: 'EXPIRE', component: 'Game' }])
    await advance(4900)
    expect(t.state.log.filter(([type]) => type === 'EXPIRE')).toHaveLength(0)
    await advance(200)
    await advance(10_000)
    const expired = t.state.log.filter(([type]) => type === 'EXPIRE').map(([, d]) => d)
    expect(expired).toHaveLength(1)                      // once, though still armed
    expect(Object.keys(expired[0])).toEqual(['t'])
    t.simulateAction('ANIMATE'); await t.next(s => s.animating)
    await advance(500)
    const frames = t.state.log.filter(([type]) => type === 'FRAME').map(([, d]) => d)
    expect(frames).toHaveLength(3)
    expect(frames[0].dt).toBe(0)
    expect(frames[1].dt).toBeGreaterThan(0)
    expect(Object.keys(frames[1]).sort()).toEqual(['dt', 't'])
    expect(t.timers()).toEqual([])   // the after fired, the others are falsy
  })

  it('background: true keeps polling while its Switchable page is hidden', async () => {
    vi.useFakeTimers()
    const prelude = `import { Switchable } from 'sygnal'
function Inbox({ state }) { return <p className="checks">{state.checks}</p> }
function Settings() { return <p>Settings</p> }
function App({ state }) {
  return <main><Switchable of={{ inbox: Inbox, settings: Settings }} current={state.page} /></main>
}
App.initialState = { page: 'inbox', checks: 0 }
App.model = { GO: (state, page) => ({ ...state, page }) }
Inbox.model = { CHECK_MAIL: (state) => ({ ...state, checks: state.checks + 1 }) }
`
    const { mod } = await load({ 'App.jsx': prelude + SAMPLES.tBackground.code + '\nexport { App }\n' }, 'App.jsx')
    t = renderComponent(mod.App)
    await t.ready()
    await advance(30_000)
    expect(t.state.checks).toBe(1)
    t.simulateAction('GO', 'settings'); await t.next(s => s.page === 'settings')
    expect(t.timers()).toEqual([{ name: 'poll', every: 30000, action: 'CHECK_MAIL', background: true, component: 'Inbox' }])
    await advance(60_000)
    expect(t.state.checks).toBe(3)
  })

  it('the testing sample runs against the stopwatch recipe', async () => {
    const names = await runTestFile({ 'Stopwatch.jsx': SAMPLES.stopwatch.code, 'Stopwatch.test.jsx': SAMPLES.tTest.code }, 'Stopwatch.test.jsx')
    expect(names).toEqual(['ticks while running and stops when paused'])
  })
})

// ── reference/api: fragments ────────────────────────────────────────────────

describe('reference/api', () => {
  it('timers (static): the stopwatch fragment ticks', async () => {
    vi.useFakeTimers()
    const prelude = `function Stopwatch({ state }) { return <p>{state.ticks}</p> }
Stopwatch.initialState = { running: true, ticks: 0 }
Stopwatch.model = { TICK: (state) => ({ ...state, ticks: state.ticks + 1 }) }
`
    const { mod } = await load({ 'Stopwatch.jsx': prelude + SAMPLES.apiTimersStatic.code + '\nexport { Stopwatch }\n' }, 'Stopwatch.jsx')
    t = renderComponent(mod.Stopwatch)
    await t.ready()
    await advance(300)
    expect(t.state.ticks).toBe(3)
  })

  it('STATE.watch: one save a second after the text stops changing', async () => {
    vi.useFakeTimers()
    const prelude = `import { debounce } from 'sygnal'
function Notes({ state }) { return <p>{state.saved}</p> }
Notes.initialState = { text: '', saved: '' }
Notes.model = {
  EDIT: (state, text) => ({ ...state, text }),
  SAVE: (state, text) => ({ ...state, saved: text }),
}
`
    const { mod } = await load({ 'Notes.jsx': prelude + SAMPLES.apiWatch.code + '\nexport { Notes }\n' }, 'Notes.jsx')
    t = renderComponent(mod.Notes)
    await t.ready()
    t.simulateAction('EDIT', 'b'); await t.next(s => s.text === 'b')
    t.simulateAction('EDIT', 'buy'); await t.next(s => s.text === 'buy')
    await advance(900)
    expect(t.state.saved).toBe('')
    await advance(200)
    expect(t.state.saved).toBe('buy')
    expect(t.actions.filter(a => a.type === 'SAVE')).toHaveLength(1)
  })
})

// ── integration/debugging: DevTools ─────────────────────────────────────────

const COUNTER = `function App({ state }) {
  return <div><button type="button" className="inc">+1</button><p className="count">{state.count}</p></div>
}
App.initialState = { count: 0 }
App.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
App.model = { INC: (state) => ({ ...state, count: state.count + 1 }) }
export default App
`
const click = (sel) => document.querySelector(sel).dispatchEvent(new MouseEvent('click', { bubbles: true }))

describe('integration/debugging: DevTools', () => {
  let dev
  beforeAll(async () => { dev = await import('sygnal/devtools') })

  it('configureCopyAsTest: the panel\'s copies use the import, helpers, drivers and environment', async () => {
    await load({ 'configure.js': SAMPLES.dtConfigure.code }, 'configure.js')
    const { mod } = await load({ 'App.jsx': COUNTER }, 'App.jsx')
    document.body.innerHTML = '<div id="root"></div>'
    const app = sygnal.run(mod.default, {}, { mountPoint: '#root' })
    try {
      await until(() => document.querySelector('.count')?.textContent === '0', 'the render')
      click('.inc')
      await until(() => document.querySelector('.count').textContent === '1', 'INC')
      const code = dev.getDevTools()._copyAsTest().code
      expect(code.split('\n')[0]).toBe('// @vitest-environment jsdom')
      expect(code).toContain("import App from './App.jsx'")
      expect(code).toContain("import { mockDragDriver } from './test-helpers.js'")
      expect(code).toContain('DND: mockDragDriver().driver')
    } finally {
      app.dispose()
      dev.getDevTools()._copyOptions = {}
    }
  })

  it('vite.config.js: devtools: { redux: true } connects the Redux bridge in the dev server', async () => {
    const { mod } = await load({ 'vite.config.js': SAMPLES.dtVite.code }, 'vite.config.js')
    const [plugin] = [mod.default.plugins].flat()
    const saved = process.env.VITEST
    delete process.env.VITEST
    try {
      plugin.config({}, { command: 'serve' })
      plugin.configResolved?.({ root: process.cwd() })
    } finally {
      if (saved !== undefined) process.env.VITEST = saved
    }
    const code = plugin.transform(`import { run } from 'sygnal'\nimport App from './App.jsx'\nrun(App)\n`, '/src/main.js').code
    expect(code.startsWith("import { connectReduxDevtools as __sygnalReduxDevtools } from 'sygnal/devtools';__sygnalReduxDevtools();")).toBe(true)
  })
})

// These start apps with run() that the samples don't dispose: last, each on a fresh #root
describe('run() samples (apps left running)', () => {
  const fresh = () => { document.body.innerHTML = '<div id="root"></div>' }
  // stops after 3 ticks, so nothing keeps running
  const TICKER = `function App({ state }) { return <p className="ticks">{state.ticks}</p> }
App.initialState = { ticks: 0 }
App.timers = (state) => ({ tick: state.ticks < 3 && { every: 20, action: 'TICK' } })
App.model = { TICK: (state) => ({ ...state, ticks: state.ticks + 1 }) }
export default App
`

  it('guide/timers setup: run(App, { TIMER: makeTimerDriver() }) ticks', async () => {
    fresh()
    await load({ 'App.jsx': TICKER, 'main.js': SAMPLES.tSetup.code }, 'main.js')
    await until(() => document.querySelector('.ticks')?.textContent === '3', 'three ticks')
  })

  it('reference/api makeTimerDriver: the same with the reference fragment', async () => {
    fresh()
    const main = `import { run, makeTimerDriver } from 'sygnal'\nimport App from './App.jsx'\n` + SAMPLES.apiTimerRun.code
    await load({ 'App.jsx': TICKER, 'main.js': main }, 'main.js')
    await until(() => document.querySelector('.ticks')?.textContent === '3', 'three ticks')
  })

  it('reference/api run(): the added timers example', async () => {
    fresh()
    const main = `import { run } from 'sygnal'\nimport RootComponent from './App.jsx'\n` + SAMPLES.apiRunTimer.code
    await load({ 'App.jsx': TICKER, 'main.js': main }, 'main.js')
    await until(() => document.querySelector('.ticks')?.textContent === '3', 'three ticks')
  })

  it('copyAsTest / getActions from code: the printed test passes unchanged', async () => {
    await import('sygnal/devtools')
    fresh()
    await load({ 'App.jsx': COUNTER, 'main.js': SAMPLES.dtFromCode.code }, 'main.js')
    await until(() => document.querySelector('.count')?.textContent === '0', 'the render')
    click('.inc'); click('.inc')
    await until(() => document.querySelector('.count').textContent === '2', 'two INC')
    await sleep(20)
    const table = vi.spyOn(console, 'table').mockImplementation(() => {})
    window.actions()
    expect(table.mock.calls[0][0].filter(r => r.component === 'App' && r.type === 'INC').slice(-2)).toEqual([
      { type: 'INC', component: 'App', sinks: 'STATE' }, { type: 'INC', component: 'App', sinks: 'STATE' },
    ])
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    window.copyTest()
    const code = log.mock.calls[0][0]
    log.mockRestore()
    expect(code.split('\n')[0]).toBe('// @vitest-environment jsdom')
    expect(code).toContain("import App from './App.jsx'")
    expect(code).toContain('expect(t.state).toEqual({ count: 2 })')
    const names = await runTestFile({ 'App.jsx': COUNTER, 'App.copied.test.js': code }, 'App.copied.test.js')
    expect(names).toHaveLength(1)
  })

  it('connectReduxDevtools(app, { name }) without Vite: init, then each action with the root state', async () => {
    const calls = { connect: [], init: [], send: [] }
    window.__REDUX_DEVTOOLS_EXTENSION__ = {
      connect: (options) => {
        calls.connect.push(options)
        return { init: (state) => calls.init.push(state), send: (action, state) => calls.send.push([action, state]), subscribe: () => () => {} }
      },
    }
    try {
      fresh()
      await load({ 'App.jsx': COUNTER, 'main.js': SAMPLES.dtRedux.code }, 'main.js')
      await until(() => document.querySelector('.count')?.textContent === '0', 'the render')
      expect(calls.connect.map(o => o.name)).toEqual(['My app'])
      click('.inc')
      await until(() => calls.send.length > 0, 'a send')
      expect(calls.send.map(([a, s]) => [a.type, s])).toEqual([['App/INC', { count: 1 }]])
      expect(calls.init).toEqual([{ count: 0 }])
    } finally {
      delete window.__REDUX_DEVTOOLS_EXTENSION__
    }
  })
})
