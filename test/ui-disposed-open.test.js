// @vitest-environment jsdom
// 7.7.1 (Tune): a component disposed while its dialog() / popover() / tooltip() is open, with its
// slice kept by a parent (a wizard step left and entered again): the slice doesn't stay open, so
// the part isn't opened on the way back, and its trigger works. (G-400 covered the element leaving
// a living component.)
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent, wizard, Outlet, makeTimerDriver } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { dialog, popover, tooltip, tooltips } from '../src/ui.ts'

let t, restore = []
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  restore.reverse().forEach((f) => f())
  restore = []
  document.body.innerHTML = ''
})
// jsdom has no <dialog> methods and no Popover API: stand-ins that keep `open` / :popover-open and
// send close / toggle as the browser does (toggle in a task)
const stub = (o, k, v) => { const d = Object.getOwnPropertyDescriptor(o, k); restore.push(() => (d ? Object.defineProperty(o, k, d) : delete o[k])); Object.defineProperty(o, k, { configurable: true, writable: true, value: v }) }
const calls = []
function fakes() {
  calls.length = 0
  const P = HTMLDialogElement.prototype, E = Element.prototype, H = HTMLElement.prototype, m = E.matches
  const toggle = (el, on) => setTimeout(() => el.dispatchEvent(Object.assign(new Event('toggle'), { newState: on ? 'open' : 'closed' })))
  stub(P, 'showModal', function () { calls.push('showModal'); this.setAttribute('open', ''); toggle(this, true) })
  stub(P, 'close', function () { calls.push('close'); if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new Event('close')) })
  stub(E, 'matches', function (s) { return s == ':popover-open' ? !!this._pop : m.call(this, s) })
  stub(H, 'showPopover', function () { calls.push('showPopover'); if (this._pop) throw new Error('already open'); this._pop = true; toggle(this, true) })
  stub(H, 'hidePopover', function () { calls.push('hidePopover'); if (!this._pop) throw new Error('not open'); this._pop = false; toggle(this, false) })
}
const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms))

function Two() { return h('p', { className: 'two' }, 'Two') }
const flow = (Step) => {
  function Flow({ state }) {
    return h('section', null,
      h(Outlet, { of: { one: Step, two: Two }, from: 'wizard' }),
      h('button', { className: 'back' }, 'Back'), h('button', { className: 'next' }, 'Next'),
      h('pre', { className: 'slice' }, JSON.stringify(state.wizard.local.one || null)))
  }
  Flow.uses = { wizard: wizard({ steps: { one: {}, two: {} }, draft: {}, next: '.next', back: '.back' }) }
  return Flow
}
const slice = () => JSON.parse(t.query('.slice').textContent)
const away = async () => {
  t.query('.next').click()
  await t.settle(); await wait()
  expect(t.query('.two')).not.toBe(null)
}
const back = async () => {
  t.query('.back').click()
  await t.settle(); await wait()
  expect(t.query('.two')).toBe(null)
}

describe('a step disposed while a sygnal/ui part is open', () => {
  it('dialog: closed on the way back (opened by its trigger, then without the model); the trigger opens it again', async () => {
    fakes()
    function One() { return h('div', null, h('button', { className: 'open' }, 'Open'), h('dialog', { className: 'd', 'aria-label': 'D' }, 'x')) }
    One.uses = { d: dialog({ dialog: '.d', trigger: '.open' }) }
    t = renderComponent(flow(One), { dom: 'real' })
    await t.ready()
    for (const how of ['trigger', 'element']) {
      how == 'trigger' ? t.query('.open').click() : t.query('.d').showModal()
      await t.settle(); await wait()
      expect(t.query('.d').hasAttribute('open')).toBe(true)
      expect(slice().d.open).toBe(true)
      await away()
      expect(slice().d.open).toBe(false)
      await back()
      expect(t.query('.d').hasAttribute('open')).toBe(false)
      expect(slice().d.open).toBe(false)
    }
    expect(calls.filter((c) => c == 'showModal')).toHaveLength(2)
    t.query('.open').click()
    await t.settle(); await wait()
    expect(t.query('.d').hasAttribute('open')).toBe(true)
    t.expectNoDiagnostics()
  })

  it('popover: closed on the way back; the trigger opens it again', async () => {
    fakes()
    function One() { return h('div', null, h('button', { className: 'open' }, 'Open'), h('div', { className: 'p', popover: 'manual' }, 'x')) }
    One.uses = { p: popover({ popover: '.p', trigger: '.open' }) }
    t = renderComponent(flow(One), { dom: 'real' })
    await t.ready()
    t.query('.open').click()
    await t.settle(); await wait()
    expect(t.query('.p')._pop).toBe(true)
    expect(slice().p.open).toBe(true)
    await away()
    expect(slice().p.open).toBe(false)
    await back()
    expect(!!t.query('.p')._pop).toBe(false)
    t.query('.open').click()
    await t.settle(); await wait()
    expect(t.query('.p')._pop).toBe(true)
    expect(slice().p.open).toBe(true)
    t.expectNoDiagnostics()
  })

  it('tooltip and tooltips: at rest on the way back; focus shows the tip again', async () => {
    fakes()
    function One() {
      return h('div', null,
        h('button', { className: 'save' }, 'Save'), h('div', { className: 'save-tip', popover: 'manual', role: 'tooltip' }, 'Saves'),
        h('button', { className: 'hint', 'aria-describedby': 'h1' }, 'Hint'), h('div', { className: 'tip', id: 'h1', popover: 'manual', role: 'tooltip' }, 'A hint'))
    }
    One.uses = { tip: tooltip({ trigger: '.save', tip: '.save-tip', showDelay: 0 }), tips: tooltips({ trigger: '.hint', tip: '.tip', showDelay: 0 }) }
    t = renderComponent(flow(One), { dom: 'real', drivers: { TIMERS: makeTimerDriver() } })
    await t.ready()
    const focus = (sel) => t.query(sel).dispatchEvent(new Event('focus'))
    stub(Element.prototype, 'matches', ((m) => function (s) { return s == ':focus-visible' ? true : m.call(this, s) })(Element.prototype.matches))
    for (const [sel, tip, key, open] of [['.save', '.save-tip', 'tip', true], ['.hint', '.tip', 'tips', 'h1']]) {
      focus(sel)
      await wait(); await t.settle()
      expect(t.query(tip)._pop).toBe(true)
      expect(slice()[key]).toMatchObject({ open, focus: true })
      await away()
      expect(slice()[key]).toMatchObject({ open: key == 'tip' ? false : null, pending: null, hover: false, focus: false, pressed: false })
      await back()
      expect(!!t.query(tip)._pop).toBe(false)
      focus(sel)
      await wait(); await t.settle()
      expect(t.query(tip)._pop).toBe(true)
      expect(slice()[key]).toMatchObject({ open, focus: true })
      await away()
      await back()
    }
  })
})
