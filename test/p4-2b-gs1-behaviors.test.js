// @vitest-environment jsdom
// PLAN-4 2-B GS-1: reusable behaviors. defineBehavior({ initialState, intent, model, calculated })
// returns a factory; `C.uses = { key: behavior(options) }` runs it on state[key] (a lens), its
// actions are '<key>.<ACTION>' (D109), and each defineBehavior value carries its own merge (D114:
// the core only loops over `uses` and calls it).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection, ABORT, controls, event } from '../src/index.js'
import { defineBehavior } from '../src/extra/behaviors.js'
import { setupChecks, diagnostics, settle } from './diagnostics/helpers.js'
import { CODE_TITLES, DEV_CODE_SEVERITY } from '../src/extra/diagnostics/codes.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

// A test-local pager (the first-party one is 3-D's)
const pager = defineBehavior({
  initialState: { page: 0, pageSize: 20 },
  intent: ({ DOM }, { next, prev }) => ({ NEXT: DOM.click(next), PREV: DOM.click(prev) }),
  model: {
    NEXT: (p) => ({ ...p, page: p.page + 1 }),
    PREV: (p) => (p.page === 0 ? ABORT : { ...p, page: p.page - 1 }),
  },
  calculated: { offset: (p) => p.page * p.pageSize },
})

const { Older, Newer } = controls({ Older: 'button', Newer: 'button' })

let t
beforeEach(() => { setupChecks() })
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; _resetDiagnostics() })

const texts = () => t.queryAll('li').map(l => l.textContent)

describe('GS-1: X3 on the real API', () => {
  function List({ state }) {
    const { offset, pageSize, page } = state.pager
    return h('div', null,
      h(Older, null, '‹'), h('span', { className: 'page' }, String(page)), h(Newer, null, '›'),
      h('ul', null, ...state.items.slice(offset, offset + pageSize).map(i => h('li', null, i))))
  }
  List.initialState = { items: ['a', 'b', 'c', 'd', 'e'] }
  List.uses = { pager: pager({ pageSize: 2, next: Newer, prev: Older }) }

  it('state.pager defaults to the behavior initialState (options override its keys); calculated on the slice; namespaced actions; ABORT', async () => {
    t = renderComponent(List, { dom: 'real' })
    await t.ready()
    expect(t.state).toEqual({ items: ['a', 'b', 'c', 'd', 'e'], pager: { page: 0, pageSize: 2, offset: 0 } })
    expect(texts()).toEqual(['a', 'b'])
    t.simulateEvent(Newer, 'click'); await t.next(s => s.pager.page === 1)
    expect(t.state.pager).toEqual({ page: 1, pageSize: 2, offset: 2 })
    expect(texts()).toEqual(['c', 'd'])
    t.simulateEvent(Newer, 'click'); await t.next(s => s.pager.page === 2)
    expect(texts()).toEqual(['e'])
    t.simulateEvent(Older, 'click'); await t.next(s => s.pager.page === 1)
    t.simulateEvent(Older, 'click'); await t.next(s => s.pager.page === 0)
    const n = t.states.length
    t.simulateEvent(Older, 'click')      // ABORT at page 0: no new state
    await settle(30)
    expect(t.states.length).toBe(n)
    expect(t.state.pager.offset).toBe(0)
    t.expectNoDiagnostics()
  })

  it('does not change the component statics', () => {
    expect(List.initialState).toEqual({ items: ['a', 'b', 'c', 'd', 'e'] })
    expect(List.model).toBe(undefined)
    expect(List.intent).toBe(undefined)
  })
})

