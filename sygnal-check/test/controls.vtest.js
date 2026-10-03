/**
 * PLAN-4 CT-1 (1-D): controls in sygnal-check.
 *
 *   resolution   controls() destructuring, `const C = controls(…)` + `C.Key`,
 *                relative imports and re-exports
 *   SYG110       a control the intent listens to that the view never renders
 *   SYG104       a control rendered only inside a child component's view
 *   SYG124       a component passed where a control or selector is expected
 *   SYG125       a control given .intent / .model / .initialState
 *   SYG126       a control rendered but never listened to (info)
 *   SYG128       two controls() calls in one file reuse a key
 *   --graph      controls listed next to selectors
 *   --fix --controls  single-class selector → control
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles, graphFiles, validateSchema, fixFiles } from '../src/index.js'
import { formatGraph } from '../src/graphText.js'
import { main } from '../src/cli.js'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const schema = JSON.parse(fs.readFileSync(path.join(here, '../schema/inspect.schema.json'), 'utf8'))

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

/** Write `files` ({ relPath: source }) into a temp dir; returns helpers. */
function project(files) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-controls-'))
  for (const [rel, src] of Object.entries(files)) {
    const p = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, src)
  }
  const root = tmp
  const sources = () => Object.keys(files).filter(f => /\.[jt]sx?$/.test(f)).map(f => path.join(root, f))
  return {
    root,
    check: (opts = {}) => checkFiles(sources(), { cwd: root, ...opts }),
    graph: () => graphFiles(sources(), { cwd: root }),
    fix: (opts = {}) => fixFiles(sources(), { cwd: root, controls: true, ...opts }),
    read: (rel) => fs.readFileSync(path.join(root, rel), 'utf8'),
  }
}

const codes = (diags) => diags.map(d => `${d.code} ${d.severity}`).sort()
const only = (diags, code) => diags.filter(d => d.code === code)

const ADD_TODO = `import { controls } from 'sygnal'
const { Draft, Add } = controls({ Draft: 'input', Add: 'button' })

export function AddTodo({ state }) {
  return <div><Draft className="field" value={state.draft} /><Add>Add</Add></div>
}
AddTodo.initialState = { draft: '' }
AddTodo.intent = ({ DOM }) => ({ DRAFT: DOM.input(Draft).value(), ADD: DOM.click(Add) })
AddTodo.model = { DRAFT: (s, draft) => ({ ...s, draft }), ADD: (s) => ({ ...s, draft: '' }) }
`

describe('control resolution', () => {
  it('destructured controls() in the same file: no diagnostics', () => {
    expect(project({ 'AddTodo.jsx': ADD_TODO }).check()).toEqual([])
  })

  it('an aliased controls import works too', () => {
    const src = ADD_TODO.replace("import { controls } from 'sygnal'", "import { controls as ctl } from 'sygnal'").replace('= controls(', '= ctl(')
    expect(project({ 'AddTodo.jsx': src }).check()).toEqual([])
  })

  it('const C = controls(…) with <C.Key> and DOM.click(C.Key)', () => {
    const p = project({
      'App.jsx': `import { controls } from 'sygnal'
const C = controls({ Add: 'button', Clear: 'button' })
export function App() { return <div><C.Add>+</C.Add><C.Clear>x</C.Clear></div> }
App.intent = ({ DOM }) => ({ ADD: DOM.click(C.Add), CLEAR: DOM.select(C.Clear).events('click') })
App.model = { ADD: (s) => s, CLEAR: (s) => s }
`,
    })
    expect(p.check()).toEqual([])
  })

  it('through a relative import and a re-export', () => {
    const p = project({
      'controls.js': `import { controls } from 'sygnal'
export const { Add, Draft } = controls({ Add: 'button', Draft: 'input' })
`,
      'index.js': `export { Add, Draft } from './controls.js'
`,
      'App.jsx': `import { Add } from './controls'
import { Draft } from './index.js'
export function App({ state }) { return <form><Draft value={state.d} /><Add>go</Add></form> }
App.intent = ({ DOM }) => ({ ADD: DOM.click(Add), D: DOM.input(Draft).value() })
App.model = { ADD: (s) => s, D: (s, d) => ({ ...s, d }) }
`,
    })
    expect(p.check()).toEqual([])
  })

  it('a control in a template-string selector', () => {
    const p = project({
      'List.jsx': `import { controls } from 'sygnal'
const { Done } = controls({ Done: 'input' })
export function List() { return <ul><li><Done type="checkbox" /></li></ul> }
List.intent = ({ DOM }) => ({ DONE: DOM.click(\`li \${Done}\`) })
List.model = { DONE: (s) => s }
`,
    })
    expect(p.check()).toEqual([])
  })
})

