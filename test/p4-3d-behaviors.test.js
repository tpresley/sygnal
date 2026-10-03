// @vitest-environment jsdom
// PLAN-4 3-D: the first-party behaviors (GS-1) and undo/redo (GS-8).
//   pager({ pageSize, total, next, prev })             state[key] = { page, pageSize, total, offset, pages, hasPrev, hasNext }
//   selection({ multi, item, all, clear, attr, from }) state[key] = { selected: string[], count }, isSelected(slice, id)
//   undoable(model, { key, limit, track, coalesceMs, resetOn })  state.history = { past, future }, UNDO / REDO
//   undo({ key, ..., undo, redo })                     the same as a behavior: state[usesKey] + canUndo / canRedo
// SYG226 (dev): a track / resetOn name with no model entry.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection, ABORT, controls, pager, selection, isSelected, undoable, undo } from '../src/index.js'
import { setupChecks, diagnostics, settle } from './diagnostics/helpers.js'
import { CODE_TITLES, DEV_CODE_SEVERITY } from '../src/extra/diagnostics/codes.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

let t
beforeEach(() => { setupChecks() })
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; _resetDiagnostics(); vi.useRealTimers() })

const { Older, Newer } = controls({ Older: 'button', Newer: 'button' })
const texts = (sel = 'li') => t.queryAll(sel).map(l => l.textContent)

