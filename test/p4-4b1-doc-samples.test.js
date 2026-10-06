// @vitest-environment jsdom
// PLAN-4 4-B part 1: the code samples of the site docs for the merged PLAN-4 features, run
// verbatim (PLAN-4 §1.4). Each SAMPLES entry is the exact code block of its docs page (the
// "in the docs" test checks that the page still contains it), compiled with the automatic JSX
// runtime (jsxImportSource 'sygnal', as sygnal/vite does), imported against the built package
// (dist: run `npm run build` first) and exercised. Fragments get a prelude (fixtures, imports)
// and an epilogue (exports) here; the sample text itself is unchanged. Every sample is also
// checked with `sygnal-check --strict` (no strict SYG5xx or a11y SYG7xx finding, as
// scripts/check-doc-samples.mjs requires; full components: no finding at all).
//
// Third-party packages the docs show (immer, @testing-library/dom, @testing-library/user-event)
// are not dependencies of this repo. Set SYGNAL_DOCS_EXTDEPS to a directory whose node_modules
// has them to run those samples against the real packages; without it the immer sample runs
// against a stand-in `produce` and the Testing Library sample is skipped.
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
const docs = path.join(repo, 'docs/src/content/docs')
const EXT = process.env.SYGNAL_DOCS_EXTDEPS ? path.resolve(process.env.SYGNAL_DOCS_EXTDEPS, 'node_modules') : null
const hasExt = (name) => !!EXT && fs.existsSync(path.join(EXT, name, 'package.json'))

