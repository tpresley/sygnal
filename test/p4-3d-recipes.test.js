// @vitest-environment jsdom
// PLAN-4 3-D: the docs recipes for pager, selection and undo, run verbatim (PLAN-4 §1.4).
// Each RECIPES entry is the exact code block for the docs (4-B copies it): it is compiled
// with the automatic JSX runtime (jsxImportSource 'sygnal', as sygnal/vite does), imported
// against the built package (dist: run `npm run build` first), exercised with renderComponent,
// and checked with `sygnal-check --strict` (strict-clean and a11y-clean).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { renderComponent } from 'sygnal'
import { checkFiles } from '../sygnal-check/src/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))

export const RECIPES = {
  // ── guide/behaviors: pager ────────────────────────────────────────────────
  pager: `import { pager } from 'sygnal'

export function TaskList({ state }) {
  const { offset, pageSize, page, pages, hasPrev, hasNext } = state.pager
  return (
    <div>
      <ul>
        {state.tasks.slice(offset, offset + pageSize).map(task => <li>{task.title}</li>)}
      </ul>
      <nav>
        <button className="older" disabled={!hasPrev}>Older</button>
        <span className="page">Page {page + 1} of {pages}</span>
        <button className="newer" disabled={!hasNext}>Newer</button>
      </nav>
    </div>
  )
}

TaskList.initialState = { tasks: [] }
TaskList.uses = { pager: pager({ pageSize: 10, next: '.newer', prev: '.older' }) }
TaskList.model = {
  BOOTSTRAP: { HTTP: () => ({ url: '/api/tasks', ok: 'LOADED' }) },
  LOADED: (state, tasks) => ({ ...state, tasks, pager: { ...state.pager, total: tasks.length } }),
}
`,

  // ── guide/behaviors: selection ────────────────────────────────────────────
  selection: `import { selection, isSelected } from 'sygnal'

export function Inbox({ state }) {
  const { count } = state.sel
  return (
    <div>
      <label>
        <input className="pick-all" type="checkbox" checked={count > 0 && count === state.mails.length} /> Select all
      </label>
      <button className="archive" disabled={count === 0}>Archive ({count})</button>
      <ul>
        {state.mails.map(mail => (
          <li>
            <label>
              <input className="pick" type="checkbox" data-id={mail.id} checked={isSelected(state.sel, mail.id)} /> {mail.subject}
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}

Inbox.initialState = {
  mails: [{ id: 1, subject: 'Lunch?' }, { id: 2, subject: 'Invoice' }, { id: 3, subject: 'Re: plans' }],
}
Inbox.uses = { sel: selection({ multi: true, item: '.pick', all: '.pick-all', from: 'mails' }) }
Inbox.intent = ({ DOM }) => ({ ARCHIVE: DOM.click('.archive') })
Inbox.model = {
  ARCHIVE: (state) => ({
    ...state,
    mails: state.mails.filter(mail => !isSelected(state.sel, mail.id)),
    sel: { ...state.sel, selected: [] },
  }),
}
`,

  // ── advanced/undo: the undo behavior ──────────────────────────────────────
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
Editor.uses = { history: undo({ key: 'doc', coalesceMs: 500, undo: '.undo', redo: '.redo' }) }
Editor.intent = ({ DOM }) => ({ TYPE: DOM.input('.note').value() })
Editor.model = {
  TYPE: (state, text) => ({ ...state, doc: { ...state.doc, text } }),
}
`,

  // ── advanced/undo: keyboard shortcuts (a host intent action replaces the behavior's trigger) ──
  undoKeys: `import { undo, xs } from 'sygnal'

export function Editor({ state }) {
  return (
    <div>
      <label>Note <textarea className="note" value={state.doc.text} /></label>
      <button className="undo" disabled={!state.history.canUndo}>Undo</button>
      <button className="redo" disabled={!state.history.canRedo}>Redo</button>
    </div>
  )
}

const keys = (DOM, shift) => DOM.select('document').events('keydown')
  .filter(e => (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.shiftKey === shift)

Editor.initialState = { doc: { text: '' } }
Editor.uses = { history: undo({ key: 'doc', coalesceMs: 500 }) }
Editor.intent = ({ DOM }) => ({
  TYPE: DOM.input('.note').value(),
  'history.UNDO': xs.merge(DOM.click('.undo'), keys(DOM, false)),
  'history.REDO': xs.merge(DOM.click('.redo'), keys(DOM, true)),
})
Editor.model = {
  TYPE: (state, text) => ({ ...state, doc: { ...state.doc, text } }),
}
`,

  // ── advanced/undo: the undoable() model wrapper ───────────────────────────
  undoable: `import { undoable } from 'sygnal'

export function Editor({ state }) {
  const { past, future } = state.history || { past: [], future: [] }
  return (
    <div>
      <label>Note <textarea className="note" value={state.doc.text} /></label>
      <button className="undo" disabled={past.length === 0}>Undo</button>
      <button className="redo" disabled={future.length === 0}>Redo</button>
    </div>
  )
}

Editor.initialState = { doc: { text: '' } }
Editor.intent = ({ DOM }) => ({ TYPE: DOM.input('.note').value(), UNDO: DOM.click('.undo'), REDO: DOM.click('.redo') })
Editor.model = undoable({
  BOOTSTRAP: { HTTP: () => ({ url: '/api/note', ok: 'LOADED' }) },
  LOADED: (state, doc) => ({ ...state, doc }),
  TYPE: (state, text) => ({ ...state, doc: { ...state.doc, text } }),
}, { key: 'doc', coalesceMs: 500, resetOn: ['LOADED'] })
`,
}

let dir
const mods = {}
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(here, '.p4-3d-recipes-'))
  for (const [name, src] of Object.entries(RECIPES)) {
    fs.writeFileSync(path.join(dir, name + '.jsx'), src)
    // (esbuild can't run under jsdom; TypeScript's transpiler gives the same automatic-runtime output)
    const { outputText: code } = ts.transpileModule(src, { fileName: name + '.jsx', compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'sygnal', module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, allowJs: true,
    } })
    fs.writeFileSync(path.join(dir, name + '.mjs'), code)
    mods[name] = await import(pathToFileURL(path.join(dir, name + '.mjs')).href)
  }
})
afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }) })

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null })

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

describe('the recipes are strict-clean and a11y-clean (sygnal-check --strict)', () => {
  for (const name of Object.keys(RECIPES)) {
    it(name, () => {
      const d = checkFiles([path.join(dir, name + '.jsx')], { cwd: dir, strict: true })
      expect(d.map(x => `${x.code} ${x.message}`)).toEqual([])
    })
  }
})

describe('pager recipe', () => {
  it('pages through the loaded tasks; the buttons disable at the ends', async () => {
    t = renderComponent(mods.pager.TaskList, { dom: 'real' })
    await t.ready()
    t.respond('HTTP', Array.from({ length: 25 }, (_, i) => ({ title: 'task ' + (i + 1) })))
    await t.next(s => s.tasks.length === 25)
    const titles = () => t.queryAll('li').map(li => li.textContent)
    expect(titles()).toHaveLength(10)
    expect(t.query('.page').textContent).toBe('Page 1 of 3')
    expect(t.query('.older').disabled).toBe(true)
    t.simulateEvent('.newer', 'click'); await t.next(s => s.pager.page === 1)
    expect(titles()[0]).toBe('task 11')
    t.simulateEvent('.newer', 'click'); await t.next(s => s.pager.page === 2)
    expect(titles()).toEqual(['task 21', 'task 22', 'task 23', 'task 24', 'task 25'])
    expect(t.query('.newer').disabled).toBe(true)
    t.simulateEvent('.older', 'click'); await t.next(s => s.pager.page === 1)
    t.expectNoDiagnostics()
  })
})

describe('selection recipe', () => {
  it('picks, selects all, archives the selection', async () => {
    t = renderComponent(mods.selection.Inbox, { dom: 'real' })
    await t.ready()
    const pick = (n) => t.simulateEvent(`li:nth-child(${n}) .pick`, 'click')
    pick(1); await t.next(s => s.sel.count === 1)
    pick(3); await t.next(s => s.sel.count === 2)
    expect(t.query('.archive').textContent).toBe('Archive (2)')
    t.simulateEvent('.pick-all', 'click'); await t.next(s => s.sel.count === 3)
    expect(t.query('.pick-all').checked).toBe(true)
    t.simulateEvent('.pick-all', 'click'); await t.next(s => s.sel.count === 0)
    pick(1); await t.next(s => s.sel.count === 1)
    pick(3); await t.next(s => s.sel.count === 2)
    t.simulateEvent('.archive', 'click'); await t.next(s => s.mails.length === 1)
    expect(t.state.mails).toEqual([{ id: 2, subject: 'Invoice' }])
    expect(t.state.sel).toEqual({ selected: [], count: 0 })
    t.expectNoDiagnostics()
  })
})

describe('undo recipes', () => {
  const type = async (text) => { t.simulateEvent('.note', 'input', { value: text }); await t.next(s => s.doc.text === text) }

  it('undo behavior: typing within coalesceMs is one step; undo / redo buttons', async () => {
    t = renderComponent(mods.undo.Editor, { dom: 'real' })
    await t.ready()
    await type('h'); await type('he'); await type('hel')
    expect(t.state.history.past).toEqual([{ text: '' }])
    await sleep(550)
    await type('hello')
    expect(t.state.history.past).toEqual([{ text: '' }, { text: 'hel' }])
    expect(t.query('.redo').disabled).toBe(true)
    t.simulateEvent('.undo', 'click'); await t.next(s => s.doc.text === 'hel')
    t.simulateEvent('.undo', 'click'); await t.next(s => s.doc.text === '')
    expect(t.query('.undo').disabled).toBe(true)
    t.simulateEvent('.redo', 'click'); await t.next(s => s.doc.text === 'hel')
    expect(t.query('.note').value).toBe('hel')
    t.expectNoDiagnostics()
  })

  it('keyboard shortcuts: Ctrl+Z / Ctrl+Shift+Z and the buttons', async () => {
    t = renderComponent(mods.undoKeys.Editor, { dom: 'real' })
    await t.ready()
    await type('a'); await sleep(550); await type('ab')
    t.simulateEvent('document', 'keydown', { ctrlKey: true, key: 'z', shiftKey: false }); await t.next(s => s.doc.text === 'a')
    t.simulateEvent('document', 'keydown', { ctrlKey: true, key: 'Z', shiftKey: true }); await t.next(s => s.doc.text === 'ab')
    t.simulateEvent('.undo', 'click'); await t.next(s => s.doc.text === 'a')
    expect(t.state.history.canRedo).toBe(true)
    t.expectNoDiagnostics()
  })

  it('undoable(): resetOn LOADED clears the history; UNDO / REDO from the intent', async () => {
    t = renderComponent(mods.undoable.Editor, { dom: 'real' })
    await t.ready()
    await type('draft')
    expect(t.state.history.past).toHaveLength(1)
    t.respond('HTTP', { text: 'saved note' })
    await t.next(s => s.doc.text === 'saved note')
    expect(t.state.history).toEqual({ past: [], future: [] })
    expect(t.query('.undo').disabled).toBe(true)
    await type('saved note!')
    t.simulateEvent('.undo', 'click'); await t.next(s => s.doc.text === 'saved note')
    t.simulateEvent('.redo', 'click'); await t.next(s => s.doc.text === 'saved note!')
    t.expectNoDiagnostics()
  })
})
