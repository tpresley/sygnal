// @vitest-environment jsdom
// UI sweep (dev-plans/research/ui-sweep/zag.md): Menu, Select and Combobox fixes.
// - ZS-1: a pick is the hidden field's `input` event: the form behavior and processForm hear it
//   (single and multiple), and a refused pick leaves the submitted value alone
// - ZS-2: Select still submits a selected value the items no longer have (the trigger shows it)
// - ZS-3: Combobox's input shows the value's label when the items arrive after the value, and goes
//   back to the state's value when the model refuses a pick
// - ZS-4: a native form reset resets Combobox (the input and the hidden input)
// - ZS-5: the focus leaving a Select / Combobox marks its form-behavior field touched
// - ZS-6: inside a <dialog> the positioning strategy is 'fixed' (Firefox and WebKit flipped the list
//   off-screen: browser-tests/src/tests/ui-zag-p5z.jsx)
import { describe, it, expect, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { ABORT, processForm } from '../src/index.ts'
import { form } from '../src/extra/form.ts'
import { Select } from '../src/ui-select.ts'
import { Combobox } from '../src/ui-combobox.ts'

// a Standard Schema that accepts anything
const ANY = { '~standard': { version: 1, vendor: 'test', validate: (value) => ({ value }) } }
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms))
let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })
const type = (input, text) => { input.value = text; input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text })) }
const real = async (C) => { t = renderComponent(C, { dom: 'real' }); await t.ready(); await settle(); return t }
const ITEMS = [{ value: 'nyc', label: 'New York' }, { value: 'par', label: 'Paris' }, { value: 'lis', label: 'Lisbon' }]
const input = (sel) => t.query(sel + ' input[role=combobox]')
const pickSelect = async (sel, v) => {
  if (t.query(sel + ' [data-part=content]').hidden) t.query(sel + ' [data-part=trigger]').click()
  await settle()
  t.query(`${sel} [role=option][data-value="${v}"]`).click()
  await settle()
}
const pickCombo = async (sel, q, v) => {
  input(sel).focus()
  type(input(sel), q)
  await settle()
  t.query(`${sel} [role=option][data-value="${v}"]`).click()
  await settle()
}

describe('ZS-1: the form behavior and processForm hear picks', () => {
  it('Select, single and multiple', async () => {
    function A({ state }) {
      return h('form', null,
        h(Select, { className: 's', label: 'Size', name: 'size', items: ITEMS, value: state.form.values.size }),
        h(Select, { className: 'm', label: 'Tags', name: 'tags', multiple: true, items: ITEMS, value: state.form.values.tags }))
    }
    A.uses = { form: form(ANY, { values: { size: '', tags: [] } }) }
    await real(A)
    await pickSelect('.s', 'par')
    expect(t.state.form.values.size).toBe('par')
    expect(t.query('.s [data-part=value-text]').textContent).toBe('Paris')
    await pickSelect('.m', 'par')
    await pickSelect('.m', 'lis')
    expect(t.state.form.values.tags).toEqual(['par', 'lis'])
    expect([...t.query('.m select').selectedOptions].map((o) => o.value)).toEqual(['par', 'lis'])
  })

  it('Combobox, single and multiple; the input shows the label; form.RESET goes back', async () => {
    function A({ state }) {
      return h('form', null,
        h(Combobox, { className: 'c', label: 'City', name: 'city', items: ITEMS, value: state.form.values.city }),
        h(Combobox, { className: 'm', label: 'Cities', name: 'cities', multiple: true, items: ITEMS, value: state.form.values.cities }))
    }
    A.uses = { form: form(ANY, { values: { city: 'nyc', cities: [] } }) }
    await real(A)
    await pickCombo('.c', 'Lis', 'lis')
    expect(t.state.form.values.city).toBe('lis')
    expect(input('.c').value).toBe('Lisbon')
    await pickCombo('.m', 'P', 'par')
    await pickCombo('.m', 'L', 'lis')
    expect(t.state.form.values.cities).toEqual(['par', 'lis'])
    expect(t.queryAll('.m input[type=hidden]').map((i) => i.value)).toEqual(['par', 'lis'])
    t.simulateAction('form.RESET')
    await settle()
    expect(input('.c').value).toBe('New York')
  })

  it('processForm (input, submit): one entry per pick, with the picked value', async () => {
    const seen = []
    function A() { return h('form', { className: 'f' }, h(Select, { className: 's', label: 'Size', name: 'size', items: ITEMS })) }
    A.initialState = {}
    A.intent = ({ DOM }) => ({ F: processForm(DOM.select('.f')) })
    A.model = { F: (s, v) => { seen.push(v.size); return s } }
    await real(A)
    await pickSelect('.s', 'par')
    expect(seen).toEqual(['par'])
  })

  it('a refused pick: the field keeps the state value, no stand-in field is left', async () => {
    function A({ state }) { return h('form', { className: 'f' }, h(Select, { className: 's', label: 'Size', name: 'size', items: ITEMS, value: state.v })) }
    A.initialState = { v: 'nyc' }
    A.intent = ({ DOM }) => ({ V: DOM.select('.s').events('value-change').detail() })
    A.model = { V: () => ABORT }
    await real(A)
    await pickSelect('.s', 'par')
    expect(new FormData(t.query('.f')).getAll('size')).toEqual(['nyc'])
    expect(t.query('.s [data-part=value-text]').textContent).toBe('New York')
  })
})

