// @vitest-environment jsdom
// PLAN-4 4-P: the code samples of guide/controls (controls are an alternative form, D141), run
// verbatim (PLAN-4 §1.4), as test/p4-4b2-doc-samples.test.js does. Each SAMPLES entry is the exact
// code block of the page (the "in the docs" test checks that the page still contains it), compiled
// with the automatic JSX runtime (jsxImportSource 'sygnal', as sygnal/vite does), imported against
// the built package (dist: run `npm run build` first) and exercised. Fragments get a prelude
// (fixtures, imports) and an epilogue (exports) here; the sample text itself is unchanged. Every
// sample is checked with `sygnal-check --strict` (no strict SYG5xx or a11y SYG7xx finding, as
// scripts/check-doc-samples.mjs requires; whole modules: no finding beyond the ones listed). The
// `--fix --controls` before/after pair is checked by running the fixer on the "before" sample.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import 'sygnal/diagnostics'
import { renderComponent } from 'sygnal'
import { checkFiles, fixFiles } from '../sygnal-check/src/index.js'
import { codesOf } from './support/fences.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const PAGE = path.join(repo, 'docs/src/content/docs/guide/controls.md')

export const SAMPLES = {
  addTodo: { lang: 'jsx', code: `// AddTodo.jsx
import { ABORT, controls } from 'sygnal'

export const { Draft, Add } = controls({ Draft: 'input', Add: 'button' })

export function AddTodo({ state }) {
  return (
    <form>
      <label>New todo <Draft value={state.draft} /></label>
      <Add type="button">Add</Add>
      <ul>{state.todos.map((todo) => <li>{todo}</li>)}</ul>
    </form>
  )
}

AddTodo.initialState = { draft: '', todos: [] }

AddTodo.intent = ({ DOM }) => ({
  DRAFT: DOM.input(Draft).value(),
  ADD: DOM.click(Add),
})

AddTodo.model = {
  DRAFT: (state, draft) => ({ ...state, draft }),
  ADD: (state) => (state.draft ? { ...state, todos: [...state.todos, state.draft], draft: '' } : ABORT),
}
` },
  intent: { lang: 'jsx', code: `Search.intent = ({ DOM }) => ({
  QUERY: DOM.input(Query).value(),
  CLEAR: DOM.click(Clear),
  // a control on a page-wide source: clicks on the Close button, wherever it is rendered
  CLOSE: DOM.select('document').select(Close).events('click'),
})
` },
  addTodoTest: { lang: 'jsx', code: `// AddTodo.test.jsx
import { it, expect } from 'vitest'
import { renderComponent } from 'sygnal'
import { AddTodo, Draft, Add } from './AddTodo.jsx'

it('adds the typed todo', async () => {
  const t = renderComponent(AddTodo, { dom: 'real' })
  await t.ready()
  t.simulateEvent(Draft, 'input', { value: 'milk' })
  await t.next(s => s.draft === 'milk')
  t.simulateEvent(Add, 'click')
  await t.next(s => s.todos.length === 1)
  expect(t.query(Draft).value).toBe('')
  expect(t.queryAll('li').map(li => li.textContent)).toEqual(['milk'])
  t.dispose()
})
` },
  todoList: { lang: 'jsx', code: `// TodoList.jsx
import { Collection, controls } from 'sygnal'

export const { Done, Remove } = controls({ Done: 'input', Remove: 'button' })

function TodoItem({ state }) {
  return (
    <li data-id={state.id}>
      <label><Done type="checkbox" checked={state.done} /> {state.title}</label>
      <Remove>Remove</Remove>
    </li>
  )
}

TodoItem.intent = ({ DOM }) => ({ TOGGLE: DOM.click(Done), REMOVE: DOM.click(Remove) })
TodoItem.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  REMOVE: () => undefined,
}

export function TodoList() {
  return (
    <ul>
      <Collection of={TodoItem} from="todos" />
    </ul>
  )
}

TodoList.initialState = {
  todos: [{ id: 1, title: 'Milk', done: false }, { id: 2, title: 'Eggs', done: false }, { id: 3, title: 'Bread', done: false }],
}
` },
  within: { lang: 'jsx', code: `const t = renderComponent(TodoList, { dom: 'real' })
await t.ready()
t.simulateEvent(Done, 'click', { within: '[data-id="2"]' })
await t.next(s => s.todos[1].done)
t.simulateEvent(Remove, 'click', { within: '[data-id="3"]' })
await t.next(s => s.todos.length === 2)
` },
  pages: { lang: 'jsx', code: `// Pages.jsx
import { controls, pager } from 'sygnal'

const { Older, Newer } = controls({ Older: 'button', Newer: 'button' })

export function Pages({ state }) {
  const { page, pages, hasPrev, hasNext } = state.pager
  return (
    <nav>
      <Older disabled={!hasPrev}>Older</Older>
      <span className="page">Page {page + 1} of {pages}</span>
      <Newer disabled={!hasNext}>Newer</Newer>
    </nav>
  )
}

Pages.initialState = {}
Pages.uses = { pager: pager({ pageSize: 10, total: 35, next: Newer, prev: Older }) }
` },
  emailForm: { lang: 'jsx', code: `// EmailForm.jsx
import { ABORT, controls } from 'sygnal'

const { Email, Save } = controls({ Email: 'input', Save: 'button' })

export function EmailForm({ state }) {
  return (
    <form>
      <label>Email <Email type="email" value={state.email} /></label>
      <Save type="button">Save</Save>
    </form>
  )
}

EmailForm.initialState = { email: '' }
EmailForm.intent = ({ DOM }) => ({ EMAIL: DOM.input(Email).value(), SAVE: DOM.click(Save) })
EmailForm.model = {
  EMAIL: (state, email) => ({ ...state, email }),
  // an address without @: put the cursor back in the field
  SAVE: { ELEMENT: (state) => (state.email.includes('@') ? ABORT : { focus: Email }) },
}
` },
  types: { lang: 'tsx', code: `import { controls } from 'sygnal'
import type { Component, RenderResult } from 'sygnal'

const { Draft, Add } = controls({ Draft: 'input', Add: 'button' })

type State = { draft: string }

export const NewTodo: Component<State> = ({ state }) => (
  <div>
    <label>New todo <Draft value={state.draft} placeholder="Milk" /></label>
    <Add type="button">Add</Add>
  </div>
)

// @ts-expect-error: \`valeu\` is not an <input> prop
export const typo = <Draft valeu="x" />

export const draftOf = (t: RenderResult<State>): string => t.query(Draft)?.value ?? ''
` },
  stars: { lang: 'jsx', code: `// stars.js
export const stars = {
  kind: 'widget',
  vnode: ({ value = 0, max = 5, ...props }, children, h) =>
    h('span', { ...props, role: 'img', 'aria-label': \`\${value} of \${max} stars\` }, '★'.repeat(value) + '☆'.repeat(max - value)),
  commands: {
    flash: (element, { ms = 300 }) => {
      element.classList.add('flash')
      setTimeout(() => element.classList.remove('flash'), ms)
    },
  },
}
` },
  review: { lang: 'jsx', code: `// Review.jsx
import { controls } from 'sygnal'
import { stars } from './stars.js'

const { Rating, More } = controls({ Rating: stars, More: 'button' })

export function Review({ state }) {
  return (
    <div>
      <Rating value={state.rating} />
      <More disabled={state.rating === 5}>Add a star</More>
    </div>
  )
}

Review.initialState = { rating: 3 }
Review.intent = ({ DOM }) => ({ MORE: DOM.click(More) })
Review.model = {
  MORE: {
    STATE: (state) => ({ ...state, rating: Math.min(state.rating + 1, 5) }),
    ELEMENT: { flash: Rating, ms: 300 },
  },
}
` },
  counterBefore: { lang: 'jsx', code: `import { ABORT } from 'sygnal'

export function Counter({ state }) {
  return (
    <div>
      <p>{state.count}</p>
      <button className="increment">+1</button>
      <button className="reset" disabled={state.count === 0}>Reset</button>
    </div>
  )
}

Counter.initialState = { count: 0 }
Counter.intent = ({ DOM }) => ({ INCREMENT: DOM.click('.increment'), RESET: DOM.click('.reset') })
Counter.model = {
  INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
  RESET: (state) => (state.count === 0 ? ABORT : { ...state, count: 0 }),
}
` },
  counterAfter: { lang: 'jsx', code: `import { ABORT, controls } from 'sygnal'

const { Increment, Reset } = controls({ Increment: 'button', Reset: 'button' })

export function Counter({ state }) {
  return (
    <div>
      <p>{state.count}</p>
      <Increment>+1</Increment>
      <Reset disabled={state.count === 0}>Reset</Reset>
    </div>
  )
}

Counter.initialState = { count: 0 }
Counter.intent = ({ DOM }) => ({ INCREMENT: DOM.click(Increment), RESET: DOM.click(Reset) })
Counter.model = {
  INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
  RESET: (state) => (state.count === 0 ? ABORT : { ...state, count: 0 }),
}
` },
  pin: { lang: 'jsx', code: `// Not <Pin>📌</Pin>: the key isn't rendered, so that button's only text is the emoji
<Pin aria-pressed={String(state.pinned)}>📌 Pin</Pin>
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

// A sample that is a test file: its it() calls are collected by a shim (the import specifier
// 'vitest' is pointed at it; the sample is unchanged) and run here, in order
const VITEST_SHIM = `export { expect, vi } from 'vitest'
export const registered = { tests: [] }
export const it = (name, fn) => { registered.tests.push([name, fn]) }
`
async function runTestFile(files, main) {
  const { base } = await load({ ...files, 'vitest-shim.mjs': VITEST_SHIM }, main, { vitest: './vitest-shim.mjs' })
  const { registered } = await import(pathToFileURL(path.join(base, 'vitest-shim.mjs')).href)
  for (const [, fn] of registered.tests) await fn()
  return registered.tests.map(([name]) => name)
}

// sygnal-check --strict on a set of files in a folder of their own, as check-doc-samples does
function checkIn(name, files) {
  const base = path.join(dir, 'check', name)
  fs.mkdirSync(base, { recursive: true })
  for (const [rel, src] of Object.entries(files)) fs.writeFileSync(path.join(base, rel), src)
  return checkFiles(Object.keys(files).map(f => path.join(base, f)), { cwd: base, strict: true })
    .map(d => `${path.basename(d.file || '')} ${d.code} ${d.message}`)
}

beforeAll(() => { dir = fs.mkdtempSync(path.join(here, '.p4-4p-controls-')) })
afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }) })

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; vi.restoreAllMocks() })

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ── the samples are on the page ─────────────────────────────────────────────

describe('every sample is in guide/controls, verbatim', () => {
  const page = fs.readFileSync(PAGE, 'utf8')
  for (const [name, { lang, code }] of Object.entries(SAMPLES)) {
    it(name, () => { expect(codesOf(page, lang)).toContain(code) })
  }
  it('the page is marked as an alternative form and listed on alternative-forms', () => {
    expect(page).toContain(':::note[An alternative form]')
    const alt = fs.readFileSync(path.join(repo, 'docs/src/content/docs/advanced/alternative-forms.md'), 'utf8')
    expect(alt).toContain('## Controls instead of class selectors')
    expect(alt).toContain('(/guide/controls/)')
  })
})

// ── static: strict-clean and a11y-clean ─────────────────────────────────────

// whole modules (with the files they import): no finding but the ones listed
const WHOLE = {
  addTodo: [{ 'AddTodo.jsx': 'addTodo' }, []],
  todoList: [{ 'TodoList.jsx': 'todoList' }, []],
  pages: [{ 'Pages.jsx': 'pages' }, []],
  emailForm: [{ 'EmailForm.jsx': 'emailForm' }, []],
  review: [{ 'Review.jsx': 'review', 'stars.js': 'stars' }, []],
  counterBefore: [{ 'Counter.jsx': 'counterBefore' }, []],
  counterAfter: [{ 'Counter.jsx': 'counterAfter' }, []],
}

describe('sygnal-check --strict: no strict or a11y findings', () => {
  for (const [name, { code, lang }] of Object.entries(SAMPLES)) {
    it(name, () => {
      const found = checkIn(name, { [name + (lang === 'tsx' ? '.tsx' : '.jsx')]: code })
      expect(found.filter(f => / SYG[57]\d\d /.test(f))).toEqual([])
    })
  }
  for (const [name, [files, allowed]] of Object.entries(WHOLE)) {
    it(`${name}: no finding at all (whole module)`, () => {
      const found = checkIn('whole-' + name, Object.fromEntries(Object.entries(files).map(([f, s]) => [f, SAMPLES[s].code])))
      expect(found).toEqual(allowed)
    })
  }
})

// ── the samples run ─────────────────────────────────────────────────────────

describe('guide/controls', () => {
  it('AddTodo renders its controls with data-control and nothing else', async () => {
    const { mod } = await load({ 'AddTodo.jsx': SAMPLES.addTodo.code }, 'AddTodo.jsx')
    t = renderComponent(mod.AddTodo)
    await t.ready()
    expect(t.html()).toContain('<button type="button" data-control="Add">Add</button>')
    expect(t.html()).toContain('<input value="" data-control="Draft">')
    expect(String(mod.Add)).toBe('[data-control="Add"]')
    t.expectNoDiagnostics()
  })

  it('the testing sample runs against AddTodo', async () => {
    const names = await runTestFile({ 'AddTodo.jsx': SAMPLES.addTodo.code, 'AddTodo.test.jsx': SAMPLES.addTodoTest.code }, 'AddTodo.test.jsx')
    expect(names).toEqual(['adds the typed todo'])
  })

  it('intent: DOM shorthands and DOM.select(\'document\').select(control)', async () => {
    const prelude = `import { controls } from 'sygnal'
const { Query, Clear, Close } = controls({ Query: 'input', Clear: 'button', Close: 'button' })
function Search({ state }) {
  return <div><label>Search <Query value={state.query} /></label><Clear>Clear</Clear><Close>Close</Close><p className="open">{String(state.open)}</p></div>
}
Search.initialState = { query: '', open: true }
Search.model = {
  QUERY: (state, query) => ({ ...state, query }),
  CLEAR: (state) => ({ ...state, query: '' }),
  CLOSE: (state) => ({ ...state, open: false }),
}
`
    const { mod } = await load({ 'Search.jsx': prelude + SAMPLES.intent.code + '\nexport { Search }\n' }, 'Search.jsx')
    t = renderComponent(mod.Search, { dom: 'real' })
    await t.ready()
    t.simulateEvent('[data-control="Query"]', 'input', { value: 'milk' }); await t.next(s => s.query === 'milk')
    t.simulateEvent('[data-control="Clear"]', 'click'); await t.next(s => s.query === '')
    t.simulateEvent('[data-control="Close"]', 'click'); await t.next(s => !s.open)
    t.expectNoDiagnostics()
  })

  it('Collections: per-item controls; within picks the item', async () => {
    const run = `import { renderComponent } from 'sygnal'
import { TodoList, Done, Remove } from './TodoList.jsx'
export async function go() {
${SAMPLES.within.code}return t
}
`
    const { mod } = await load({ 'TodoList.jsx': SAMPLES.todoList.code, 'run.jsx': run }, 'run.jsx')
    t = await mod.go()
    expect(t.state.todos.map(x => [x.title, x.done])).toEqual([['Milk', false], ['Eggs', true]])
    expect(t.queryAll('li').map(li => li.getAttribute('data-id'))).toEqual(['1', '2'])
    expect(t.queryAll('[data-control="Done"]').map(x => x.checked)).toEqual([false, true])
    t.expectNoDiagnostics()
  })

  it('behavior options: pager next/prev are controls', async () => {
    const { mod } = await load({ 'Pages.jsx': SAMPLES.pages.code }, 'Pages.jsx')
    t = renderComponent(mod.Pages, { dom: 'real' })
    await t.ready()
    expect(t.query('.page').textContent).toBe('Page 1 of 4')
    expect(t.query('[data-control="Older"]').disabled).toBe(true)
    t.simulateEvent('[data-control="Newer"]', 'click'); await t.next(s => s.pager.page === 1)
    t.simulateEvent('[data-control="Newer"]', 'click'); await t.next(s => s.pager.page === 2)
    t.simulateEvent('[data-control="Older"]', 'click'); await t.next(s => s.pager.page === 1)
    expect(t.query('.page').textContent).toBe('Page 2 of 4')
    t.expectNoDiagnostics()
  })

  it('element commands: a control as the target (recorded as the control; focused in the real DOM)', async () => {
    const { mod } = await load({ 'EmailForm.jsx': SAMPLES.emailForm.code }, 'EmailForm.jsx')
    t = renderComponent(mod.EmailForm, { dom: 'real' })
    await t.ready()
    t.simulateEvent('[data-control="Email"]', 'input', { value: 'ada' }); await t.next(s => s.email === 'ada')
    t.simulateEvent('[data-control="Save"]', 'click'); await t.settle()
    const [command] = t.commands('ELEMENT')
    expect(String(command.focus)).toBe('[data-control="Email"]')
    expect(typeof command.focus).toBe('function')   // the control itself
    expect(document.activeElement).toBe(t.query('[data-control="Email"]'))
    t.simulateEvent('[data-control="Email"]', 'input', { value: 'ada@example.com' }); await t.next(s => s.email.includes('@'))
    t.simulateEvent('[data-control="Save"]', 'click'); await t.settle()
    expect(t.commands('ELEMENT')).toHaveLength(1)
    t.expectNoDiagnostics()
  })

  it('TypeScript: props from the element, t.query typed, a typo is an error (tsc)', () => {
    const base = path.join(dir, 'tsc')
    fs.mkdirSync(base, { recursive: true })
    fs.writeFileSync(path.join(base, 'NewTodo.tsx'), SAMPLES.types.code)
    const options = {
      target: ts.ScriptTarget.ES2020, lib: ['lib.es2021.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, noEmit: true, skipLibCheck: true, jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: 'sygnal', baseUrl: base,
      paths: { sygnal: [path.join(repo, 'src/index.d.ts')], 'sygnal/jsx-runtime': [path.join(repo, 'src/jsx-runtime.d.ts')], xstream: [path.join(repo, 'node_modules/xstream')], 'xstream/*': [path.join(repo, 'node_modules/xstream/*')] },
    }
    const errors = ts.getPreEmitDiagnostics(ts.createProgram([path.join(base, 'NewTodo.tsx')], options))
      .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
    expect(errors).toEqual([])
    // without the @ts-expect-error line's directive, the typo is an error
    fs.writeFileSync(path.join(base, 'Typo.tsx'), SAMPLES.types.code.replace(/^\/\/ @ts-expect-error.*\n/m, ''))
    const typo = ts.getPreEmitDiagnostics(ts.createProgram([path.join(base, 'Typo.tsx')], options))
      .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
    expect(typo.join('\n')).toMatch(/valeu/)
  }, 30_000)

  it('widget controls: vnode(props, children, h) gets the stamp; spec commands run on the element', async () => {
    const { mod } = await load({ 'stars.js': SAMPLES.stars.code, 'Review.jsx': SAMPLES.review.code }, 'Review.jsx')
    t = renderComponent(mod.Review, { dom: 'real' })
    await t.ready()
    const rating = () => t.query('[data-control="Rating"]')
    expect(rating().tagName).toBe('SPAN')
    expect(rating().getAttribute('role')).toBe('img')
    expect(rating().getAttribute('aria-label')).toBe('3 of 5 stars')
    expect(rating().textContent).toBe('★★★☆☆')
    t.simulateEvent('[data-control="More"]', 'click'); await t.next(s => s.rating === 4)
    await vi.waitFor(() => expect(rating().classList.contains('flash')).toBe(true))
    expect(rating().getAttribute('aria-label')).toBe('4 of 5 stars')
    await sleep(350)
    expect(rating().classList.contains('flash')).toBe(false)
    t.simulateEvent('[data-control="More"]', 'click'); await t.next(s => s.rating === 5)
    expect(t.query('[data-control="More"]').disabled).toBe(true)
    t.expectNoDiagnostics()
  })

  it('sygnal-check --fix --controls turns the "before" counter into the "after" one; both behave the same', async () => {
    const base = path.join(dir, 'fix')
    fs.mkdirSync(base, { recursive: true })
    // a project of its own (the fixer keeps a class that another file of the project mentions)
    fs.writeFileSync(path.join(base, 'package.json'), '{ "name": "counter", "type": "module" }\n')
    const file = path.join(base, 'Counter.jsx')
    fs.writeFileSync(file, SAMPLES.counterBefore.code)
    fixFiles([file], { cwd: base, controls: true })
    expect(fs.readFileSync(file, 'utf8')).toBe(SAMPLES.counterAfter.code)
    fixFiles([file], { cwd: base, controls: true })   // again: no change
    expect(fs.readFileSync(file, 'utf8')).toBe(SAMPLES.counterAfter.code)
    for (const sample of [SAMPLES.counterBefore, SAMPLES.counterAfter]) {
      const { mod } = await load({ 'Counter.jsx': sample.code }, 'Counter.jsx')
      t = renderComponent(mod.Counter)
      await t.ready()
      t.simulateAction('INCREMENT'); t.simulateAction('INCREMENT'); await t.next(s => s.count === 2)
      t.simulateAction('RESET'); await t.next(s => s.count === 0)
      t.dispose(); t = null
    }
  })

  it('the pitfall: the visible label is rendered, the key is not', async () => {
    const prelude = `import { controls } from 'sygnal'
const { Pin } = controls({ Pin: 'button' })
export function Note({ state }) {
  return (
`
    const { mod } = await load({ 'Note.jsx': prelude + SAMPLES.pin.code + '  )\n}\nNote.initialState = { pinned: false }\nNote.intent = ({ DOM }) => ({ PIN: DOM.click(Pin) })\nNote.model = { PIN: (state) => ({ ...state, pinned: !state.pinned }) }\n' }, 'Note.jsx')
    t = renderComponent(mod.Note)
    await t.ready()
    expect(t.html()).toContain('<button aria-pressed="false" data-control="Pin">📌 Pin</button>')
  })
})