describe('SYG110 by control', () => {
  it('reports a control the intent listens to but the view never renders', () => {
    const p = project({
      'AddTodo.jsx': ADD_TODO.replace('<Add>Add</Add>', '<button>Add</button>'),
    })
    const d = only(p.check(), 'SYG110')
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('warn')
    expect(d[0].message).toContain('<Add>')
    expect(d[0].message).toContain('never renders')
    expect(d[0].data).toMatchObject({ control: 'Add' })
    expect(d[0].line).toBe(8)
  })

  it('reports an imported control that is not rendered', () => {
    const p = project({
      'controls.js': `import { controls } from 'sygnal'\nexport const { Add } = controls({ Add: 'button' })\n`,
      'App.jsx': `import { Add } from './controls.js'
export function App() { return <div /> }
App.intent = ({ DOM }) => ({ ADD: DOM.click(Add) })
App.model = { ADD: (s) => s }
`,
    })
    expect(codes(p.check())).toEqual(['SYG110 warn'])
  })

  it('a same-named control from another controls() file is a different control', () => {
    const p = project({
      'a.js': `import { controls } from 'sygnal'\nexport const { Add } = controls({ Add: 'button' })\n`,
      'App.jsx': `import { controls } from 'sygnal'
import * as A from './a.js'
const { Add } = controls({ Add: 'button' })
export function App() { return <div><Add /></div> }
App.intent = ({ DOM }) => ({ ADD: DOM.click(A.Add) })
App.model = { ADD: (s) => s }
`,
    })
    expect(codes(p.check())).toEqual(['SYG110 warn', 'SYG126 info'])
  })
})

describe('SYG104 by control', () => {
  it('reports a parent listening to a control rendered only inside a child', () => {
    const p = project({
      'App.jsx': `import { controls, Collection } from 'sygnal'
const { Remove } = controls({ Remove: 'button' })
function Item({ state }) { return <li>{state.t}<Remove>x</Remove></li> }
Item.intent = ({ DOM }) => ({ REMOVE: DOM.click(Remove) })
Item.model = { REMOVE: { PARENT: (s) => s.id } }
function Header() { return <header><Remove>x</Remove></header> }
export function App() { return <div><Header /><Collection of={Item} from="items" /></div> }
App.intent = ({ DOM }) => ({ REMOVE: DOM.click(Remove) })
App.model = { REMOVE: (s) => s }
`,
    })
    const d = p.check()
    expect(codes(d)).toEqual(['SYG104 warn'])
    expect(d[0].message).toMatch(/control <Remove> is only rendered inside child component <(Header|Item)>/)
    expect(d[0].data).toMatchObject({ control: 'Remove' })
  })

  it('a control passed into a child as children renders in the child: SYG104 for the parent', () => {
    const p = project({
      'App.jsx': `import { controls } from 'sygnal'
const { Go } = controls({ Go: 'button' })
function Card({ children }) { return <section>{children}</section> }
export function App() { return <Card><Go>go</Go></Card> }
App.intent = ({ DOM }) => ({ GO: DOM.click(Go) })
App.model = { GO: (s) => s }
`,
    })
    expect(codes(p.check())).toEqual(['SYG104 warn'])
  })
})

