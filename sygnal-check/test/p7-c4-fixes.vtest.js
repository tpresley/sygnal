/**
 * PLAN-7 C-4: fixes as edits.
 *
 *   diagnostic.fixes   [{ title, kind, preferred?, fixAll?, edits: [{ file, start, end, line, column,
 *                      endLine, endColumn, text }] }]: applying the edits gives the expected text,
 *                      and re-checking it no longer reports the finding
 *   "did you mean"     SYG110, SYG112, SYG105, SYG127, SYG226, SYG140, SYG141, SYG142, SYG150,
 *                      SYG151, SYG223, SYG641, SYG707
 *   strict rewrites    SYG504, SYG505, SYG506 (+ SYG612 removals): `fixAll`, the same text --fix
 *                      produced before C-4 (goldens in fixtures/p7-c4/golden, captured from the
 *                      pre-C-4 fixFiles)
 *   editor only        SYG101 (add a model stub), SYG102 (remove the entry, a refactor)
 *   fixFiles           with `sources`: texts and edits, never writes
 *   --controls         with `sources`, and controlFixes() (one selector → control)
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkFiles, fixFiles, controlFixes, applyEdits, graphFiles, validateSchema } from '../src/index.js'
import { lineStarts, positionAt } from '../src/edits.js'
import { parseSource } from '../src/ast.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fx = path.join(here, 'fixtures', 'p7-c4')
const schema = JSON.parse(fs.readFileSync(path.join(here, '../schema/inspect.schema.json'), 'utf8'))

// a directory that doesn't exist: every file is an in-memory source (C-1)
const ROOT = path.join(os.tmpdir(), 'sygnal-check-c4-virtual-does-not-exist')
const abs = (files) => Object.fromEntries(Object.entries(files).map(([k, v]) => [path.join(ROOT, k), v]))
const check = (files, opts = {}) => checkFiles(Object.keys(abs(files)).filter(f => /\.[jt]sx?$/.test(f)), { cwd: ROOT, sources: abs(files), ...opts })
const only = (diags, code) => diags.filter(d => d.code === code)

/** Apply one fix to the `files` map ({ rel: text }), checking each edit's line/column against its offsets. */
function apply(files, fix) {
  const out = { ...files }
  const byFile = new Map()
  for (const e of fix.edits) {
    expect(Object.keys(e).sort()).toEqual(['column', 'end', 'endColumn', 'endLine', 'file', 'line', 'start', 'text'])
    const text = files[e.file]
    expect(text, `edit in an unknown file ${e.file}`).toBeTypeOf('string')
    const starts = lineStarts(text)
    expect(positionAt(starts, e.start)).toEqual({ line: e.line, column: e.column })
    expect(positionAt(starts, e.end)).toEqual({ line: e.endLine, column: e.endColumn })
    if (!byFile.has(e.file)) byFile.set(e.file, [])
    byFile.get(e.file).push(e)
  }
  for (const [file, edits] of byFile) out[file] = applyEdits(files[file], edits)
  return out
}

/** The one finding with `code`, its single fix applied; asserts it's gone on a re-check. */
function fixOne(files, code, { opts = {}, pick = (ds) => ds[0], title, kind = 'quickfix', preferred = true } = {}) {
  const ds = only(check(files, opts), code)
  expect(ds.length, `${code} findings`).toBeGreaterThan(0)
  const d = pick(ds)
  expect(d.fixes, `${code} has a fix`).toHaveLength(1)
  const fix = d.fixes[0]
  if (title) expect(fix.title).toBe(title)
  expect(fix.kind).toBe(kind)
  expect(!!fix.preferred).toBe(preferred)
  const out = apply(files, fix)
  const after = only(check(out, opts), code).filter(x => x.message === d.message && x.file === d.file)
  expect(after, `${code} still reported after the fix`).toEqual([])
  return { out, d, fix }
}

// ---------------------------------------------------------------- did you mean