export const SAMPLES = {
  // ── guide/behaviors ───────────────────────────────────────────────────────
  disclosure: { page: 'guide/behaviors.md', code: `// behaviors/disclosure.js
import { ABORT, defineBehavior } from 'sygnal'

export const disclosure = defineBehavior({
  initialState: { open: false },
  intent: ({ DOM }, { toggle }) => ({ TOGGLE: DOM.click(toggle) }),
  model: {
    TOGGLE: (slice) => ({ ...slice, open: !slice.open }),
    CLOSE:  (slice) => (slice.open ? { ...slice, open: false } : ABORT),
  },
  calculated: {
    label: (slice) => (slice.open ? 'Hide details' : 'Show details'),
  },
})
` },

  product: { page: 'guide/behaviors.md', code: `// Product.jsx
import { disclosure } from './behaviors/disclosure.js'

export function Product({ state }) {
  return (
    <section>
      <h2>{state.name}</h2>
      <button className="toggle" aria-expanded={String(state.more.open)}>{state.more.label}</button>
      {state.more.open && <p>{state.description}</p>}
    </section>
  )
}

Product.initialState = { name: 'Desk lamp', description: 'Warm light, three brightness levels.' }
Product.uses = { more: disclosure({ toggle: '.toggle' }) }
` },

  faq: { page: 'guide/behaviors.md', code: `// Faq.jsx
import { ABORT } from 'sygnal'
import { disclosure } from './behaviors/disclosure.js'

export function Faq({ state }) {
  return (
    <section>
      <button className="toggle" aria-expanded={String(state.answer.open)}>{state.answer.label}</button>
      {state.answer.open && <p>{state.text}</p>}
      <p className="opened">Opened {state.opened} times</p>
    </section>
  )
}

Faq.initialState = { text: 'Yes, returns are free for 30 days.', opened: 0 }
Faq.uses = { answer: disclosure({ toggle: '.toggle' }) }
Faq.intent = ({ DOM }) => ({
  // a behavior action triggered by the host: Escape closes the answer
  'answer.CLOSE': DOM.keydown('document').key().filter(key => key === 'Escape'),
})
Faq.model = {
  // runs after the behavior's own TOGGLE, on the full state with its update applied
  'answer.TOGGLE': (state) => (state.answer.open ? { ...state, opened: state.opened + 1 } : ABORT),
}
` },

  faqTest: { page: 'guide/behaviors.md', code: `import { expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { Faq } from './Faq.jsx'

const t = renderComponent(Faq)
t.simulateAction('answer.TOGGLE')
await t.next(s => s.answer.open)
expect(t.state.opened).toBe(1)
expect(t.actions.at(-1)).toMatchObject({ type: 'answer.TOGGLE', cause: 'simulateAction', component: 'Faq' })
t.dispose()
` },

  // ── guide/intent: STATE.watch ─────────────────────────────────────────────
  autosave: { page: 'guide/intent.md', code: `import { debounce } from 'sygnal'

function Notes({ state }) {
  return (
    <div>
      <label>Notes <textarea className="notes" value={state.text} /></label>
      <p className="status">{state.status}</p>
    </div>
  )
}

Notes.initialState = { text: '', status: '' }

Notes.intent = ({ DOM, STATE }) => ({
  EDIT: DOM.input('.notes').value(),
  // one save a second after the text stops changing
  SAVE: STATE.watch(state => state.text).compose(debounce(1000)),
})

Notes.model = {
  EDIT: (state, text) => ({ ...state, text }),
  SAVE: {
    STATE: (state) => ({ ...state, status: 'Saving…' }),
    HTTP:  (state, text) => ({ url: '/api/notes', method: 'PUT', json: { text }, ok: 'SAVED', error: 'SAVE_FAILED' }),
  },
  SAVED:       (state) => ({ ...state, status: 'Saved' }),
  SAVE_FAILED: (state) => ({ ...state, status: 'Could not save' }),
}
` },

  // ── guide/model: GS-4, SYG222, Immer ──────────────────────────────────────
  mutation: { page: 'guide/model.md', code: `Todo.model = {
  // SYG222: the same object comes back, so the change is ignored
  // DONE: (state) => { state.done = true; return state },
  DONE: (state) => ({ ...state, done: true }),
}
` },

  immer: { page: 'guide/model.md', code: `import { produce } from 'immer'

Todos.model = {
  ADD: produce((draft, text) => {
    draft.todos.push({ id: draft.nextId, text, done: false })
    draft.nextId += 1
  }),
  TOGGLE: produce((draft, id) => {
    const todo = draft.todos.find(t => t.id === id)
    if (todo) todo.done = !todo.done
  }),
}
` },

  // ── guide/inputs: uid ──────────────────────────────────────────────────────
  uidForm: { page: 'guide/inputs.md', code: `function Signup({ state, uid }) {
  return (
    <form className="signup">
      <label for={uid('email')}>Email</label>
      <input id={uid('email')} type="email" className="email" value={state.email} aria-describedby={uid('email-help')} />
      <p id={uid('email-help')}>We only use it to sign you in.</p>
    </form>
  )
}

Signup.initialState = { email: '' }
Signup.intent = ({ DOM }) => ({ EMAIL: DOM.input('.email').value() })
Signup.model = { EMAIL: (state, email) => ({ ...state, email }) }
` },

  // ── guide/accessibility ───────────────────────────────────────────────────
  a701: { page: 'guide/accessibility.md', code: `// Flagged:
// function Card({ state }) { return <div className="card">{state.title}</div> }

function Card({ state }) {
  return <button type="button" className="card">{state.title}</button>
}

Card.intent = ({ DOM }) => ({ OPEN: DOM.click('.card') })
Card.model = { OPEN: (state) => ({ ...state, open: true }) }
` },

  a701div: { page: 'guide/accessibility.md', code: `import { xs } from 'sygnal'

function Card({ state }) {
  return <div className="card" role="button" tabIndex={0}>{state.title}</div>
}

Card.intent = ({ DOM }) => ({
  OPEN: xs.merge(
    DOM.click('.card'),
    DOM.keydown('.card').filter(e => e.key === 'Enter' || e.key === ' '),
  ),
})
Card.model = { OPEN: (state) => ({ ...state, open: true }) }
` },

  a702: { page: 'guide/accessibility.md', code: `// Flagged: <input className="search" type="search" value={state.query} />

function Search({ state }) {
  return <input className="search" type="search" aria-label="Search tasks" value={state.query} />
}

Search.initialState = { query: '' }
Search.intent = ({ DOM }) => ({ QUERY: DOM.input('.search').value() })
Search.model = { QUERY: (state, query) => ({ ...state, query }) }
` },

  a703: { page: 'guide/accessibility.md', code: `// Flagged: <img src={state.avatarUrl} />

function Profile({ state }) {
  return (
    <div>
      <img src={state.avatarUrl} alt={state.name} />
      <img src="/divider.svg" alt="" />
    </div>
  )
}
` },

  a704: { page: 'guide/accessibility.md', code: `// Flagged: <a className="more">Show more</a> with DOM.click('.more')

function Comments({ state }) {
  return (
    <div>
      <p>{state.shown} of {state.total} comments</p>
      <button type="button" className="more">Show more</button>
    </div>
  )
}

Comments.intent = ({ DOM }) => ({ MORE: DOM.click('.more') })
Comments.model = { MORE: (state) => ({ ...state, shown: Math.min(state.total, state.shown + 10) }) }
` },

  a705: { page: 'guide/accessibility.md', code: `// Flagged: <button type="button" className="close"><span>×</span></button>, no name for "×"...
// ...and an icon with no text: <button type="button" className="close"><i className="icon-x" /></button>

function Banner({ state }) {
  return (
    <div role="status">
      {state.message}
      <button type="button" className="close" aria-label="Dismiss">
        <i className="icon-x" aria-hidden="true" />
      </button>
    </div>
  )
}

Banner.intent = ({ DOM }) => ({ DISMISS: DOM.click('.close') })
Banner.model = { DISMISS: (state) => ({ ...state, message: '' }) }
` },

  a706: { page: 'guide/accessibility.md', code: `// Flagged: <div className="preview" tabIndex={1}>…</div>

function Preview({ state }) {
  return <div className="preview" tabIndex={0} aria-label="Preview">{state.html}</div>
}
` },

  a707: { page: 'guide/accessibility.md', code: `// Flagged: aria-labeledby (a typo), role="widget" (abstract)

function Tabs({ state }) {
  return (
    <div>
      <h2 id="tabs-title">Settings</h2>
      <div role="tablist" aria-labelledby="tabs-title">
        {state.tabs.map(tab => <button type="button" role="tab" aria-selected={String(tab === state.current)}>{tab}</button>)}
      </div>
    </div>
  )
}
` },

  a708: { page: 'guide/accessibility.md', code: `// Flagged: <input id="email" … /> with <label for="e-mail">

function EmailField({ state, uid }) {
  return (
    <p>
      <label for={uid('email')}>Email</label>
      <input id={uid('email')} type="email" className="email" value={state.email} aria-describedby={uid('email-error')} />
      {state.error && <span id={uid('email-error')}>{state.error}</span>}
    </p>
  )
}

EmailField.initialState = { email: '', error: '' }
EmailField.intent = ({ DOM }) => ({ EMAIL: DOM.input('.email').value() })
EmailField.model = { EMAIL: (state, email) => ({ ...state, email, error: email.includes('@') ? '' : 'Enter an email address' }) }
` },

  a11yIgnore: { page: 'guide/accessibility.md', code: `import { xs } from 'sygnal'

function Dialog({ state }) {
  return (
    <div>
      <div className="backdrop" />
      <div role="dialog" aria-modal="true" aria-label="Settings">{state.body}</div>
    </div>
  )
}

Dialog.intent = ({ DOM }) => ({
  CLOSE: xs.merge(
    // a mouse shortcut: keyboard users close the dialog with Escape
    // sygnal-ignore SYG701
    DOM.click('.backdrop'),
    DOM.keydown('document').key().filter(key => key === 'Escape'),
  ),
})
Dialog.model = { CLOSE: { PARENT: () => 'closed' } }
` },

  // ── integration/testing ───────────────────────────────────────────────────
  actions: { page: 'integration/testing.md', code: `const t = renderComponent(Counter)
t.simulateEvent('.inc', 'click')
t.simulateAction('SET', 5)
await t.waitForState(s => s.count === 5)

expect(t.actions.map(a => [a.type, a.cause])).toEqual([
  ['INITIALIZE', 'built-in'],
  ['INC', 'intent'],
  ['SET', 'simulateAction'],
])
expect(t.actions[1]).toMatchObject({ component: 'Counter', sinks: ['STATE'] })
` },

  explain: { page: 'integration/testing.md', code: `const why = t.explain(s => s.count === 5)
expect(why).toMatchObject({ type: 'SET', cause: 'simulateAction', state: { count: 5 } })
expect(why.reducer).toMatchObject({ action: 'SET', sink: 'STATE' })
` },

  inspectActions: { page: 'integration/testing.md', code: `const graph = t.inspect({ actions: true })
expect(graph.recentActions.map(a => a.type)).toEqual(['INITIALIZE', 'INC', 'SET'])
` },

  testingLibrary: { page: 'integration/testing.md', code: `// @vitest-environment jsdom
import { it, expect, afterEach } from 'vitest'
import { within } from '@testing-library/dom'
import userEvent from '@testing-library/user-event'
import { renderComponent } from 'sygnal'
import NewTodo from './NewTodo.jsx'

let t
afterEach(() => t?.dispose())

it('adds a todo', async () => {
  t = renderComponent(NewTodo, { dom: 'real' })
  await t.ready()
  const screen = within(t.container)
  const user = userEvent.setup()

  const field = screen.getByRole('textbox', { name: 'New todo' })
  await user.type(field, 'Buy milk')
  await user.click(screen.getByRole('button', { name: 'Add' }))

  await t.waitForState(s => s.items.length === 1)
  expect(t.state.items).toEqual(['Buy milk'])
  expect(field.value).toBe('')
})
` },

  strictTest: { page: 'guide/strict-mode.md', code: `import 'sygnal/diagnostics'
import { renderComponent } from 'sygnal'

const t = renderComponent(Lane, { strict: true })
await t.ready()
t.expectNoDiagnostics()   // fails on SYG508 (and SYG106) as well; SYG612 always
t.dispose()               // restores the previous strict setting
` },

  // ── advanced/error-boundaries: the app-level hook ─────────────────────────
  runOnError: { page: 'advanced/error-boundaries.md', code: `import { run } from 'sygnal'
import App from './App.jsx'
import { tracker } from './tracker.js'

run(App, {}, {
  onError: (error, { componentName, action, phase, driver }) => {
    tracker.captureException(error, { tags: { componentName, action, phase, driver } })
  },
})
` },

  vikeOnError: { page: 'advanced/error-boundaries.md', code: `// pages/+sygnalOnError.js: used by renderToString on the server and by run() in the browser
export default function sygnalOnError(error, { componentName, action, phase }) {
  console.error('[' + phase + ']', componentName, action, error)
}
` },

  astroConfig: { page: 'advanced/error-boundaries.md', code: `// astro.config.mjs
import { defineConfig } from 'astro/config'
import sygnal from 'sygnal/astro'

export default defineConfig({
  integrations: [sygnal({ onError: './src/onError.js' })],
})
` },

  ssrOnError: { page: 'advanced/error-boundaries.md', code: `import { renderToString } from 'sygnal'

const html = renderToString(Page, {
  onError: (error, info) => logger.error({ ...info, message: error.message }),
})
` },

  testOnError: { page: 'advanced/error-boundaries.md', code: `const reported = []
const t = renderComponent(Checkout, { onError: (error, info) => reported.push(info) })
t.simulateAction('PAY')
await t.settle()
expect(reported).toEqual([{ componentName: 'Checkout', action: 'PAY', phase: 'reducer' }])
t.dispose()
` },

  // ── integration/ssr: uid roots ────────────────────────────────────────────
  ssrUid: { page: 'integration/ssr.md', code: `// server
const html = renderToString(Signup, { uid: 'signup' })

// client, hydrating that markup
run(Signup, {}, { mountPoint: '#signup', uid: 'signup' })
` },

  // ── guide/collections: performance ────────────────────────────────────────
  mappedRows: { page: 'guide/collections.md', code: `function Report({ state }) {
  return (
    <table>
      <tbody>
        {state.rows.map(row => (
          <tr key={row.id}>
            <td>{row.name}</td>
            <td>{row.total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
` },

  // ── advanced/alternative-forms: returning the unchanged state ─────────────
  sameObject: { page: 'advanced/alternative-forms.md', code: `// Also "no change" since 6.0
RENAME: (state, title) => title ? { ...state, title } : state

// The form the docs use
RENAME: (state, title) => title ? { ...state, title } : ABORT
` },
}

