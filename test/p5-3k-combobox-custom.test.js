// @vitest-environment jsdom
// PLAN-5 3-K G-468: Combobox `allowCustomValue` submits the selected value unless the user typed
// since the last selection. The 3-G rule (submit the input's text unless it is the selected item's
// label) sent the typed "Lis" with selectionBehavior 'preserve', '' with 'clear', the label when
// the items changed or were relabelled after a pick, and '' for a defaultValue before the items
// loaded.
import { describe, it, expect, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { Combobox } from '../src/ui-combobox.ts'

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms))
let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })
const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
const type = (input, text) => {
  input.value = text
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }))
}
const ITEMS = [{ value: 'nyc', label: 'New York' }, { value: 'par', label: 'Paris' }, { value: 'lis', label: 'Lisbon' }]

// a form with one custom-value combobox; `items` / extra props from state
function app(props = {}) {
  function A({ state }) {
    return h('form', { className: 'f' },
      h(Combobox, { className: 'c', label: 'City', name: 'city', items: state.items, allowCustomValue: true, ...props }))
  }
  A.initialState = { items: props.items ?? ITEMS }
  A.model = { ITEMS: (s, items) => ({ ...s, items }) }
  return A
}
const mount = async (props) => {
  t = renderComponent(app(props), { dom: 'real' })
  await t.ready()
  await settle(60)
  return { form: t.query('.f'), input: t.query('.c input') }
}
const city = (form) => new FormData(form).get('city')
// type, move to the first match, Enter
const pick = async (input, text) => {
  input.focus()
  type(input, text)
  await settle()
  key(input, 'ArrowDown')
  await settle()
  key(input, 'Enter')
  await settle()
}

describe('G-468: allowCustomValue submits the value after a pick', () => {
  it("selectionBehavior 'replace' (default): the picked value", async () => {
    const { form, input } = await mount()
    await pick(input, 'Lis')
    expect(input.value).toBe('Lisbon')
    expect(city(form)).toBe('lis')
  })
  it("selectionBehavior 'preserve': the picked value, not the typed text", async () => {
    const { form, input } = await mount({ selectionBehavior: 'preserve' })
    await pick(input, 'Lis')
    expect(input.value).toBe('Lis')
    expect(city(form)).toBe('lis')
  })
  it("selectionBehavior 'clear': the picked value, not ''", async () => {
    const { form, input } = await mount({ selectionBehavior: 'clear' })
    await pick(input, 'Lis')
    expect(input.value).toBe('')
    expect(city(form)).toBe('lis')
  })
  it('items relabelled after a pick: the value, not the old label', async () => {
    const { form, input } = await mount()
    await pick(input, 'Lis')
    t.simulateAction('ITEMS', [{ value: 'nyc', label: 'New York' }, { value: 'lis', label: 'Lisboa' }])
    await settle()
    expect(city(form)).toBe('lis')
  })
  it('items changed after a pick (the picked item gone): the value', async () => {
    const { form, input } = await mount()
    await pick(input, 'Lis')
    t.simulateAction('ITEMS', [{ value: 'nyc', label: 'New York' }])
    await settle()
    expect(city(form)).toBe('lis')
  })
  it('defaultValue before the items load: the value', async () => {
    const { form } = await mount({ items: [], defaultValue: 'par' })
    expect(city(form)).toBe('par')
    t.simulateAction('ITEMS', ITEMS)
    await settle()
    expect(city(form)).toBe('par')
  })
})

describe('G-468: typing after a pick', () => {
  it('custom text typed after a pick is submitted; a later pick submits its value again', async () => {
    const { form, input } = await mount({ selectionBehavior: 'preserve' })
    await pick(input, 'Par')
    expect(city(form)).toBe('par')
    type(input, 'Rome')
    await settle()
    expect(city(form)).toBe('Rome')
    key(input, 'Escape')
    input.blur()
    await settle()
    expect(city(form)).toBe('Rome')
    await pick(input, 'New')
    expect(city(form)).toBe('nyc')
  })
  it("typing an item's exact label submits that item's value", async () => {
    const { form, input } = await mount()
    await pick(input, 'Lis')
    type(input, 'Paris')
    await settle()
    expect(city(form)).toBe('par')
    type(input, 'paris')
    await settle()
    expect(city(form)).toBe('paris')
  })
  it('a new controlled value ends the typing', async () => {
    function B({ state }) {
      return h('form', { className: 'f' },
        h(Combobox, { className: 'c', label: 'City', name: 'city', items: ITEMS, value: state.v, allowCustomValue: true }))
    }
    B.initialState = { v: null }
    B.model = { SET: (s, v) => ({ ...s, v }) }
    t = renderComponent(B, { dom: 'real' })
    await t.ready()
    await settle(60)
    const form = t.query('.f'), input = t.query('.c input')
    input.focus()
    type(input, 'Rome')
    await settle()
    expect(city(form)).toBe('Rome')
    t.simulateAction('SET', 'lis')
    await settle()
    expect(city(form)).toBe('lis')
  })
})