describe('"did you mean" fixes', () => {
  it('SYG110: the selector string, quotes kept, inside a compound selector too', () => {
    const files = {
      'App.jsx': `function App() { return <ul className="list"><li className="item"><button className="add-todo">+</button></li></ul> }
App.intent = ({ DOM }) => ({ ADD: DOM.click('.add-todos'), PICK: DOM.select(".list .itm").events('click') })
App.model = { ADD: (state) => state, PICK: (state) => state }
export default App
`,
    }
    const a = fixOne(files, 'SYG110', { pick: ds => ds.find(d => /add-todos/.test(d.message)), title: "Change '.add-todos' to '.add-todo'" })
    expect(a.out['App.jsx']).toContain("DOM.click('.add-todo')")
    expect(a.fix.edits).toEqual([expect.objectContaining({ file: 'App.jsx', line: 2, column: 45, endLine: 2, endColumn: 57, text: "'.add-todo'" })])
    // the finding's range is the edit's range
    expect([a.d.line, a.d.column, a.d.endLine, a.d.endColumn]).toEqual([2, 45, 2, 57])
    const b = fixOne(files, 'SYG110', { pick: ds => ds.find(d => /itm/.test(d.message)) })
    expect(b.out['App.jsx']).toContain('DOM.select(".list .item")')
  })

  it('SYG110: no fix when nothing is close, or the selector is not a literal', () => {
    const ds = only(check({
      'App.jsx': `const SEL = '.ad'
function App() { return <button className="add">+</button> }
App.intent = ({ DOM }) => ({ A: DOM.click('.zzzzzz'), B: DOM.click(SEL) })
App.model = { A: (s) => s, B: (s) => s }
`,
    }), 'SYG110')
    expect(ds).toHaveLength(2)
    expect(ds.every(d => !d.fixes)).toBe(true)
  })

  it('SYG112: a reply action name', () => {
    const { out } = fixOne({
      'App.jsx': `function App() { return <button className="go">go</button> }
App.intent = ({ DOM }) => ({ LOAD: DOM.click('.go') })
App.model = {
  LOAD: { HTTP: () => ({ url: '/x', ok: 'LODED' }) },
  LOADED: (state, data) => ({ ...state, data }),
}
`,
    }, 'SYG112', { title: "Change 'LODED' to 'LOADED'" })
    expect(out['App.jsx']).toContain("ok: 'LOADED'")
  })

  it('SYG105: renames this side to the near-miss type (not preferred: either side may be wrong)', () => {
    const files = {
      'Doc.jsx': `import { event } from 'sygnal'
export function Doc() { return <button className="save">save</button> }
Doc.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
Doc.model = { SAVE: { EVENTS: event('DOC_SAVE') } }
`,
      'Bar.jsx': `export function Bar() { return <p /> }
Bar.intent = ({ EVENTS }) => ({ SAVED: EVENTS.select('DOC_SAVED') })
Bar.model = { SAVED: (s) => s }
`,
    }
    const { out } = fixOne(files, 'SYG105', { pick: ds => ds.find(d => d.file === 'Bar.jsx'), preferred: false, title: "Change 'DOC_SAVED' to 'DOC_SAVE'" })
    expect(out['Bar.jsx']).toContain("EVENTS.select('DOC_SAVE')")
    expect(only(check(out), 'SYG105')).toEqual([]) // both sides agree now
  })

  it('SYG127: a behavior option key (and a shorthand one keeps its value)', () => {
    const list = (opts) => `import { controls, pager } from 'sygnal'
const { Older, Newer } = controls({ Older: 'button', Newer: 'button' })
export function List({ state }) {
  return <div><Older>Older</Older><Newer>Newer</Newer>{state.items.length}</div>
}
List.initialState = { items: [] }
List.uses = { pager: pager(${opts}) }
`
    const a = fixOne({ 'List.jsx': list('{ nxt: Newer, prev: Older }') }, 'SYG127', { title: "Rename 'nxt' to 'next'" })
    expect(a.out['List.jsx']).toContain('pager({ next: Newer, prev: Older })')
    const b = fixOne({ 'List.jsx': `const nxt = 1\n${list('{ nxt, prev: Older }')}` }, 'SYG127')
    expect(b.out['List.jsx']).toContain('pager({ next: nxt, prev: Older })')
  })

  it('SYG226: an undo track name', () => {
    const { out } = fixOne({
      'Editor.jsx': `import { controls, undoable } from 'sygnal'
const { Inc, Undo, Redo } = controls({ Inc: 'button', Undo: 'button', Redo: 'button' })
export function Editor({ state }) { return <div><Inc>+</Inc><Undo>u</Undo><Redo>r</Redo>{state.doc.n}</div> }
Editor.initialState = { doc: { n: 0 } }
Editor.intent = ({ DOM }) => ({ INC: DOM.click(Inc), UNDO: DOM.click(Undo), REDO: DOM.click(Redo) })
Editor.model = undoable({
  INC: (s) => ({ ...s, doc: { n: s.doc.n + 1 } }),
}, { key: 'doc', track: ['INCC'] })
`,
    }, 'SYG226', { title: "Change 'INCC' to 'INC'" })
    expect(out['Editor.jsx']).toContain("track: ['INC']")
  })

  it('SYG223: a persist pick key', () => {
    const { out } = fixOne({
      'TodoApp.jsx': `import { persist } from 'sygnal'
export function TodoApp({ state }) {
  return <ul>{state.todos.map(t => <li>{t}</li>)}<p>{state.filter}</p></ul>
}
TodoApp.initialState = { todos: [], filter: 'all' }
TodoApp.model = { RESTORE: (state, saved) => ({ ...state, ...saved }) }
TodoApp.persist = persist({ key: 'todo-app', pick: ['todos', "filtr"] })
`,
    }, 'SYG223', { title: "Change 'filtr' to 'filter'" })
    expect(out['TodoApp.jsx']).toContain(`pick: ['todos', "filter"]`)
  })

  it('SYG641: an element command key', () => {
    const { out } = fixOne({
      'F.jsx': `import { controls } from 'sygnal'
const { Email, Go } = controls({ Email: 'input', Go: 'button' })
export function F() { return <div><Email aria-label="mail" /><Go>go</Go></div> }
F.intent = ({ DOM }) => ({ GO: DOM.click(Go) })
F.model = { GO: { ELEMENT: { fokus: Email } } }
`,
    }, 'SYG641', { title: "Change 'fokus' to 'focus'" })
    expect(out['F.jsx']).toContain('ELEMENT: { focus: Email }')
  })

  it('SYG150 and SYG151: the agent action key, and the misspelled static', () => {
    const comp = (stat, key) => `export function Todo({ state }) { return <p>{state.n}</p> }
Todo.initialState = { n: 0 }
Todo.model = { ADD: (s) => ({ ...s, n: s.n + 1 }) }
Todo.${stat} = { name: 'todo', actions: { ${key}: { description: 'add one' } } }
`
    const a = fixOne({ 'Todo.jsx': comp('agents', 'ADD') }, 'SYG151', { title: 'Rename Todo.agents to Todo.agent' })
    expect(a.out['Todo.jsx']).toContain('Todo.agent = {')
    const b = fixOne({ 'Todo.jsx': comp('agent', 'ADDD') }, 'SYG150', { title: "Rename 'ADDD' to 'ADD'" })
    expect(b.out['Todo.jsx']).toContain('actions: { ADD: {')
  })

  it('SYG140, SYG141 and SYG142: widget events and commands', () => {
    const a = fixOne({
      'w.js': `import { defineWidget } from 'sygnal'
export const Stars = defineWidget({
  mount(el, props, emit) { el.onclick = () => { emit('rate', 1); emit('rtae', 2) }; return {} },
  events: ['rate'],
})
`,
    }, 'SYG140', { title: "Change 'rtae' to 'rate'" })
    expect(a.out['w.js']).toContain("emit('rate', 2)")

    const picker = `import { defineWidget } from 'sygnal'
export const DatePicker = defineWidget({
  tag: 'input',
  mount(el, props, emit) { el.onclick = () => emit('pick', 1); return { el } },
  events: ['pick'],
  commands: { open: (fp) => fp.open() },
})
`
    const form = (intent, model) => `import { controls } from 'sygnal'
import { DatePicker } from './picker.js'
const { Due } = controls({ Due: DatePicker })
export function Form({ state }) {
  return <form><label>Due <DatePicker className="due" value={state.due} /></label><label>Other <Due /></label><button className="go">go</button></form>
}
Form.initialState = { due: null }
Form.intent = ({ DOM }) => (${intent})
Form.model = ${model}
`
    const b = fixOne({
      'picker.js': picker,
      'Form.jsx': form(`{ DUE: DOM.select('.due').events('pikc'), GO: DOM.click('.go') }`, `{ DUE: (s, due) => ({ ...s, due }), GO: (s) => s }`),
    }, 'SYG141', { title: "Listen for 'pick'" })
    expect(b.out['Form.jsx']).toContain("DOM.select('.due').events('pick')")

    const c = fixOne({
      'picker.js': picker,
      'Form.jsx': form(`{ GO: DOM.click('.go') }`, `{ GO: { ELEMENT: { opne: '.due' } } }`),
    }, 'SYG142', { title: "Change 'opne' to 'open'" })
    expect(c.out['Form.jsx']).toContain("ELEMENT: { open: '.due' }")
  })

  it('SYG707: an aria attribute name and a role token', () => {
    const files = {
      'App.jsx': `export function App() { return <main><div aria-lable="x" /><div role="buton" tabIndex={0} /></main> }
`,
    }
    const a = fixOne(files, 'SYG707', { pick: ds => ds.find(d => /aria-lable/.test(d.message)), title: 'Change aria-lable to aria-label' })
    expect(a.out['App.jsx']).toContain('<div aria-label="x" />')
    const b = fixOne(files, 'SYG707', { pick: ds => ds.find(d => /buton/.test(d.message)), title: 'Change role "buton" to "button"' })
    expect(b.out['App.jsx']).toContain('<div role="button" tabIndex={0} />')
  })
})