// ── fixtures and harness ────────────────────────────────────────────────────

const COUNTER = `import { renderComponent } from 'sygnal'
import { expect } from 'vitest'
function Counter({ state }) {
  return <div><button className="inc">+</button><span className="n">{state.count}</span></div>
}
Counter.initialState = { count: 0 }
Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
Counter.model = {
  INC: (state) => ({ ...state, count: state.count + 1 }),
  SET: (state, count) => ({ ...state, count }),
}
`

// guide/inputs "Controlled inputs" (the Testing Library sample's component), unchanged
const NEW_TODO = `import { ABORT } from 'sygnal'

function NewTodo({ state }) {
  return (
    <div>
      <input className="new-todo" aria-label="New todo" value={state.draft} />
      <button className="add">Add</button>
    </div>
  )
}

NewTodo.initialState = { draft: '', items: [] }

NewTodo.intent = ({ DOM }) => ({
  DRAFT: DOM.input('.new-todo').value(),
  ADD:   DOM.click('.add'),
})

NewTodo.model = {
  DRAFT: (state, draft) => ({ ...state, draft }),
  ADD:   (state) => state.draft.trim()
    ? { ...state, items: [...state.items, state.draft.trim()], draft: '' }
    : ABORT,
}
export default NewTodo
`

// A stand-in for immer's curried produce (used when the real package isn't available): the
// recipe edits a deep copy; when nothing changed the base object is returned, as immer does
const PRODUCE_STANDIN = `export const produce = (recipe) => (base, ...args) => {
  const draft = JSON.parse(JSON.stringify(base))
  recipe(draft, ...args)
  return JSON.stringify(draft) === JSON.stringify(base) ? base : draft
}
`