describe('pager', () => {
  function List({ state }) {
    const { offset, pageSize, page, hasPrev, hasNext } = state.pager
    return h('div', null,
      h(Older, { disabled: !hasPrev }, 'Older'), h('span', { className: 'page' }, String(page)), h(Newer, { disabled: !hasNext }, 'Newer'),
      h('ul', null, ...state.items.slice(offset, offset + pageSize).map(i => h('li', null, i))))
  }
  List.initialState = { items: ['a', 'b', 'c', 'd', 'e'] }
  List.uses = { pager: pager({ pageSize: 2, total: 5, next: Newer, prev: Older }) }

  it('slice: page, pageSize, total and the calculated offset, pages, hasPrev, hasNext; options override', async () => {
    t = renderComponent(List, { dom: 'real' })
    await t.ready()
    expect(t.state.pager).toEqual({ page: 0, pageSize: 2, total: 5, offset: 0, pages: 3, hasPrev: false, hasNext: true })
    expect(texts()).toEqual(['a', 'b'])
    t.expectNoDiagnostics()
  })

  it('next / prev controls move the page; ABORT at both bounds (no new state)', async () => {
    t = renderComponent(List, { dom: 'real' })
    await t.ready()
    t.simulateEvent(Newer, 'click'); await t.next(s => s.pager.page === 1)
    t.simulateEvent(Newer, 'click'); await t.next(s => s.pager.page === 2)
    expect(texts()).toEqual(['e'])
    expect(t.state.pager.hasNext).toBe(false)
    let n = t.states.length
    t.simulateEvent(Newer, 'click'); await settle(30)
    expect(t.states.length).toBe(n)
    t.simulateEvent(Older, 'click'); await t.next(s => s.pager.page === 1)
    t.simulateEvent(Older, 'click'); await t.next(s => s.pager.page === 0)
    n = t.states.length
    t.simulateEvent(Older, 'click'); await settle(30)
    expect(t.states.length).toBe(n)
    t.expectNoDiagnostics()
  })

  it('without total, NEXT is unbounded and pages is null', async () => {
    function C({ state }) { return h('div', null, h(Newer, null, 'Newer'), String(state.p.page)) }
    C.uses = { p: pager({ next: Newer }) }
    t = renderComponent(C)
    await t.ready()
    expect(t.state.p).toEqual({ page: 0, pageSize: 20, total: null, offset: 0, pages: null, hasPrev: false, hasNext: true })
    t.simulateEvent(Newer, 'click'); await t.next(s => s.p.page === 1)
    t.simulateEvent(Newer, 'click'); await t.next(s => s.p.page === 2)
    expect(t.state.p.offset).toBe(40)
  })

  it('GOTO clamps into range; SET_TOTAL updates pages and pulls the page back in range (host next())', async () => {
    function C({ state }) { return h('div', null, String(state.p.page)) }
    C.uses = { p: pager({ pageSize: 10, total: 95 }) }
    C.model = {
      JUMP: { EFFECT: (s, page, next) => next('p.GOTO', page) },
      COUNT: { EFFECT: (s, total, next) => next('p.SET_TOTAL', total) },
    }
    t = renderComponent(C)
    await t.ready()
    t.simulateAction('JUMP', 4); await t.next(s => s.p.page === 4)
    t.simulateAction('JUMP', 99); await t.next(s => s.p.page === 9)
    const n = t.states.length
    t.simulateAction('JUMP', 9); await settle(30)
    expect(t.states.length).toBe(n)
    t.simulateAction('COUNT', 31); await t.next(s => s.p.total === 31)
    expect(t.state.p).toMatchObject({ page: 3, pages: 4, offset: 30, hasNext: false })
    t.simulateAction('COUNT', 0); await t.next(s => s.p.total === 0)
    expect(t.state.p).toMatchObject({ page: 0, pages: 1, hasNext: false, hasPrev: false })
  })

  it('a host reducer that writes pager.total gets the calculated fields recomputed', async () => {
    function C({ state }) { return h('div', null, String(state.p.pages)) }
    C.initialState = { items: [] }
    C.uses = { p: pager({ pageSize: 2 }) }
    C.model = { LOADED: (s, items) => ({ ...s, items, p: { ...s.p, total: items.length } }) }
    t = renderComponent(C)
    await t.ready()
    t.simulateAction('LOADED', [1, 2, 3]); await t.next(s => s.p.total === 3)
    expect(t.state.p).toMatchObject({ pages: 2, hasNext: true })
  })

  it('is shared by a host and its Collection items, each with its own slice', async () => {
    function Thread({ state }) {
      return h('li', null, h(Older, null, 'Older'), h('span', { className: 'p' }, `${state.title}:${state.pager.page}`), h(Newer, null, 'Newer'))
    }
    Thread.uses = { pager: pager({ next: Newer, prev: Older }) }
    function Inbox({ state }) {
      return h('div', null, h(Newer, null, 'Next page'), h('ul', null, h(Collection, { of: Thread, from: 'threads' })))
    }
    Inbox.initialState = { threads: [{ id: 1, title: 'x' }, { id: 2, title: 'y' }] }
    Inbox.uses = { pager: pager({ next: Newer }) }
    t = renderComponent(Inbox, { dom: 'real' })
    await t.ready(); await settle(30)
    t.simulateEvent(`li:nth-child(2) ${Newer}`, 'click')
    await t.waitForState(s => s.threads[1].pager?.page === 1)
    expect(t.state.pager.page).toBe(0)
    t.simulateEvent(`div > ${Newer}`, 'click')
    await t.waitForState(s => s.pager.page === 1)
    expect(texts('.p')).toEqual(['x:0', 'y:1'])
    t.expectNoDiagnostics()
  })
})