// ---------------------------------------------------------------- strict rewrites

const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p, out); else out.push(p)
  }
  return out
}
/** { rel: text } of a fixture directory */
const readDir = (dir) => Object.fromEntries(walk(dir).map(f => [path.relative(dir, f), fs.readFileSync(f, 'utf8')]))
const GOLDEN = (set) => readDir(path.join(fx, 'golden', set))
const INPUTS = {
  'strict-bad': path.join(here, 'fixtures', 'strict', 'bad'),
  'fix-input': path.join(fx, 'fix-input'),
  'controls-input': path.join(fx, 'controls-input'),
}

describe('strict rewrites as fixAll fixes', () => {
  it('each rewrite is one preferred fixAll quick fix with a title', () => {
    const ds = check(readDir(INPUTS['strict-bad']), { strict: true })
    const fixable = ds.filter(d => d.fixes?.some(f => f.fixAll))
    // PING's raw EVENTS sink is a shorthand entry (SYG504 rewrites it) and CHILD.select('Unknown') has no binding: no fix
    expect(fixable.map(d => d.code).sort()).toEqual(['SYG504', 'SYG504', 'SYG504', 'SYG505', 'SYG505', 'SYG505', 'SYG506'])
    for (const d of fixable) {
      expect(d.fixes).toHaveLength(1)
      expect(d.fixes[0]).toMatchObject({ kind: 'quickfix', preferred: true, fixAll: true })
      expect(d.fixes[0].title).toMatch(/^(Rewrite '.*' to the object form|Use event\(\) in the object form|Replace the emit\(\) spread with an EVENTS sink|Pass the component: CHILD\.select\(\w+\))$/)
      // the legacy non-enumerable edits are the same edits, with absolute paths
      expect(d.edits.map(e => ({ ...e, file: path.relative(ROOT, e.file) }))).toEqual(d.fixes[0].edits.map(({ file, start, end, text }) => ({ file, start, end, text })))
    }
    // SYG505's range is exactly its edit
    const delete505 = fixable.find(d => d.code === 'SYG505' && /'DELETE'/.test(d.message))
    const main = delete505.fixes[0].edits.find(e => e.text.startsWith('{ EVENTS'))
    expect([delete505.line, delete505.column, delete505.endLine, delete505.endColumn]).toEqual([main.line, main.column, main.endLine, main.endColumn])
  })

  it('one fix alone, as an editor applies it: the import edits come with it', () => {
    const files = readDir(INPUTS['fix-input'])
    const golden = GOLDEN('fix-input')
    // a file with one rewrite: its quick fix gives exactly the --fix result (event added, emit removed)
    for (const f of ['emit-only.jsx', 'emit-last.jsx', 'emit-first.jsx']) {
      const d = only(check(files, { strict: true }), 'SYG505').find(x => x.file === f)
      const out = apply(files, d.fixes[0])
      expect(out[f], f).toBe(golden[f])
      expect(only(check(out, { strict: true }), 'SYG505').filter(x => x.file === f)).toEqual([])
    }
    // emit still used elsewhere: the import stays
    const kept = only(check(files, { strict: true }), 'SYG505').find(x => x.file === 'emit-kept.jsx')
    expect(apply(files, kept.fixes[0])['emit-kept.jsx']).toContain("import { emit, event } from 'sygnal'")
    // two emit() rewrites: each alone keeps the import (the other still uses it); the result parses
    const twice = only(check(files, { strict: true }), 'SYG505').filter(x => x.file === 'emit-twice.jsx')
    expect(twice).toHaveLength(2)
    for (const d of twice) {
      const out = apply(files, d.fixes[0])['emit-twice.jsx']
      expect(out).toContain("import { emit, Collection, event } from 'sygnal'")
      expect(parseSource(out, 'x.jsx').errors?.length || 0).toBe(0)
    }
    // SYG612: removing the static
    const removed = only(check(files), 'SYG612').filter(x => x.file === 'removed.jsx' && x.fixes)
    expect(removed.map(d => d.fixes[0].title).sort()).toEqual(['Remove App.DOMSourceName', 'Remove App.storeCalculatedInState'])
    expect(apply(files, removed[0].fixes[0])['removed.jsx']).not.toContain(removed[0].data.static)
  })

  it('every strict rewrite alone parses and clears its finding', () => {
    for (const set of ['strict-bad', 'fix-input']) {
      const files = readDir(INPUTS[set])
      for (const d of check(files, { strict: true }).filter(x => x.fixes?.some(f => f.fixAll))) {
        const out = apply(files, d.fixes[0])
        for (const e of d.fixes[0].edits) expect(parseSource(out[e.file], e.file).errors?.length || 0).toBe(0)
        const again = check(out, { strict: true }).filter(x => x.code === d.code && x.file === d.file && x.message === d.message)
        expect(again, `${set} ${d.code} ${d.message}`).toEqual([])
      }
    }
  })
})