let dir
let n = 0
const compile = (src, file) => ts.transpileModule(src, { fileName: file, compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'sygnal', module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, allowJs: true,
} }).outputText.replace(/(from\s+['"]\.{1,2}\/[^'"]+?)\.jsx?(['"])/g, '$1.mjs$2')

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
  return import(pathToFileURL(path.join(base, main.replace(/\.jsx?$/, '.mjs'))).href)
}

// sygnal-check --strict on one sample, as check-doc-samples does (a .jsx file of its own)
function check(name, code) {
  const file = path.join(dir, 'check', name + '.jsx')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, code)
  return checkFiles([file], { cwd: path.dirname(file), strict: true }).map(d => `${d.code} ${d.message}`)
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(here, '.p4-4b1-samples-'))
  const nm = path.join(dir, 'node_modules')
  fs.mkdirSync(nm)
  // third-party packages the docs show: the real ones when SYGNAL_DOCS_EXTDEPS has them
  for (const name of ['immer', '@testing-library/dom', '@testing-library/user-event']) {
    if (!hasExt(name)) continue
    fs.mkdirSync(path.dirname(path.join(nm, name)), { recursive: true })
    fs.symlinkSync(path.join(EXT, name), path.join(nm, name), 'dir')
  }
  if (!hasExt('immer')) {
    fs.mkdirSync(path.join(nm, 'immer'))
    fs.writeFileSync(path.join(nm, 'immer/package.json'), JSON.stringify({ name: 'immer', type: 'module', exports: './index.js' }))
    fs.writeFileSync(path.join(nm, 'immer/index.js'), PRODUCE_STANDIN)
  }
  // astro/config for the Astro sample (defineConfig is the identity in Astro)
  fs.mkdirSync(path.join(nm, 'astro'))
  fs.writeFileSync(path.join(nm, 'astro/package.json'), JSON.stringify({ name: 'astro', type: 'module', exports: { './config': './config.js' } }))
  fs.writeFileSync(path.join(nm, 'astro/config.js'), 'export const defineConfig = (config) => config\n')
})
afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }) })

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; vi.restoreAllMocks() })

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const until = async (cond, what, ms = 3000) => {
  for (const end = Date.now() + ms; !cond(); await sleep(5)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
  }
}

// ── the samples are in their docs pages ─────────────────────────────────────

describe('every sample is in its docs page, verbatim', () => {
  for (const [name, { page, code }] of Object.entries(SAMPLES)) {
    it(`${name} (${page})`, () => {
      expect(fs.readFileSync(path.join(docs, page), 'utf8')).toContain(code)
    })
  }

  // 3-D's recipes (run by test/p4-3d-recipes.test.js) are on the behaviors and undo pages
  const recipes = fs.readFileSync(path.join(here, 'p4-3d-recipes.test.js'), 'utf8')
  const found = [...recipes.matchAll(/^  (\w+): `([\s\S]*?)`,$/gm)]
  it('found the five 3-D recipes', () => {
    expect(found.map(m => m[1])).toEqual(['pager', 'selection', 'undo', 'undoKeys', 'undoable'])
  })
  for (const [, name, code] of found) {
    const page = /^(pager|selection)$/.test(name) ? 'guide/behaviors.md' : 'advanced/undo.md'
    it(`3-D recipe ${name} (${page})`, () => {
      expect(fs.readFileSync(path.join(docs, page), 'utf8')).toContain(code)
    })
  }
})

// ── static: strict-clean and a11y-clean ─────────────────────────────────────

// samples that are whole modules or components (any finding fails); the rest are fragments
// (only SYG5xx / SYG7xx fail, as in check-doc-samples)
const WHOLE = new Set(['disclosure', 'autosave', 'uidForm', 'a701', 'a701div', 'a702', 'a704', 'a705', 'a708', 'a11yIgnore', 'mappedRows'])

describe('sygnal-check --strict: no strict or a11y findings', () => {
  for (const [name, { code }] of Object.entries(SAMPLES)) {
    it(name, () => {
      const found = check(name, code)
      expect(WHOLE.has(name) ? found : found.filter(f => /^SYG[57]\d\d /.test(f))).toEqual([])
    })
  }

  it('the behavior hosts check clean with their behavior (relative import resolved)', () => {
    const base = path.join(dir, 'check-hosts')
    fs.mkdirSync(path.join(base, 'behaviors'), { recursive: true })
    fs.writeFileSync(path.join(base, 'behaviors/disclosure.js'), SAMPLES.disclosure.code)
    fs.writeFileSync(path.join(base, 'Product.jsx'), SAMPLES.product.code)
    fs.writeFileSync(path.join(base, 'Faq.jsx'), SAMPLES.faq.code)
    const d = checkFiles([base], { cwd: base, strict: true })
    expect(d.map(x => `${x.code} ${x.message}`)).toEqual([])
  })
})