it('ZS-2: Select submits a selected value the items no longer have', async () => {
  function A({ state }) { return h('form', { className: 'f' }, h(Select, { className: 's', label: 'Size', name: 'size', items: state.items, value: 'par' })) }
  A.initialState = { items: ITEMS }
  A.model = { DROP: (s) => ({ ...s, items: ITEMS.filter((i) => i.value !== 'par') }) }
  await real(A)
  t.simulateAction('DROP')
  await settle()
  expect(t.query('.s [data-part=value-text]').textContent).toBe('Paris')
  expect(new FormData(t.query('.f')).get('size')).toBe('par')
})

describe('ZS-3: the Combobox input shows the state value', () => {
  it('when the items arrive after the value, and when an item is relabelled', async () => {
    function A({ state }) { return h('div', null, h(Combobox, { className: 'c', label: 'City', items: state.items, value: 'par' })) }
    A.initialState = { items: [] }
    A.model = { LOAD: (s, items) => ({ ...s, items }) }
    await real(A)
    expect(input('.c').value).toBe('')
    t.simulateAction('LOAD', ITEMS)
    await settle()
    expect(input('.c').value).toBe('Paris')
    t.simulateAction('LOAD', ITEMS.map((i) => (i.value === 'par' ? { ...i, label: 'Paris, FR' } : i)))
    await settle()
    expect(input('.c').value).toBe('Paris, FR')
  })

  it('when the model refuses or overrides a pick', async () => {
    function A({ state }) { return h('div', null, h(Combobox, { className: 'c', label: 'City', items: ITEMS, value: state.v })) }
    A.initialState = { v: 'nyc' }
    A.intent = ({ DOM }) => ({ V: DOM.select('.c').events('value-change').detail() })
    A.model = { V: (s, v) => (v === 'lis' ? ABORT : { ...s, v: v === 'par' ? 'nyc' : v }) }
    await real(A)
    await pickCombo('.c', 'Lis', 'lis')
    expect(t.state.v).toBe('nyc')
    expect(input('.c').value).toBe('New York')
    await pickCombo('.c', 'Par', 'par')
    expect(input('.c').value).toBe('New York')
  })

  it('leaves the typed text alone (typing, allowCustomValue, selectionBehavior preserve)', async () => {
    function A({ state }) { return h('div', null, h(Combobox, { className: 'c', label: 'City', items: ITEMS, value: state.v, allowCustomValue: true })) }
    A.initialState = { v: 'nyc' }
    await real(A)
    input('.c').focus()
    type(input('.c'), 'Lis')
    await settle()
    expect(input('.c').value).toBe('Lis')
    input('.c').blur()
    await settle()
    expect(input('.c').value).toBe('Lis')
  })
})