// ---------------------------------------------------------------- fixFiles

describe('fixFiles() on the fixes', () => {
  let tmp
  afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })
  const copy = (set) => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-c4-'))
    fs.cpSync(INPUTS[set], tmp, { recursive: true })
    return tmp
  }
  const sourceFiles = (root) => walk(root).filter(f => /\.[jt]sx?$/.test(f))

  for (const set of ['strict-bad', 'fix-input']) {
    it(`${set}: --fix on disk gives the pre-C-4 result, and again changes nothing`, () => {
      const root = copy(set)
      const r = fixFiles(sourceFiles(root), { cwd: root })
      expect(r.texts).toBeUndefined()
      expect(readDir(root)).toEqual(GOLDEN(set))
      const second = fixFiles(sourceFiles(root), { cwd: root })
      expect(second).toEqual({ fixed: 0, files: [], passes: 0, diagnostics: [] })
    })

    it(`${set}: with sources it returns the texts and edits, and never writes`, () => {
      const root = copy(set)
      const input = readDir(root)
      // the disk holds something else: offsets must apply to the buffers
      for (const f of sourceFiles(root)) fs.writeFileSync(f, '// on disk only\n')
      const disk = readDir(root)
      const sources = Object.fromEntries(Object.entries(input).map(([k, v]) => [path.join(root, k), v]))
      const r = fixFiles(sourceFiles(root), { cwd: root, sources })
      expect(readDir(root)).toEqual(disk)
      const golden = GOLDEN(set)
      const changed = Object.keys(golden).filter(k => golden[k] !== input[k]).sort()
      expect([...r.texts.keys()].map(f => path.relative(root, f)).sort()).toEqual(changed)
      for (const [f, text] of r.texts) expect(text).toBe(golden[path.relative(root, f)])
      expect(r.files.map(f => path.relative(root, f)).sort()).toEqual(changed)
      // one edit per changed file, against the buffer
      expect(r.edits.map(e => e.file).sort()).toEqual(changed)
      const out = apply(input, { edits: r.edits })
      for (const k of changed) expect(out[k]).toBe(golden[k])
      // fixing the result again changes nothing
      const again = fixFiles(sourceFiles(root), { cwd: root, sources: r.texts })
      expect(again.texts.size).toBe(0)
      expect(again.fixed).toBe(0)
    })
  }

  it('an insertion touching another fix\'s edit waits for the next pass (no duplicate import)', () => {
    const src = `import { emit } from 'sygnal'
function A({ state }) { return <button className="a">{state.n}</button> }
A.initialState = { n: 0 }
A.intent = ({ DOM }) => ({ GO: DOM.click('.a'), R: DOM.click('.a') })
A.model = {
  GO: emit('GONE'),
  'R | EVENTS': () => ({ type: 'RESET' }),
}
export default A
`
    const file = path.join(ROOT, 'A.jsx')
    const r = fixFiles([file], { cwd: ROOT, sources: { [file]: src } })
    const out = r.texts.get(file)
    expect(out).toContain("import { event } from 'sygnal'\n")
    expect(out).toContain("GO: { EVENTS: event('GONE') },")
    expect(out).toContain("R: { EVENTS: event('RESET') },")
    expect(r.diagnostics).toEqual([])
  })
})