describe('SYG126: rendered, never listened to', () => {
  it('reports (info) a control the view renders but no intent listens to', () => {
    const p = project({ 'AddTodo.jsx': ADD_TODO.replace(', ADD: DOM.click(Add)', '') })
    const d = p.check()
    expect(only(d, 'SYG126')).toHaveLength(1)
    const i = only(d, 'SYG126')[0]
    expect(i.message).toContain('<Add>')
    expect(i.line).toBe(5)
    expect(i.data).toMatchObject({ control: 'Add' })
  })

  it('a document-level listener counts as listening', () => {
    const p = project({
      'App.jsx': `import { controls } from 'sygnal'
const { Close } = controls({ Close: 'button' })
export function App() { return <div><Close>x</Close></div> }
App.intent = ({ DOM }) => ({ CLOSE: DOM.select('document').select(Close).events('click') })
App.model = { CLOSE: (s) => s }
`,
    })
    expect(p.check()).toEqual([])
  })

  it('a component without an intent rendering a control is reported once per control', () => {
    const p = project({
      'App.jsx': `import { controls } from 'sygnal'
const { A, B } = controls({ A: 'button', B: 'button' })
export function App() { return <div><A /><B /><A /></div> }
App.initialState = {}
`,
    })
    expect(codes(p.check())).toEqual(['SYG126 info', 'SYG126 info'])
  })
})

describe('SYG124: component where a control or selector is expected', () => {
  const files = (intent) => ({
    'TodoItem.jsx': `export default function TodoItem({ state }) { return <li>{state.t}</li> }
TodoItem.intent = ({ DOM }) => ({ X: DOM.click('li') })
TodoItem.model = { X: { PARENT: (s) => s } }
`,
    'App.jsx': `import { controls } from 'sygnal'
import TodoItem from './TodoItem.jsx'
const { Add } = controls({ Add: 'button' })
function Badge() { return <span>!</span> }
const handler = () => '.x'
export function App() { return <div className="x"><Add /><TodoItem /><Badge /></div> }
App.intent = ({ DOM }) => ({ ${intent} })
App.model = { A: (s) => s }
`,
  })

  it('reports DOM.click(Component) for a component with statics (imported)', () => {
    const d = project(files('A: DOM.click(TodoItem), B: DOM.click(Add)')).check()
    const e = only(d, 'SYG124')
    expect(e).toHaveLength(1)
    expect(e[0].severity).toBe('error')
    expect(e[0].message).toContain('TodoItem')
    expect(e[0].fix).toContain('CHILD.select(TodoItem)')
    expect(e[0].fix).toContain('PARENT')
    expect(e[0].fix).toContain('control')
    expect(only(d, 'SYG110')).toEqual([]) // not also "not a static string"
  })

  it('reports DOM.select(Component) for a capitalised function used as a JSX component', () => {
    const d = project(files("A: DOM.select(Badge).events('click'), B: DOM.click(Add)")).check()
    expect(only(d, 'SYG124').map(x => x.data.component)).toEqual(['Badge'])
  })

  it('reports it under a document chain too', () => {
    const d = project(files("A: DOM.select('document').select(TodoItem).events('click'), B: DOM.click(Add)")).check()
    expect(only(d, 'SYG124')).toHaveLength(1)
  })

  it('does not report controls, strings or lower-case values', () => {
    const d = project(files("A: DOM.click(Add), B: DOM.click(handler()), C: DOM.click('.x')")).check()
    expect(only(d, 'SYG124')).toEqual([])
  })
})

describe('SYG125: control given component statics', () => {
  it('reports .intent / .model / .initialState on a control, in every form', () => {
    const p = project({
      'App.jsx': `import { controls } from 'sygnal'
const { Add, Remove } = controls({ Add: 'button', Remove: 'button' })
const C = controls({ Edit: 'button' })
Add.intent = ({ DOM }) => ({ X: DOM.click('button') })
C.Edit.model = { X: (s) => s }
Object.assign(Remove, { initialState: { n: 0 } })
export function App() { return <div><Add /><Remove /><C.Edit /></div> }
App.intent = ({ DOM }) => ({ A: DOM.click(Add), R: DOM.click(Remove), E: DOM.click(C.Edit) })
App.model = { A: (s) => s, R: (s) => s, E: (s) => s }
`,
    })
    const d = only(p.check(), 'SYG125')
    expect(d.map(x => `${x.line} ${x.severity} ${x.data.control}.${x.data.prop}`)).toEqual([
      '4 error Add.intent', '5 error Edit.model', '6 error Remove.initialState',
    ])
    expect(d[0].message).toContain('controls are elements, not components')
  })

  it('reports an imported control given a static', () => {
    const p = project({
      'controls.js': `import { controls } from 'sygnal'\nexport const { Add } = controls({ Add: 'button' })\n`,
      'App.jsx': `import { Add } from './controls.js'\nAdd.model = {}\n`,
    })
    expect(codes(p.check())).toEqual(['SYG125 error'])
  })

  it('does not report statics on components', () => {
    expect(only(project({ 'AddTodo.jsx': ADD_TODO }).check(), 'SYG125')).toEqual([])
  })
})

