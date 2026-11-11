// `sygnal-check --report` (src/report/; research: dev-plans/research/behaviour-report): what a change
// does, per component, from the code of the two versions. The last block pins what it gets wrong.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { main, parseArgs } from '../src/cli.js'
import { createMcpServer } from '../src/mcp.js'
import { graphFiles } from '../src/graph.js'
import { behaviourFacts, appDrivers } from '../src/report/facts.js'
import { behaviourReport } from '../src/report/compare.js'
import { formatReport } from '../src/report/markdown.js'

const CWD = path.join(os.tmpdir(), 'behaviour-report-virtual')

function side(files) {
  const out = { graph: null, facts: null, parseErrors: [] }
  const sources = Object.fromEntries(Object.entries(files).map(([f, t]) => [path.join(CWD, f), t]))
  graphFiles(Object.keys(sources).filter(f => /\.[jt]sx?$/.test(f)), {
    cwd: CWD, sources,
    onProject: (p, g) => { out.graph = g; out.facts = behaviourFacts(p, g); out.apps = appDrivers(p); out.parseErrors = p.parseErrors.map(e => p.relPath(e.file)) },
  })
  return out
}

function report(a, b, changedFiles) {
  return behaviourReport(side(typeof a === 'string' ? { 'src/App.jsx': a } : a), side(typeof b === 'string' ? { 'src/App.jsx': b } : b), { base: 'base', head: 'head', changedFiles })
}

const items = (r) => [...r.attention, ...r.notes]
const kinds = (r) => items(r).map(a => a.kind)
const action = (r, name, comp = 0) => r.components[comp].actions.find(a => a.name === name)
const sink = (r, a, s = 'STATE', comp = 0) => action(r, a, comp).sinks.find(x => x.sink === s)

const app = (model, { intent = `({ DOM }) => ({ ADD: DOM.click('.add'), SAVE: DOM.click('.save') })`, head = '', view = `<div><button className="add">{state.n}</button><button className="save">s</button></div>`, extra = '' } = {}) => `${head}
export function App({ state }) { return ${view} }
App.initialState = { n: 0, draft: '', items: [] }
App.intent = ${intent}
App.model = ${model}
${extra}
`
const ABORT = `import { ABORT } from 'sygnal'`

describe('--report: flags', () => {
  it('needs --base, and --head needs --base; not with --graph', () => {
    expect(() => parseArgs(['--report'])).toThrow('--report needs --base')
    expect(() => parseArgs(['--graph', '--head', 'x'])).toThrow('--head needs --base')
    expect(() => parseArgs(['--report', '--base', 'a', '--graph'])).toThrow('cannot be combined')
    expect(() => parseArgs(['--fail-on=high'])).toThrow('--fail-on=high needs --report')
    expect(parseArgs(['--report', '--base', 'a', '--head', 'b', '--json', '--out', 'x.md'])).toMatchObject({ report: true, base: 'a', head: 'b', json: true, out: 'x.md' })
  })
})

describe('--report: side effects', () => {
  it('a new HTTP request on an existing action', () => {
    const r = report(
      app(`{ ADD: (s) => ({ ...s, n: s.n + 1 }), SAVE: (s) => s }`),
      app(`{ ADD: (s) => ({ ...s, n: s.n + 1 }), SAVE: { STATE: (s) => s, HTTP: (s) => ({ url: '/api/save', method: 'POST', json: s.draft, ok: 'SAVED', error: 'FAILED' }) }, SAVED: (s) => s, FAILED: (s) => s }`),
    )
    const a = items(r).find(x => x.kind === 'side-effect')
    expect(a.severity).toBe('high')
    expect(a.text).toContain('`App.SAVE` now sends to HTTP')
    expect(a.text).toContain('POST /api/save → ok SAVED, error FAILED')
    expect(sink(r, 'SAVE', 'HTTP').reads).toEqual(['draft'])
  })

  it('a changed URL is a new request, the old one named', () => {
    const http = (u) => app(`{ ADD: (s) => s, SAVE: { HTTP: () => ({ url: '${u}', method: 'POST', ok: 'A' }) }, A: (s) => s }`)
    const r = report(http('/api/v1/save'), http('/api/v2/save'))
    expect(items(r)[0].text).toContain('new HTTP request: `POST /api/v2/save → ok A` (was `POST /api/v1/save → ok A`)')
  })

  it('the same address with other reply names is not a new request', () => {
    const http = (o) => app(`{ ADD: (s) => s, SAVE: { HTTP: () => ({ url: '/a', method: 'POST', ok: ${o} }) }, A: (s) => s }`, { extra: 'const NAMES = { ok: "A" }' })
    expect(kinds(report(http("NAMES.ok"), http("'A'")))).not.toContain('side-effect')
  })

  it('a new EFFECT and the globals it touches', () => {
    const r = report(
      app(`{ ADD: (s) => s, SAVE: (s) => s }`),
      app(`{ ADD: (s) => s, SAVE: { EFFECT: (s) => { localStorage.setItem('d', s.draft) } } }`),
    )
    expect(items(r).find(a => a.kind === 'side-effect').text).toContain('localStorage.setItem')
  })

  it('a reducer that starts touching a global', () => {
    const r = report(
      app(`{ ADD: (s) => ({ ...s, n: 1 }), SAVE: (s) => s }`),
      app(`{ ADD: (s) => ({ ...s, n: window.innerWidth }), SAVE: (s) => s }`),
    )
    expect(items(r).find(a => a.kind === 'side-effect').text).toContain('STATE now touches `window.innerWidth`')
  })

  it('a clock read in a reducer is a note, not a side effect', () => {
    const r = report(app(`{ ADD: (s) => ({ ...s, n: 1 }), SAVE: (s) => s }`), app(`{ ADD: (s) => ({ ...s, n: Date.now() }), SAVE: (s) => s }`))
    expect(items(r).find(a => a.kind === 'clock')).toMatchObject({ severity: 'low' })
    expect(kinds(r)).not.toContain('side-effect')
  })

  it('a new driver given to run() is a new side-effect surface', () => {
    const v = (d) => ({ 'src/App.jsx': app(`{ ADD: (s) => s, SAVE: (s) => s }`), 'src/main.js': `import { run } from 'sygnal'\nimport { App } from './App.jsx'\nrun(App, ${d})\n` })
    const r = report(v('{}'), v('{ HTTP: makeFetchDriver() }'), ['src/main.js'])
    expect(items(r)[0]).toMatchObject({ severity: 'high', kind: 'driver' })
    expect(items(r)[0].text).toContain('`HTTP`')
    expect(r.coverage.explained).toEqual(['src/main.js'])
  })

  it('a removed side effect', () => {
    const r = report(
      app(`{ ADD: (s) => s, SAVE: { HTTP: () => ({ url: '/a', ok: 'A' }) }, A: (s) => s }`),
      app(`{ ADD: (s) => s, SAVE: (s) => s, A: (s) => s }`),
    )
    expect(kinds(r)).toContain('side-effect-removed')
  })
})

