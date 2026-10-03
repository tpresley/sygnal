// @vitest-environment jsdom
// PLAN-4 2-R: fixes from the Phase 1+2 code review (G-214) and queued small items.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { ABORT } from '../src/index.js'
import collection, { Collection } from '../src/collection.js'
import switchable from '../src/switchable.js'
import { StateSource } from '../src/cycle/state/index.js'
import xs from 'xstream'
import run from '../src/extra/run.js'
import { renderToString } from '../src/extra/ssr.ts'
import { defineBehavior } from '../src/extra/behaviors.js'
import { undoable } from '../src/extra/undo.js'
import { setupChecks, settle, diagnostics } from './diagnostics/helpers.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

let t
beforeEach(() => { setupChecks() })
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; _resetDiagnostics() })

describe('G-214 (1): constant sink values in a behavior model entry', () => {
  it('a constant is sent as is, `true` passes the data through, a constant EFFECT is ignored (as in the core)', async () => {
    const b = defineBehavior({
      initialState: { open: true },
      model: {
        CLOSE: { STATE: (s) => ({ ...s, open: false }), PARENT: 'closed', EFFECT: true },
        PICK: { PARENT: true },
        SET: { STATE: true },
      },
    })
    function C({ state }) { return h('div', null, String(state.d.open)) }
    C.uses = { d: b() }
    C.model = { 'd.PICK': { EFFECT: true } }   // a host constant for a behavior action
    t = renderComponent(C)
    await t.ready()
    t.simulateAction('d.CLOSE'); await t.next(s => s.d.open === false)
    t.simulateAction('d.PICK', 7); await settle(30)
    expect(t.sinkValues('PARENT').map(v => v?.value ?? v)).toEqual(['closed', 7])
    t.simulateAction('d.SET', { open: 'yes' }); await t.next(s => s.d.open === 'yes')
    expect(t.state.d).toEqual({ open: 'yes' })
    t.expectNoDiagnostics()
  })

  it('undoable() leaves an entry with a constant STATE value alone and keeps constant sinks', async () => {
    const model = undoable({ A: { STATE: (s) => ({ ...s, doc: s.doc + 1 }), PARENT: 'a' }, B: { PARENT: true }, UNDO: { PARENT: 'u' }, K: { STATE: 5 } }, { key: 'doc' })
    expect(model.K).toEqual({ STATE: 5 })
    expect(model.A.PARENT).toBe('a')
    expect(model.B).toEqual({ PARENT: true })
    function C({ state }) { return h('div', null, String(state.doc)) }
    C.initialState = { doc: 0 }
    C.model = model
    t = renderComponent(C)
    await t.ready()
    t.simulateAction('A'); await t.next(s => s.doc === 1)
    t.simulateAction('B', 'x'); await settle(30)
    t.simulateAction('UNDO'); await t.next(s => s.doc === 0)
    expect(t.sinkValues('PARENT').map(v => v?.value ?? v)).toEqual(['a', 'x', 'u'])
  })
})

const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (cond, what, ms = 2000) => {
  for (const end = Date.now() + ms; !cond(); await sleep(5)) if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
}

describe('G-214 (2): the parent does not write child uids into the sources it received', () => {
  const ids = () => [...document.querySelectorAll('#root [id]')].map(e => e.id)
  function Field({ uid }) { return h('input', { attrs: { id: uid('input') } }) }
  function Row({ state, uid }) { return h('li', { attrs: { id: uid() } }, state.text) }
  function Form({ uid }) {
    return h('form', { attrs: { id: uid('form') } }, h(Field), h('ul', null, h(Collection, { of: Row, from: 'rows' })))
  }
  Form.initialState = { rows: [{ id: 'a', text: 'one' }] }

  for (const uid of [undefined, 'app1']) it(`a root remount via app.hmr() keeps the same uids (uid option: ${uid})`, async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const app = run(Form, {}, { diagnostics: 'off', ...(uid && { uid }) })
    try {
      await until(() => document.querySelectorAll('#root li').length === 1, 'first render'); await sleep(20)
      const before = ids()
      expect(before).toHaveLength(3)
      expect(app.sources.__uid).toBe(uid)     // not the last child's uid
      app.hmr(Form)
      await sleep(150)
      await until(() => document.querySelectorAll('#root li').length === 1, 'remount')
      expect(ids()).toEqual(before)
      expect(app.sources.__uid).toBe(uid)
    } finally { app.dispose(); document.body.innerHTML = '' }
  })
})

