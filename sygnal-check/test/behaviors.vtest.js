/**
 * PLAN-4 3-D: behaviors in sygnal-check (GS-1 `uses`, GS-8 undo).
 *
 *   resolution   uses = { key: factory(options) } → defineBehavior() in the same file, through
 *                relative imports / re-exports, and the first-party pager / selection / undo
 *   SYG101/102   see the merged, namespaced actions ('pager.NEXT', D109)
 *   SYG110/104   a control passed as an option the behavior's intent listens to
 *   SYG126       ... counts as listened
 *   SYG127       unresolvable entry, initialState collision, unknown option (a typo)
 *   SYG226       undoable() / undo() track, resetOn or coalesce naming an unknown action
 *   opaque       behaviors from packages: no findings about them
 *   --graph      behavior-owned actions, `uses`, behavior selectors; schema (+ recentActions, G-210)
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkFiles, graphFiles, validateSchema } from '../src/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const schema = JSON.parse(fs.readFileSync(path.join(here, '../schema/inspect.schema.json'), 'utf8'))

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function project(files) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-behaviors-'))
  for (const [rel, src] of Object.entries(files)) {
    const p = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, src)
  }
  const root = tmp
  const sources = () => Object.keys(files).filter(f => /\.[jt]sx?$/.test(f)).map(f => path.join(root, f))
  return {
    check: (opts = {}) => checkFiles(sources(), { cwd: root, ignore: A11Y, ...opts }),
    graph: () => graphFiles(sources(), { cwd: root }),
  }
}

const A11Y = ['SYG701', 'SYG702', 'SYG703', 'SYG704', 'SYG705', 'SYG706', 'SYG707', 'SYG708']
const codes = (diags) => diags.map(d => `${d.code} ${d.severity}`).sort()
const only = (diags, code) => diags.filter(d => d.code === code)

// A host using the first-party pager with its controls
const LIST = (usesLine = "List.uses = { pager: pager({ pageSize: 10, next: Newer, prev: Older }) }", extra = '') => `import { controls, pager } from 'sygnal'
const { Older, Newer } = controls({ Older: 'button', Newer: 'button' })

export function List({ state }) {
  const { offset, pageSize } = state.pager
  return <div><Older>Older</Older><Newer>Newer</Newer><ul>{state.items.slice(offset, offset + pageSize).map(i => <li>{i}</li>)}</ul></div>
}
List.initialState = { items: [] }
${usesLine}
${extra}
`

const USER_PAGER = `import { defineBehavior, ABORT } from 'sygnal'
export const pager = defineBehavior({
  initialState: { page: 0, pageSize: 20 },
  intent: ({ DOM }, { next, prev }) => ({ NEXT: DOM.click(next), PREV: DOM.click(prev) }),
  model: {
    NEXT: (p) => ({ ...p, page: p.page + 1 }),
    PREV: (p) => (p.page === 0 ? ABORT : { ...p, page: p.page - 1 }),
  },
  calculated: { offset: (p) => p.page * p.pageSize },
})
`

const USER_LIST = (usesLine, extra = '') => `import { controls } from 'sygnal'
import { pager } from './behaviors/pager.js'
const { Older, Newer } = controls({ Older: 'button', Newer: 'button' })

export function List({ state }) {
  return <div><Older>Older</Older><Newer>Newer</Newer><span>{state.pager.offset}</span></div>
}
${usesLine}
${extra}
`

describe('first-party behaviors (known definitions)', () => {
  it('pager with its controls: no findings (the controls count as listened, the actions as handled)', () => {
    expect(project({ 'List.jsx': LIST() }).check()).toEqual([])
  })

  it('selection and undo too', () => {
    const src = `import { controls, selection, undo, isSelected } from 'sygnal'
const { Pick, All, Undo, Redo, Inc } = controls({ Pick: 'input', All: 'input', Undo: 'button', Redo: 'button', Inc: 'button' })
export function Mail({ state }) {
  return <div><All type="checkbox" /><Undo>Undo</Undo><Redo>Redo</Redo><Inc>+</Inc>
    {state.mails.map(m => <Pick type="checkbox" data-id={m.id} checked={isSelected(state.sel, m.id)} />)}</div>
}
Mail.initialState = { mails: [], doc: { n: 0 } }
Mail.intent = ({ DOM }) => ({ INC: DOM.click(Inc) })
Mail.model = { INC: (s) => ({ ...s, doc: { n: s.doc.n + 1 } }), 'sel.CLEAR': { EFFECT: () => {} } }
Mail.uses = {
  sel: selection({ multi: true, item: Pick, all: All, from: 'mails' }),
  history: undo({ key: 'doc', undo: Undo, redo: Redo, track: ['INC'] }),
}
`
    expect(project({ 'Mail.jsx': src }).check()).toEqual([])
  })

  it('a typo in a control option: SYG127 (with the suggestion) and the control is never listened to (SYG126)', () => {
    const d = project({ 'List.jsx': LIST("List.uses = { pager: pager({ nxt: Newer, prev: Older }) }") }).check()
    expect(codes(d)).toEqual(['SYG126 info', 'SYG127 error'])
    const e = only(d, 'SYG127')[0]
    expect(e.message).toContain("no option 'nxt'")
    expect(e.message).toContain("did you mean 'next'")
    expect(e.data).toMatchObject({ key: 'pager', reason: 'option', option: 'nxt', suggestion: 'next' })
    expect(e.line).toBe(9)
    expect(only(d, 'SYG126')[0].message).toContain('<Newer>')
  })

  it('a control option the view never renders: SYG110 at the option', () => {
    const src = LIST().replace('<Newer>Newer</Newer>', '')
    const d = project({ 'List.jsx': src }).check()
    expect(codes(d)).toEqual(['SYG110 warn'])
    expect(d[0].message).toContain("behavior 'pager' (option next: Newer, DOM.click())")
    expect(d[0].message).toContain('never renders <Newer>')
    expect(d[0].data).toMatchObject({ control: 'Newer' })
  })

  it('a control option rendered only inside a child component: SYG104', () => {
    const src = `import { controls, pager } from 'sygnal'
const { Older, Newer } = controls({ Older: 'button', Newer: 'button' })
function Bar() { return <nav><Older>Older</Older><Newer>Newer</Newer></nav> }
export function List({ state }) { return <div><Bar /><span>{state.pager.page}</span></div> }
List.uses = { pager: pager({ next: Newer, prev: Older }) }
`
    const d = project({ 'List.jsx': src }).check()
    expect(codes(d)).toEqual(['SYG104 warn', 'SYG104 warn'])
    expect(d[0].data).toMatchObject({ child: 'Bar' })
  })

  it("host model entries: 'pager.NEXT' is handled; 'pager.NXT' is SYG102 naming the behavior's actions", () => {
    const ok = project({ 'List.jsx': LIST(undefined, "List.model = { 'pager.NEXT': { EFFECT: (s) => console.log(s.pager.page) } }") }).check()
    expect(ok).toEqual([])
    const d = project({ 'List.jsx': LIST(undefined, "List.model = { 'pager.NXT': { EFFECT: () => {} } }") }).check()
    expect(codes(d)).toEqual(['SYG102 warn'])
    expect(d[0].message).toContain("behavior 'pager' (uses key 'pager') has no action 'NXT'")
    expect(d[0].message).toContain('NEXT, PREV, GOTO, SET_TOTAL')
  })

  it("host intent actions: 'pager.NEXT' (an override) needs no host model entry; 'pager.FOO' is SYG101", () => {
    const ok = project({ 'List.jsx': LIST(undefined, "List.intent = ({ DOM }) => ({ 'pager.NEXT': DOM.select('document').events('keydown') })") }).check()
    expect(ok).toEqual([])
    const d = project({ 'List.jsx': LIST(undefined, "List.intent = ({ DOM }) => ({ 'pager.FOO': DOM.select('document').events('keydown') })") }).check()
    expect(codes(d)).toEqual(['SYG101 warn'])
  })

  it('SYG127: a uses key already in initialState', () => {
    const d = project({ 'List.jsx': LIST().replace('List.initialState = { items: [] }', 'List.initialState = { items: [], pager: { page: 2 } }') }).check()
    expect(codes(d)).toEqual(['SYG127 error'])
    expect(d[0].message).toContain("uses key 'pager' is also a key of List's initialState")
    expect(d[0].data).toMatchObject({ reason: 'initialState' })
  })

  it('SYG127: entries the core skips (an uncalled factory, an object, defineBehavior() without the options call)', () => {
    const src = `import { defineBehavior, pager } from 'sygnal'
const counter = defineBehavior({ initialState: { n: 0 } })
export function C() { return <div /> }
C.uses = { pager, counter, raw: { initialState: { a: 1 } }, inline: defineBehavior({ initialState: {} }) }
`
    const d = project({ 'C.jsx': src }).check()
    expect(codes(d)).toEqual(['SYG127 error', 'SYG127 error', 'SYG127 error', 'SYG127 error'])
    expect(d.map(x => x.message).join('\n')).toMatch(/'pager' is the behavior factory 'pager' itself, not called/)
    expect(d.map(x => x.message).join('\n')).toMatch(/'counter' is the behavior factory 'counter' itself/)
    expect(d.map(x => x.message).join('\n')).toMatch(/'raw' is an object literal/)
    expect(d.every(x => x.data.reason === 'unresolvable' || x.data.key)).toBe(true)
  })
})

describe('user behaviors (defineBehavior)', () => {
  it('through a relative import: options, actions and controls are resolved; no findings', () => {
    const p = project({
      'behaviors/pager.js': USER_PAGER,
      'List.jsx': USER_LIST("List.uses = { pager: pager({ pageSize: 10, next: Newer, prev: Older }) }", "List.model = { 'pager.NEXT': { EFFECT: () => {} } }"),
    })
    expect(p.check()).toEqual([])
  })

  it('through a re-export (export * / export { x } from) and an options const', () => {
    const p = project({
      'behaviors/pager.js': USER_PAGER,
      'behaviors/index.js': "export * from './pager.js'\n",
      'List.jsx': USER_LIST("const opts = { next: Newer, prev: Older }\nList.uses = { pager: pager(opts) }").replace("'./behaviors/pager.js'", "'./behaviors/index.js'"),
    })
    expect(p.check()).toEqual([])
  })

  it('in the same file, with an options identifier (o.next): a typo is caught', () => {
    const src = `import { controls, defineBehavior } from 'sygnal'
const { Inc } = controls({ Inc: 'button' })
const counter = defineBehavior({
  initialState: { n: 0 },
  intent: ({ DOM }, o) => ({ INC: DOM.click(o.inc) }),
  model: { INC: (s) => ({ ...s, n: s.n + 1 }) },
})
export function C({ state }) { return <div><Inc>+</Inc>{state.c.n}</div> }
C.uses = { c: counter({ incc: Inc, n: 3 }) }
`
    const d = project({ 'C.jsx': src }).check()
    expect(codes(d)).toEqual(['SYG126 info', 'SYG127 error'])
    expect(only(d, 'SYG127')[0].message).toContain("did you mean 'inc'")
  })

  it('a behavior intent action with no model entry: SYG101 at the uses entry (unless the host handles it)', () => {
    const beh = `import { defineBehavior } from 'sygnal'
export const toggler = defineBehavior({
  initialState: { on: false },
  intent: ({ DOM }, { button }) => ({ TOGGLE: DOM.click(button), PING: DOM.click(button) }),
  model: { TOGGLE: (s) => ({ ...s, on: !s.on }) },
})
`
    const host = (extra = '') => `import { controls } from 'sygnal'
import { toggler } from './toggler.js'
const { Btn } = controls({ Btn: 'button' })
export function C({ state }) { return <Btn>{String(state.t.on)}</Btn> }
C.uses = { t: toggler({ button: Btn }) }
${extra}`
    const d = project({ 'toggler.js': beh, 'C.jsx': host() }).check()
    expect(codes(d)).toEqual(['SYG101 warn'])
    expect(d[0].message).toContain("intent action 'PING'")
    expect(d[0].file).toBe('C.jsx')
    expect(project({ 'toggler.js': beh, 'C.jsx': host("C.model = { 't.PING': { EFFECT: () => {} } }") }).check()).toEqual([])
  })

  it("a behavior's next() targets and reply actions trigger host entries", () => {
    const src = `import { controls, defineBehavior } from 'sygnal'
const { Go } = controls({ Go: 'button' })
const loader = defineBehavior({
  initialState: {},
  intent: ({ DOM }, { go }) => ({ GO: DOM.click(go) }),
  model: { GO: { HTTP: () => ({ url: '/x', ok: 'LOADED' }), EFFECT: (s, d, next) => next('DONE') }, DONE: (s) => s },
})
export function C() { return <Go>go</Go> }
C.uses = { l: loader({ go: Go }) }
C.model = { LOADED: (s) => s, 'l.DONE': { EFFECT: () => {} } }
`
    expect(project({ 'C.jsx': src }).check()).toEqual([])
  })
})

describe('opaque behaviors (from packages)', () => {
  it('no findings about them: controls passed to them count as listened, their key prefix and host entries are not checked', () => {
    const src = `import { controls } from 'sygnal'
import { tabs } from 'some-ui-kit'
const { Tab } = controls({ Tab: 'button' })
export function C({ state }) { return <div><Tab>One</Tab>{state.tabs.active}</div> }
C.uses = { tabs: tabs({ tab: Tab }) }
C.model = { 'tabs.SELECT': { EFFECT: () => {} }, CHANGED: (s) => s }
C.intent = ({ DOM }) => ({ 'tabs.FOCUS': DOM.select('document').events('keydown') })
`
    expect(project({ 'C.jsx': src }).check()).toEqual([])
  })
})

describe('SYG226', () => {
  it('undoable(model, { track, resetOn }): a name with no model entry (with a suggestion)', () => {
    const src = `import { controls, undoable } from 'sygnal'
const { Inc, Undo } = controls({ Inc: 'button', Undo: 'button' })
export function Editor({ state }) { return <div><Inc>+</Inc><Undo>Undo</Undo>{state.doc.n}</div> }
Editor.initialState = { doc: { n: 0 } }
Editor.intent = ({ DOM }) => ({ INC: DOM.click(Inc), UNDO: DOM.click(Undo) })
Editor.model = undoable({
  INC: (s) => ({ ...s, doc: { n: s.doc.n + 1 } }),
  'LOAD | STATE': (s) => s,
}, { key: 'doc', track: ['INCC'], resetOn: ['LOAD', 'RESET'] })
`
    const d = project({ 'Editor.jsx': src }).check()
    // undoable() adds UNDO and REDO entries: the intent has no REDO trigger (and LOAD has none)
    expect(codes(d)).toEqual(['SYG102 warn', 'SYG102 warn', 'SYG226 warn', 'SYG226 warn'])
    expect(only(d, 'SYG102').map(x => x.data.action).sort()).toEqual(['LOAD', 'REDO'])
    const s = only(d, 'SYG226')
    expect(s[0].message).toContain("track names 'INCC'")
    expect(s[0].message).toContain("did you mean 'INC'")
    expect(s[1].data).toEqual({ action: 'RESET', option: 'resetOn' })
    expect(s[0].component).toBe('Editor')
  })

  it("undo({ track, resetOn }) in uses: the host's actions (its model and its behaviors')", () => {
    const src = `import { controls, undo, pager } from 'sygnal'
const { Undo, Newer } = controls({ Undo: 'button', Newer: 'button' })
export function C({ state }) { return <div><Undo>Undo</Undo><Newer>Newer</Newer>{state.doc.n}</div> }
C.initialState = { doc: { n: 0 } }
C.model = { SET: (s, n) => ({ ...s, doc: { n } }) }
C.uses = { pager: pager({ next: Newer }), history: undo({ key: 'doc', undo: Undo, track: ['SET', 'pager.NEXT', 'SETT'] }) }
`
    const d = project({ 'C.jsx': src }).check()
    expect(codes(d)).toEqual(['SYG102 warn', 'SYG226 warn'])
    expect(only(d, 'SYG226')[0].message).toContain("undo() (uses key 'history') track names 'SETT'")
  })

  // 4-G1 (D143) added `coalesce`; 4-G2: a known option, and its names are checked like track's
  it('coalesce: a known undo() option (no SYG127); a name with no model entry is SYG226', () => {
    const src = `import { controls, undo, undoable } from 'sygnal'
const { Undo } = controls({ Undo: 'button' })
export function C({ state }) { return <div><Undo>Undo</Undo>{state.doc.n}</div> }
C.initialState = { doc: { n: 0 } }
C.model = { SET: (s, n) => ({ ...s, doc: { n } }) }
C.uses = { history: undo({ key: 'doc', undo: Undo, coalesce: ['SET', 'SETT'], coalesceMs: 300 }) }
export function E({ state }) { return <p>{state.doc.n}</p> }
E.initialState = { doc: { n: 0 } }
E.model = undoable({ TYPE: (s) => s }, { key: 'doc', coalesce: ['TYPEE'] })
`
    const d = project({ 'C.jsx': src }).check()
    expect(only(d, 'SYG127')).toEqual([])
    const s = only(d, 'SYG226')
    expect(s.map(x => x.data)).toEqual([{ action: 'SETT', option: 'coalesce' }, { action: 'TYPEE', option: 'coalesce' }])
    expect(s[0].message).toContain("coalesce names 'SETT'")
    expect(s[1].message).toContain("did you mean 'TYPE'")
  })
})

describe('--graph', () => {
  it('lists behavior-owned actions, uses entries and behavior selectors; validates against the schema', () => {
    const g = project({ 'List.jsx': LIST(undefined, "List.model = { 'pager.NEXT': { EFFECT: () => {} } }") }).graph()
    expect(validateSchema(schema, g)).toEqual([])
    const c = g.components.find(x => x.name === 'List')
    expect(c.uses).toEqual([{ key: 'pager', behavior: 'pager', status: 'resolved' }])
    expect(c.stateKeys).toEqual(['items', 'pager'])
    expect(c.actions).toEqual(expect.arrayContaining([
      { name: 'pager.NEXT', trigger: 'intent', sinks: ['EFFECT', 'STATE'], behavior: 'pager' },
      { name: 'pager.GOTO', trigger: 'unknown', sinks: ['STATE'], behavior: 'pager' },
    ]))
    expect(c.selectors).toEqual([
      { selector: '[data-control="Newer"]', events: ['click'], matched: true, isolationHit: null, control: 'Newer', behavior: 'pager' },
      { selector: '[data-control="Older"]', events: ['click'], matched: true, isolationHit: null, control: 'Older', behavior: 'pager' },
    ])
    expect(c.controls.every(x => x.listened)).toBe(true)
  })

  it('G-210: the schema accepts runtime recentActions', () => {
    const g = { version: 1, source: 'runtime', components: [], events: {}, diagnostics: [],
      recentActions: [{ type: 'pager.NEXT', data: 1, component: 'List', instance: '3', sinks: ['STATE'], cause: 'behavior', at: 12.5 }] }
    expect(validateSchema(schema, g)).toEqual([])
    g.recentActions[0].cause = 'other'
    expect(validateSchema(schema, g).join()).toMatch(/cause/)
  })
})