// The "Flagged" forms on the accessibility page are what the rules report
describe('guide/accessibility: the flagged forms are reported', () => {
  const flagged = {
    SYG701: `function Card({ state }) { return <div className="card">{state.title}</div> }
Card.intent = ({ DOM }) => ({ OPEN: DOM.click('.card') })
Card.model = { OPEN: (state) => ({ ...state, open: true }) }
`,
    SYG702: `function Search({ state }) { return <input className="search" type="search" value={state.query} /> }
Search.intent = ({ DOM }) => ({ QUERY: DOM.input('.search').value() })
Search.model = { QUERY: (state, query) => ({ ...state, query }) }
`,
    SYG703: 'function Profile({ state }) { return <img src={state.avatarUrl} /> }\n',
    SYG704: `function Comments() { return <a className="more">Show more</a> }
Comments.intent = ({ DOM }) => ({ MORE: DOM.click('.more') })
Comments.model = { MORE: (state) => ({ ...state, more: true }) }
`,
    SYG705: `function Banner() { return <button type="button" className="close"><i className="icon-x" /></button> }
Banner.intent = ({ DOM }) => ({ DISMISS: DOM.click('.close') })
Banner.model = { DISMISS: (state) => ({ ...state, message: '' }) }
`,
    SYG706: 'function Preview({ state }) { return <div className="preview" tabIndex={1}>{state.html}</div> }\n',
    SYG707: 'function Tabs() { return <div role="widget" aria-labeledby="tabs-title"><h2 id="tabs-title">Settings</h2></div> }\n',
    SYG708: 'function EmailField() { return <p><label for="e-mail">Email</label><input id="email" type="email" /></p> }\n',
  }
  for (const [code, src] of Object.entries(flagged)) {
    it(code, () => {
      expect(check('flagged-' + code, src).map(f => f.split(' ')[0])).toContain(code)
    })
  }

  // D144 (amends D111): a warning, also under --strict; an error with a11y: 'error'
  it("the a11y lane is a warning, also under --strict, and an error with a11y: 'error'", () => {
    const file = path.join(dir, 'check', 'flagged-SYG701.jsx')
    const sev = (opts) => checkFiles([file], { cwd: path.dirname(file), ...opts }).find(d => d.code === 'SYG701').severity
    expect(sev({ strict: true })).toBe('warn')
    expect(sev({})).toBe('warn')
    expect(sev({ a11y: 'error' })).toBe('error')
  })

  it('without its sygnal-ignore line the backdrop listener is SYG701', () => {
    const src = SAMPLES.a11yIgnore.code.replace('    // sygnal-ignore SYG701\n', '')
    expect(src).not.toBe(SAMPLES.a11yIgnore.code)
    expect(check('a11yIgnore-without', src).map(f => f.split(' ')[0])).toContain('SYG701')
  })
})

// ── runtime ─────────────────────────────────────────────────────────────────