describe('SYG128: duplicate control key', () => {
  it('reports a key reused by a second controls() call in the same file', () => {
    const p = project({
      'App.jsx': `import { controls } from 'sygnal'
const { Add } = controls({ Add: 'button' })
const More = controls({ Add: 'a', Other: 'button' })
export function App() { return <div><Add /><More.Add /><More.Other /></div> }
App.intent = ({ DOM }) => ({ A: DOM.click(Add), B: DOM.click(More.Add), C: DOM.click(More.Other) })
App.model = { A: (s) => s, B: (s) => s, C: (s) => s }
`,
    })
    const d = only(p.check(), 'SYG128')
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ severity: 'error', line: 3 })
    expect(d[0].message).toContain("'Add'")
    expect(d[0].message).toContain('line 2')
  })

  it('reports a key repeated inside one controls() object', () => {
    const p = project({ 'a.js': `import { controls } from 'sygnal'\nexport const C = controls({ Add: 'button', Add: 'a' })\n` })
    expect(codes(p.check())).toEqual(['SYG128 error'])
  })

  it('does not report the same key in different files', () => {
    const p = project({
      'a.js': `import { controls } from 'sygnal'\nexport const A = controls({ Add: 'button' })\n`,
      'b.js': `import { controls } from 'sygnal'\nexport const B = controls({ Add: 'button' })\n`,
    })
    expect(p.check()).toEqual([])
  })
})

describe('--graph lists controls next to selectors', () => {
  it('selector entries name the control; components list the controls they render', () => {
    const p = project({ 'AddTodo.jsx': ADD_TODO.replace(', ADD: DOM.click(Add)', ", ADD: DOM.click('.missing')") })
    const g = p.graph()
    expect(validateSchema(schema, g)).toEqual([])
    const c = g.components.find(x => x.name === 'AddTodo')
    expect(c.selectors[0]).toEqual({ selector: '[data-control="Draft"]', control: 'Draft', events: ['input'], matched: true, isolationHit: null })
    expect(c.controls).toEqual([
      { name: 'Draft', element: 'input', listened: true },
      { name: 'Add', element: 'button', listened: false },
    ])
    const text = formatGraph(g)
    expect(text).toContain('controls  Draft <input> ✓, Add <button> (not listened to)')
    expect(text).toContain('selectors Draft [input] ✓')
  })
})