describe('ZS-4: a native form reset resets Combobox', () => {
  it('uncontrolled: the defaultValue, in the input and the hidden input', async () => {
    function A() { return h('form', { className: 'f' }, h(Combobox, { className: 'c', label: 'City', name: 'city', items: ITEMS, defaultValue: 'nyc' })) }
    await real(A)
    await pickCombo('.c', 'Lis', 'lis')
    expect(new FormData(t.query('.f')).get('city')).toBe('lis')
    t.query('.f').reset()
    await settle()
    expect(input('.c').value).toBe('New York')
    expect(new FormData(t.query('.f')).get('city')).toBe('nyc')
  })

  it('controlled: value-change reports the first value; unchanged since: the input keeps its label', async () => {
    function A({ state }) { return h('form', { className: 'f' }, h(Combobox, { className: 'c', label: 'City', name: 'city', items: ITEMS, value: state.v })) }
    A.initialState = { v: 'nyc' }
    A.intent = ({ DOM }) => ({ V: DOM.select('.c').events('value-change').detail() })
    A.model = { V: (s, v) => ({ ...s, v }) }
    await real(A)
    t.query('.f').reset()
    await settle()
    expect(input('.c').value).toBe('New York')
    await pickCombo('.c', 'Lis', 'lis')
    expect(t.state.v).toBe('lis')
    t.query('.f').reset()
    await settle()
    expect(t.state.v).toBe('nyc')
    expect(input('.c').value).toBe('New York')
  })

  it('the form attribute: a reset of that form; the listener goes with the combobox', async () => {
    function A({ state }) {
      return h('div', null, h('form', { id: 'zs4', className: 'f' }), state.show && h(Combobox, { className: 'c', label: 'City', name: 'city', form: 'zs4', items: ITEMS, defaultValue: 'nyc' }))
    }
    A.initialState = { show: true }
    A.model = { HIDE: (s) => ({ ...s, show: false }) }
    await real(A)
    await pickCombo('.c', 'Par', 'par')
    t.query('.f').reset()
    await settle()
    expect(new FormData(t.query('.f')).get('city')).toBe('nyc')
    t.simulateAction('HIDE')
    await settle()
    t.query('.f').reset()
    await settle()
  })
})

it('ZS-5: the focus leaving Select / Combobox marks the field touched (not moving into the list)', async () => {
  function A({ state }) {
    return h('form', null,
      h(Select, { className: 's', label: 'Size', name: 'size', items: ITEMS, value: state.form.values.size }),
      h(Combobox, { className: 'c', label: 'City', name: 'city', items: ITEMS, value: state.form.values.city }),
      h('input', { name: 'note', className: 'note' }))
  }
  A.uses = { form: form(ANY, { values: { size: '', city: '', note: '' } }) }
  await real(A)
  t.query('.s [data-part=trigger]').focus()
  t.query('.s [data-part=content]').focus()
  await settle()
  expect(t.state.form.touched).toEqual({})
  input('.c').focus()
  await settle()
  expect(t.state.form.touched).toEqual({ size: true })
  t.query('.note').focus()
  await settle()
  expect(t.state.form.touched).toEqual({ size: true, city: true })
})

it("ZS-6: inside a <dialog>, the parts' positioning strategy is 'fixed' unless the prop says otherwise", async () => {
  const { Menu } = await import('../src/ui-menu.ts')
  function A() {
    return h('div', null,
      h('dialog', null,
        h(Menu, { className: 'm', label: 'A', items: ['x'] }),
        h(Select, { className: 's', label: 'S', items: ['x'], positioning: { placement: 'top' } }),
        h(Combobox, { className: 'c', label: 'C', items: ['x'], positioning: { strategy: 'absolute' } })),
      h(Select, { className: 'out', label: 'O', items: ['x'] }))
  }
  await real(A)
  const pos = (sel) => t.widget(sel).instance.machine.service.prop('positioning')
  expect(pos('.m').strategy).toBe('fixed')
  expect(pos('.s')).toMatchObject({ strategy: 'fixed', placement: 'top' })
  expect(pos('.c').strategy).toBe('absolute')
  expect(pos('.out')?.strategy).not.toBe('fixed')
})
