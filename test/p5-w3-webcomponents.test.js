// PLAN-5 W-3: web components in the mock DOM (from spike 0-S6).
//   .detail(fn?) reads an event's payload (a Web Awesome Event subclass with a `detail` field, or a
//   CustomEvent); custom-element tags, custom event names and controls made from custom-element
//   tags raise no dev diagnostics, strict included. The real elements run in browser-tests
//   (webawesome-p5w3.jsx, Chromium/Firefox/WebKit).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { controls } from '../src/extra/controls.js'
import { set } from '../src/extra/reducers.js'
import { renderToString } from '../src/extra/ssr.ts'

let t
beforeEach(() => setupChecks())
afterEach(() => { if (t) t.dispose(); t = null })

function Review({ state }) {
  return h('div', { className: 'review' },
    h('wa-rating', { className: 'food', label: 'Food', value: state.food }),
    h('wa-dropdown', { className: 'menu' }, h('wa-dropdown-item', { value: 'copy' }, 'Copy')),
    h('p', { className: 'out' }, `${state.food}|${state.hover}|${state.action}`))
}
Review.initialState = { food: 2, hover: 0, action: '' }
Review.intent = ({ DOM }) => ({
  FOOD: DOM.select('.food').events('change').value(Number),
  HOVER: DOM.select('.food').events('wa-hover').detail((d) => d.value),
  RAW: DOM['wa-hover']('.food').detail(),
  ACTION: DOM.select('.menu').events('wa-select').detail((d) => d.item.value),
})
Review.model = {
  FOOD: set((s, food) => ({ food })),
  HOVER: set((s, hover) => ({ hover })),
  RAW: (s) => s,
  ACTION: set((s, action) => ({ action })),
}

describe('web components in the mock DOM (W-3)', () => {
  it('.detail() / .detail(fn) map e.detail; .value(Number) reads the host value', async () => {
    t = renderComponent(Review, { strict: true })
    await t.ready()
    t.simulateEvent('.food', 'wa-hover', { detail: { phase: 'move', value: 4 } })
    await t.waitForState((s) => s.hover === 4)
    t.simulateEvent('.menu', 'wa-select', { detail: { item: { value: 'copy' } } })
    await t.waitForState((s) => s.action === 'copy')
    t.simulateEvent('.food', 'change', { target: { value: 5 } })
    await t.waitForState((s) => s.food === 5)
    expect(diagnostics()).toEqual([])
  })

  it('controls({ Rating: "wa-rating" }): DOM.select(Rating).events("wa-hover").detail()', async () => {
    const { Rating } = controls({ Rating: 'wa-rating' })
    const Survey = ({ state }) => h('div', null, h(Rating, { label: 'Service', value: state.v }))
    Survey.initialState = { v: 0, hover: null }
    Survey.intent = ({ DOM }) => ({
      V: DOM.select(Rating).events('change').value(Number),
      HOVER: DOM.select(Rating).events('wa-hover').detail(),
    })
    Survey.model = { V: set((s, v) => ({ v })), HOVER: set((s, hover) => ({ hover })) }
    t = renderComponent(Survey, { strict: true })
    await t.ready()
    t.simulateEvent(Rating, 'wa-hover', { detail: { value: 3 } })
    await t.waitForState((s) => s.hover?.value === 3)
    t.simulateEvent(Rating, 'change', { target: { value: 2 } })
    await t.waitForState((s) => s.v === 2)
    expect(diagnostics()).toEqual([])
  })
})

describe('renderToString with custom elements (W-3, D199)', () => {
  it('skips function and object props and writes camelCase props as kebab-case attributes', () => {
    function Page() {
      return h('div', null,
        h('wa-rating', { className: 'food', label: 'Food', value: 4, readonly: true, disabled: false, getSymbol: () => '*', config: { a: 1 }, withClear: true, maxValue: 5 }),
        h('input', { className: 'plain', readOnly: true, value: 'x' }))
    }
    Page.initialState = {}
    expect(renderToString(Page)).toBe('<div data-sygnal-ssr=""><wa-rating class="food" label="Food" value="4" readonly with-clear max-value="5"></wa-rating><input class="plain" readOnly value="x"></div>')
  })
})