describe('--report: guards', () => {
  const guarded = `{ ADD: (s) => { if (!s.draft) return ABORT; return { ...s, n: s.n + 1 } }, SAVE: (s) => s }`
  const bare = `{ ADD: (s) => { return { ...s, n: s.n + 1 } }, SAVE: (s) => s }`

  it('removed: named with its condition, high', () => {
    const r = report(app(guarded, { head: ABORT }), app(bare, { head: ABORT }))
    expect(items(r)[0]).toMatchObject({ severity: 'high', kind: 'guard-removed', action: 'ADD' })
    expect(items(r)[0].text).toContain('`!s.draft`')
  })

  it('added: listed, no alarm', () => {
    const r = report(app(bare, { head: ABORT }), app(guarded, { head: ABORT }))
    expect(sink(r, 'ADD').guards.added).toEqual(['!s.draft'])
    expect(kinds(r)).not.toContain('guard-removed')
  })

  it('changed condition: paired, medium; through ?: and nested ifs', () => {
    const v = (c) => app(`{ ADD: (s) => (${c} ? ABORT : { ...s, n: 1 }), SAVE: (s) => s }`, { head: ABORT })
    const r = report(v('s.n > 3'), v('s.n > 5'))
    expect(items(r)[0]).toMatchObject({ severity: 'medium', kind: 'guard-changed' })
    expect(items(r)[0].text).toContain('`s.n > 3` became `s.n > 5`')
    const nest = report(
      app(`{ ADD: (s) => { if (s.a) { if (s.b) return ABORT } return { ...s, n: 1 } }, SAVE: (s) => s }`, { head: ABORT }),
      app(`{ ADD: (s) => { if (s.a) { } return { ...s, n: 1 } }, SAVE: (s) => s }`, { head: ABORT }),
    )
    expect(nest.attention.find(a => a.kind === 'guard-removed').text).toContain('`s.a && s.b`')
  })

  it('`return state` from a reducer is a guard too', () => {
    const r = report(
      app(`{ ADD: (s) => { if (s.n > 9) return s; return { ...s, n: s.n + 1 } }, SAVE: (s) => s }`),
      app(`{ ADD: (s) => ({ ...s, n: s.n + 1 }), SAVE: (s) => s }`),
    )
    expect(kinds(r)).toContain('guard-removed')
  })

  it('a trigger filter removed is a guard removed', () => {
    const intent = (x) => `({ DOM }) => ({ ADD: DOM.select('.add').events('keydown')${x}, SAVE: DOM.click('.save') })`
    const r = report(app(`{ ADD: (s) => s, SAVE: (s) => s }`, { intent: intent(`.filter(e => e.key === 'Enter')`) }), app(`{ ADD: (s) => s, SAVE: (s) => s }`, { intent: intent('') }))
    expect(items(r)[0]).toMatchObject({ severity: 'high', kind: 'trigger-filter-removed' })
  })
})

describe('--report: triggers', () => {
  it('rewired: the source added and removed, also through a local', () => {
    const r = report(
      app(`{ ADD: (s) => s, SAVE: (s) => s }`),
      app(`{ ADD: (s) => s, SAVE: (s) => s }`, { intent: `({ DOM }) => { const k = DOM.select('.add').events('keydown'); return { ADD: k, SAVE: DOM.click('.save') } }` }),
    )
    expect(action(r, 'ADD').trigger).toMatchObject({ rewired: true, added: ['keydown .add'], removed: ['click .add'] })
  })

  it('what the stream passes on, with the same source', () => {
    const r = report(
      app(`{ ADD: (s) => s, SAVE: (s) => s }`, { intent: `({ DOM }) => ({ ADD: DOM.click('.add').map(() => 1), SAVE: DOM.click('.save') })` }),
      app(`{ ADD: (s) => s, SAVE: (s) => s }`, { intent: `({ DOM }) => ({ ADD: DOM.click('.add').map(() => 2), SAVE: DOM.click('.save') })` }),
    )
    expect(action(r, 'ADD').trigger).toMatchObject({ rewired: false, logic: true })
  })

  it('keymap(): keys by action, also spread into the intent', () => {
    const head = `import { keymap } from 'sygnal'`
    const intent = (m) => `({ DOM }) => { const keys = keymap(DOM, ${m}); return { ...keys, SAVE: DOM.click('.save') } }`
    const r = report(app(`{ ADD: (s) => s, SAVE: (s) => s }`, { head, intent: intent(`{ a: 'ADD' }`) }), app(`{ ADD: (s) => s, SAVE: (s) => s }`, { head, intent: intent(`{ b: 'ADD' }`) }))
    expect(action(r, 'ADD').trigger).toMatchObject({ added: ['key b'], removed: ['key a'] })
  })
})