describe('GS-1: sharing, Collection items, sinks', () => {
  it('two components share pager; one is a Collection item host (state[key] defaults per item, items page independently)', async () => {
    function Thread({ state }) {
      return h('li', { className: 'thread' }, h(Older, null, '‹'), h('span', { className: 'p' }, `${state.title}:${state.pager.page}/${state.pager.offset}`), h(Newer, null, '›'))
    }
    Thread.uses = { pager: pager({ pageSize: 5, next: Newer, prev: Older }) }

    function Inbox({ state }) {
      return h('div', null, h(Older, null, '‹'), h('span', { className: 'top' }, String(state.pager.page)), h(Newer, null, '›'),
        h('ul', null, h(Collection, { of: Thread, from: 'threads' })))
    }
    Inbox.initialState = { threads: [{ id: 1, title: 'x' }, { id: 2, title: 'y' }] }
    Inbox.uses = { pager: pager({ next: Newer, prev: Older }) }

    t = renderComponent(Inbox, { dom: 'real' })
    await t.ready()
    await settle(30)
    expect(t.queryAll('.p').map(e => e.textContent)).toEqual(['x:0/0', 'y:0/0'])
    t.simulateEvent(`li:nth-child(2) ${Newer}`, 'click')
    await t.waitForState(s => s.threads[1].pager?.page === 1)
    await settle(30)
    expect(t.state.threads[1].pager).toEqual({ page: 1, pageSize: 5, offset: 5 })
    expect(t.state.threads[0].pager).toBe(undefined)   // never written: reads as the default
    expect(t.state.pager.page).toBe(0)                  // the host's own pager is separate (isolation)
    expect(t.queryAll('.p').map(e => e.textContent)).toEqual(['x:0/0', 'y:1/5'])
    t.simulateEvent(`div > ${Newer}`, 'click')
    await t.waitForState(s => s.pager.page === 1)
    expect(t.state.pager).toEqual({ page: 1, pageSize: 20, offset: 20 })
    expect(t.state.threads[1].pager.page).toBe(1)
    t.expectNoDiagnostics()
  })

  it('a behavior emits PARENT and EVENTS (computed from its slice); next() inside it names its own actions', async () => {
    const { Pick } = controls({ Pick: 'button' })
    const selection = defineBehavior({
      initialState: { selected: null, count: 0 },
      intent: ({ DOM }, { pick }) => ({ PICK: DOM.click(pick).map(e => e.target.dataset.id) }),
      model: {
        PICK: {
          STATE: (s, id) => ({ ...s, selected: id }),
          EVENTS: event('PICKED', (s, id) => id),
          PARENT: (s, id) => ({ picked: id, before: s.selected }),
          EFFECT: (s, id, next) => next('COUNTED', id),
        },
        COUNTED: (s) => ({ ...s, count: s.count + 1 }),
      },
    })
    function Picker({ state }) {
      return h('div', null, h(Pick, { attrs: { 'data-id': 'a' } }, 'a'), h('span', { className: 'sel' }, String(state.sel.selected)))
    }
    Picker.uses = { sel: selection({ pick: Pick }) }
    function Shell({ state }) { return h('div', null, h('p', { className: 'got' }, String(state.got)), h(Picker, { state: 'picker' })) }
    Shell.initialState = { got: null, picker: {} }
    Shell.intent = ({ CHILD }) => ({ GOT: CHILD.select(Picker) })
    Shell.model = { GOT: (s, v) => ({ ...s, got: v.picked + '/' + v.before }) }

    t = renderComponent(Shell, { dom: 'real' })
    await t.ready()
    t.simulateEvent(Pick, 'click')
    await t.waitForState(s => s.got === 'a/null' && s.picker.sel?.count === 1)
    expect(t.state.picker.sel).toEqual({ selected: 'a', count: 1 })
    expect(t.emitted).toEqual([{ type: 'PICKED', data: 'a' }])
    t.expectNoDiagnostics()
  })

  it('the behavior intent gets the host sources (DOM isolated to the host) and STATE lensed to its slice', async () => {
    const watcher = defineBehavior({
      initialState: { n: 0, seen: 0 },
      intent: ({ STATE, DOM }, { inc }) => ({ INC: DOM.click(inc), SEEN: STATE.watch(s => s.n) }),
      model: { INC: (s) => ({ ...s, n: s.n + 1 }), SEEN: (s, n) => ({ ...s, seen: n }) },
    })
    const { Inc } = controls({ Inc: 'button' })
    function Kid({ state }) { return h('div', { className: 'kid' }, h(Inc, null, '+'), String(state.w.seen)) }
    Kid.uses = { w: watcher({ inc: Inc }) }
    function Host({ state }) { return h('div', null, h(Inc, null, 'host +'), h(Kid, { state: 'kid' })) }
    Host.initialState = { kid: {} }
    Host.uses = { w: watcher({ inc: Inc }) }
    t = renderComponent(Host, { dom: 'real' })
    await t.ready()
    t.simulateEvent(`.kid ${Inc}`, 'click')
    await t.waitForState(s => s.kid.w?.seen === 1)
    await settle(30)
    expect(t.state.w).toEqual({ n: 0, seen: 0 })   // the host's own button wasn't clicked
    expect(t.state.kid.w).toEqual({ n: 1, seen: 1 })
  })
})

