// @vitest-environment jsdom
// PLAN-5 3-I: dialog() review fixes (review 3-F).
// G-457 with cancelable: false, CANCEL is not an Escape an element inside handled (its default
// prevented: a Zag combobox closing its list), nor an IME one, nor one in a non-modal dialog.
// G-459 G-430's returnFocus with an opener that is not the trigger's first match, and a close
// event that is a task later (as browsers send it), installed per test.
// G-461 OPEN arms its close listener and closedby only once showModal() / show() succeeded.
// (Real engines: browser-tests ui-p5u.jsx.)
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderComponent } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { dialog } from '../src/ui.ts'
import run from '../src/extra/run.js'
import { setupChecks, settle } from './diagnostics/helpers.js'

const P = HTMLDialogElement.prototype
const own = { showModal: Object.getOwnPropertyDescriptor(P, 'showModal'), show: Object.getOwnPropertyDescriptor(P, 'show'), close: Object.getOwnPropertyDescriptor(P, 'close') }
// as browsers: open goes false at once, the close event is a task later
const fakes = ({ sync = false } = {}) => {
  P.showModal = function () { this.open = true }
  P.show = function () { this.open = true }
  P.close = function () {
    if (!this.open) return
    this.open = false
    sync ? this.dispatchEvent(new Event('close')) : setTimeout(() => this.dispatchEvent(new Event('close')))
  }
}
const restore = () => { for (const k in own) own[k] ? Object.defineProperty(P, k, own[k]) : delete P[k] }

let t, app
beforeEach(() => fakes())
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  try { app?.dispose() } catch (_) {}
  t = app = null
  document.body.innerHTML = ''
  restore()
})

const escape = (el, init = {}) => {
  const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init })
  el.dispatchEvent(e)
  return e
}

function strict(opts) {
  function Strict({ state }) {
    return h('div', null,
      h('button', { className: 'open' }, 'Open'),
      h('dialog', { className: 'strict' }, h('input', { className: 'field' }), h('button', { className: 'inner' }, 'x')),
      h('p', { className: 'n' }, String(state.cancels)))
  }
  Strict.initialState = { cancels: 0 }
  Strict.uses = { strict: dialog({ dialog: '.strict', trigger: '.open', cancelable: false, ...opts }) }
  Strict.model = { 'strict.CANCEL': (s) => ({ ...s, cancels: s.cancels + 1 }) }
  return Strict
}

describe('G-457: CANCEL with cancelable: false', () => {
  const open = async (opts) => {
    t = renderComponent(strict(opts), { dom: 'real' })
    await t.ready()
    t.query('.open').click()
    await t.settle()
    expect(t.query('.strict').open).toBe(true)
  }

  it('an Escape an element inside handled (default prevented, as a Zag combobox closing its list): no CANCEL', async () => {
    await open()
    // the element's own listener runs before the DOM driver's delegated one
    t.query('.field').addEventListener('keydown', (e) => { if (e.key === 'Escape') e.preventDefault() })
    expect(escape(t.query('.field')).defaultPrevented).toBe(true)
    await t.settle()
    expect(t.query('.n').textContent).toBe('0')
    // an unhandled one still runs it
    escape(t.query('.inner'))
    await t.settle()
    expect(t.query('.n').textContent).toBe('1')
  })

  it('an IME Escape (isComposing, or keyCode 229 as Safari sends it): no CANCEL', async () => {
    await open()
    escape(t.query('.field'), { isComposing: true })
    escape(t.query('.field'), { keyCode: 229 })
    await t.settle()
    expect(t.query('.n').textContent).toBe('0')
    escape(t.query('.field'), { keyCode: 27 })
    await t.settle()
    expect(t.query('.n').textContent).toBe('1')
  })

  it('a non-modal dialog (modal: false): Escape runs no CANCEL, as with cancelable: true (the cancel event is still prevented)', async () => {
    await open({ modal: false })
    escape(t.query('.inner'))
    await t.settle()
    expect(t.query('.n').textContent).toBe('0')
    const c = new Event('cancel', { cancelable: true })
    t.query('.strict').dispatchEvent(c)
    expect(c.defaultPrevented).toBe(true)
  })
})

describe('G-461: OPEN when showModal() throws', () => {
  // (the state shows `open`, so OPEN patches and its command runs in the microtask after it)
  function Host({ state }) {
    return h('div', null,
      h('button', { className: 'open first' }, 'Open 1'),
      h('button', { className: 'open second' }, 'Open 2'),
      h('p', null, String(state.d.open)),
      h('dialog', { className: 'dlg' }, h('button', { className: 'inner' }, 'x')))
  }
  Host.uses = { d: dialog({ dialog: '.dlg', trigger: '.open', cancelable: false }) }

  // (the second trigger opens it: a stale listener would focus it; the CLOSED fallback focuses the
  // first match of the trigger)
  it('arms no close listener and leaves no closedby: a later close does not focus the old opener', async () => {
    const errors = [], qm = globalThis.queueMicrotask
    P.showModal = function () { throw new DOMException('not allowed', 'InvalidStateError') }
    setupChecks()
    document.body.innerHTML = '<div id="root"></div>'
    try {
      app = run(Host, {}, { mountPoint: '#root', diagnostics: 'collect' })
      await settle(60)
      const d = document.querySelector('.dlg')
      // the command's error (it reaches the caller as any command's does)
      globalThis.queueMicrotask = (f) => qm(() => { try { f() } catch (e) { errors.push(e) } })
      document.querySelector('.second').click()
      await settle(60)
      globalThis.queueMicrotask = qm
      expect(errors.map((e) => e.name)).toEqual(['InvalidStateError'])
      expect(d.open).toBe(false)
      expect(d.hasAttribute('closedby')).toBe(false)
      // later the dialog opens some other way and closes with the focus lost
      d.open = true
      document.querySelector('.inner').focus()
      d.open = false
      document.querySelector('.inner').blur()
      d.dispatchEvent(new Event('close'))
      await settle(60)
      expect(document.activeElement).not.toBe(document.querySelector('.second'))
    } finally { globalThis.queueMicrotask = qm }
  })
})
