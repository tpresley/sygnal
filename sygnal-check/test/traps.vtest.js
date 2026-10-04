/**
 * PLAN-4 4-G2: static checks for the Sygnal traps in REPORT-v4's Haiku failures (recommendation 4).
 *
 *   SYG405 (static)  a component with an `initialState` (and no `isolatedState = true`) that another
 *                    component renders: by tag (error, the runtime throws) or as a Collection /
 *                    Switchable target (warn, the runtime warns). Reported at the initialState.
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
