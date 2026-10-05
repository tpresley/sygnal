// @vitest-environment jsdom
// PLAN-5 1-F item 3 (D196, 0-S6 "controlled drift"): a form-associated custom element (its
// class has `static formAssociated = true`, as Web Awesome's wa-input / wa-rating / wa-switch)
// with a `value` / `checked` prop is controlled like <input>: when the model refuses the user's
// value and renders again, the element gets the state's value back. Before, only input,
// textarea and select were re-synced, so the element kept showing the refused value.
import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { controlledInputModule, isField } from '../src/cycle/dom/controlledInputModule.js'

let t
afterEach(() => { if (t) t.dispose(); t = null; document.body.innerHTML = '' })

// tiny elements: a number `value` (like wa-rating), a boolean `checked` (like wa-switch)
beforeAll(() => {
  class XRating extends HTMLElement {
    static formAssociated = true
    constructor() { super(); this._v = 0 }
    get value() { return this._v }
    set value(v) { this._v = Number(v) }
  }
  class XSwitch extends HTMLElement {
    static formAssociated = true
    constructor() { super(); this._c = false }
    get checked() { return this._c }
    set checked(v) { this._c = !!v }
  }
  // not form-associated: left alone, as before
  class XPlain extends HTMLElement {
    constructor() { super(); this._v = 0 }
    get value() { return this._v }
    set value(v) { this._v = v }
  }
  customElements.define('x-rating', XRating)
  customElements.define('x-switch', XSwitch)
  customElements.define('x-plain', XPlain)
})

// the user picks a value on the element (it changes its own value, then fires change)
const pick = (el, v) => { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })) }
const flip = (el) => { el.checked = !el.checked; el.dispatchEvent(new Event('change', { bubbles: true })) }

function capped(tag, showRefused) {
  function Capped({ state }) {
    return h('div', null,
      h(tag, { className: 'r', value: state.v }),
      showRefused ? h('p', { className: 'refused' }, String(state.refused)) : null)
  }
  Capped.initialState = { v: 2, refused: 0 }
  Capped.intent = ({ DOM }) => ({ SET: DOM.select('.r').events('change').map(e => e.target.value) })
  // refuses values above 3; a refusal is a new state (it renders), as in the forms guide
  Capped.model = { SET: (s, v) => (v > 3 ? { ...s, refused: s.refused + 1 } : { ...s, v }) }
  return Capped
}

describe('form-associated custom elements are controlled (D196)', () => {
  it('isField: input/textarea/select, and a form-associated custom element', () => {
    const el = (tag) => document.createElement(tag)
    expect(isField({ sel: 'x-rating.r', elm: el('x-rating') })).toBeTruthy()
    expect(isField({ sel: 'x-plain', elm: el('x-plain') })).toBeFalsy()
    expect(isField({ sel: 'input.a', elm: el('input') })).toBeTruthy()
    expect(isField({ sel: 'div.my-class', elm: el('div') })).toBeFalsy()
    expect(isField({ sel: 'inputs', elm: el('inputs') })).toBeFalsy()
  })

  it('a refused value is replaced by the state value on the next render', async () => {
    t = renderComponent(capped('x-rating', true), { dom: 'real' }); await t.ready()
    const r = t.query('.r')
    expect(r.value).toBe(2)
    pick(r, 3); await t.settle()
    expect(t.state.v).toBe(3)
    pick(r, 5); await t.settle()
    expect(t.state).toEqual({ v: 3, refused: 1 })
    expect(r.value).toBe(3)
  })

  it('also when the refusal renders the same tree (no other visible change)', async () => {
    t = renderComponent(capped('x-rating', false), { dom: 'real' }); await t.ready()
    const r = t.query('.r')
    pick(r, 5); await t.settle()
    expect(t.state.refused).toBe(1)
    expect(r.value).toBe(2)
  })

  it('the value is written as the prop (a number stays a number); equal values are not rewritten', async () => {
    const sets = []
    const elm = document.createElement('x-rating')
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(elm), 'value')
    Object.defineProperty(elm, 'value', { get: () => desc.get.call(elm), set: (v) => { sets.push(v); desc.set.call(elm, v) } })
    const vnode = (value) => ({ sel: 'x-rating', data: { props: { value } }, elm })
    elm.value = 5; sets.length = 0
    controlledInputModule.update(vnode(2), vnode(2))
    expect(sets).toEqual([2])
    controlledInputModule.update(vnode(2), vnode(2))
    expect(sets).toEqual([2])
  })

  it('checked on a form-associated switch', async () => {
    function Locked({ state }) { return h('div', null, h('x-switch', { className: 's', checked: state.on }), h('p', null, String(state.tries))) }
    Locked.initialState = { on: false, tries: 0 }
    Locked.intent = ({ DOM }) => ({ TRY: DOM.select('.s').events('change') })
    Locked.model = { TRY: (s) => ({ ...s, tries: s.tries + 1 }) } // never lets it turn on
    t = renderComponent(Locked, { dom: 'real' }); await t.ready()
    const s = t.query('.s')
    flip(s); await t.settle()
    expect(t.state.tries).toBe(1)
    expect(s.checked).toBe(false)
  })

  it('a custom element that is not form-associated is left alone (as before)', async () => {
    t = renderComponent(capped('x-plain', true), { dom: 'real' }); await t.ready()
    const r = t.query('.r')
    pick(r, 5); await t.settle()
    expect(t.state.refused).toBe(1)
    expect(r.value).toBe(5)
  })

  it('as the forms guide says: a copy of the state puts the value back, and (D205) so does ABORT', async () => {
    const { ABORT } = await import('../src/index.js')
    for (const [refuse, expected] of [[(s) => ({ ...s }), 2], [() => ABORT, 2], [(s) => s, 2]]) {
      function R({ state }) { return h('x-rating', { className: 'r', value: state.v }) }
      R.initialState = { v: 2 }
      R.intent = ({ DOM }) => ({ SET: DOM.select('.r').events('change').map(e => e.target.value) })
      R.model = { SET: (s, v) => (v > 3 ? refuse(s) : { ...s, v }) }
      t = renderComponent(R, { dom: 'real' }); await t.ready()
      pick(t.query('.r'), 5); await t.settle()
      expect(t.query('.r').value).toBe(expected)
      t.dispose(); t = null
    }
  })
})