describe('G-214 (3): uid path parts are encoded injectively (client and SSR alike)', () => {
  function Item({ uid }) { return h('i', { attrs: { id: uid() } }) }
  function Row({ uid }) { return h('li', { attrs: { id: uid() } }) }
  function Page({ uid }) {
    return h('main', { attrs: { id: uid() } },
      h(Item, { id: 'x/y' }), h(Item, { id: 'x y' }), h(Item, { id: 'x_y' }), h(Item, { id: 'x.y' }),
      h('ul', null, h(Collection, { of: Row, from: 'rows' })))
  }
  Page.initialState = { rows: [{ id: 'a.b' }, { id: 'a_b' }, { id: 'a b' }, { id: 'a_2eb' }] }

  it("'a.b' / 'a_b' and 'x/y' / 'x y' give distinct, valid ids; renderToString gives the same ids", async () => {
    const html = renderToString(Page)
    const ssrIds = [...html.matchAll(/ id="([^"]+)"/g)].map(m => m[1])
    expect(ssrIds).toHaveLength(9)
    expect(new Set(ssrIds).size).toBe(9)
    for (const id of ssrIds) expect(id).toMatch(/^[A-Za-z][\w-]*$/)
    document.body.innerHTML = `<div id="root">${html}</div>`
    const app = run(Page, {}, { diagnostics: 'off' })
    try {
      await until(() => document.querySelectorAll('#root li').length === 4, 'hydration'); await sleep(30)
      expect([...document.querySelectorAll('#root [id]')].map(e => e.id)).toEqual(ssrIds)
    } finally { app.dispose(); document.body.innerHTML = '' }
  })

  it("a root uid option keeps its readable form ('my_app')", () => {
    function C({ uid }) { return h('p', { attrs: { id: uid('x') } }) }
    expect(renderToString(C, { uid: 'my_app' })).toContain('id="my_app-x"')
  })
})

describe('G-214 (4): STATE.select(...).watch() ends on dispose', () => {
  it('a selected source keeps the end stream (and a behavior intent sees it)', async () => {
    const ev = []
    const b = defineBehavior({
      initialState: { v: 0 },
      intent: ({ STATE }) => { const w = STATE.watch(s => s.v); w.addListener({ complete: () => ev.push('behavior-end') }); return { W: w } },
    })
    function C({ state }) { return h('div', null, String(state.a.n)) }
    C.initialState = { a: { n: 1 } }
    C.uses = { b: b() }
    C.intent = ({ STATE }) => { const w = STATE.select('a').watch(s => s.n); w.addListener({ complete: () => ev.push('select-end') }); return { N: w } }
    C.model = { N: s => s }
    t = renderComponent(C)
    await t.ready()
    ev.push('--')
    t.dispose()
    await sleep(30)
    expect(ev.sort()).toEqual(['--', 'behavior-end', 'select-end'])
  })
})

describe("G-214 (5): collection() / switchable() without a __uid source use the root 'u'", () => {
  const listen = (sinks) => { for (const k in sinks) sinks[k]?.addListener?.({ next() {}, error() {} }) }
  it('collection(): item uids are u-<key>', async () => {
    const seen = []
    const Item = (so) => { seen.push(so.__uid); return { EVENTS: xs.never() } }
    const STATE = new StateSource(xs.of({ items: [{ id: 'k' }] }).remember(), 'STATE')
    listen(collection(Item, 'items')({ STATE, EVENTS: { select: () => xs.never() } }))
    await sleep(20)
    expect(seen).toEqual(['u-k'])
  })
  it('switchable(): page uids are u-<name>', () => {
    const seen = []
    const Page = (so) => { seen.push(so.__uid); return { EVENTS: xs.never() } }
    switchable({ a: Page }, xs.of('a').remember())({ EVENTS: xs.never() })
    expect(seen).toEqual(['u-a'])
  })
})

describe("G-214 (6): SYG222 sees an in-place mutation of a behavior's slice", () => {
  it('a behavior reducer that mutates its slice and returns it is reported (keys as key.field)', async () => {
    const b = defineBehavior({
      initialState: { page: 0 },
      model: { NEXT: (p) => { p.page++; return p }, OK: (p) => ({ ...p, page: p.page + 1 }) },
    })
    function C({ state }) { return h('div', null, String(state.pager.page)) }
    C.initialState = { n: 0 }
    C.uses = { pager: b() }
    t = renderComponent(C)
    await t.ready(); await t.settle()
    t.simulateAction('pager.OK'); await t.next(s => s.pager.page === 1)
    expect(diagnostics('SYG222')).toHaveLength(0)
    t.simulateAction('pager.NEXT'); await t.settle()
    const found = diagnostics('SYG222')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ severity: 'warn', component: 'C', data: { action: 'pager.NEXT', keys: ['pager.page'] } })
  })
})

