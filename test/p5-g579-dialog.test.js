// @vitest-environment jsdom
// PLAN-5 G-579: with cancelable: false, the dialog's Escape filter skipped CANCEL whenever the
// dialog held an open popover; a <Toaster> region moved into the open modal is an open
// popover="manual" (D198), so CANCEL never ran while a Toaster was on the page. Only a popover
// Escape closes first (auto, or hint) keeps the Escape from the dialog now.
// jsdom has no Popover API: `:popover-open` is stubbed from a set. (Real engines: browser-tests
// ui-p5u.jsx, "Dialog (G-579)".)
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderComponent } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { dialog } from '../src/ui.ts'

const P = HTMLDialogElement.prototype
const own = { showModal: Object.getOwnPropertyDescriptor(P, 'showModal'), close: Object.getOwnPropertyDescriptor(P, 'close') }
const matches = Element.prototype.matches, qs = Element.prototype.querySelector
const opened = new Set()

let t
beforeEach(() => {
  P.showModal = function () { this.open = true }
  P.close = function () { if (this.open) { this.open = false; this.dispatchEvent(new Event('close')) } }
  Element.prototype.matches = function (sel) { return sel === ':popover-open' ? opened.has(this) : matches.call(this, sel) }
  Element.prototype.querySelector = function (sel) { return sel === ':popover-open' ? [...opened].find((p) => this.contains(p) && p !== this) ?? null : qs.call(this, sel) }
})
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  opened.clear()
  document.body.innerHTML = ''
  Element.prototype.matches = matches
  Element.prototype.querySelector = qs
  for (const k in own) own[k] ? Object.defineProperty(P, k, own[k]) : delete P[k]
})

const escape = (el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

function Strict({ state }) {
  return h('div', null,
    h('button', { className: 'open' }, 'Open'),
    h('dialog', { className: 'strict' },
      h('button', { className: 'inner' }, 'x'),
      // as a Toaster region moved into the modal
      h('section', { className: 'toaster', attrs: { popover: 'manual' } }, h('button', { className: 'dismiss' }, 'Dismiss')),
      h('div', { className: 'tip', attrs: { popover: 'manual' } }, 'tip'),
      h('div', { className: 'auto', attrs: { popover: 'auto' } }, 'auto'),
      h('div', { className: 'empty', attrs: { popover: '' } }, 'empty'),
      h('div', { className: 'hint', attrs: { popover: 'hint' } }, 'hint')),
    h('p', { className: 'n' }, String(state.cancels)))
}
Strict.initialState = { cancels: 0 }
Strict.uses = { strict: dialog({ dialog: '.strict', trigger: '.open', cancelable: false }) }
Strict.model = { 'strict.CANCEL': (s) => ({ ...s, cancels: s.cancels + 1 }) }

const open = async () => {
  t = renderComponent(Strict, { dom: 'real' })
  await t.ready()
  t.query('.open').click()
  await t.settle()
  expect(t.query('.strict').open).toBe(true)
}
const count = () => t.query('.n').textContent

describe('G-579: cancelable: false with an open manual popover in the dialog', () => {
  it('a Toaster region (popover="manual") open in the modal: Escape runs CANCEL once', async () => {
    await open()
    opened.add(t.query('.toaster'))
    escape(t.query('.inner'))
    await t.settle()
    expect(count()).toBe('1')
    // also from inside the region (a focused Dismiss button)
    escape(t.query('.dismiss'))
    await t.settle()
    expect(count()).toBe('2')
  })

  it('a manual tooltip open in it: Escape runs CANCEL (Escape closes no manual popover first)', async () => {
    await open()
    opened.add(t.query('.tip'))
    escape(t.query('.inner'))
    await t.settle()
    expect(count()).toBe('1')
  })

  for (const which of ['auto', 'empty', 'hint']) {
    it(`a popover="${which === 'empty' ? '' : which}" open in it: Escape closes that first, no CANCEL; with it closed, CANCEL`, async () => {
      await open()
      opened.add(t.query('.toaster'))
      opened.add(t.query('.' + which))
      escape(t.query('.inner'))
      await t.settle()
      expect(count()).toBe('0')
      opened.delete(t.query('.' + which))
      escape(t.query('.inner'))
      await t.settle()
      expect(count()).toBe('1')
    })
  }
})
