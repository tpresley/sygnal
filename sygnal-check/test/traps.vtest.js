/**
 * PLAN-4 4-G2: static checks for the Sygnal traps in REPORT-v4's Haiku failures (recommendation 4).
 *
 *   SYG405 (static)  a component with an `initialState` (and no `isolatedState = true`) that another
 *                    component renders: by tag (error, the runtime throws) or as a Collection /
 *                    Switchable target (warn, the runtime warns). Reported at the initialState.
 *   SYG129           `CHILD.select(X)` in a component that doesn't render X, while a component it
 *                    renders does (a grandchild, PLAN-3 G-187): warn, with the PARENT relay fix.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'
import { CODES } from '../src/codes.js'
import { getExplanation } from '../src/explain.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function check(files, opts = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-4g2-'))
  for (const [rel, src] of Object.entries(files)) {
    const p = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, src)
  }
  const sources = Object.keys(files).filter(f => /\.[jt]sx?$/.test(f)).map(f => path.join(tmp, f))
  return checkFiles(sources, { cwd: tmp, ...opts })
}
const only = (diags, code) => diags.filter(d => d.code === code)
const brief = (diags) => diags.map(d => `${d.code} ${d.severity} ${d.file}:${d.line}`)

// Task 28's shape (REPORT-v4: 4 of 5 Haiku trials)
const STOPWATCH = (extra = '') => `export function Stopwatch({ state }) {
  return <p className="time">{state.ms}</p>
}
Stopwatch.initialState = { ms: 0, running: false }
${extra}`
const APP = (jsx) => `import { Stopwatch } from './Stopwatch.jsx'
export function App({ state }) {
  return <main>${jsx}</main>
}
App.initialState = { show: true, stopwatch: { ms: 0, running: false } }
`

describe('SYG405 (static): sub-component with initialState', () => {
  it('registered as a static code (error, reportedBy static and runtime)', () => {
    expect(CODES.SYG405?.severity).toBe('error')
    expect(getExplanation('SYG405').reportedBy).toEqual(expect.arrayContaining(['runtime', 'static']))
  })

  it('a lensed child <X state="…"> with initialState: error at the initialState', () => {
    const d = only(check({ 'src/Stopwatch.jsx': STOPWATCH(), 'src/App.jsx': APP('{state.show && <Stopwatch state="stopwatch" />}') }), 'SYG405')
    expect(brief(d)).toEqual(['SYG405 error src/Stopwatch.jsx:4'])
    expect(d[0].component).toBe('Stopwatch')
    expect(d[0].message).toContain('Sub-component initialState replaces the state its parent passes in')
    expect(d[0].message).toContain('<Stopwatch state="stopwatch">')
    expect(d[0].message).toContain('src/App.jsx:3')
    expect(d[0].fix).toContain('Remove Stopwatch.initialState')
    expect(d[0].fix).toContain("App's initialState")
    expect(d[0].fix).toContain('isolatedState = true')
  })

  it('a child rendered by tag without a state prop: error too (the runtime throws either way)', () => {
    const d = only(check({ 'src/Stopwatch.jsx': STOPWATCH(), 'src/App.jsx': APP('<Stopwatch />') }), 'SYG405')
    expect(brief(d)).toEqual(['SYG405 error src/Stopwatch.jsx:4'])
    expect(d[0].message).toContain('<Stopwatch>')
  })

  it('state={…} expression lens, in the same file, and through a helper: error once', () => {
    const src = `function Row({ state }) { return <li>{state.n}</li> }
Row.initialState = { n: 0 }
const rows = (s) => <ul><Row state={{ get: x => x.a, set: (x, a) => ({ ...x, a }) }} /><Row state="b" /></ul>
export function App({ state }) { return <div>{rows(state)}</div> }
App.initialState = { a: { n: 1 }, b: { n: 2 } }
`
    expect(brief(only(check({ 'src/App.jsx': src }), 'SYG405'))).toEqual(['SYG405 error src/App.jsx:2'])
  })

  it('a Collection item or Switchable target with initialState: warning (the runtime warns)', () => {
    const src = `import { Collection, Switchable } from 'sygnal'
function Item({ state }) { return <li>{state.t}</li> }
Item.initialState = { t: '' }
function Page() { return <p>p</p> }
Page.initialState = { x: 1 }
export function App({ state }) {
  return <div><Collection of={Item} from="items" /><Switchable of={{ page: Page }} current="page" /></div>
}
App.initialState = { items: [] }
`
    expect(brief(only(check({ 'src/App.jsx': src }), 'SYG405'))).toEqual(['SYG405 warn src/App.jsx:3', 'SYG405 warn src/App.jsx:5'])
  })

  it('isolatedState = true: nothing; isolatedState not literal: nothing', () => {
    expect(only(check({ 'src/Stopwatch.jsx': STOPWATCH('Stopwatch.isolatedState = true'), 'src/App.jsx': APP('<Stopwatch state="stopwatch" />') }), 'SYG405')).toEqual([])
    expect(only(check({ 'src/Stopwatch.jsx': STOPWATCH('Stopwatch.isolatedState = LOCAL'), 'src/App.jsx': APP('<Stopwatch state="stopwatch" />') }), 'SYG405')).toEqual([])
  })

  it('isolatedState = false is the same as none: error', () => {
    expect(only(check({ 'src/Stopwatch.jsx': STOPWATCH('Stopwatch.isolatedState = false'), 'src/App.jsx': APP('<Stopwatch state="stopwatch" />') }), 'SYG405')).toHaveLength(1)
  })

  it('a root with initialState that nothing renders: nothing', () => {
    const main = `import { run } from 'sygnal'
import { Stopwatch } from './Stopwatch.jsx'
run(Stopwatch)
`
    expect(only(check({ 'src/Stopwatch.jsx': STOPWATCH(), 'src/main.js': main }), 'SYG405')).toEqual([])
  })

  it('a child without initialState: nothing; a child rendered only from a test file not scanned: nothing', () => {
    const plain = `export function Stopwatch({ state }) { return <p>{state.ms}</p> }
Stopwatch.model = { TICK: s => s }
`
    expect(only(check({ 'src/Stopwatch.jsx': plain, 'src/App.jsx': APP('<Stopwatch state="stopwatch" />') }), 'SYG405')).toEqual([])
    expect(only(check({ 'src/Stopwatch.jsx': STOPWATCH() }), 'SYG405')).toEqual([])
  })

  it('a same-named component in another file is not confused with the rendered one', () => {
    const other = `export function Stopwatch() { return <p /> }
Stopwatch.initialState = { ms: 0 }
`
    const app = `import { Stopwatch } from './Plain.jsx'
export function App() { return <main><Stopwatch state="sw" /></main> }
App.initialState = { sw: {} }
`
    const plain = `export function Stopwatch({ state }) { return <p>{state.ms}</p> }
`
    expect(only(check({ 'src/Other.jsx': other, 'src/Plain.jsx': plain, 'src/App.jsx': app }), 'SYG405')).toEqual([])
  })

  it('// sygnal-ignore SYG405 on the initialState line', () => {
    const sw = `export function Stopwatch({ state }) { return <p>{state.ms}</p> }
// sygnal-ignore SYG405
Stopwatch.initialState = { ms: 0 }
`
    expect(only(check({ 'src/Stopwatch.jsx': sw, 'src/App.jsx': APP('<Stopwatch state="stopwatch" />') }), 'SYG405')).toEqual([])
  })
})

// Task 12's shape (REPORT-v4: Haiku 12-t3; 14-t1/t5 are the tag-in-tag variant)
const ROW = `export function TaskRow({ state }) { return <li className="row">{state.title}</li> }
TaskRow.intent = ({ DOM }) => ({ PICK: DOM.click('.row') })
TaskRow.model = { PICK: { PARENT: (state) => state.id } }
`
const SECTION = (jsx = '<Collection of={TaskRow} from="tasks" />') => `import { Collection } from 'sygnal'
import { TaskRow } from './TaskRow.jsx'
export function Section({ state }) { return <section>${jsx}</section> }
`
const APP12 = (jsx, select = 'CHILD.select(TaskRow)', imports = "import { Collection, Switchable } from 'sygnal'") => `${imports}
import { Section } from './Section.jsx'
import { TaskRow } from './TaskRow.jsx'
export function App({ state }) {
  return <main>${jsx}</main>
}
App.initialState = { sections: [], picked: null }
App.intent = ({ CHILD }) => ({ PICKED: ${select} })
App.model = { PICKED: (state, id) => ({ ...state, picked: id }) }
`

describe('SYG129: CHILD.select() of a component this one does not render (grandchild)', () => {
  it('registered (warn, static)', () => {
    expect(CODES.SYG129?.severity).toBe('warn')
    expect(getExplanation('SYG129').reportedBy).toEqual(['static'])
  })

  it('a Collection item of a child: warn at the CHILD.select call, with the relay fix', () => {
    const d = only(check({
      'src/TaskRow.jsx': ROW,
      'src/Section.jsx': SECTION(),
      'src/App.jsx': APP12('<Collection of={Section} from="sections" />'),
    }), 'SYG129')
    expect(brief(d)).toEqual(['SYG129 warn src/App.jsx:8'])
    expect(d[0].component).toBe('App')
    expect(d[0].message).toContain('CHILD.select(TaskRow)')
    expect(d[0].message).toContain('App > Section > TaskRow')
    expect(d[0].message).toContain('PARENT')
    expect(d[0].fix).toContain('Section')
    expect(d[0].fix).toContain('CHILD.select(Section)')
    expect(d[0].data).toMatchObject({ child: 'TaskRow', path: ['App', 'Section', 'TaskRow'] })
  })

  it('a tag inside a tag child (two levels down): warn, path names every level', () => {
    const list = `import { Card } from './Card.jsx'
export function List({ state }) { return <ul><Card state="card" /></ul> }
`
    const card = `export function Card({ state }) { return <li className="c">x</li> }
Card.intent = ({ DOM }) => ({ GO: DOM.click('.c') })
Card.model = { GO: { PARENT: () => 1 } }
`
    const app = `import { List } from './List.jsx'
import { Card } from './Card.jsx'
export function App() { return <div><List /></div> }
App.initialState = {}
App.intent = (sources) => ({ GO: sources.CHILD.select(Card) })
App.model = { GO: (s) => s }
`
    const d = only(check({ 'src/Card.jsx': card, 'src/List.jsx': list, 'src/App.jsx': app }), 'SYG129')
    expect(brief(d)).toEqual(['SYG129 warn src/App.jsx:5'])
    expect(d[0].data.path).toEqual(['App', 'List', 'Card'])
  })

  it('X rendered by this component (tag, Collection, Switchable, passed as a child): nothing', () => {
    for (const jsx of [
      '<TaskRow state="first" /><Section />',
      '<Collection of={TaskRow} from="rows" /><Section />',
      '<Switchable of={{ row: TaskRow, s: Section }} current="row" />',
      '<Section><TaskRow /></Section>',
    ]) {
      expect(only(check({ 'src/TaskRow.jsx': ROW, 'src/Section.jsx': SECTION(), 'src/App.jsx': APP12(jsx) }), 'SYG129'), jsx).toEqual([])
    }
  })

  it('the view mentions X some other way (h(X), a variable): nothing', () => {
    const src = APP12('<Section />{h(TaskRow, {})}')
    expect(only(check({ 'src/TaskRow.jsx': ROW, 'src/Section.jsx': SECTION(), 'src/App.jsx': src }), 'SYG129')).toEqual([])
  })

  it('a child the checker cannot follow, or X rendered nowhere it can see: nothing', () => {
    // Section from a package: its view is unknown
    const app = APP12('<Section />').replace("from './Section.jsx'", "from 'some-ui'")
    expect(only(check({ 'src/TaskRow.jsx': ROW, 'src/App.jsx': app }), 'SYG129')).toEqual([])
    // nothing renders TaskRow (e.g. not written yet)
    expect(only(check({ 'src/TaskRow.jsx': ROW, 'src/Section.jsx': SECTION('<p />'), 'src/App.jsx': APP12('<Section />') }), 'SYG129')).toEqual([])
  })

  it('a dynamic component in the own view (Switchable with a computed of): nothing', () => {
    const app = APP12('<Section /><Switchable of={pages} current="a" />', undefined,
      "import { Collection, Switchable } from 'sygnal'\nimport { pages } from './pages.js'")
    expect(only(check({ 'src/TaskRow.jsx': ROW, 'src/Section.jsx': SECTION(), 'src/App.jsx': app }), 'SYG129')).toEqual([])
  })

  it('a string CHILD.select: nothing (SYG506 under --strict)', () => {
    const app = APP12('<Section />', "CHILD.select('TaskRow')")
    expect(only(check({ 'src/TaskRow.jsx': ROW, 'src/Section.jsx': SECTION(), 'src/App.jsx': app }), 'SYG129')).toEqual([])
  })
})
