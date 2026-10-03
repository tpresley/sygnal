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
import { setupChecks, settle } from './diagnostics/helpers.js'
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