// ---------------------------------------------------------------- SYG101 / SYG102

describe('SYG101: add a model entry (editor only)', () => {
  const comp = (model, extra = '') => `function App() { return <div><button className="a">a</button><button className="b">b</button></div> }
App.intent = ({ DOM }) => ({ A: DOM.click('.a'), B: DOM.click('.b') })
${extra}App.model = ${model}
export default App
`
  const stub = (files, opts) => fixOne(files, 'SYG101', { title: "Add a model entry for 'B'", preferred: false, ...opts })

  it('after the last entry, on its own line, with its indentation and a comma', () => {
    const { out } = stub({ 'App.jsx': comp('{\n  A: (state) => state,\n}') })
    expect(out['App.jsx']).toContain('App.model = {\n  A: (state) => state,\n  B: (state, data) => state, // TODO\n}')
  })

  it('adds the missing comma and keeps a trailing comment on the last entry', () => {
    const { out } = stub({ 'App.jsx': comp('{\n      A: (state) => state // the A\n}') })
    expect(out['App.jsx']).toContain('App.model = {\n      A: (state) => state, // the A\n      B: (state, data) => state, // TODO\n}')
  })

  it('an empty model, nested indentation and tabs', () => {
    const empty = stub({ 'App.jsx': comp('{}') }, { pick: ds => ds.find(d => d.data.action === 'B'), title: "Add a model entry for 'B'" })
    expect(empty.out['App.jsx']).toContain('App.model = {\n  B: (state, data) => state, // TODO\n}')
    const nested = `function App() { return <div><button className="a">a</button><button className="b">b</button></div> }
App.intent = ({ DOM }) => ({ A: DOM.click('.a'), B: DOM.click('.b') })
const make = () => {
\tconst model = {
\t\tA: (state) => state,
\t}
\treturn model
}
App.model = (() => {
    const m = {}
    return m
})()
export default App
`
    // a model the checker can't see as an object literal: no stub
    expect(only(check({ 'App.jsx': nested }), 'SYG101')).toEqual([])
    const tabs = stub({ 'App.jsx': comp('{\n\tA: (state) => state,\n}', 'if (true) {}\n') })
    expect(tabs.out['App.jsx']).toContain('App.model = {\n\tA: (state) => state,\n\tB: (state, data) => state, // TODO\n}')
    const deep = `function App() { return <div><button className="a">a</button><button className="b">b</button></div> }
App.intent = ({ DOM }) => ({ A: DOM.click('.a'), B: DOM.click('.b') })
const model = {
    A: {
        STATE: (state) => state,
    },
}
App.model = model
export default App
`
    const d = stub({ 'App.jsx': deep })
    expect(d.out['App.jsx']).toContain('const model = {\n    A: {\n        STATE: (state) => state,\n    },\n    B: (state, data) => state, // TODO\n}')
  })

  it('a one-line model gets the stub inline', () => {
    const { out } = stub({ 'App.jsx': comp('{ A: (state) => state }') })
    expect(out['App.jsx']).toContain('App.model = { A: (state) => state, B: (state, data) => state /* TODO */ }')
  })

  it('an edit in another file: the intent is imported, the stub goes into the component\'s model', () => {
    const files = {
      'intent.js': `export const intent = ({ DOM }) => ({ A: DOM.click('.a'), B: DOM.click('.b') })
`,
      'App.jsx': `import { intent } from './intent.js'
function App() { return <div><button className="a">a</button><button className="b">b</button></div> }
App.intent = intent
App.model = {
  A: (state) => state,
}
export default App
`,
    }
    const { d, fix, out } = stub(files)
    expect(d.file).toBe('intent.js')
    expect(fix.edits.map(e => e.file)).toEqual(['App.jsx'])
    expect(out['App.jsx']).toContain('  B: (state, data) => state, // TODO\n}')
  })

  it('no stub when the model lives in another file or is not an object literal', () => {
    const imported = only(check({
      'model.js': 'export const model = { A: (state) => state }\n',
      'App.jsx': `import { model } from './model.js'
function App() { return <div><button className="a">a</button><button className="b">b</button></div> }
App.intent = ({ DOM }) => ({ A: DOM.click('.a'), B: DOM.click('.b') })
App.model = model
`,
    }), 'SYG101')
    expect(imported).toHaveLength(1)
    expect(imported[0].fixes).toBeUndefined()
    const none = only(check({ 'App.jsx': `function App() { return <button className="a">a</button> }\nApp.intent = ({ DOM }) => ({ A: DOM.click('.a') })\n` }), 'SYG101')
    expect(none[0].fixes).toBeUndefined()
  })
})