describe('GS-1: host entries for a behavior action', () => {
  it('a host model entry for the same action: STATE runs after the behavior (on the full state); EFFECT runs too; a value sink replaces the behavior\'s', async () => {
    const log = []
    const counter = defineBehavior({
      initialState: { n: 0 },
      intent: ({ DOM }, { inc }) => ({ INC: DOM.click(inc) }),
      model: { INC: { STATE: (s) => ({ ...s, n: s.n + 1 }), EFFECT: (s) => { log.push('behavior ' + s.n) }, EVENTS: event('BEHAVIOR', s => s.n) } },
      calculated: { double: (s) => s.n * 2 },
    })
    const { Inc } = controls({ Inc: 'button' })
    function C({ state }) { return h('div', null, h(Inc, null, '+'), String(state.c.n)) }
    C.initialState = { total: 0 }
    C.uses = { c: counter({ inc: Inc }) }
    C.model = {
      'c.INC': {
        STATE: (s) => ({ ...s, total: s.total + s.c.double }),   // sees the behavior's update (and fresh calculated)
        EFFECT: (s) => { log.push('host ' + s.c.n) },
        EVENTS: event('HOST', s => s.c.n),
      },
    }
    t = renderComponent(C, { dom: 'real' })
    await t.ready()
    t.simulateEvent(Inc, 'click')
    await t.waitForState(s => s.c.n === 1)
    expect(t.state).toEqual({ total: 2, c: { n: 1, double: 2 } })
    expect(log).toEqual(['behavior 0', 'host 0'])
    expect(t.emitted).toEqual([{ type: 'HOST', data: 0 }])
    t.expectNoDiagnostics()
  })

  it('a host STATE entry still runs when the behavior ABORTs; returning ABORT keeps the behavior\'s update', async () => {
    const b = defineBehavior({
      initialState: { on: false },
      model: { FLIP: (s) => (s.on ? ABORT : { ...s, on: true }) },
    })
    function C({ state }) { return h('div', null, String(state.hits)) }
    C.initialState = { hits: 0 }
    C.uses = { f: b() }
    C.model = { 'f.FLIP': (s) => (s.hits >= 1 ? ABORT : { ...s, hits: s.hits + 1 }) }
    t = renderComponent(C)
    await t.ready()
    t.simulateAction('f.FLIP'); await t.next(s => s.f.on)
    expect(t.state).toEqual({ hits: 1, f: { on: true } })
    t.simulateAction('f.FLIP'); await settle(30)
    expect(t.state).toEqual({ hits: 1, f: { on: true } })
  })

  it('a host intent action with the namespaced name overrides the behavior\'s trigger', async () => {
    const { Go } = controls({ Go: 'button' })
    function C({ state }) { return h('div', null, h(Older, null, '‹'), h(Newer, null, '›'), h(Go, null, 'go'), String(state.pager.page)) }
    C.uses = { pager: pager({ next: Newer, prev: Older }) }
    C.intent = ({ DOM }) => ({ 'pager.NEXT': DOM.click(Go) })
    t = renderComponent(C, { dom: 'real' })
    await t.ready()
    t.simulateEvent(Newer, 'click'); await settle(30)
    expect(t.state.pager.page).toBe(0)
    t.simulateEvent(Go, 'click'); await t.next(s => s.pager.page === 1)
    t.simulateEvent(Older, 'click'); await t.next(s => s.pager.page === 0)
    t.expectNoDiagnostics()
  })

  it('a host reducer on another action that changes state[key] gets the slice calculated fields recomputed', async () => {
    function C({ state }) { return h('div', null, String(state.pager.offset)) }
    C.initialState = {}
    C.uses = { pager: pager({ pageSize: 10, next: Newer, prev: Older }) }
    C.model = { JUMP: (s, page) => ({ ...s, pager: { ...s.pager, page } }) }
    t = renderComponent(C)
    await t.ready()
    t.simulateAction('JUMP', 3); await t.next(s => s.pager.page === 3)
    expect(t.state.pager).toEqual({ page: 3, pageSize: 10, offset: 30 })
    expect(t.html()).toContain('30')
  })

  it('GS-4 on the slice: a behavior reducer returning its slice unchanged is no change', async () => {
    let ran = 0
    const { Same } = controls({ Same: 'button' })
    const b = defineBehavior({ initialState: { v: 1 }, intent: ({ DOM }, { same }) => ({ SAME: DOM.click(same) }), model: { SAME: (s) => (ran++, s) } })
    function C({ state }) { return h('div', null, h(Same, null, 'same'), String(state.b.v)) }
    C.uses = { b: b({ same: Same }) }
    t = renderComponent(C, { dom: 'real' })
    await t.ready()
    const n = t.states.length
    t.simulateEvent(Same, 'click'); await settle(30)
    expect(ran).toBe(1)
    expect(t.states.length).toBe(n)
    t.expectNoDiagnostics()
  })

  it('t.actions hook: the instance maps behavior-owned actions to their key (a host intent override is host-owned)', async () => {
    let instance
    const spy = defineBehavior({ initialState: {}, intent: () => ({}), model: {} })
    const probe = defineBehavior({ initialState: {}, model: {} })
    function C() { return h('div') }
    const p = probe()
    const merge = p.merge
    p.merge = (c, k) => { instance = c; merge(c, k) }
    C.uses = { pager: pager({ next: Newer, prev: Older }), x: p, s: spy() }
    C.intent = ({ DOM }) => ({ 'pager.PREV': DOM.click('.prev') })
    t = renderComponent(C)
    await t.ready()
    expect(instance._behaviorActions).toEqual({ 'pager.NEXT': 'pager' })
  })
})