describe('--report: reads, writes, reducer logic', () => {
  it('wider writes and reads', () => {
    const r = report(
      app(`{ ADD: (s) => ({ ...s, n: s.n + 1 }), SAVE: (s) => s }`),
      app(`{ ADD: (s) => ({ ...s, n: s.n + 1, draft: s.draft + 'x' }), SAVE: (s) => s }`),
    )
    const x = sink(r, 'ADD')
    expect(x.writes).toMatchObject({ base: ['n'], head: ['n', 'draft'], added: ['draft'] })
    expect(x.readsDiff).toEqual({ added: ['draft'], removed: [] })
    expect(x.logic.kinds).toContain('writes')
    expect(items(r)[0]).toMatchObject({ kind: 'writes-widened' })
  })

  it('same writes, different value: which key', () => {
    const r = report(app(`{ ADD: (s) => ({ ...s, n: s.n + 1, draft: '' }), SAVE: (s) => s }`), app(`{ ADD: (s) => ({ ...s, n: s.n + 2, draft: '' }), SAVE: (s) => s }`))
    expect(sink(r, 'ADD').logic).toMatchObject({ kinds: ['value'], confidence: 'high' })
    expect(sink(r, 'ADD').logic.notes[0]).toContain('`n`')
    expect(kinds(r)).toEqual([])
  })

  it('a local that holds the value is followed into the key', () => {
    const r = report(
      app(`{ ADD: (s) => { const x = s.n + 1; return { ...s, n: x } }, SAVE: (s) => s }`),
      app(`{ ADD: (s) => { const x = s.n + 2; return { ...s, n: x } }, SAVE: (s) => s }`),
    )
    expect(sink(r, 'ADD').logic.kinds).toEqual(['value'])
  })

  it('a new branch, a changed condition', () => {
    const r = report(
      app(`{ ADD: (s) => ({ ...s, n: s.a ? 1 : 2 }), SAVE: (s) => s }`),
      app(`{ ADD: (s) => ({ ...s, n: s.b ? 1 : s.c ? 2 : 3 }), SAVE: (s) => s }`),
    )
    expect(sink(r, 'ADD').logic.kinds).toEqual(expect.arrayContaining(['branch', 'condition']))
  })

  it('writes that become unknown', () => {
    const r = report(app(`{ ADD: (s) => ({ ...s, n: 1 }), SAVE: (s) => s }`, {}), app(`{ ADD: (s, d) => merge(s, d), SAVE: (s) => s }`, { head: `import { merge } from 'lodash'` }))
    expect(kinds(r)).toContain('writes-opaque')
    expect(sink(r, 'ADD').logic.confidence).toBe('low')
  })

  it('a helper: in this file or imported, named, its file accounted for', () => {
    const v = (x) => ({ 'src/App.jsx': app(`{ ADD: (s) => bump(s), SAVE: (s) => s }`, { head: `import { bump } from './bump.js'` }), 'src/bump.js': `export const bump = (s) => ({ ...s, n: s.n + ${x} })\n` })
    const r = report(v(1), v(2), ['src/bump.js'])
    expect(sink(r, 'ADD').logic.kinds).toEqual(['helper', 'value'])
    expect(sink(r, 'ADD').logic.notes[0]).toContain('`bump`')
    expect(r.coverage).toMatchObject({ explained: ['src/bump.js'], unexplained: [] })
  })

  it('of a large object used as `api.x`, only the keys used count', () => {
    const v = (a, b) => ({ 'src/App.jsx': app(`{ ADD: { HTTP: () => api.get(1) }, SAVE: (s) => s }`, { head: `import { api } from './api.js'` }), 'src/api.js': `export const api = { get: (i) => ({ url: '/a/' + i + '${a}', ok: 'X' }), other: () => '${b}' }\n` })
    expect(report(v('', 1), v('', 2), ['src/api.js']).components).toEqual([])
    const r = report(v('', 1), v('x', 1), ['src/api.js'])
    expect(sink(r, 'ADD', 'HTTP').logic.kinds).toContain('helper')
    expect(sink(r, 'ADD', 'HTTP').logic.notes[0]).toContain('`api.get`')
    expect(r.coverage.explained).toEqual(['src/api.js'])
  })

  it('a helper several components reach is one line, and they fold away', () => {
    const v = (x) => ({
      'src/h.js': `export const h = (s) => ({ ...s, n: ${x} })\n`,
      'src/A.jsx': `import { h } from './h.js'\nexport function A() { return <p className="a">a</p> }\nA.initialState = {}\nA.intent = ({ DOM }) => ({ GO: DOM.click('.a') })\nA.model = { GO: (s) => h(s) }\n`,
      'src/B.jsx': `import { h } from './h.js'\nexport function B() { return <p className="b">b</p> }\nB.initialState = {}\nB.intent = ({ DOM }) => ({ GO: DOM.click('.b') })\nB.model = { GO: (s) => g(s) }\nconst g = (s) => { return h(s) }\n`,
    })
    const r = report(v(1), v(2), ['src/h.js'])
    expect(sink(r, 'GO').logic.kinds).toContain('value')
    const w = (x) => ({ 'src/h.js': `const p = (s) => s + ${x}\nexport const h = (s, d) => { return [p, s, d] }\n`, 'src/A.jsx': `import { h } from './h.js'\nexport function A() { return <p className="a">a</p> }\nA.initialState = {}\nA.intent = ({ DOM }) => ({ GO: DOM.click('.a') })\nA.model = { GO: { EFFECT: (s) => h(s, 1) } }\n`, 'src/B.jsx': `import { h } from './h.js'\nexport function B() { return <p className="b">b</p> }\nB.initialState = {}\nB.intent = ({ DOM }) => ({ GO: DOM.click('.b') })\nB.model = { GO: { EFFECT: (s) => h(s, 2) } }\n` })
    const f = report(w(1), w(2), ['src/h.js'])
    expect(f.sharedHelpers[0]).toMatchObject({ name: 'p', components: ['A', 'B'], sinks: 2 })
    expect(f.components.every(c => c.folded)).toBe(true)
    const md = formatReport(f)
    expect(md).toContain('`p` reaches 2 components')
    expect(md).not.toContain('### `A`')
  })

  it("a driver sink that differs: the request differs, even with the arguments in a spread", () => {
    const v = (b) => app(`{ ADD: (s) => s, SAVE: { HTTP: () => ({ ...api.create({ body: '${b}' }), ok: 'ADD' }) } }`, { head: `import { api } from 'client'` })
    expect(sink(report(v('a'), v('b')), 'SAVE', 'HTTP').logic.kinds).toEqual(['payload'])
  })

  it('may remove its Collection item', () => {
    const r = report(app(`{ ADD: (s) => s, SAVE: (s) => ({ ...s, n: 1 }) }`), app(`{ ADD: (s) => s, SAVE: (s) => (s.n ? undefined : { ...s, n: 1 }) }`))
    expect(kinds(r)).toContain('removes')
  })
})

describe('--report: what is not a change', () => {
  const same = (a, b, opts) => expect(report(app(a, opts), app(b, opts)).components).toEqual([])

  it('formatting, comments, parameter and local names, types of function', () => {
    same(`{ ADD: (s) => ({ ...s, n: s.n + 1 }), SAVE: (s) => s }`, `{
      // bump it
      ADD: (state) => {
        return { ...state, n: state.n + 1 }
      },
      SAVE: (st) => st,
    }`)
    same(`{ ADD: (s, d) => { const x = d + 1; return { ...s, n: x } }, SAVE: (s) => s }`, `{ ADD: (t, e) => { const y = e + 1; return { ...t, n: y } }, SAVE: (s) => s }`)
  })

  it('`{ ...s, a }`, set({ a }), set(fn) and the key order', () => {
    const head = `import { set } from 'sygnal'`
    same(`{ ADD: (s) => ({ ...s, n: 1, draft: '' }), SAVE: (s) => s }`, `{ ADD: set({ draft: '', n: 1 }), SAVE: (s) => s }`, { head })
    same(`{ ADD: (s, d) => ({ ...s, n: d }), SAVE: (s) => s }`, `{ ADD: set((s, d) => ({ n: d })), SAVE: (s) => s }`, { head })
  })

  it("{ type, data } and event('T', fn) / emit('T', fn), the shorthand and the object form", () => {
    const head = `import { event, emit } from 'sygnal'`
    same(`{ ADD: { EVENTS: (s) => ({ type: 'A', data: { n: s.n } }) }, SAVE: (s) => s }`, `{ ADD: { EVENTS: event('A', (s) => ({ n: s.n })) }, SAVE: (s) => s }`, { head })
    same(`{ ADD: { EVENTS: (s) => ({ type: 'A', data: { n: s.n } }) }, SAVE: (s) => s }`, `{ ADD: emit('A', (s) => ({ n: s.n })), SAVE: (s) => s }`, { head })
    same(`{ ADD: (s) => s, SAVE: (s) => s }`, `{ ADD: { STATE: (s) => s }, SAVE: { STATE: (s) => s } }`)
  })

  it("an if / else written the other way round doesn't count as a changed condition", () => {
    const r = report(
      app(`{ ADD: (s) => { if (s.a) return { ...s, n: 1 }; return { ...s, n: 2 } }, SAVE: (s) => s }`),
      app(`{ ADD: (s) => { if (!s.a) return { ...s, n: 2 }; return { ...s, n: 1 } }, SAVE: (s) => s }`),
    )
    // (still reported as changed: the code differs; nothing to look at first)
    expect(sink(r, 'ADD').logic.kinds).not.toContain('condition')
    expect(kinds(r)).toEqual([])
  })

  it('a child component changing is reported on the child, not on what renders it', () => {
    const v = (x) => ({
      'src/App.jsx': `import { Row } from './Row.jsx'\nexport function App() { return <Row /> }\nApp.intent = ({ CHILD }) => ({ PICK: CHILD.select(Row) })\nApp.model = { PICK: (s) => s }\nApp.initialState = {}\n`,
      'src/Row.jsx': `export function Row() { return <p>${x}</p> }\nRow.intent = ({ DOM }) => ({ GO: DOM.click('p') })\nRow.model = { GO: { PARENT: () => 1 } }\n`,
    })
    const r = report(v('a'), v('b'))
    expect(r.components.map(c => c.name)).toEqual(['Row'])
  })
})

