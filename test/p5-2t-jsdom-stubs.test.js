// @vitest-environment jsdom
// PLAN-5 2-T (D211): renderComponent({ dom: 'real' }) provides what Zag needs and jsdom lacks
// (ResizeObserver, CSS.escape, Element.prototype.scrollTo) for the test's lifetime only: the
// Zag parts run in jsdom without a setup file, and nothing is left behind after dispose().
import { it, expect, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { Combobox } from '../src/ui-combobox.ts'

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms))
const type = (input, text) => {
  input.value = text
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }))
}
const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })

const missing = () => ({
  ResizeObserver: typeof globalThis.ResizeObserver,
  CSS: typeof globalThis.CSS,
  scrollTo: typeof Element.prototype.scrollTo,
})

it('jsdom has none of them to begin with (this file installs no stubs)', () => {
  expect(missing()).toEqual({ ResizeObserver: 'undefined', CSS: 'undefined', scrollTo: 'undefined' })
})

it('a Combobox runs (typing, keyboard, selection) with no stubs; they are gone after dispose()', async () => {
  const errors = []
  const onErr = (e) => errors.push(e.message)
  process.on('uncaughtException', onErr)
  try {
    function Trip({ state }) {
      return h('div', null, h(Combobox, { className: 'city', label: 'City', items: ['Paris', 'London', 'Lisbon'], value: state.city }))
    }
    Trip.initialState = { city: null }
    Trip.intent = ({ DOM }) => ({ CITY: DOM.select('.city').events('value-change').detail() })
    Trip.model = { CITY: (s, city) => ({ ...s, city }) }
    t = renderComponent(Trip, { dom: 'real' })
    await t.ready()
    await settle()
    expect(typeof globalThis.ResizeObserver).toBe('function')
    expect(CSS.escape('a b')).toBe('a\\ b')
    expect(typeof Element.prototype.scrollTo).toBe('function')
    const input = t.query('.city input')
    input.focus()
    type(input, 'Li')
    await settle()
    key(input, 'ArrowDown')
    await settle()
    key(input, 'Enter')
    await t.next((s) => s.city === 'Lisbon')
  } finally {
    process.off('uncaughtException', onErr)
  }
  expect(errors).toEqual([])
  t.dispose()
  t = null
  expect(missing()).toEqual({ ResizeObserver: 'undefined', CSS: 'undefined', scrollTo: 'undefined' })
})

it("an existing implementation is kept, never replaced or removed", async () => {
  class RO { observe() {} unobserve() {} disconnect() {} }
  globalThis.ResizeObserver = RO
  try {
    t = renderComponent(() => h('p', null, 'x'), { dom: 'real' })
    await t.ready()
    expect(globalThis.ResizeObserver).toBe(RO)
    t.dispose()
    t = null
    expect(globalThis.ResizeObserver).toBe(RO)
  } finally { delete globalThis.ResizeObserver }
})