describe('SYG102: remove the unreachable entry (a refactor, never preferred)', () => {
  const comp = (model) => `function App() { return <button className="a">a</button> }
App.intent = ({ DOM }) => ({ A: DOM.click('.a') })
App.model = ${model}
export default App
`
  const remove = (model, title = "Remove the unreachable entry 'X'") =>
    fixOne({ 'App.jsx': comp(model) }, 'SYG102', { title, kind: 'refactor', preferred: false }).out['App.jsx']

  it('an entry on its own line(s) goes with its line and trailing comment', () => {
    expect(remove('{\n  A: (s) => s,\n  X: (s) => ({\n    ...s,\n  }), // unused\n}'))
      .toContain('App.model = {\n  A: (s) => s,\n}')
    expect(remove('{\n  X: (s) => s,\n  A: (s) => s\n}')).toContain('App.model = {\n  A: (s) => s\n}')
  })

  it('inline entries: the property and its comma', () => {
    expect(remove('{ X: (s) => s, A: (s) => s }')).toContain('App.model = { A: (s) => s }')
    expect(remove('{ A: (s) => s, X: (s) => s }')).toContain('App.model = { A: (s) => s }')
    expect(remove('{ A: (s) => s, X: (s) => s, }')).toContain('App.model = { A: (s) => s, }')
  })

  it("every entry of the action ('X' and 'X | EFFECT'), and the last one leaves {}", () => {
    expect(remove("{\n  A: (s) => s,\n  X: (s) => s,\n  'X | EFFECT': () => {},\n}")).toContain('App.model = {\n  A: (s) => s,\n}')
    const out = fixOne({ 'App.jsx': 'function App() { return <p /> }\nApp.model = { X: (s) => s }\n' }, 'SYG102', { kind: 'refactor', preferred: false }).out['App.jsx']
    expect(out).toContain('App.model = {}')
  })
})