describe('--report: events, payloads, blast radius', () => {
  const two = (emit, listen = `EVENTS.select('A')`) => ({
    'src/App.jsx': `import { Item } from './Item.jsx'\nexport function App({ state }) { return <div><Item /><p>{state.n}</p></div> }\nApp.initialState = { n: 0 }\nApp.intent = ({ EVENTS }) => ({ GOT: ${listen} })\nApp.model = { GOT: (s) => s }\n`,
    'src/Item.jsx': `export function Item({ state }) { return <button className="b">{state.n}</button> }\nItem.intent = ({ DOM }) => ({ GO: DOM.click('.b') })\nItem.model = { GO: ${emit} }\n`,
  })

  it('a new emission and who hears it', () => {
    const r = report(two(`(s) => s`), two(`{ EVENTS: (s) => ({ type: 'A', data: 1 }) }`))
    expect(items(r).find(a => a.kind === 'event-new').text).toContain('`A` → App')
    expect(r.components.find(c => c.name === 'Item').blast).toContainEqual({ kind: 'event', key: 'A', readers: ['App'] })
  })

  it('emitted with no listener; a listener left behind', () => {
    const none = report(two(`(s) => s`, `EVENTS.select('B')`), two(`{ EVENTS: () => ({ type: 'A', data: 1 }) }`, `EVENTS.select('B')`))
    expect(kinds(none)).toContain('event-no-listener')
    const left = report(two(`{ EVENTS: () => ({ type: 'A', data: 1 }) }`), two(`(s) => s`))
    expect(kinds(left)).toContain('event-orphan')
  })

  it('payload shape, and the receiver through PARENT', () => {
    const v = (p) => ({
      'src/App.jsx': `import { Row } from './Row.jsx'\nexport function App() { return <Row /> }\nApp.initialState = {}\nApp.intent = ({ CHILD }) => { const rows = CHILD.select(Row); return { PICK: rows } }\nApp.model = { PICK: (s) => s }\n`,
      'src/Row.jsx': `export function Row() { return <p>x</p> }\nRow.intent = ({ DOM }) => ({ GO: DOM.click('p') })\nRow.model = { GO: { PARENT: (s) => ${p} } }\n`,
    })
    const r = report(v('s.id'), v('({ pick: s.id })'))
    expect(items(r)[0]).toMatchObject({ kind: 'payload' })
    expect(items(r)[0].text).toContain('a value → { pick }')
    expect(r.components[0].blast).toContainEqual({ kind: 'parent', key: 'PARENT', readers: ['App (PICK)'] })
  })

  it('state: a view that shares it, a lens, a Collection, a context field, a calculated field', () => {
    const v = (x) => ({
      'src/App.jsx': `import { Collection } from 'sygnal'
import { Share, Lens, Item, Ctx } from './kids.jsx'
export function App({ state }) { return <div><Share /><Lens state="user" /><Collection of={Item} from="items" /><Ctx /></div> }
App.initialState = { user: {}, items: [], n: 0, other: 1 }
App.calculated = { double: (s) => s.n * 2 }
App.context = { nCtx: (s) => s.n }
App.intent = ({ DOM }) => ({ A: DOM.click('.a'), B: DOM.click('.b'), C: DOM.click('.c') })
App.model = { A: (s) => ({ ...s, n: ${x} }), B: (s) => ({ ...s, user: {}, items: [${x}] }), C: (s) => ({ ...s, other: ${x} }) }
`,
      'src/kids.jsx': `export function Share({ state }) { return <i>{state.n}{state.double}</i> }
Share.intent = () => ({})
export function Lens({ state }) { return <i>{state.name}</i> }
Lens.intent = () => ({})
export function Item({ state }) { return <i>{state.id}</i> }
Item.intent = () => ({})
export function Ctx({ context }) { return <i>{context.nCtx}</i> }
Ctx.intent = () => ({})
`,
    })
    const r = report(v(1), v(2))
    const blast = Object.fromEntries(r.components[0].blast.map(b => [b.key, b.readers]))
    expect(blast.n).toEqual(['Ctx (context nCtx)', 'Share (view)'])
    expect(blast.double).toEqual(['Share (view)'])
    expect(blast.user).toEqual(['Lens (state="user")'])
    expect(blast.items).toEqual(["Item (Collection from 'items')"])
    expect(blast.other).toBeUndefined()
  })

  it("a Collection item's state lives in the parent's list", () => {
    const v = (x) => ({
      'src/App.jsx': `import { Collection } from 'sygnal'\nimport { Item } from './Item.jsx'\nexport function App() { return <Collection of={Item} from="items" /> }\nApp.initialState = { items: [] }\nApp.intent = () => ({})\n`,
      'src/Item.jsx': `export function Item({ state }) { return <b className="i">{state.a}</b> }\nItem.intent = ({ DOM }) => ({ GO: DOM.click('.i') })\nItem.model = { GO: (s) => ({ ...s, a: ${x} }) }\n`,
    })
    expect(report(v(1), v(2)).components[0].blast).toContainEqual({ kind: 'holder', key: 'items', parent: 'App', readers: [] })
  })
})