describe('selection', () => {
  const { Pick, All, Clear } = controls({ Pick: 'input', All: 'input', Clear: 'button' })
  function Mailbox({ state }) {
    return h('div', null,
      h(All, { type: 'checkbox', 'aria-label': 'Select all', checked: state.sel.count === state.mails.length }),
      h(Clear, null, 'Clear'),
      h('span', { className: 'count' }, String(state.sel.count)),
      h('ul', null, ...state.mails.map(m => h('li', null,
        h(Pick, { type: 'checkbox', 'aria-label': m.subject, 'data-id': m.id, checked: isSelected(state.sel, m.id) }), m.subject))))
  }
  Mailbox.initialState = { mails: [{ id: 1, subject: 'a' }, { id: 2, subject: 'b' }, { id: 3, subject: 'c' }] }

  it('multi: item clicks toggle ids (as strings); count; isSelected; clear; ABORT when nothing to clear', async () => {
    const C = (p) => Mailbox(p)
    C.initialState = Mailbox.initialState
    C.uses = { sel: selection({ multi: true, item: Pick, clear: Clear }) }
    t = renderComponent(C, { dom: 'real' })
    await t.ready()
    expect(t.state.sel).toEqual({ selected: [], count: 0 })
    t.simulateEvent(`li:nth-child(2) ${Pick}`, 'click'); await t.next(s => s.sel.count === 1)
    t.simulateEvent(`li:nth-child(3) ${Pick}`, 'click'); await t.next(s => s.sel.count === 2)
    expect(t.state.sel.selected).toEqual(['2', '3'])
    expect(isSelected(t.state.sel, 2)).toBe(true)
    expect(isSelected(t.state.sel, '1')).toBe(false)
    t.simulateEvent(`li:nth-child(2) ${Pick}`, 'click'); await t.next(s => s.sel.count === 1)
    expect(t.state.sel.selected).toEqual(['3'])
    t.simulateEvent(Clear, 'click'); await t.next(s => s.sel.count === 0)
    const n = t.states.length
    t.simulateEvent(Clear, 'click'); await settle(30)
    expect(t.states.length).toBe(n)
    t.expectNoDiagnostics()
  })

  it('single (default): an item click replaces the selection; the same item again is no change', async () => {
    const C = (p) => Mailbox(p)
    C.initialState = Mailbox.initialState
    C.uses = { sel: selection({ item: Pick }) }
    t = renderComponent(C)
    await t.ready()
    t.simulateEvent(`li:nth-child(1) ${Pick}`, 'click'); await t.next(s => s.sel.count === 1)
    t.simulateEvent(`li:nth-child(3) ${Pick}`, 'click'); await t.next(s => s.sel.selected[0] === '3')
    expect(t.state.sel).toEqual({ selected: ['3'], count: 1 })
    const n = t.states.length
    t.simulateEvent(`li:nth-child(3) ${Pick}`, 'click'); await settle(30)
    expect(t.states.length).toBe(n)
  })

  it('select-all with `from`: the all control toggles every item of state[from]; SELECT_ALL / SELECT take ids too', async () => {
    const C = (p) => Mailbox(p)
    C.initialState = Mailbox.initialState
    C.uses = { sel: selection({ multi: true, item: Pick, all: All, clear: Clear, from: 'mails' }) }
    C.model = {
      PICK_IDS: { EFFECT: (s, ids, next) => next('sel.SELECT_ALL', ids) },
      PICK: { EFFECT: (s, id, next) => next('sel.SELECT', id) },
      PICK_ALL: { EFFECT: (s, _, next) => next('sel.SELECT_ALL') },
    }
    t = renderComponent(C, { dom: 'real' })
    await t.ready()
    t.simulateEvent(All, 'click'); await t.next(s => s.sel.count === 3)
    expect(t.state.sel.selected).toEqual(['1', '2', '3'])
    t.simulateEvent(All, 'click'); await t.next(s => s.sel.count === 0)
    t.simulateEvent(`li:nth-child(2) ${Pick}`, 'click'); await t.next(s => s.sel.count === 1)
    t.simulateEvent(All, 'click'); await t.next(s => s.sel.count === 3)   // some selected: selects all
    t.simulateAction('PICK_IDS', [5, 6]); await t.next(s => s.sel.count === 2)
    expect(t.state.sel.selected).toEqual(['5', '6'])
    t.simulateAction('PICK', 7); await t.next(s => s.sel.count === 3)
    t.simulateAction('PICK_ALL'); await t.next(s => s.sel.selected.join() === '1,2,3')
    t.expectNoDiagnostics()
  })

  it('select-all without `from` and without ids is no change', async () => {
    function C({ state }) { return h('div', null, String(state.sel.count)) }
    C.uses = { sel: selection({ multi: true }) }
    C.model = { ALL: { EFFECT: (s, _, next) => { next('sel.TOGGLE_ALL'); next('sel.SELECT_ALL') } } }
    t = renderComponent(C)
    await t.ready()
    const n = t.states.length
    t.simulateAction('ALL'); await settle(30)
    expect(t.states.length).toBe(n)
  })

  it('a custom attribute names the item id', async () => {
    const { Row } = controls({ Row: 'button' })
    function C({ state }) { return h('div', null, h(Row, { 'data-key': 'k1' }, 'one'), String(state.s.count)) }
    C.uses = { s: selection({ item: Row, attr: 'data-key' }) }
    t = renderComponent(C)
    await t.ready()
    t.simulateEvent(Row, 'click'); await t.next(s => s.s.count === 1)
    expect(t.state.s.selected).toEqual(['k1'])
  })
})