describe('GS-1: SYG127', () => {
  it('is registered as a dev-entry error with a title', () => {
    expect(DEV_CODE_SEVERITY.SYG127).toBe('error')
    expect(CODE_TITLES.SYG127).toMatch(/behavior/i)
  })

  it('a behavior key already in the host initialState', async () => {
    function C({ state }) { return h('div', null, String(state.pager.page)) }
    C.initialState = { pager: { page: 3 } }
    C.uses = { pager: pager({ next: Newer, prev: Older }) }
    t = renderComponent(C)
    await t.ready()
    const d = diagnostics('SYG127')
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('error')
    expect(d[0].message).toContain("'pager'")
    expect(d[0].message).toContain('initialState')
  })

  it('an unresolvable uses entry (not a defineBehavior result) is reported and skipped', async () => {
    function C() { return h('div', null, 'ok') }
    C.initialState = { a: 1 }
    C.uses = { pager: { initialState: { page: 0 } }, other: undefined }
    t = renderComponent(C)
    await t.ready()
    const d = diagnostics('SYG127')
    expect(d.map(x => x.message).join('\n')).toMatch(/'pager'.*defineBehavior/)
    expect(d.map(x => x.message).join('\n')).toMatch(/'other'/)
    expect(t.state).toEqual({ a: 1 })
  })

  it('each definition is reported once (not per Collection item)', async () => {
    function Item() { return h('li', null, 'i') }
    Item.uses = { bad: 42 }
    function L() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
    L.initialState = { items: [{ id: 1 }, { id: 2 }, { id: 3 }] }
    t = renderComponent(L)
    await t.ready()
    await settle(30)
    expect(diagnostics('SYG127')).toHaveLength(1)
  })

  it('a host intent action with a behavior\'s namespaced name is not a collision', async () => {
    function C({ state }) { return h('div', null, String(state.pager.page)) }
    C.uses = { pager: pager({ next: Newer, prev: Older }) }
    C.intent = ({ DOM }) => ({ 'pager.NEXT': DOM.click('.x') })
    t = renderComponent(C)
    await t.ready()
    expect(diagnostics('SYG127')).toEqual([])
  })
})
