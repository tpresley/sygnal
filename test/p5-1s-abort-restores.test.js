// @vitest-environment jsdom
// PLAN-5 1-S D205: an action triggered by input on a value-bound (controlled) field whose STATE
// handler makes no change (ABORT, or the state it was given) still re-renders its component, so
// the field shows the model's value again (as React's controlled inputs). Before, nothing
// rendered and the field kept the refused text. Native fields and form-associated custom
// elements; ABORT on any other action (a click) still renders nothing.
import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { ABORT } from '../src/index.js'

let t
afterEach(() => { if (t) t.dispose(); t = null; document.body.innerHTML = '' })

beforeAll(() => {
  class XNum extends HTMLElement {
    static formAssociated = true
    constructor() { super(); this._v = '' }
    get value() { return this._v }
    set value(v) { this._v = String(v) }
  }
  customElements.define('x-num', XNum)
})

const views = { n: 0 }
function Digits({ state }) {
  views.n++
  return h('div', null,
    h('input', { className: 'n', value: state.v }),
    h('input', { className: 'same', value: state.v }),
    h('input', { type: 'checkbox', className: 'c', checked: state.on }),
    h('x-num', { className: 'x', value: state.v }),
    h('button', { className: 'b' }, 'b'))
}
Digits.initialState = { v: '12', on: false }
Digits.intent = ({ DOM }) => ({
  TYPE: DOM.select('.n').events('input').map(e => e.target.value),
  SAME: DOM.select('.same').events('input').map(e => e.target.value),
  TOGGLE: DOM.select('.c').events('change').map(e => e.target.checked),
  CUSTOM: DOM.select('.x').events('input').map(e => e.target.value),
  CLICK: DOM.click('.b'),
})
const digits = (s, v) => /^\d*$/.test(v) ? { ...s, v } : ABORT
Digits.model = {
  TYPE: digits,
  CUSTOM: digits,
  // GS-4: the state itself is no change too
  SAME: (s, v) => /^\d*$/.test(v) ? { ...s, v } : s,
  TOGGLE: () => ABORT,
  CLICK: () => ABORT,
}

describe('D205: ABORT on input restores a controlled field', () => {
  it('a digits-only filter: the refused text is replaced by the model value', async () => {
    t = renderComponent(Digits, { dom: 'real' }); await t.ready()
    t.simulateEvent('.n', 'input', { value: '123' }); await t.settle()
    expect(t.state.v).toBe('123')
    expect(t.query('.n').value).toBe('123')
    t.simulateEvent('.n', 'input', { value: '123a' }); await t.settle()
    expect(t.state.v).toBe('123')
    expect(t.query('.n').value).toBe('123')
  })

  it('returning the same state restores it too', async () => {
    t = renderComponent(Digits, { dom: 'real' }); await t.ready()
    t.simulateEvent('.same', 'input', { value: '1x' }); await t.settle()
    expect(t.query('.same').value).toBe('12')
  })

  it('a checkbox change ABORTed is unchecked again', async () => {
    t = renderComponent(Digits, { dom: 'real' }); await t.ready()
    t.simulateEvent('.c', 'change', { checked: true }); await t.settle()
    expect(t.query('.c').checked).toBe(false)
  })

  it('a form-associated custom element gets the model value back', async () => {
    t = renderComponent(Digits, { dom: 'real' }); await t.ready()
    t.simulateEvent('.x', 'input', { value: 'abc' }); await t.settle()
    expect(t.query('.x').value).toBe('12')
  })

  it('ABORT on a click action does not render', async () => {
    t = renderComponent(Digits, { dom: 'real' }); await t.ready()
    const before = views.n
    t.simulateEvent('.b', 'click'); await t.settle()
    t.simulateEvent('.b', 'click'); await t.settle()
    expect(views.n).toBe(before)
  })
})
