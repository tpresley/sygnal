// @vitest-environment jsdom
// PLAN-5 3-N G-494: Combobox `allowCustomValue` with a controlled `value` the app clears when the
// user types (input-change → value ''): the typed text is still what the form submits. Only a
// controlled value that isn't empty (a real pick, an app-set value) ends the typing (G-468).
// (With selectionBehavior 'replace', the default, Zag itself writes the cleared selection's label,
// '', into the input: the form submits what the input shows, '')
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
const city = (form) => new FormData(form).get('city')

function B({ state }) {
  return h('form', { className: 'f' },
    h(Combobox, { className: 'c', label: 'City', name: 'city', items: ITEMS, value: state.v, allowCustomValue: true, selectionBehavior: state.sb }))
}
B.intent = ({ DOM }) => ({
  PICK: DOM.select('.c').events('value-change').detail(),
  TYPED: DOM.select('.c').events('input-change').detail(),
})
B.model = {
  PICK: (s, v) => ({ ...s, v }),
  // the app clears its value while the user types
  TYPED: (s) => ({ ...s, v: '' }),
  SET: (s, v) => ({ ...s, v }),
}

const mount = async (v, sb = 'preserve') => {
  B.initialState = { v, sb }
  t = renderComponent(B, { dom: 'real' })
  await t.ready()
  await settle(60)
  return { form: t.query('.f'), input: t.query('.c input') }
}

describe('G-494: an app clearing the controlled value on input-change', () => {
  it('after a pick: the typed text is submitted, not the cleared value', async () => {
    const { form, input } = await mount('par')
    expect(city(form)).toBe('par')
    input.focus()
    type(input, 'Rome')
    await settle()
    expect(t.state.v).toBe('')
    expect(city(form)).toBe('Rome')
  })

  it('with no value: the typed text is submitted', async () => {
    const { form, input } = await mount('')
    input.focus()
    type(input, 'Rome')
    await settle()
    expect(city(form)).toBe('Rome')
  })

  it('a pick after typing, and a value the app sets, still end the typing', async () => {
    const { form, input } = await mount('par')
    input.focus()
    type(input, 'Lis')
    await settle()
    expect(city(form)).toBe('Lis')
    key(input, 'ArrowDown')
    await settle()
    key(input, 'Enter')
    await settle()
    expect(city(form)).toBe('lis')
    type(input, 'Rome')
    await settle()
    expect(city(form)).toBe('Rome')
    t.simulateAction('SET', 'nyc')
    await settle()
    expect(city(form)).toBe('nyc')
  })

  it("selectionBehavior 'replace': the form submits what the input shows", async () => {
    const { form, input } = await mount('par', 'replace')
    input.focus()
    type(input, 'Rome')
    await settle()
    expect(city(form)).toBe(input.value)
  })
})