describe('--fix --controls: single-class selector → control', () => {
  const APP = `import { ABORT } from 'sygnal'

export function App({ state }) {
  return (
    <div className="app">
      <input className="draft" value={state.draft} />
      <button type="button" className="btn add">Add</button>
      <button className="clear">Clear</button>
    </div>
  )
}
App.initialState = { draft: '' }
App.intent = ({ DOM }) => ({
  DRAFT: DOM.input('.draft').value(),
  COMMIT: DOM.keydown('.draft').filter(e => e.key === 'Enter'),
  ADD: DOM.click('.add'),
  CLEAR: DOM.select('.clear').events('click'),
})
App.model = {
  DRAFT: (s, draft) => ({ ...s, draft }),
  COMMIT: (s) => s,
  ADD: (s) => (s.draft ? { ...s, draft: '' } : ABORT),
  CLEAR: (s) => ({ ...s, draft: '' }),
}
`

  it('converts, drops unused classes, merges the sygnal import, and is idempotent', () => {
    const p = project({ 'App.jsx': APP })
    const r = p.fix()
    expect(r.controls).toBe(3)
    expect(p.read('App.jsx')).toBe(`import { ABORT, controls } from 'sygnal'

const { Draft, Add, Clear } = controls({ Draft: 'input', Add: 'button', Clear: 'button' })

export function App({ state }) {
  return (
    <div className="app">
      <Draft value={state.draft} />
      <Add type="button" className="btn">Add</Add>
      <Clear>Clear</Clear>
    </div>
  )
}
App.initialState = { draft: '' }
App.intent = ({ DOM }) => ({
  DRAFT: DOM.input(Draft).value(),
  COMMIT: DOM.keydown(Draft).filter(e => e.key === 'Enter'),
  ADD: DOM.click(Add),
  CLEAR: DOM.select(Clear).events('click'),
})
App.model = {
  DRAFT: (s, draft) => ({ ...s, draft }),
  COMMIT: (s) => s,
  ADD: (s) => (s.draft ? { ...s, draft: '' } : ABORT),
  CLEAR: (s) => ({ ...s, draft: '' }),
}
`)
    expect(p.check()).toEqual([])
    const again = p.fix()
    expect(again.controls).toBe(0)
    expect(again.files).toEqual([])
  })

  it('keeps a class that a CSS file uses, or every class with keepClasses', () => {
    const p = project({ 'App.jsx': APP, 'styles.css': '.app .add:hover { color: red }\n/* .clear */\n' })
    p.fix()
    const out = p.read('App.jsx')
    expect(out).toContain('<Add type="button" className="btn add">Add</Add>')
    expect(out).toContain('<Clear>Clear</Clear>') // only in a CSS comment
    expect(out).toContain('<Draft value={state.draft} />')

    const q = project({ 'App.jsx': APP })
    q.fix({ keepClasses: true })
    const kept = q.read('App.jsx')
    expect(kept).toContain('<Draft className="draft" value={state.draft} />')
    expect(kept).toContain('<Clear className="clear">Clear</Clear>')
  })

  it('keeps a class another file (e.g. a test) refers to as a selector', () => {
    const p = project({ 'App.jsx': APP, 'App.test.js': "t.simulateEvent('.clear', 'click')\n" })
    p.fix()
    expect(p.read('App.jsx')).toContain('<Clear className="clear">Clear</Clear>')
  })

  it('leaves an element alone when a string asserts its rendered markup (data-control would change it)', () => {
    const p = project({ 'App.jsx': APP, 'App.test.js': `expect(t.html).toContain('<button class="clear">Clear</button>')\n` })
    expect(p.fix().controls).toBe(2)
    const out = p.read('App.jsx')
    expect(out).toContain('<button className="clear">Clear</button>')
    expect(out).toContain("CLEAR: DOM.select('.clear').events('click')")
  })

  it('wraps a long controls() declaration', () => {
    const p = project({
      'App.jsx': `export function App() {
  return <div><button className="first-long-button">a</button><button className="second-long-button">b</button><button className="third-long-button">c</button></div>
}
App.intent = ({ DOM }) => ({ A: DOM.click('.first-long-button'), B: DOM.click('.second-long-button'), C: DOM.click('.third-long-button') })
App.model = { A: (s) => s, B: (s) => s, C: (s) => s }
`,
    })
    p.fix()
    expect(p.read('App.jsx')).toMatch(/^import \{ controls \} from 'sygnal'\n\nconst \{ FirstLongButton, SecondLongButton, ThirdLongButton \} = controls\(\{\n  FirstLongButton: 'button',\n  SecondLongButton: 'button',\n  ThirdLongButton: 'button',\n\}\)\n\nexport function App/)
    expect(p.check()).toEqual([])
  })

  it('extends an existing controls() declaration and avoids name collisions', () => {
    const p = project({
      'App.jsx': `import { controls } from 'sygnal'
const { Save } = controls({ Save: 'button' })
const Add = 1

export function App() { return <div><Save /><button className="add">+</button></div> }
App.intent = ({ DOM }) => ({ SAVE: DOM.click(Save), ADD: DOM.click('.add') })
App.model = { SAVE: (s) => s, ADD: (s) => s + Add }
`,
    })
    expect(p.fix().controls).toBe(1)
    const out = p.read('App.jsx')
    expect(out).toContain("const { Save, Add2 } = controls({ Save: 'button', Add2: 'button' })")
    expect(out).toContain('<Add2>+</Add2>')
    expect(out).toContain('ADD: DOM.click(Add2)')
    expect(p.check()).toEqual([])
  })

  it('adds an import when the file has none from sygnal', () => {
    const p = project({
      'App.tsx': `import type { Component } from 'sygnal'
export const App: Component = () => <button className="go">go</button>
App.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
App.model = { GO: (s: any) => s }
`,
    })
    p.fix()
    expect(p.read('App.tsx')).toBe(`import type { Component } from 'sygnal'
import { controls } from 'sygnal'

const { Go } = controls({ Go: 'button' })
export const App: Component = () => <Go>go</Go>
App.intent = ({ DOM }) => ({ GO: DOM.click(Go) })
App.model = { GO: (s: any) => s }
`)
  })

  const unchanged = {
    'the class is on two elements': `export function App() { return <div><button className="x">a</button><a className="x">b</a></div> }
App.intent = ({ DOM }) => ({ X: DOM.click('.x') })
App.model = { X: (s) => s }
`,
    'the class is on a component': `function Btn() { return <button>b</button> }
export function App() { return <div><Btn className="x" /></div> }
App.intent = ({ DOM }) => ({ X: DOM.click('.x') })
App.model = { X: (s) => s }
`,
    'the class is (also) in a child view': `import { Collection } from 'sygnal'
function Item() { return <li className="x">i</li> }
Item.intent = ({ DOM }) => ({ X: DOM.click('.x') })
Item.model = { X: (s) => s }
export function App() { return <div><button className="x">a</button><Collection of={Item} from="items" /></div> }
App.intent = ({ DOM }) => ({ X: DOM.click('.x') })
App.model = { X: (s) => s }
`,
    'the class is used with a document selector': `export function App() { return <div><button className="x">a</button></div> }
App.intent = ({ DOM }) => ({ X: DOM.click('.x'), Y: DOM.select('document').select('.x').events('click') })
App.model = { X: (s) => s, Y: (s) => s }
`,
    'the className is dynamic': `export function App({ state }) { return <div><button className={state.on ? 'x' : 'y'}>a</button></div> }
App.intent = ({ DOM }) => ({ X: DOM.click('.x') })
App.model = { X: (s) => s }
`,
    'the selector is not a single class': `export function App() { return <ul><li className="x"><b>a</b></li></ul> }
App.intent = ({ DOM }) => ({ X: DOM.click('.x b'), Y: DOM.click('li.x') })
App.model = { X: (s) => s, Y: (s) => s }
`,
    "'controls' is bound to something else": `const controls = 1
export function App() { return <button className="x">a</button> }
App.intent = ({ DOM }) => ({ X: DOM.click('.x') })
App.model = { X: (s) => s + controls }
`,
  }
  for (const [why, src] of Object.entries(unchanged)) {
    it(`leaves the selector alone when ${why}`, () => {
      const p = project({ 'App.jsx': src })
      expect(p.fix().controls).toBe(0)
      expect(p.read('App.jsx')).toBe(src)
    })
  }

  it('fixFiles without controls: true does not convert (opt-in until P4-D)', () => {
    const p = project({ 'App.jsx': APP })
    fixFiles([path.join(p.root, 'App.jsx')], { cwd: p.root })
    expect(p.read('App.jsx')).toBe(APP)
  })

  it('CLI: --controls (implies --fix) and --keep-classes', () => {
    const p = project({ 'App.jsx': APP })
    let out = ''
    let err = ''
    const code = main(['.', '--controls', '--keep-classes', '--fail-on=never'], {
      cwd: p.root, stdout: { write: (s) => { out += s } }, stderr: { write: (s) => { err += s } },
    })
    expect(code).toBe(0)
    expect(err).toMatch(/converted 3 selectors to controls in 1 file/)
    expect(p.read('App.jsx')).toContain('<Clear className="clear">Clear</Clear>')
  })
})