describe("G-214 (7): a throwing static declaration is reported with phase 'declaration'", () => {
  it('connections / resources / route statics: the app onError hook gets phase declaration', async () => {
    const reported = []
    const routeDriver = (sink$) => {
      sink$.addListener({ next() {}, error() {}, complete() {} })
      return { __sygnalStatic: 'route' }
    }
    function App() { return h('p', null, 'app') }
    App.initialState = { n: 1 }
    App.route = () => { throw new Error('boom') }
    document.body.innerHTML = '<div id="root"></div>'
    const errSpy = console.error
    console.error = () => {}
    const app = run(App, { ROUTER: routeDriver }, { diagnostics: 'off', onError: (e, info) => reported.push(info) })
    try {
      await until(() => reported.length > 0, 'the report')
      expect(reported[0]).toMatchObject({ componentName: 'App', phase: 'declaration' })
    } finally { app.dispose(); console.error = errSpy; document.body.innerHTML = '' }
  })
})

describe('G-214 (8): one isAbort', () => {
  it('only src/shared.ts defines isAbort; it matches ABORT and a duplicate registry copy only', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const walk = (d) => readdirSync(d).flatMap(f => statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)])
    const src = join(__dirname, '../src')
    const defs = walk(src).filter(f => f.endsWith('.ts') && /(const|function) isAbort\b/.test(readFileSync(f, 'utf8')))
    expect(defs.map(f => f.slice(src.length + 1))).toEqual(['shared.ts'])
    const { isAbort, ABORT: A } = await import('../src/shared.ts')
    expect(isAbort(ABORT)).toBe(true)
    expect(A).toBe(ABORT)
    expect(isAbort(Symbol('sygnal.ABORT'))).toBe(true)
    expect(isAbort(Symbol('x'))).toBe(false)
    expect(isAbort('sygnal.ABORT')).toBe(false)
  })
})

describe("G-216: an app's hot swap is scoped to that app (the __hmr source)", () => {
  function Counter({ state }) { return h('b', null, state.label + state.count) }
  Counter.initialState = { label: 'A', count: 1 }
  function Other({ state }) { return h('i', null, state.name + state.n) }
  Other.initialState = { name: 'B', n: 100 }
  const text = sel => document.querySelector(sel)?.textContent

  it("an app started during another app's swap starts from its own initialState; the swapped app keeps its state", async () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>'
    const a = run(Counter, {}, { mountPoint: '#a', diagnostics: 'off' })
    let b
    try {
      await until(() => text('#a') === 'A1', 'app A')
      a.sinks.STATE.shamefullySendNext(s => ({ ...s, count: 5 }))
      await until(() => text('#a') === 'A5', 'A at 5')
      a.hmr(Counter)
      b = run(Other, {}, { mountPoint: '#b' })   // inside A's swap window
      await until(() => text('#b') === 'B100', 'app B with its own state')
      await sleep(150)
      expect(text('#b')).toBe('B100')
      expect(text('#a')).toBe('A5')
      expect(b.sources.STATE.stream._v).toEqual({ name: 'B', n: 100 })
      expect(window.__SYGNAL_HMR_UPDATING).toBeUndefined()
      expect(window.__SYGNAL_HMR_STATE).toBeUndefined()
    } finally { a.dispose(); b?.dispose(); document.body.innerHTML = '' }
  })

  it('hmrActions fire in the swapped-in app only', async () => {
    const fired = []
    function A({ state }) { return h('b', null, String(state.r)) }
    A.initialState = { r: 0 }
    A.hmrActions = 'REFRESH'
    A.model = { REFRESH: s => (fired.push('A'), { ...s, r: s.r + 1 }) }
    function B({ state }) { return h('i', null, String(state.r)) }
    B.initialState = { r: 0 }
    B.hmrActions = 'REFRESH'
    B.model = { REFRESH: s => (fired.push('B'), { ...s, r: s.r + 1 }) }
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>'
    const a = run(A, {}, { mountPoint: '#a', diagnostics: 'off' })
    let b
    try {
      await until(() => text('#a') === '0', 'app A')
      a.hmr(A)
      b = run(B, {}, { mountPoint: '#b' })
      await until(() => fired.length > 0, 'an hmrAction')
      await sleep(150)
      expect(fired).toEqual(['A'])
    } finally { a.dispose(); b?.dispose(); document.body.innerHTML = '' }
  })
})