describe('--report: the rest of a component', () => {
  it('persistence: the picked keys, and an action that starts writing one', () => {
    const P = `import { persist } from 'sygnal'`
    const r = report(
      app(`{ ADD: (s) => ({ ...s, n: 1 }), SAVE: (s) => s }`, { head: P, extra: `App.persist = persist({ key: 'k', pick: ['n'] })` }),
      app(`{ ADD: (s) => ({ ...s, n: 1, draft: 'x' }), SAVE: (s) => s }`, { head: P, extra: `App.persist = persist({ key: 'k', pick: ['n', 'draft'] })` }),
    )
    const t = items(r).filter(a => a.kind === 'persist').map(a => a.text)
    expect(t[0]).toContain('+draft')
    expect(t[1]).toContain('`App.ADD` now writes persisted key `draft`')
  })

  it('agent surface', () => {
    const agent = (extra) => `App.agent = { name: 'a', actions: { ADD: { description: 'd', consequential: true }${extra} } }`
    const r = report(
      app(`{ ADD: (s) => s, SAVE: (s) => s }`, { extra: agent('') }),
      app(`{ ADD: (s) => s, SAVE: (s) => s }`, { extra: `App.agent = { name: 'a', actions: { ADD: { description: 'd' }, SAVE: { description: 's' } } }` }),
    )
    const t = items(r).filter(a => a.kind === 'agent').map(a => a.text)
    expect(t).toEqual(expect.arrayContaining([expect.stringContaining('can now call `SAVE`'), expect.stringContaining('`ADD` is no longer marked consequential')]))
  })

  it('initial state, context, calculated, view', () => {
    const v = (n, ctx, calc, view) => app(`{ ADD: (s) => s, SAVE: (s) => s }`, { view, extra: `App.context = { c: (s) => ${ctx} }\nApp.calculated = { k: (s) => ${calc} }\nApp.initialState = { n: ${n} }` })
    const r = report(v(0, 's.n', '1', '<p>a</p>'), v(5, 's.m', '2', '<p>b</p>'))
    const c = r.components[0]
    expect(c.state).toEqual([{ name: 'n', change: 'changed', base: '0', head: '5' }])
    expect(c.context[0]).toMatchObject({ name: 'c', change: 'changed', reads: { added: ['m'], removed: ['n'] } })
    expect(c.calculated[0]).toMatchObject({ name: 'k', change: 'changed' })
    expect(c.view.changed).toBe(true)
  })

  it('a moved file is a move, not a removal and an addition', () => {
    const r = report({ 'src/App.jsx': app(`{ ADD: (s) => s, SAVE: (s) => s }`) }, { 'src/pages/App.jsx': app(`{ ADD: (s) => ({ ...s, n: 1 }), SAVE: (s) => s }`) }, [])
    expect(r.summary).toMatchObject({ added: 0, removed: 0, changed: 1 })
    expect(r.components[0]).toMatchObject({ movedFrom: 'src/App.jsx', file: 'src/pages/App.jsx' })
    expect(action(r, 'ADD').change).toBe('changed')
  })

  it('a new component: its side effects are in the list', () => {
    const r = report(app(`{ ADD: (s) => s, SAVE: (s) => s }`), { 'src/App.jsx': app(`{ ADD: (s) => s, SAVE: (s) => s }`), 'src/New.jsx': `export function New() { return <p className="p">n</p> }\nNew.initialState = {}\nNew.intent = ({ DOM }) => ({ GO: DOM.click('.p') })\nNew.model = { GO: { HTTP: () => ({ url: '/x', ok: 'A' }) }, A: (s) => s }\n` })
    expect(r.components[0]).toMatchObject({ name: 'New', status: 'added' })
    // a new action's side effects are in its row, not the attention list
    expect(r.attention).toEqual([])
    expect(formatReport(r)).toContain('`GO` | + `click .p` | + HTTP, + `GET /x → ok A`')
  })

  it('coverage: what is changed and not accounted for', () => {
    const v = (c) => ({ 'src/App.jsx': app(`{ ADD: (s) => s, SAVE: (s) => ({ ...s, n: ${c} }) }`), 'src/util.js': `export const x = 1 // note ${c}\n` })
    const r = report(v(1), v(2), ['src/App.jsx', 'src/util.js', 'src/a.css', 'src/App.test.js'])
    expect(r.coverage).toMatchObject({ files: 4, explained: ['src/App.jsx'], unexplained: ['src/util.js'], nonCode: ['src/a.css'], tests: ['src/App.test.js'] })
  })

  it('a file that stops parsing is said up front', () => {
    const r = report(app(`{ ADD: (s) => s, SAVE: (s) => s }`), 'export function App( {')
    expect(r.coverage.parseErrors).toEqual(['head: src/App.jsx'])
    expect(formatReport(r)).toContain('did not parse')
  })
})

describe('--report: the markdown', () => {
  it('the attention list first, then per component, then what was not looked at', () => {
    const r = report(
      app(`{ ADD: (s) => { if (!s.draft) return ABORT; return { ...s, n: s.n + 1 } }, SAVE: (s) => s }`, { head: ABORT }),
      app(`{ ADD: (s) => ({ ...s, n: s.n + 1, draft: '' }), SAVE: { HTTP: (s) => ({ url: '/save', method: 'POST', ok: 'S' }) }, S: (s) => s }`, { head: ABORT }),
      ['src/App.jsx', 'src/a.css'],
    )
    expect(formatReport(r)).toMatchInlineSnapshot(`
      "<!-- sygnal-behaviour-report -->
      ## Behaviour report

      \`base\` → \`head\`. Components: 1 changed, 0 added, 0 removed. Derived from the code by \`sygnal-check\`, not from the author's description.

      ### Look at these first
      - **Look closely** (Guard removed): \`App.ADD\` STATE: guard removed, it no longer stops when \`!s.draft\` (\`src/App.jsx:5\`)
      - **Look closely** (New side effect): \`App.SAVE\` now sends to HTTP: \`POST /save → ok S\` (\`src/App.jsx:5\`)
      - **Check** (Wider writes): \`App.ADD\` now also writes \`draft\` (\`src/App.jsx:5\`)

      ### \`App\` · \`src/App.jsx\`

      | | action | trigger | sinks | logic |
      |---|---|---|---|---|
      | ~ | \`ADD\` | \`click .add\` | STATE, writes n → n, draft, reads -draft | guard, branches, written keys: fewer branches (1 → 0) |
      | + | \`S\` | + (reply) | + STATE, writes — |  |
      | ~ | \`SAVE\` | \`click .save\` | + HTTP, + \`POST /save → ok S\`<br>− STATE |  |

      **Guards (ABORT / no change)**
      - − \`ADD STATE\` no longer stops when \`!s.draft\`

      ### What this report did not look at
      - Changed files that aren't code: \`src/a.css\`
      - Not analysed at all: what the view renders (markup, text, styling), runtime data and timing. Effects in a view or a helper it calls are reported only as the checker finds them (SYG265, SYG266).
      - Compared only as changed or not: a helper whose body has statements other than if, return and const, and a condition with more than 12 parts. Addresses built with \`+\` are compared as written, not resolved.
      "
    `)
  })
})