describe('guide/behaviors', () => {
  const files = () => ({ 'behaviors/disclosure.js': SAMPLES.disclosure.code, 'Product.jsx': SAMPLES.product.code, 'Faq.jsx': SAMPLES.faq.code })

  it('Product: state.more from the behavior, calculated label, the toggle button opens it', async () => {
    const { Product } = await load(files(), 'Product.jsx')
    t = renderComponent(Product, { dom: 'real' })
    await t.ready()
    expect(t.state).toEqual({ name: 'Desk lamp', description: 'Warm light, three brightness levels.', more: { open: false, label: 'Show details' } })
    const toggle = t.query('.toggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(t.queryAll('p')).toHaveLength(0)
    t.simulateEvent('.toggle', 'click'); await t.next(s => s.more.open)
    expect(t.query('.toggle').textContent).toBe('Hide details')
    expect(t.query('.toggle').getAttribute('aria-expanded')).toBe('true')
    expect(t.query('p').textContent).toBe('Warm light, three brightness levels.')
    expect(t.actions.at(-1)).toMatchObject({ type: 'more.TOGGLE', cause: 'behavior', component: 'Product' })
    t.expectNoDiagnostics()
  })

  it('Faq: the host entry runs after the behavior\'s; Escape (host intent) triggers answer.CLOSE', async () => {
    const { Faq } = await load(files(), 'Faq.jsx')
    t = renderComponent(Faq, { dom: 'real' })
    await t.ready()
    t.simulateEvent('.toggle', 'click'); await t.next(s => s.answer.open)
    expect(t.state.opened).toBe(1)
    t.simulateEvent('document', 'keydown', { key: 'Escape' }); await t.next(s => !s.answer.open)
    expect(t.state.opened).toBe(1)
    expect(t.actions.at(-1)).toMatchObject({ type: 'answer.CLOSE', cause: 'intent' })
    const states = t.states.length
    t.simulateEvent('document', 'keydown', { key: 'Escape' }); await t.settle()   // CLOSE when closed: ABORT
    expect(t.states.length).toBe(states)
    t.simulateEvent('.toggle', 'click'); await t.next(s => s.answer.open)
    t.simulateEvent('.toggle', 'click'); await t.next(s => !s.answer.open)   // closing: host ABORT keeps the toggle
    expect(t.state.opened).toBe(2)
    expect(t.query('.opened').textContent).toBe('Opened 2 times')
    t.expectNoDiagnostics()
  })

  it('the test snippet runs (simulateAction of a namespaced action, t.actions)', async () => {
    await load({ ...files(), 'faq.test.js': SAMPLES.faqTest.code }, 'faq.test.js')
  })
})

describe('guide/intent: STATE.watch autosave', () => {
  it('saves once a second after typing stops; reply actions set the status', async () => {
    const { Notes } = await load({ 'Notes.jsx': SAMPLES.autosave.code + '\nexport { Notes }\n' }, 'Notes.jsx')
    t = renderComponent(Notes, { dom: 'real' })
    await t.ready()
    expect(t.requests('HTTP')).toEqual([])
    t.simulateEvent('.notes', 'input', { value: 'b' })
    t.simulateEvent('.notes', 'input', { value: 'bu' })
    t.simulateEvent('.notes', 'input', { value: 'buy milk' })
    await t.next(s => s.text === 'buy milk')
    await sleep(500)
    expect(t.requests('HTTP')).toEqual([])
    await t.waitForState(s => s.status === 'Saving…', 2000)
    expect(t.requests('HTTP')).toEqual([{ url: '/api/notes', method: 'PUT', json: { text: 'buy milk' }, ok: 'SAVED', error: 'SAVE_FAILED' }])
    await t.respond('HTTP', {})
    expect(t.state.status).toBe('Saved')
    expect(t.query('.status').textContent).toBe('Saved')
    await sleep(1100)   // status changes are not text changes: no second save
    expect(t.requests('HTTP')).toHaveLength(1)
    t.simulateEvent('.notes', 'input', { value: 'buy milk!' })
    await t.waitForState(s => s.status === 'Saving…' && s.text === 'buy milk!', 2000)
    await t.fail('HTTP', 500)
    expect(t.state.status).toBe('Could not save')
    t.expectNoDiagnostics()
  }, 10000)
})

describe('guide/model', () => {
  it('the DONE reducer; the commented-out mutation is SYG222 and changes nothing', async () => {
    const prelude = `function Todo({ state }) { return <p>{state.title}{state.done ? ' (done)' : ''}</p> }
Todo.initialState = { title: 'Write docs', done: false }
`
    const { Todo } = await load({ 'Todo.jsx': prelude + SAMPLES.mutation.code + '\nexport { Todo }\n' }, 'Todo.jsx')
    t = renderComponent(Todo)
    t.simulateAction('DONE'); await t.next(s => s.done)
    expect(t.html()).toContain('(done)')
    t.expectNoDiagnostics()
    t.dispose()

    // the flagged form, uncommented
    const bad = SAMPLES.mutation.code.match(/\/\/ (DONE: .*),/)[1]
    const { Todo: Bad } = await load({ 'Todo.jsx': prelude + `Todo.model = { ${bad} }\nexport { Todo }\n` }, 'Todo.jsx')
    t = renderComponent(Bad)
    await t.ready()
    const states = t.states.length
    t.simulateAction('DONE'); await t.settle()
    expect(t.states.length).toBe(states)
    expect(t.html()).not.toContain('(done)')
    expect(t.diagnostics.map(d => d.code)).toContain('SYG222')
  })

  it(`immer: produce reducers; a no-op adds no state (${hasExt('immer') ? 'real immer' : 'stand-in produce'})`, async () => {
    const prelude = `import { xs } from 'sygnal'
function Todos({ state }) {
  return <div><span className="left">{state.left}</span><ul>{state.todos.map(t => <li>{t.text}{t.done ? ' ✓' : ''}</li>)}</ul></div>
}
Todos.initialState = { nextId: 1, todos: [] }
Todos.calculated = { left: (state) => state.todos.filter(t => !t.done).length }
`
    const { Todos } = await load({ 'Todos.jsx': prelude + SAMPLES.immer.code + '\nexport { Todos }\n' }, 'Todos.jsx')
    t = renderComponent(Todos, { dom: 'real' })
    await t.ready()
    t.simulateAction('ADD', 'milk'); await t.next(s => s.todos.length === 1)
    t.simulateAction('ADD', 'bread'); await t.next(s => s.todos.length === 2)
    expect(t.state.todos).toEqual([{ id: 1, text: 'milk', done: false }, { id: 2, text: 'bread', done: false }])
    expect(t.state.nextId).toBe(3)
    t.simulateAction('TOGGLE', 2); await t.next(s => s.todos[1].done)
    expect(t.state.left).toBe(1)
    expect(t.query('.left').textContent).toBe('1')
    const states = t.states.length
    t.simulateAction('TOGGLE', 99); await t.settle()   // no such todo: the base comes back
    expect(t.states.length).toBe(states)
    t.expectNoDiagnostics()
  })
})

describe('guide/inputs: uid()', () => {
  it('label for / input id / aria-describedby match; unique per instance', async () => {
    const prelude = `const Field = (props) => Signup(props)
function Page() { return <div><Field state="a" /><Field state="b" /></div> }
Page.initialState = { a: { email: '' }, b: { email: '' } }
`
    const { Signup, Page } = await load({ 'Signup.jsx': SAMPLES.uidForm.code + prelude + '\nexport { Signup, Page }\n' }, 'Signup.jsx')
    t = renderComponent(Signup, { dom: 'real' })
    await t.ready()
    const label = t.query('label'), input = t.query('input'), help = t.query('p')
    expect(label.getAttribute('for')).toBe(input.id)
    expect(input.getAttribute('aria-describedby')).toBe(help.id)
    expect(input.id).toMatch(/^[A-Za-z][\w-]*$/)
    t.simulateEvent('.email', 'input', { value: 'ada@example.com' }); await t.next(s => s.email === 'ada@example.com')
    t.expectNoDiagnostics()
    t.dispose()
    t = renderComponent(Page, { dom: 'real' })
    await t.ready(); await t.settle()
    const ids = t.queryAll('input').map(i => i.id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    for (const l of t.queryAll('label')) expect(t.container.querySelector('#' + l.getAttribute('for')).tagName).toBe('INPUT')
  })
})

describe('guide/accessibility: the fixed forms render and work', () => {
  const comp = (name, code, exportName) => load({ [name + '.jsx']: code + `\nexport { ${exportName} }\n` }, name + '.jsx')

  it('a701: the button card', async () => {
    const { Card } = await comp('a701', SAMPLES.a701.code, 'Card')
    t = renderComponent(Card, { dom: 'real', initialState: { title: 'Task' } })
    await t.ready()
    t.simulateEvent('.card', 'click'); await t.next(s => s.open)
    t.expectNoDiagnostics()
  })

  it('a701div: the div card answers Enter and Space too', async () => {
    const { Card } = await comp('a701div', SAMPLES.a701div.code, 'Card')
    t = renderComponent(Card, { dom: 'real', initialState: { title: 'Task', open: false } })
    await t.ready()
    expect(t.query('.card').getAttribute('role')).toBe('button')
    expect(t.query('.card').tabIndex).toBe(0)
    t.simulateEvent('.card', 'keydown', { key: 'a' }); await t.settle()
    expect(t.state.open).toBe(false)
    t.simulateEvent('.card', 'keydown', { key: ' ' }); await t.next(s => s.open)
    t.expectNoDiagnostics()
  })

  it('a702 … a708 render as shown', async () => {
    const cases = [
      ['a702', 'Search', undefined, (q) => { expect(q('.search').getAttribute('aria-label')).toBe('Search tasks') }],
      ['a703', 'Profile', { avatarUrl: '/ada.png', name: 'Ada' }, (q) => { expect(q('img').getAttribute('alt')).toBe('Ada') }],
      ['a704', 'Comments', { shown: 10, total: 25 }, null],
      ['a705', 'Banner', { message: 'Saved' }, (q) => { expect(q('.close').getAttribute('aria-label')).toBe('Dismiss'); expect(q('i').getAttribute('aria-hidden')).toBe('true') }],
      ['a706', 'Preview', { html: 'x' }, (q) => { expect(q('.preview').tabIndex).toBe(0) }],
      ['a707', 'Tabs', { tabs: ['General', 'Privacy'], current: 'Privacy' }, (q) => { expect(t.queryAll('[role="tab"]').map(b => b.getAttribute('aria-selected'))).toEqual(['false', 'true']) }],
      ['a708', 'EmailField', undefined, null],
    ]
    for (const [name, exp, initialState, assert] of cases) {
      const mod = await comp(name, SAMPLES[name].code, exp)
      t = renderComponent(mod[exp], { dom: 'real', ...(initialState && { initialState }) })
      await t.ready()
      if (assert) assert((s) => t.query(s))
      t.expectNoDiagnostics()
      t.dispose(); t = null
    }
  })

  it('a704: Show more', async () => {
    const { Comments } = await comp('a704', SAMPLES.a704.code, 'Comments')
    t = renderComponent(Comments, { dom: 'real', initialState: { shown: 10, total: 25 } })
    await t.ready()
    t.simulateEvent('.more', 'click'); await t.next(s => s.shown === 20)
    t.simulateEvent('.more', 'click'); await t.next(s => s.shown === 25)
    t.expectNoDiagnostics()
  })

  it('a708: the error is described by the field once it renders', async () => {
    const { EmailField } = await comp('a708', SAMPLES.a708.code, 'EmailField')
    t = renderComponent(EmailField, { dom: 'real' })
    await t.ready()
    t.simulateEvent('.email', 'input', { value: 'ada' }); await t.next(s => s.error)
    const input = t.query('.email')
    expect(t.container.querySelector('#' + input.getAttribute('aria-describedby')).textContent).toBe('Enter an email address')
    expect(t.query('label').getAttribute('for')).toBe(input.id)
    t.expectNoDiagnostics()
  })

  it('a11yIgnore: the backdrop and Escape both close (PARENT)', async () => {
    const { Dialog } = await comp('a11yIgnore', SAMPLES.a11yIgnore.code, 'Dialog')
    t = renderComponent(Dialog, { dom: 'real', initialState: { body: 'Hi' } })
    await t.ready()
    t.simulateEvent('.backdrop', 'click'); await t.settle()
    t.simulateEvent('document', 'keydown', { key: 'Escape' }); await t.settle()
    expect(t.actions.filter(a => a.type === 'CLOSE').map(a => a.sinks)).toEqual([['PARENT'], ['PARENT']])
  })
})

describe('integration/testing', () => {
  it('t.actions, t.explain and inspect({ actions }) (one test, in page order)', async () => {
    await load({ 'counter.test.jsx': COUNTER + SAMPLES.actions.code + SAMPLES.explain.code + SAMPLES.inspectActions.code + `
expect(typeof why.reducer.fn).toBe('function')
t.dispose()
` }, 'counter.test.jsx')
  })

  it.skipIf(!hasExt('@testing-library/dom') || !hasExt('@testing-library/user-event'))('Testing Library: within(t.container), userEvent, role queries', async () => {
    // the sample's it() / afterEach() can't register inside this test: its 'vitest' import is
    // pointed at a shim that collects them (the import specifier only; the sample is unchanged)
    const files = {
      'NewTodo.jsx': NEW_TODO,
      'NewTodo.test.jsx': SAMPLES.testingLibrary.code,
      'vitest-shim.mjs': `export { expect } from 'vitest'
export const registered = { tests: [], after: [] }
export const it = (name, fn) => { registered.tests.push(fn) }
export const afterEach = (fn) => { registered.after.push(fn) }
`,
    }
    await load(files, 'NewTodo.test.jsx', { vitest: './vitest-shim.mjs' })
    const { registered } = await import(pathToFileURL(path.join(dir, 'm' + (n - 1), 'vitest-shim.mjs')).href)
    expect(registered.tests).toHaveLength(1)
    try { await registered.tests[0]() } finally { for (const f of registered.after) f() }
  })

  it('strict-mode: the strict test snippet', async () => {
    const prelude = `function Lane({ state, className }) { return <h2 className={className}>{state.title}</h2> }
Lane.initialState = { title: 'Todo' }
`
    await load({ 'lane.test.jsx': prelude + SAMPLES.strictTest.code }, 'lane.test.jsx')
  })
})

describe('advanced/error-boundaries: the app-level hook', () => {
  it('renderComponent({ onError })', async () => {
    const prelude = `import { renderComponent } from 'sygnal'
import { expect } from 'vitest'
function Checkout() { return <p>checkout</p> }
Checkout.initialState = {}
Checkout.model = { PAY: () => { throw new Error('card declined') } }
`
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await load({ 'checkout.test.jsx': prelude + SAMPLES.testOnError.code }, 'checkout.test.jsx')
  })

  it("renderToString({ onError }): 'view', after the boundary", async () => {
    const prelude = `function Page() { throw new Error('no data') }
Page.onError = () => <p>Sorry</p>
export const logger = { calls: [], error: (x) => logger.calls.push(x) }
`
    const mod = await load({ 'page.jsx': prelude + SAMPLES.ssrOnError.code + '\nexport { html }\n' }, 'page.jsx')
    expect(mod.html).toBe('<p data-sygnal-ssr="">Sorry</p>')
    expect(mod.logger.calls).toEqual([{ componentName: 'Page', action: undefined, phase: 'view', message: 'no data' }])
  })

  it('Vike: +sygnalOnError.js as config.sygnalOnError (server render)', async () => {
    const hook = await load({ 'pages/+sygnalOnError.js': SAMPLES.vikeOnError.code }, 'pages/+sygnalOnError.js')
    const { onRenderHtml } = await import('../dist/vike/onRenderHtml.mjs')
    const logged = []
    vi.spyOn(console, 'error').mockImplementation((...a) => logged.push(a))
    function Page() { throw new Error('ssr view') }
    Page.initialState = {}
    Page.onError = () => ({ sel: 'p', data: {}, children: undefined, text: 'fallback' })
    onRenderHtml({ Page, config: { sygnalOnError: hook.default }, data: {} })
    expect(logged.filter(a => a[0] === '[view]').map(a => [a[1], a[2], a[3].message])).toEqual([['Page', undefined, 'ssr view']])
  })

  it('Astro: the integration option names the module the virtual module re-exports', async () => {
    const { default: config } = await load({ 'astro.config.mjs': SAMPLES.astroConfig.code }, 'astro.config.mjs')
    const [integration] = config.integrations
    let vite
    integration.hooks['astro:config:setup']({ addRenderer() {}, updateConfig(c) { vite = c.vite }, command: 'build', config: { root: pathToFileURL(path.resolve('/proj') + '/') } })
    const p = vite.plugins.find(p => p.name === 'sygnal:astro-on-error')
    expect(p.load(p.resolveId('virtual:sygnal/astro-on-error'))).toBe(`export { default } from ${JSON.stringify(path.resolve('/proj/src/onError.js'))}`)
  })
})

describe('guide/collections: mapped rows', () => {
  it('renders one row per item', async () => {
    const { Report } = await load({ 'Report.jsx': SAMPLES.mappedRows.code + '\nexport { Report }\n' }, 'Report.jsx')
    t = renderComponent(Report, { dom: 'real', initialState: { rows: [{ id: 1, name: 'North', total: 10 }, { id: 2, name: 'South', total: 7 }] } })
    await t.ready()
    expect(t.queryAll('tr').map(r => r.textContent)).toEqual(['North10', 'South7'])
    t.expectNoDiagnostics()
  })
})

describe('advanced/alternative-forms: returning the unchanged state', () => {
  it('both RENAME reducers: a title changes the state; none emits nothing', async () => {
    const [same, canonical] = SAMPLES.sameObject.code.split('\n\n').map(b => b.split('\n').find(l => l.startsWith('RENAME')).replace(/^RENAME: /, ''))
    for (const reducer of [same, canonical]) {
      const src = `import { ABORT } from 'sygnal'
function Lane({ state }) { return <h2>{state.title}</h2> }
Lane.initialState = { title: 'Todo' }
Lane.model = { RENAME: ${reducer} }
export { Lane }
`
      const { Lane } = await load({ 'Lane.jsx': src }, 'Lane.jsx')
      t = renderComponent(Lane)
      await t.ready()
      const states = t.states.length
      t.simulateAction('RENAME', ''); await t.settle()
      expect(t.states.length).toBe(states)
      t.simulateAction('RENAME', 'Doing'); await t.next(s => s.title === 'Doing')
      t.expectNoDiagnostics()
      t.dispose(); t = null
    }
  })
})

// These start apps with run() that the samples don't dispose: last, on their own mount points
describe('run() samples (apps left running)', () => {
  it('run(App, {}, { onError }) reports to the tracker', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const files = {
      'App.jsx': `import { xs } from 'sygnal'
function App() { return <p>app</p> }
App.initialState = {}
App.intent = () => ({ LOAD: xs.of(1) })
App.model = { LOAD: () => { throw new Error('bad data') } }
export default App
`,
      'tracker.js': 'export const tracker = { calls: [], captureException(error, extra) { tracker.calls.push([error.message, extra]) } }\n',
      'main.js': SAMPLES.runOnError.code,
    }
    await load(files, 'main.js')
    const { tracker } = await import(pathToFileURL(path.join(dir, 'm' + (n - 1), 'tracker.mjs')).href)
    await until(() => tracker.calls.length > 0, 'the hook')
    expect(tracker.calls).toEqual([['bad data', { tags: { componentName: 'App', action: 'LOAD', phase: 'reducer', driver: undefined } }]])
  })

  it('renderToString and run() with the same uid root produce the same ids', async () => {
    const prelude = `import { renderToString, run } from 'sygnal'
` + SAMPLES.uidForm.code + `
document.body.innerHTML = '<div id="signup"></div>'
`
    const mod = await load({ 'ssr.jsx': prelude + SAMPLES.ssrUid.code + '\nexport { html }\n' }, 'ssr.jsx')
    const ssrIds = [...mod.html.matchAll(/ id="([^"]+)"/g)].map(m => m[1])
    expect(ssrIds).toEqual(['signup-email', 'signup-email-help'])
    await until(() => document.querySelectorAll('#signup [id]').length === 2, 'the client render')
    expect([...document.querySelectorAll('#signup [id]')].map(e => e.id)).toEqual(ssrIds)
    expect(document.querySelector('#signup label').getAttribute('for')).toBe('signup-email')
  })
})
