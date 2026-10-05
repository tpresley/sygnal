// @vitest-environment jsdom
// PLAN-5 3-F: dialog() fixes (review 2-S). G-429 cancelable: false sets closedby="none", which
// stops the cancel event: CANCEL is the Escape keydown in the dialog then, and the attribute goes
// when the dialog closes. (Real engines: browser-tests ui-p5u.jsx.)
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { dialog } from '../src/ui.ts'

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