describe('undoable (GS-8 helper)', () => {
  const { Inc, Undo, Redo } = controls({ Inc: 'button', Undo: 'button', Redo: 'button' })
  const makeEditor = (opts = {}, extra = {}) => {
    function Editor({ state }) {
      return h('div', null, h('span', { className: 'n' }, String(state.doc.n)), h(Inc, null, '+'),
        h(Undo, { disabled: !state.history?.past.length }, 'Undo'), h(Redo, { disabled: !state.history?.future.length }, 'Redo'))
    }
    Editor.initialState = { doc: { n: 0 }, other: 0 }
    Editor.intent = ({ DOM }) => ({ INC: DOM.click(Inc), UNDO: DOM.click(Undo), REDO: DOM.click(Redo) })
    Editor.model = undoable({
      INC: (s) => ({ ...s, doc: { n: s.doc.n + 1 } }),
      SET: (s, n) => ({ ...s, doc: { n } }),
      OTHER: (s) => ({ ...s, other: s.other + 1 }),
      LOAD: (s, n) => ({ ...s, doc: { n } }),
      ...extra,
    }, { key: 'doc', ...opts })
    return Editor
  }

  it('X4 on the real API: undo / redo; past and future; ABORT when empty', async () => {
    t = renderComponent(makeEditor(), { dom: 'real' })
    await t.ready()
    let n = t.states.length
    t.simulateEvent(Undo, 'click'); await settle(30)
    expect(t.states.length).toBe(n)
    t.simulateEvent(Inc, 'click'); await t.next(s => s.doc.n === 1)
    t.simulateEvent(Inc, 'click'); await t.next(s => s.doc.n === 2)
    expect(t.state.history).toEqual({ past: [{ n: 0 }, { n: 1 }], future: [] })
    t.simulateEvent(Undo, 'click'); await t.next(s => s.doc.n === 1)
    expect(t.state.history).toEqual({ past: [{ n: 0 }], future: [{ n: 2 }] })
    t.simulateEvent(Redo, 'click'); await t.next(s => s.doc.n === 2)
    n = t.states.length
    t.simulateEvent(Redo, 'click'); await settle(30)
    expect(t.states.length).toBe(n)
    t.simulateEvent(Undo, 'click'); await t.next(s => s.doc.n === 1)
    t.simulateEvent(Inc, 'click'); await t.next(s => s.doc.n === 2 && s.history.future.length === 0)  // a new change clears future
    t.expectNoDiagnostics()
  })

  it('a change that leaves state[key] alone is not recorded; ABORT passes through', async () => {
    t = renderComponent(makeEditor({}, { NOPE: () => ABORT }))
    await t.ready()
    t.simulateAction('OTHER'); await t.next(s => s.other === 1)
    expect(t.state.history).toBe(undefined)
    t.simulateAction('NOPE'); await settle(20)
    expect(t.state.other).toBe(1)
  })

  it('limit keeps the newest snapshots', async () => {
    t = renderComponent(makeEditor({ limit: 2 }))
    await t.ready()
    for (let i = 1; i <= 4; i++) { t.simulateAction('SET', i); await t.next(s => s.doc.n === i) }
    expect(t.state.history.past).toEqual([{ n: 2 }, { n: 3 }])
  })

  it('track: only the listed actions are recorded', async () => {
    t = renderComponent(makeEditor({ track: ['INC'] }))
    await t.ready()
    t.simulateAction('SET', 5); await t.next(s => s.doc.n === 5)
    expect(t.state.history).toBe(undefined)
    t.simulateAction('INC'); await t.next(s => s.doc.n === 6)
    expect(t.state.history.past).toEqual([{ n: 5 }])
  })

  it('resetOn clears the history (and is not recorded)', async () => {
    t = renderComponent(makeEditor({ resetOn: ['LOAD'] }))
    await t.ready()
    t.simulateAction('INC'); await t.next(s => s.doc.n === 1)
    t.simulateAction('INC'); await t.next(s => s.doc.n === 2)
    t.simulateAction('LOAD', 10); await t.next(s => s.doc.n === 10)
    expect(t.state.history).toEqual({ past: [], future: [] })
  })

  it('coalesceMs merges rapid changes by the same action into one step', async () => {
    vi.useFakeTimers()
    t = renderComponent(makeEditor({ coalesceMs: 500 }))
    await t.ready()
    for (let i = 1; i <= 3; i++) { t.simulateAction('SET', i); await t.next(s => s.doc.n === i); await vi.advanceTimersByTimeAsync(100) }
    expect(t.state.history.past).toEqual([{ n: 0 }])
    await vi.advanceTimersByTimeAsync(600)
    t.simulateAction('SET', 4); await t.next(s => s.doc.n === 4)
    expect(t.state.history.past).toEqual([{ n: 0 }, { n: 3 }])
    t.simulateAction('INC'); await t.next(s => s.doc.n === 5)           // another action: a new step
    expect(t.state.history.past).toEqual([{ n: 0 }, { n: 3 }, { n: 4 }])
    t.simulateAction('UNDO'); await t.next(s => s.doc.n === 4)
    t.simulateAction('UNDO'); await t.next(s => s.doc.n === 3)
    t.simulateAction('UNDO'); await t.next(s => s.doc.n === 0)
  })

  it('object entries keep their other sinks; a model UNDO entry runs after the built-in one', async () => {
    const log = []
    t = renderComponent(makeEditor({}, {
      INC: { STATE: (s) => ({ ...s, doc: { n: s.doc.n + 1 } }), EFFECT: () => { log.push('inc') } },
      UNDO: { EFFECT: (s) => { log.push('undo ' + s.doc.n) } },
    }))
    await t.ready()
    t.simulateAction('INC'); await t.next(s => s.doc.n === 1)
    t.simulateAction('UNDO'); await t.next(s => s.doc.n === 0)
    await settle(10)
    expect(log).toEqual(['inc', 'undo 1'])
  })

  it('does not change the model it wraps', () => {
    const model = { INC: (s) => s }
    const wrapped = undoable(model, { key: 'doc' })
    expect(Object.keys(model)).toEqual(['INC'])
    expect(Object.keys(wrapped).sort()).toEqual(['INC', 'REDO', 'UNDO'])
  })
})