describe('--report: attention and notes', () => {
  it('attention: side effects on existing actions, removed guards, wider writes; the rest are notes', () => {
    const r = report(
      app(`{ ADD: (s) => { if (s.x) return ABORT; return { ...s, n: 1 } }, SAVE: (s) => (s.a ? ABORT : { ...s, n: 2 }), Z: (s) => s }`, { head: ABORT }),
      app(`{ ADD: (s) => ({ ...s, n: 1, draft: '' }), SAVE: { STATE: (s) => (s.b ? ABORT : { ...s, n: 2 }), HTTP: () => ({ url: '/x', ok: 'Z' }) }, Z: (s) => s, NEW: { HTTP: () => ({ url: '/n', ok: 'Z' }) } }`, { head: ABORT }),
    )
    expect(r.attention.map(a => a.kind).sort()).toEqual(['guard-removed', 'side-effect', 'writes-widened'])
    expect(r.notes.map(a => a.kind)).toContain('guard-changed')
    expect(r.summary.attention).toBe(3)
    const md = formatReport(r)
    expect(md.indexOf('Look at these first')).toBeLessThan(md.indexOf('Also changed'))
  })

  it('with nothing on the attention list the report says only that', () => {
    const r = report(app(`{ ADD: (s) => ({ ...s, n: 1 }), SAVE: (s) => s }`), app(`{ ADD: (s) => ({ ...s, n: 2 }), SAVE: (s) => s }`))
    expect(formatReport(r)).toContain('That is all this line says')
  })
})

describe('--report: the CLI on a git repository', () => {
  const dirs = []
  afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })
  function repo() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-report-')))
    dirs.push(root)
    const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    git('init', '-q'); git('config', 'user.email', 't@e.st'); git('config', 'user.name', 't')
    const write = (t) => { fs.mkdirSync(path.join(root, 'src'), { recursive: true }); fs.writeFileSync(path.join(root, 'src/App.jsx'), t) }
    const commit = (m) => { git('add', '-A'); git('commit', '-qm', m) }
    write(app(`{ ADD: (s) => s, SAVE: (s) => s }`)); commit('one')
    write(app(`{ ADD: (s) => ({ ...s, n: 1 }), SAVE: (s) => s }`)); commit('two')
    return { root, write }
  }
  function run(argv, cwd) {
    let out = '', err = ''
    const code = main(argv, { cwd, stdout: { write: (s) => { out += s }, isTTY: false }, stderr: { write: (s) => { err += s } }, env: {}, isTTY: false, openFile: () => {} })
    return { code, out, err }
  }

  it('--head compares two commits; without it, the working tree', () => {
    const { root, write } = repo()
    const a = run(['--report', '--base', 'HEAD~1', '--head', 'HEAD', '--json', 'src'], root)
    expect(a.code).toBe(0)
    const d = JSON.parse(a.out)
    expect(d).toMatchObject({ base: 'HEAD~1', head: 'HEAD', summary: { changed: 1 } })
    expect(d.components[0].actions.map(x => x.name)).toEqual(['ADD'])
    expect(d.coverage.explained).toEqual(['src/App.jsx'])
    write(app(`{ ADD: (s) => ({ ...s, n: 1 }), SAVE: (s) => ({ ...s, n: 2 }) }`))
    const b = JSON.parse(run(['--report', '--base', 'HEAD', '--json', 'src'], root).out)
    expect(b.head).toBe('working tree')
    expect(b.components[0].actions.map(x => x.name)).toEqual(['SAVE'])
  })

  it('markdown on stdout or --out; an unknown ref exits 2', () => {
    const { root } = repo()
    expect(run(['--report', '--base', 'HEAD~1', '--head', 'HEAD', 'src'], root).out).toContain('<!-- sygnal-behaviour-report -->')
    const w = run(['--report', '--base', 'HEAD~1', '--out', 'r.md', 'src'], root)
    expect(w.code).toBe(0)
    expect(fs.readFileSync(path.join(root, 'r.md'), 'utf8')).toContain('## Behaviour report')
    const bad = run(['--report', '--base', 'nope', 'src'], root)
    expect(bad.code).toBe(2)
    expect(bad.err).toContain('unknown git ref')
  })

  it('informational by default; --fail-on=high exits 1 on a high item only', () => {
    const { root, write } = repo()
    expect(run(['--report', '--base', 'HEAD~1', '--head', 'HEAD', '--fail-on=high', 'src'], root).code).toBe(0)
    write(app(`{ ADD: (s) => ({ ...s, n: 1 }), SAVE: { HTTP: () => ({ url: '/x', ok: 'ADD' }) } }`))
    expect(run(['--report', '--base', 'HEAD', 'src'], root).code).toBe(0)
    expect(run(['--report', '--base', 'HEAD', '--fail-on=high', 'src'], root).code).toBe(1)
  })

  it('the MCP report tool', () => {
    const { root } = repo()
    const s = createMcpServer({ cwd: root })
    s.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })
    const call = (args) => s.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'report', arguments: args } }).result
    const ok = call({ base: 'HEAD~1', head: 'HEAD', paths: ['src'] })
    expect(ok.structuredContent).toMatchObject({ base: 'HEAD~1', head: 'HEAD', summary: { changed: 1 } })
    expect(call({ base: 'nope', paths: ['src'] })).toMatchObject({ isError: true })
    expect(call({ paths: ['src'] })).toMatchObject({ isError: true })
  })

  it('--graph --base --head: the graph diff of two commits', () => {
    const { root } = repo()
    const d = JSON.parse(run(['--graph', '--json', '--base', 'HEAD~1', '--head', 'HEAD', 'src'], root).out)
    expect(d.head).toBe('HEAD')
  })
})

// What the analysis gets wrong, on purpose: each is written up in the research README. A change here
// means a limit moved, for better or worse.
// Minimal versions of three review-eval cases (test/fixtures/report-inbox/README.md): a refactor that
// changes nothing, a slip inside a helper, an effect in the view; and the negative of each.
const INBOX = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures', 'report-inbox')
function inbox(...layers) {
  const out = {}
  for (const l of layers) {
    const dir = path.join(INBOX, l)
    for (const f of fs.readdirSync(dir, { recursive: true })) if (/\.[jt]sx?$/.test(f)) out[f.split(path.sep).join('/')] = fs.readFileSync(path.join(dir, f), 'utf8')
  }
  return out
}
const comp = (r, name) => r.components.find(c => c.name === name)
const inboxSink = (r, a, s) => comp(r, 'TicketDetail').actions.find(x => x.name === a).sinks.find(x => x.sink === s)