// ---------------------------------------------------------------- --controls

describe('--controls with sources, and controlFixes()', () => {
  const root = ROOT
  const input = readDir(INPUTS['controls-input'])
  const sources = Object.fromEntries(Object.entries(input).map(([k, v]) => [path.join(root, k), v]))
  const files = [path.join(root, 'App.jsx')]

  it('fixFiles({ controls, sources }) gives the pre-C-4 --controls result in memory (style.css from sources keeps the class)', () => {
    const r = fixFiles(files, { cwd: root, controls: true, sources })
    expect(r.controls).toBe(3)
    expect(r.texts.get(files[0])).toBe(GOLDEN('controls-input')['App.jsx'])
    expect(fs.existsSync(root)).toBe(false)
    // without the stylesheet in sources, .styled is no longer kept
    const { [path.join(root, 'style.css')]: _, ...noCss } = sources
    const r2 = fixFiles(files, { cwd: root, controls: true, sources: noCss })
    expect(r2.texts.get(files[0])).toContain('<Styled>{state.n}</Styled>')
  })

  it('controlFixes(): one refactor per selector, under the same conditions', () => {
    const fixes = controlFixes(files, { cwd: root, sources })
    expect(fixes.map(f => f.title)).toEqual(["Convert '.add-item' to the control AddItem", "Convert '.clear' to the control Clear", "Convert '.styled' to the control Styled"])
    const add = fixes[0]
    expect(add).toMatchObject({ kind: 'refactor', file: 'App.jsx', line: 14, column: 18, endLine: 14, endColumn: 29, control: 'AddItem', class: 'add-item' })
    const out = apply(input, add)['App.jsx']
    expect(out).toContain("import { ABORT, controls } from 'sygnal'\n\nconst { AddItem } = controls({ AddItem: 'button' })")
    expect(out).toContain('<AddItem>+</AddItem>')
    expect(out).toContain('ADD: DOM.click(AddItem),')
    expect(out).toContain("CLEAR: DOM.click('.clear'),")
    const after = check({ ...input, 'App.jsx': out })
    expect(after.filter(d => ['SYG110', 'SYG104', 'SYG900'].includes(d.code))).toEqual([])
    // the next conversion on the result extends the declaration
    expect(controlFixes(files, { cwd: root, sources: { ...sources, [files[0]]: out } }).map(f => f.control)).toEqual(['Clear', 'Styled'])
  })

  it('no refactor where --controls would not convert (the class is also rendered by another component)', () => {
    const src = {
      [path.join(root, 'App.jsx')]: `export function App() { return <div><button className="go">go</button><Other /></div> }
App.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
App.model = { GO: (s) => s }
function Other() { return <button className="go">x</button> }
`,
    }
    expect(controlFixes(files, { cwd: root, sources: src })).toEqual([])
  })
})