describe('undo (GS-8 behavior)', () => {
  const { Inc, Undo, Redo } = controls({ Inc: 'button', Undo: 'button', Redo: 'button' })
  function Doc({ state }) {
    return h('div', null, h('span', { className: 'n' }, String(state.doc.n)), h(Inc, null, '+'),
      h(Undo, { disabled: !state.history.canUndo }, 'Undo'), h(Redo, { disabled: !state.history.canRedo }, 'Redo'))
  }
  Doc.initialState = { doc: { n: 0 } }
  Doc.intent = ({ DOM }) => ({ INC: DOM.click(Inc) })
  Doc.model = { INC: (s) => ({ ...s, doc: { n: s.doc.n + 1 } }) }
  Doc.uses = { history: undo({ key: 'doc', undo: Undo, redo: Redo }) }

  it('state.history = { past, future, canUndo, canRedo }; history.UNDO / history.REDO from the controls', async () => {
    t = renderComponent(Doc, { dom: 'real' })
    await t.ready()
    expect(t.state.history).toEqual({ past: [], future: [], canUndo: false, canRedo: false })
    t.simulateEvent(Inc, 'click'); await t.next(s => s.doc.n === 1)
    expect(t.state.history).toEqual({ past: [{ n: 0 }], future: [], canUndo: true, canRedo: false })
    t.simulateEvent(Undo, 'click'); await t.next(s => s.doc.n === 0)
    expect(t.state.history).toEqual({ past: [], future: [{ n: 1 }], canUndo: false, canRedo: true })
    t.simulateEvent(Redo, 'click'); await t.next(s => s.doc.n === 1)
    expect(t.state.history.canUndo).toBe(true)
    expect(t.query(Undo).disabled).toBe(false)
    expect(Doc.model).toEqual({ INC: Doc.model.INC })   // statics unchanged
    expect(t.actions.filter(a => a.type === 'history.UNDO').map(a => a.cause)).toEqual(['behavior'])
    t.expectNoDiagnostics()
  })

  it('a host intent action triggers history.UNDO (keyboard shortcut)', async () => {
    function K({ state }) { return h('div', null, String(state.doc.n)) }
    K.initialState = { doc: { n: 0 } }
    K.intent = ({ DOM }) => ({
      'history.UNDO': DOM.select('document').events('keydown').filter(e => e.ctrlKey && e.key === 'z'),
    })
    K.model = { SET: (s, n) => ({ ...s, doc: { n } }) }
    K.uses = { history: undo({ key: 'doc', resetOn: [] }) }
    t = renderComponent(K)
    await t.ready()
    t.simulateAction('SET', 3); await t.next(s => s.doc.n === 3)
    t.simulateEvent('document', 'keydown', { ctrlKey: true, key: 'z' })
    await t.next(s => s.doc.n === 0)
    expect(t.state.history.canRedo).toBe(true)
  })

  it('in a Collection item host each item has its own history', async () => {
    function Item({ state }) { return h('li', null, h(Inc, null, '+'), h(Undo, null, 'Undo'), h('span', { className: 'v' }, String(state.doc.n))) }
    Item.intent = ({ DOM }) => ({ INC: DOM.click(Inc) })
    Item.model = { INC: (s) => ({ ...s, doc: { n: s.doc.n + 1 } }) }
    Item.uses = { history: undo({ key: 'doc', undo: Undo }) }
    function L() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
    L.initialState = { items: [{ id: 1, doc: { n: 0 } }, { id: 2, doc: { n: 5 } }] }
    t = renderComponent(L, { dom: 'real' })
    await t.ready(); await settle(30)
    t.simulateEvent(`li:nth-child(2) ${Inc}`, 'click')
    await t.waitForState(s => s.items[1].doc.n === 6)
    t.simulateEvent(`li:nth-child(1) ${Undo}`, 'click'); await settle(30)
    expect(t.state.items[0].doc.n).toBe(0)
    t.simulateEvent(`li:nth-child(2) ${Undo}`, 'click')
    await t.next(s => s.items[1].doc.n === 5)
    expect(texts('.v')).toEqual(['0', '5'])
  })
})