describe('--report: refactors through helpers, and slips inside them', () => {
  it('a request moved into a helper unchanged is the same request, not a new side effect', () => {
    const r = report(inbox('base'), inbox('base', 'refactor'))
    expect(r.attention).toEqual([])
    const close = inboxSink(r, 'CLOSE', 'HTTP')
    expect(close.logic.kinds).toEqual(['moved'])
    expect(close.logic.notes[0]).toContain('same request')
    expect(close.requests.same).toHaveLength(1)
    expect(close.requests.added).toEqual([])
    expect(inboxSink(r, 'SEND', 'HTTP').logic.kinds).toEqual(['moved'])
  })

  it('negative: a request through a helper with another address is still a new request', () => {
    const r = report(inbox('base'), inbox('base', 'refactor', 'new-request'))
    expect(r.attention).toMatchObject([{ severity: 'high', kind: 'side-effect', action: 'CLOSE' }])
    expect(r.attention[0].text).toContain('/archive')
    expect(inboxSink(r, 'SEND', 'HTTP').logic.kinds).toEqual(['moved'])
  })

  it('negative: a body built by a helper that changed is not the same request', () => {
    const v = (x) => app(`{ ADD: (s) => s, SAVE: { HTTP: (s) => ({ url: '/save', method: 'POST', json: body(s), ok: 'ADD' }) } }`, { extra: `function body(s) { let o = { n: s.n }; o.x = ${x}; return o }` })
    const r = report(v(1), v(2))
    expect(sink(r, 'SAVE', 'HTTP').logic.kinds).toEqual(['helper'])
    expect(sink(r, 'SAVE', 'HTTP').logic.verdicts).toMatchObject([{ name: 'body', verdict: 'not-compared' }])
    expect(sink(r, 'SAVE', 'HTTP').logic.notes.join(' ')).not.toContain('same request')
    // the sink's own code changed too: the request is compared, and differs
    const w = (x, req) => app(`{ ADD: (s) => s, SAVE: { HTTP: (s) => (${req}) } }`, { extra: `function body(s) { let o = { n: s.n }; o.x = ${x}; return o }` })
    const t = sink(report(w(1, `{ url: '/save', method: 'POST', json: body(s), ok: 'ADD' }`), w(2, `{ method: 'POST', url: '/save', ok: 'ADD', json: body(s) }`)), 'SAVE', 'HTTP')
    expect(t.logic.kinds).toContain('payload')
    expect(t.logic.kinds).not.toContain('moved')
  })

  it('a guard that only gained parentheses or moved its `!` is unchanged', () => {
    const r = report(inbox('base'), inbox('base', 'refactor'))
    const send = inboxSink(r, 'SEND', 'HTTP')
    expect(send.guards.relation.rel).toBe('same')
    expect(items(r).map(a => a.kind)).not.toContain('guard-changed')
    expect(formatReport(r)).not.toContain('Guards (ABORT')
  })

  it('a `map` moved into a helper is the same values, not a branch removed', () => {
    const r = report(inbox('base'), inbox('base', 'refactor'))
    const closed = inboxSink(r, 'CLOSED', 'STATE')
    expect(closed.logic.kinds).toEqual(['moved'])
    expect(closed.logic.notes[0]).toContain('`replaceTicket`')
    expect(items(r).map(a => a.kind)).not.toContain('branch-removed')
  })

  it('negative: a helper that computes something else is a changed value', () => {
    const v = (cmp) => app(`{ ADD: (s, t) => ({ ...s, items: swap(s, t) }), SAVE: (s) => s }`, { extra: `const swap = (s, t) => s.items.map((x) => (x.id ${cmp} t.id ? t : x))` })
    const r = report(app(`{ ADD: (s, t) => ({ ...s, items: s.items.map((x) => (x.id === t.id ? t : x)) }), SAVE: (s) => s }`), v('!=='))
    expect(sink(r, 'ADD').logic.kinds).not.toContain('moved')
    expect(sink(r, 'ADD').logic.kinds).toContain('value')
  })

  it('a helper rewritten with the same logic says so; with a slip, the guard is weaker and both versions are shown', () => {
    const same = report(inbox('base'), inbox('base', 'refactor'))
    expect(inboxSink(same, 'SEND', 'HTTP').logic.verdicts).toMatchObject([{ name: 'canSend', verdict: 'same' }])
    const slip = report(inbox('base'), inbox('base', 'refactor', 'slip'))
    const send = inboxSink(slip, 'SEND', 'HTTP')
    expect(send.guards.relation).toMatchObject({ rel: 'narrower', sameAtoms: true })
    expect(send.logic.verdicts).toMatchObject([{ name: 'canSend', verdict: 'differs' }])
    const first = slip.attention.find(a => a.kind === 'guard-weakened')
    expect(first).toMatchObject({ severity: 'high', action: 'SEND' })
    expect(first.text).toContain("when `ticket.status === 'open'` is false and `draft.trim().length === 0` is false")
    const note = slip.notes.find(a => a.kind === 'helper-differs')
    expect(note.text).toContain("Before: `return ticket.status === 'open' && draft.trim().length > 0`")
    expect(note.text).toContain('Now: `if (ticket.status !== "open" && draft.trim().length === 0) return false; return true`')
    // the honest refactor and the slip no longer read alike
    expect(formatReport(slip)).not.toEqual(formatReport(same))
  })

  it('negative: a helper condition on other atoms is a changed guard, without a direction', () => {
    const r = report(inbox('base'), inbox('base', 'refactor', 'guard-helper'))
    const g = r.notes.find(a => a.kind === 'guard-changed')
    expect(g.text).toContain('A guard that reads as before but calls `canSend`, which changed: `TicketDetail.SEND HTTP`')
    expect(g.text).toContain("Which way they moved isn't worked out")
    expect(r.notes.map(a => a.kind)).toContain('helper-differs')
    expect(r.attention.map(a => a.kind)).not.toContain('guard-weakened')
  })

  it('guards in several actions that call one changed helper are one line', () => {
    const v = (x) => app(`{ ADD: (s) => (ok(s) ? { ...s, n: 1 } : ABORT), SAVE: (s) => (ok(s) ? { ...s, n: 2 } : ABORT) }`, { head: ABORT, extra: `function ok(s) { return s.n > ${x} }` })
    const r = report(v(1), v(2))
    const lines = r.notes.filter(a => a.kind === 'guard-changed')
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toContain('Guards that read as before but call `ok`, which changed: `App.ADD STATE`, `App.SAVE STATE`')
    expect(r.notes.map(a => a.kind)).not.toContain('unclear')
  })

  it('a helper that is more than if / return / const is said to be not compared, never the same', () => {
    const v = (x) => app(`{ ADD: (s) => (ok(s) ? { ...s, n: 1 } : ABORT), SAVE: (s) => s }`, { head: ABORT, extra: `function ok(s) { let c = 0; for (const i of s.items) c += i; return c > ${x} }` })
    const r = report(v(1), v(2))
    expect(sink(r, 'ADD').logic.verdicts).toMatchObject([{ name: 'ok', verdict: 'not-compared' }])
    expect(sink(r, 'ADD').logic.notes.join(' ')).toContain('not compared')
    expect(sink(r, 'ADD').guards.relation?.rel).not.toBe('same')
  })

  it('an effect the view adds through a helper is a new side effect, with its call site', () => {
    const r = report(inbox('base'), inbox('base', 'refactor', 'beacon'))
    const e = r.attention.find(a => a.kind === 'side-effect')
    expect(e.severity).toBe('high')
    expect(e.text).toContain('navigator.sendBeacon')
    expect(e.text).toContain('(SYG265)')
    expect(e.at).toMatch(/^src\/TicketDetail\.jsx:9$/)
    expect(r.notes.map(a => a.kind)).not.toContain('diagnostic')
  })

  it('negative: an effect that was already there is not new', () => {
    expect(report(inbox('base', 'refactor', 'beacon'), inbox('base', 'refactor', 'beacon')).attention).toEqual([])
  })
})

