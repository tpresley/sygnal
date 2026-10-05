// @vitest-environment jsdom
// PLAN-5 3-F: dialog() fixes (review 2-S). G-429 cancelable: false sets closedby="none", which
// stops the cancel event: CANCEL is the Escape keydown in the dialog then, and the attribute goes
// when the dialog closes. (Real engines: browser-tests ui-p5u.jsx.)
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { dialog } from '../src/ui.ts'
import run from '../src/extra/run.js'
import { setupChecks, diagnostics, settle } from './diagnostics/helpers.js'

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })

function strict(cancelable) {
  function Strict({ state }) {
    return h('div', null,
      h('button', { className: 'open' }, 'Open'),
      h('dialog', { className: 'strict' }, h('button', { className: 'inner' }, 'x'), h('dialog', { className: 'nested' }, h('button', { className: 'deep' }, 'y'))),
      h('p', { className: 'n' }, String(state.cancels)))
  }
  Strict.initialState = { cancels: 0 }
  Strict.uses = { strict: dialog({ dialog: '.strict', trigger: '.open', cancelable }) }
  Strict.model = { 'strict.CANCEL': (s) => ({ ...s, cancels: s.cancels + 1 }) }
  return Strict
}

describe('G-429: CANCEL with cancelable: false', () => {
  it('real DOM: an Escape keydown in the dialog runs CANCEL (not one in a nested dialog); closedby goes on close', async () => {
    HTMLDialogElement.prototype.showModal ||= function () { this.open = true }
    HTMLDialogElement.prototype.close ||= function () { this.open = false; this.dispatchEvent(new Event('close')) }
    t = renderComponent(strict(false), { dom: 'real' })
    await t.ready()
    t.query('.open').click()
    await t.settle()
    const d = t.query('.strict')
    expect(d.open).toBe(true)
    expect(d.getAttribute('closedby')).toBe('none')
    const esc = (el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    esc(t.query('.inner'))
    await t.settle()
    expect(t.query('.n').textContent).toBe('1')
    esc(t.query('.deep'))
    t.query('.inner').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await t.settle()
    expect(t.query('.n').textContent).toBe('1')
    // the cancel event is still prevented (a browser without closedby fires it)
    const c = new Event('cancel', { cancelable: true })
    d.dispatchEvent(c)
    expect(c.defaultPrevented).toBe(true)
    await t.settle()
    expect(t.query('.n').textContent).toBe('1')
    d.close()
    await t.settle()
    expect(d.hasAttribute('closedby')).toBe(false)
  })

  it('cancelable (default): CANCEL is the cancel event, not prevented', async () => {
    t = renderComponent(strict(undefined), { dom: 'real' })
    await t.ready()
    const c = new Event('cancel', { cancelable: true })
    t.query('.strict').dispatchEvent(c)
    await t.settle()
    expect(c.defaultPrevented).toBe(false)
    expect(t.query('.n').textContent).toBe('1')
  })
})

describe('G-430: returnFocus with a dialog rendered only while open', () => {
  function Transient({ state }) {
    return h('div', null,
      h('button', { className: 't-open' }, 'Open'),
      h('button', { className: 'other' }, 'Other'),
      state.t.open ? h('dialog', { className: 'transient' }, h('button', { className: 't-done' }, 'Done')) : null)
  }
  Transient.uses = { t: dialog({ dialog: '.transient', trigger: '.t-open', close: '.t-done' }) }

  let app
  afterEach(() => { app?.dispose(); app = null })
  const start = async () => {
    setupChecks()
    HTMLDialogElement.prototype.showModal ||= function () { this.open = true }
    // as browsers: open goes false at once, the close event is a task later
    HTMLDialogElement.prototype.close ||= function () { this.open = false; setTimeout(() => this.dispatchEvent(new Event('close'))) }
    document.body.innerHTML = '<div id="root"></div>'
    app = run(Transient, {}, { mountPoint: '#root', diagnostics: 'collect' })
    await settle(60)
  }
  const $ = (s) => document.querySelector(s)

  it('the opener gets the focus back after the close; no command targets the removed dialog (no SYG640)', async () => {
    await start()
    $('.t-open').click()
    await settle(60)
    expect($('.transient').open).toBe(true)
    const d = $('.transient')
    $('.t-done').focus()
    $('.t-done').click()
    // the dialog closed and the focus was in it: lost (as WebKit after a mouse click)
    $('.t-done').blur()
    await settle(1300)
    expect($('.transient')).toBe(null)
    expect(d.isConnected).toBe(false)
    expect(document.activeElement).toBe($('.t-open'))
    expect(diagnostics().map((x) => x.code)).not.toContain('SYG640')
    // nothing keeps the opener on the element
    expect('_opener' in d).toBe(false)
  })

  it('the focus somewhere else already: left there', async () => {
    await start()
    $('.t-open').click()
    await settle(60)
    $('.t-done').click()
    $('.other').focus()
    await settle(60)
    expect(document.activeElement).toBe($('.other'))
  })
})