describe('SYG226', () => {
  it('is registered as a dev code with a title', () => {
    expect(DEV_CODE_SEVERITY.SYG226).toBe('warn')
    expect(CODE_TITLES.SYG226).toMatch(/undo/i)
  })

  it('undoable(): a track or resetOn name with no model entry', () => {
    undoable({ INC: (s) => s, LOAD: (s) => s }, { key: 'doc', track: ['INC', 'TYPO'], resetOn: ['LOAD', 'LOADED'] })
    const d = diagnostics('SYG226')
    expect(d.map(x => x.data.action)).toEqual(['TYPO', 'LOADED'])
    expect(d[0].message).toContain("'TYPO'")
    expect(d[0].severity).toBe('warn')
  })

  it('no report when every name is a model entry (shorthand keys count by their action)', () => {
    undoable({ INC: (s) => s, 'LOAD | STATE': (s) => s }, { key: 'doc', track: ['INC'], resetOn: ['LOAD'] })
    expect(diagnostics('SYG226')).toEqual([])
  })

  it('undo() behavior: reported once per definition, with the component', async () => {
    function C({ state }) { return h('div', null, String(state.doc.n)) }
    C.initialState = { doc: { n: 0 } }
    C.model = { SET: (s, n) => ({ ...s, doc: { n } }) }
    C.uses = { history: undo({ key: 'doc', track: ['SETT'] }) }
    function L() { return h('ul', null, h(Collection, { of: C, from: 'items' })) }
    L.initialState = { items: [{ id: 1, doc: { n: 0 } }, { id: 2, doc: { n: 0 } }] }
    t = renderComponent(L)
    await t.ready(); await settle(30)
    const d = diagnostics('SYG226')
    expect(d).toHaveLength(1)
    expect(d[0].message).toContain("'SETT'")
  })
})