// ---------------------------------------------------------------- every fix in the fixtures

describe('every fix in the bad fixtures', () => {
  for (const name of ['bad', 'strict/bad']) {
    it(`${name}: parses and clears its finding`, () => {
      const dir = path.join(here, 'fixtures', name)
      const files = readDir(dir)
      const run = (fs_) => checkFiles(Object.keys(fs_).filter(f => /\.[jt]sx?$/.test(f)).map(f => path.join(dir, f)),
        { cwd: dir, strict: true, sources: Object.fromEntries(Object.entries(fs_).map(([k, v]) => [path.join(dir, k), v])) })
      const fixable = run(files).filter(d => d.fixes)
      expect(fixable.length).toBeGreaterThan(0)
      for (const d of fixable) {
        for (const fix of d.fixes) {
          if (d.code === 'SYG102') expect(fix).toMatchObject({ kind: 'refactor' })
          if (fix.kind === 'refactor') expect(fix.preferred).toBeUndefined()
          const out = apply(files, fix)
          for (const e of fix.edits) {
            expect((parseSource(out[e.file], e.file).errors?.length || 0), `${d.code} ${fix.title}`).toBeLessThanOrEqual(parseSource(files[e.file], e.file).errors?.length || 0)
          }
          const again = run(out).filter(x => x.code === d.code && x.file === d.file && x.message === d.message)
          expect(again, `${name}: ${d.code} ${fix.title}`).toEqual([])
        }
      }
    })
  }
})

// ---------------------------------------------------------------- output

describe('fixes in the output', () => {
  const files = {
    'App.jsx': `function App() { return <button className="add">+</button> }
App.intent = ({ DOM }) => ({ ADD: DOM.click('.ad') })
App.model = { ADD: (state) => state }
export default App
`,
  }

  it('JSON output carries fixes; diagnostics without one have no fixes key', () => {
    const json = JSON.parse(JSON.stringify(check(files)))
    const d = json.find(x => x.code === 'SYG110')
    expect(d.fixes).toEqual([{ title: "Change '.ad' to '.add'", kind: 'quickfix', preferred: true, edits: [{ file: 'App.jsx', start: 105, end: 110, line: 2, column: 45, endLine: 2, endColumn: 50, text: "'.add'" }] }])
    expect(json.filter(x => !x.fixes).every(x => !('fixes' in x))).toBe(true)
  })

  it('the graph diagnostics carry them too, and validate against the schema', () => {
    const g = graphFiles([path.join(ROOT, 'App.jsx')], { cwd: ROOT, sources: abs(files) })
    const d = g.components.flatMap(c => c.diagnostics).find(x => x.code === 'SYG110')
    expect(d.fixes[0].edits[0].text).toBe("'.add'")
    expect(validateSchema(schema, g)).toEqual([])
  })

  it('positions count UTF-16 units and lines across CRLF', () => {
    const crlf = { 'App.jsx': `// \u{1F600} smile\r\n${files['App.jsx'].replace(/\n/g, '\r\n')}` }
    const d = only(check(crlf), 'SYG110')[0]
    const e = d.fixes[0].edits[0]
    expect([e.line, e.column, e.endLine, e.endColumn]).toEqual([d.line, d.column, d.endLine, d.endColumn])
    expect(apply(crlf, d.fixes[0])['App.jsx']).toContain("DOM.click('.add')")
  })
})
