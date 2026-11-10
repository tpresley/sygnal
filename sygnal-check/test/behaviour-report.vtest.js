// `sygnal-check --report` (src/report/; research: dev-plans/research/behaviour-report): what a change
// does, per component, from the code of the two versions. The last block pins what it gets wrong.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { main, parseArgs } from '../src/cli.js'
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

const kinds = (r) => r.attention.map(a => a.kind)
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
    expect(parseArgs(['--report', '--base', 'a', '--head', 'b', '--json', '--out', 'x.md'])).toMatchObject({ report: true, base: 'a', head: 'b', json: true, out: 'x.md' })
  })
})

describe('--report: side effects', () => {
  it('a new HTTP request on an existing action', () => {
    const r = report(
      app(`{ ADD: (s) => ({ ...s, n: s.n + 1 }), SAVE: (s) => s }`),
      app(`{ ADD: (s) => ({ ...s, n: s.n + 1 }), SAVE: { STATE: (s) => s, HTTP: (s) => ({ url: '/api/save', method: 'POST', json: s.draft, ok: 'SAVED', error: 'FAILED' }) }, SAVED: (s) => s, FAILED: (s) => s }`),
    )
    const a = r.attention.find(x => x.kind === 'side-effect')
    expect(a.severity).toBe('high')
    expect(a.text).toContain('`App.SAVE` now sends to HTTP')
    expect(a.text).toContain('POST /api/save → ok SAVED, error FAILED')
    expect(sink(r, 'SAVE', 'HTTP').reads).toEqual(['draft'])
  })

  it('a changed URL is a new request, the old one named', () => {
    const http = (u) => app(`{ ADD: (s) => s, SAVE: { HTTP: () => ({ url: '${u}', method: 'POST', ok: 'A' }) }, A: (s) => s }`)
    const r = report(http('/api/v1/save'), http('/api/v2/save'))
    expect(r.attention[0].text).toContain('new HTTP request: `POST /api/v2/save → ok A` (was `POST /api/v1/save → ok A`)')
  })

  it('a new EFFECT and the globals it touches', () => {
    const r = report(
      app(`{ ADD: (s) => s, SAVE: (s) => s }`),
      app(`{ ADD: (s) => s, SAVE: { EFFECT: (s) => { localStorage.setItem('d', s.draft) } } }`),
    )
    expect(r.attention.find(a => a.kind === 'side-effect').text).toContain('localStorage.setItem')
  })

  it('a reducer that starts touching a global', () => {
    const r = report(
      app(`{ ADD: (s) => ({ ...s, n: 1 }), SAVE: (s) => s }`),
      app(`{ ADD: (s) => ({ ...s, n: window.innerWidth }), SAVE: (s) => s }`),
    )
    expect(r.attention.find(a => a.kind === 'side-effect').text).toContain('STATE now touches `window.innerWidth`')
  })

  it('a clock read in a reducer is a note, not a side effect', () => {
    const r = report(app(`{ ADD: (s) => ({ ...s, n: 1 }), SAVE: (s) => s }`), app(`{ ADD: (s) => ({ ...s, n: Date.now() }), SAVE: (s) => s }`))
    expect(r.attention.find(a => a.kind === 'clock')).toMatchObject({ severity: 'low' })
    expect(kinds(r)).not.toContain('side-effect')
  })

  it('a new driver given to run() is a new side-effect surface', () => {
    const v = (d) => ({ 'src/App.jsx': app(`{ ADD: (s) => s, SAVE: (s) => s }`), 'src/main.js': `import { run } from 'sygnal'\nimport { App } from './App.jsx'\nrun(App, ${d})\n` })
    const r = report(v('{}'), v('{ HTTP: makeFetchDriver() }'), ['src/main.js'])
    expect(r.attention[0]).toMatchObject({ severity: 'high', kind: 'driver' })
    expect(r.attention[0].text).toContain('`HTTP`')
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
    expect(r.attention[0]).toMatchObject({ severity: 'high', kind: 'guard-removed', action: 'ADD' })
    expect(r.attention[0].text).toContain('`!s.draft`')
  })

  it('added: listed, no alarm', () => {
    const r = report(app(bare, { head: ABORT }), app(guarded, { head: ABORT }))
    expect(sink(r, 'ADD').guards.added).toEqual(['!s.draft'])
    expect(kinds(r)).not.toContain('guard-removed')
  })

  it('changed condition: paired, medium; through ?: and nested ifs', () => {
    const v = (c) => app(`{ ADD: (s) => (${c} ? ABORT : { ...s, n: 1 }), SAVE: (s) => s }`, { head: ABORT })
    const r = report(v('s.n > 3'), v('s.n > 5'))
    expect(r.attention[0]).toMatchObject({ severity: 'medium', kind: 'guard-changed' })
    expect(r.attention[0].text).toContain('`s.n > 3` became `s.n > 5`')
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
    expect(r.attention[0]).toMatchObject({ severity: 'high', kind: 'trigger-filter-removed' })
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
    expect(r.attention[0]).toMatchObject({ kind: 'writes-widened' })
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
    expect(r.attention.find(a => a.kind === 'event-new').text).toContain('`A` → App')
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
    expect(r.attention[0]).toMatchObject({ kind: 'payload' })
    expect(r.attention[0].text).toContain('a value → { pick }')
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
    const t = r.attention.filter(a => a.kind === 'persist').map(a => a.text)
    expect(t[0]).toContain('+draft')
    expect(t[1]).toContain('`App.ADD` now writes persisted key `draft`')
  })

  it('agent surface', () => {
    const agent = (extra) => `App.agent = { name: 'a', actions: { ADD: { description: 'd', consequential: true }${extra} } }`
    const r = report(
      app(`{ ADD: (s) => s, SAVE: (s) => s }`, { extra: agent('') }),
      app(`{ ADD: (s) => s, SAVE: (s) => s }`, { extra: `App.agent = { name: 'a', actions: { ADD: { description: 'd' }, SAVE: { description: 's' } } }` }),
    )
    const t = r.attention.filter(a => a.kind === 'agent').map(a => a.text)
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
    expect(r.attention[0].text).toContain('`New.GO` is new and sends to HTTP')
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
      - Not analysed at all: what the view renders (markup, text, styling), what happens inside helpers beyond whether they changed, runtime data and timing.
      "
    `)
  })
})

describe('--report: the markdown groups a large addition', () => {
  it('more than three new actions with side effects on one component are one line', () => {
    const http = ['A', 'B', 'C', 'D'].map(n => `${n}: { HTTP: () => ({ url: '/${n}', ok: 'R' }) }`).join(', ')
    const r = report(app(`{ ADD: (s) => s, SAVE: (s) => s }`), app(`{ ADD: (s) => s, SAVE: (s) => s, R: (s) => s, ${http} }`))
    expect(r.attention.filter(a => a.kind === 'side-effect')).toHaveLength(4)
    const md = formatReport(r)
    expect(md).toContain('`App`: 4 new actions send to HTTP (`A`, `B`, `C`, `D`)')
    expect(md).not.toContain('`App.A` is new')
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

  it('--graph --base --head: the graph diff of two commits', () => {
    const { root } = repo()
    const d = JSON.parse(run(['--graph', '--json', '--base', 'HEAD~1', '--head', 'HEAD', 'src'], root).out)
    expect(d.head).toBe('HEAD')
  })
})

// What the analysis gets wrong, on purpose: each is written up in the research README. A change here
// means a limit moved, for better or worse.
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
    expect(r.attention[0]).toMatchObject({ severity: 'medium', kind: 'guard-removed' })
    expect(r.attention[0].text).toContain('or moved into `add`')
  })

  it('false alarm: an equivalent condition is a changed guard', () => {
    const v = (c) => app(`{ ADD: (s) => (${c} ? ABORT : { ...s, n: 1 }), SAVE: (s) => s }`, { head: ABORT })
    expect(kinds(report(v('!(s.a && s.b)'), v('!s.a || !s.b')))).toContain('guard-changed')
  })

  it('false alarm: an equivalent value is a changed value', () => {
    const v = (c) => app(`{ ADD: (s) => ({ ...s, n: ${c} }), SAVE: (s) => s }`)
    expect(sink(report(v('s.n + 1'), v('1 + s.n')), 'ADD').logic.kinds).toEqual(['value'])
  })

  it('fixed: a guard changed in a helper is a changed guard, named in its helper', () => {
    const v = (c) => app(`{ ADD: (s) => add(s), SAVE: (s) => s }`, { head: ABORT, extra: `function add(s) { if (${c}) return ABORT; return { ...s, n: 1 } }` })
    const r = report(v('s.a && s.b'), v('s.a'))
    expect(sink(r, 'ADD').logic.kinds).toEqual(expect.arrayContaining(['helper', 'guard']))
    expect(r.attention.find(a => a.kind === 'guard-changed').text).toContain('`s.a (in add)`')
  })

  it('fixed: a guard removed from a helper, three calls down', () => {
    const v = (g) => app(`{ ADD: (s) => a(s), SAVE: (s) => s }`, { head: ABORT, extra: `const a = (s) => b(s)\nconst b = (s) => c(s)\nconst c = (s) => { ${g} return { ...s, n: 1 } }` })
    expect(kinds(report(v('if (s.x) return ABORT;'), v('')))).toContain('guard-removed')
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
