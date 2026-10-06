// @vitest-environment jsdom
// PLAN-5 3-U G-533: a dialog() whose showModal() throws syncs only its own state, not that of a
// dialog() around it (the internal fail event bubbles); G-534: SYNC after a failure clears the
// returnValue also when OPEN's STATE aborted (state open, element closed).
import { describe, it, expect, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { dialog } from '../src/ui.ts'
import run from '../src/extra/run.js'
import { settle } from './diagnostics/helpers.js'

const P = HTMLDialogElement.prototype
const own = { showModal: Object.getOwnPropertyDescriptor(P, 'showModal'), close: Object.getOwnPropertyDescriptor(P, 'close') }
const restore = () => { for (const k in own) own[k] ? Object.defineProperty(P, k, own[k]) : delete P[k] }

let app, fail, qm, errors
const mock = () => {
  fail = false
  P.showModal = function () { if (fail) throw new DOMException('no', 'InvalidStateError'); this.open = true }
  P.close = function (rv) { if (rv !== undefined) this.returnValue = rv; this.open = false; this.dispatchEvent(new Event('close')) }
  document.body.innerHTML = '<div id="root"></div>'
  errors = []; qm = globalThis.queueMicrotask
  globalThis.queueMicrotask = (f) => qm(() => { try { f() } catch (e) { errors.push(e) } })
}
afterEach(() => {
  if (qm) globalThis.queueMicrotask = qm
  qm = null
  try { app?.dispose() } catch (_) {}
  app = null
  document.body.innerHTML = ''
  restore()
})
const st = () => JSON.parse(document.querySelector('.st').textContent)
const click = async (sel) => { document.querySelector(sel).click(); await settle(60) }

describe('3-U G-533: a failed inner dialog leaves the outer one open', () => {
  it('two dialog() behaviors on one host, .inner inside .outer', async () => {
    function Host({ state }) {
      return h('div', null,
        h('button', { className: 'oo' }, 'O'),
        h('p', { className: 'st' }, JSON.stringify([state.a.open, state.b.open])),
        h('dialog', { className: 'outer' }, h('button', { className: 'io' }, 'I'), h('dialog', { className: 'inner' }, 'x')))
    }
    Host.uses = { a: dialog({ dialog: '.outer', trigger: '.oo' }), b: dialog({ dialog: '.inner', trigger: '.io' }) }
    mock()
    app = run(Host, {}, { mountPoint: '#root' })
    await settle(60)
    await click('.oo')
    expect(st()).toEqual([true, false])
    fail = true
    await click('.io')
    expect(errors.map((e) => e.name)).toEqual(['InvalidStateError'])
    expect(st()).toEqual([true, false])
    expect(document.querySelector('.outer').open).toBe(true)
  })

  it("a child component's dialog inside the parent's dialog", async () => {
    function Kid({ state }) {
      return h('div', null,
        h('button', { className: 'io' }, 'I'),
        h('p', { className: 'kst' }, JSON.stringify(state.b.open)),
        h('dialog', { className: 'inner' }, 'x'))
    }
    Kid.uses = { b: dialog({ dialog: '.inner', trigger: '.io' }) }
    function Host({ state }) {
      return h('div', null,
        h('button', { className: 'oo' }, 'O'),
        h('p', { className: 'st' }, JSON.stringify(state.a.open)),
        h('dialog', { className: 'outer' }, h(Kid, { state: 'kid' })))
    }
    Host.initialState = { kid: {} }
    Host.uses = { a: dialog({ dialog: '.outer', trigger: '.oo' }) }
    mock()
    app = run(Host, {}, { mountPoint: '#root' })
    await settle(60)
    await click('.oo')
    expect(st()).toBe(true)
    fail = true
    await click('.io')
    expect(errors.map((e) => e.name)).toEqual(['InvalidStateError'])
    expect(st()).toBe(true)
    expect(document.querySelector('.kst').textContent).toBe('false')
    expect(document.querySelector('.outer').open).toBe(true)
  })
})

describe('3-U G-534: SYNC after a failure clears the returnValue', () => {
  it("state open (OPEN's STATE aborts), the element closed without an event, showModal() throws", async () => {
    function Host({ state }) {
      return h('div', null,
        h('button', { className: 'open' }, 'Open'),
        h('p', { className: 'st' }, JSON.stringify({ open: state.d.open, returnValue: state.d.returnValue })),
        h('dialog', { className: 'dlg' }, 'x'))
    }
    Host.uses = { d: dialog({ dialog: '.dlg', trigger: '.open' }) }
    Host.intent = ({ DOM }) => ({ MARK: DOM.click('.st') })
    // a host entry for d.OPEN that changes the state: a patch follows, so the command runs (and
    // its error is thrown) in a microtask, not the commands' fallback timer
    Host.model = { MARK: (s) => ({ ...s, d: { ...s.d, returnValue: 'stale' } }), 'd.OPEN': (s) => ({ ...s, n: (s.n || 0) + 1 }) }
    mock()
    app = run(Host, {}, { mountPoint: '#root' })
    await settle(60)
    await click('.open')
    await click('.st')
    expect(st()).toEqual({ open: true, returnValue: 'stale' })
    // closed with no close event (the state stays open)
    document.querySelector('.dlg').open = false
    fail = true
    await click('.open')
    expect(errors.map((e) => e.name)).toEqual(['InvalidStateError'])
    expect(st()).toEqual({ open: false, returnValue: '' })
  })
})