describe('--report: known limits (false alarms and false calm)', () => {
  it('fixed: a guard moved into a helper is the same guard, also with the parameters in another order', () => {
    const move = (extra, call) => report(
      app(`{ ADD: (s, d) => { if (s.n > d) return ABORT; return { ...s, n: 1 } }, SAVE: (s) => s }`, { head: ABORT }),
      app(`{ ADD: (s, d) => ${call}, SAVE: (s) => s }`, { head: ABORT, extra }),
    )
    expect(kinds(move(`function add(t, e) { if (t.n > e) return ABORT; return { ...t, n: 1 } }`, 'add(s, d)'))).toEqual([])
    expect(kinds(move(`function add(e, t) { if (t.n > e) return ABORT; return { ...t, n: 1 } }`, 'add(d, s)'))).toEqual([])
  })

  it('false alarm (softened): a guard moved somewhere the walk does not reach names the helper', () => {
    const r = report(
      app(`{ ADD: (s) => { if (!s.draft) return ABORT; return { ...s, n: 1 } }, SAVE: (s) => s }`, { head: ABORT }),
      app(`{ ADD: (s) => { const t = add(s); return t }, SAVE: (s) => s }`, { head: ABORT, extra: `function add(s) { if (!s.draft) return ABORT; return { ...s, n: 1 } }` }),
    )
    expect(items(r)[0]).toMatchObject({ severity: 'medium', kind: 'guard-removed' })
    expect(items(r)[0].text).toContain('or moved into `add`')
  })

  it('fixed: an equivalent condition (De Morgan, parentheses) is the same guard', () => {
    const v = (c) => app(`{ ADD: (s) => (${c} ? ABORT : { ...s, n: 1 }), SAVE: (s) => s }`, { head: ABORT })
    const r = report(v('!(s.a && s.b)'), v('(!s.a || !s.b)'))
    expect(kinds(r)).not.toContain('guard-changed')
    expect(sink(r, 'ADD').guards).toMatchObject({ added: [], removed: [], relation: { rel: 'same' } })
    expect(sink(r, 'ADD').logic.notes).toContain('guard rewritten, same condition')
  })

  it('false alarm: an equivalent value is a changed value', () => {
    const v = (c) => app(`{ ADD: (s) => ({ ...s, n: ${c} }), SAVE: (s) => s }`)
    expect(sink(report(v('s.n + 1'), v('1 + s.n')), 'ADD').logic.kinds).toEqual(['value'])
  })

  it('fixed: a guard changed in a helper is a changed guard, named in its helper', () => {
    const v = (c) => app(`{ ADD: (s) => add(s), SAVE: (s) => s }`, { head: ABORT, extra: `function add(s) { if (${c}) return ABORT; return { ...s, n: 1 } }` })
    const r = report(v('s.a && s.b'), v('s.a'))
    expect(sink(r, 'ADD').logic.kinds).toEqual(expect.arrayContaining(['helper', 'guard']))
    expect(items(r).find(a => a.kind === 'guard-changed').text).toContain('`s.a (in add)`')
  })

  it('fixed: a guard removed from a helper, three calls down', () => {
    const v = (g) => app(`{ ADD: (s) => a(s), SAVE: (s) => s }`, { head: ABORT, extra: `const a = (s) => b(s)\nconst b = (s) => c(s)\nconst c = (s) => { ${g} return { ...s, n: 1 } }` })
    expect(kinds(report(v('if (s.x) return ABORT;'), v('')))).toContain('guard-removed')
  })

  it('fixed: a guard inside a nested helper call is still there when the code around it moves', () => {
    const extra = `const step = (s, d) => { if (s.x) return ABORT; return { ...s, n: d } }\nconst track = (s) => ({ ...s, t: 1 })`
    const r = report(app(`{ ADD: (s, d) => step(s, d), SAVE: (s) => s }`, { head: ABORT, extra }), app(`{ ADD: (s, d) => track(step(s, d)), SAVE: (s) => s }`, { head: ABORT, extra }))
    expect(kinds(r)).not.toContain('guard-removed')
  })

  it('fixed: writes through a composition of helpers, and a spread of one', () => {
    const v = (w) => app(`{ ADD: (s, d) => track(step(s, d)), SAVE: (s) => { const t = step(s); return { ...t, draft: '' } } }`, { extra: `const step = (s, d) => ({ ...s, ${w}: d })\nconst track = (s) => ({ ...s, n: 1 })` })
    const r = report(v('items'), v('other'))
    expect(sink(r, 'ADD').writes).toMatchObject({ base: ['n', 'items'], head: ['n', 'other'], added: ['other'] })
    expect(sink(r, 'SAVE').writes).toMatchObject({ base: ['items', 'draft'], head: ['other', 'draft'] })
    expect(sink(r, 'ADD').logic.confidence).toBe('high')
  })

  it('false calm: a flipped comparator is a value change, with no attention item', () => {
    const v = (c) => app(`{ ADD: (s) => ({ ...s, items: [...s.items].sort((a, b) => ${c}) }), SAVE: (s) => s }`)
    const r = report(v('a - b'), v('b - a'))
    expect(sink(r, 'ADD').logic.kinds).toEqual(['value'])
    expect(kinds(r)).toEqual([])
  })

  it('false calm: a behaviour change in the data the reducer gets is invisible at the reducer', () => {
    // the intent's payload changed meaning; the reducer that reads it is the same code
    const v = (x) => app(`{ ADD: (s, d) => ({ ...s, n: d }), SAVE: (s) => s }`, { intent: `({ DOM }) => ({ ADD: DOM.click('.add').map(() => ${x}), SAVE: DOM.click('.save') })` })
    const r = report(v(1), v(-1))
    expect(action(r, 'ADD').trigger.logic).toBe(true)
    expect(action(r, 'ADD').sinks).toEqual([])
    expect(kinds(r)).toEqual([])
  })

  it('a reducer that mutates a local: reported as low confidence, its keys not attributed', () => {
    const v = (x) => app(`{ ADD: (s) => { const items = [...s.items]; items.splice(${x}, 1); return { ...s, items } }, SAVE: (s) => s }`)
    const r = report(v(0), v(1))
    expect(sink(r, 'ADD').logic.confidence).toBe('low')
    expect(kinds(r)).toContain('unclear')
  })

  it('computed dispatch: writes unknown on both sides, low confidence', () => {
    const v = (x) => app(`{ ADD: (s, d) => HANDLERS[d](s), SAVE: (s) => s }`, { extra: `const HANDLERS = { a: (s) => ({ ...s, n: ${x} }) }` })
    const r = report(v(1), v(2))
    expect(sink(r, 'ADD').writes).toMatchObject({ base: null, head: null })
    expect(sink(r, 'ADD').logic).toMatchObject({ kinds: ['helper'], confidence: 'low' })
  })
})
