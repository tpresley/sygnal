// @vitest-environment jsdom
// UI sweep (zag.md): Combobox probes. Each `it` states what an app author would expect; a failure
// is a finding.
import { describe, it, expect, afterEach } from 'vitest'
import { createElement as h } from '../../../src/pragma/index.js'
import { renderComponent } from '../../../src/extra/testing.js'
import { ABORT, Collection, processForm } from '../../../src/index.ts'
import { form } from '../../../src/extra/form.ts'
import { Combobox } from '../../../src/ui-combobox.ts'
import { rec } from './zag-rec.js'

const ANY = { '~standard': { version: 1, vendor: 'probe', validate: (value) => ({ value }) } }
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms))
let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })
const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
const type = (input, text) => { input.value = text; input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text })) }
const real = async (C, o = {}) => { t = renderComponent(C, { dom: 'real', ...o }); await t.ready(); await settle(); return t }
const ITEMS = [{ value: 'nyc', label: 'New York' }, { value: 'par', label: 'Paris' }, { value: 'lis', label: 'Lisbon' }]
const shown = (sel) => t.queryAll(sel + ' [role=option]').map((o) => o.dataset.value)
const choose = async (sel, q, value) => {
  const input = t.query(sel + ' input[role=combobox]')
  input.focus()
  type(input, q)
  await settle()
  t.query(`${sel} [role=option][data-value="${value}"]`).click()
  await settle()
}

describe('Combobox: controlled value', () => {
  it('a value set before the items load: the input shows the label once they arrive', async () => {
    function A({ state }) { return h('div', null, h(Combobox, { className: 'c', label: 'City', items: state.items, value: state.v })) }
    A.initialState = { v: 'par', items: [] }
    A.model = { LOAD: (s) => ({ ...s, items: ITEMS }) }
    await real(A)
    t.simulateAction('LOAD')
    await settle()
    expect(t.query('.c input[role=combobox]').value).toBe('Paris')
  })

  it('the app sets the value (state → shown): the input text follows', async () => {
    function A({ state }) { return h('div', null, h(Combobox, { className: 'c', label: 'City', items: ITEMS, value: state.v })) }
    A.initialState = { v: null }
    A.model = { SET: (s, v) => ({ ...s, v }) }
    await real(A)
    t.simulateAction('SET', 'lis')
    await settle()
    expect(t.query('.c input[role=combobox]').value).toBe('Lisbon')
    t.simulateAction('SET', null)
    await settle()
    expect(t.query('.c input[role=combobox]').value).toBe('')
  })

  it('a reducer that rejects the pick (ABORT): the input shows the state value, not the rejected label', async () => {
    function A({ state }) { return h('div', null, h(Combobox, { className: 'c', label: 'City', items: ITEMS, value: state.v })) }
    A.initialState = { v: 'nyc' }
    A.intent = ({ DOM }) => ({ V: DOM.select('.c').events('value-change').detail() })
    A.model = { V: (s, v) => (v === 'lis' ? ABORT : { ...s, v }) }
    await real(A)
    await choose('.c', 'Lis', 'lis')
    expect(t.state.v).toBe('nyc')
    rec('[probe] combobox ABORT: input shows', JSON.stringify(t.query('.c input[role=combobox]').value),
      'aria-selected lis', t.query('.c [role=option][data-value=lis]')?.getAttribute('aria-selected'))
    expect(t.query('.c input[role=combobox]').value).toBe('New York')
  })

  it('a reducer that overrides the pick: the input shows the override', async () => {
    function A({ state }) { return h('div', null, h(Combobox, { className: 'c', label: 'City', items: ITEMS, value: state.v })) }
    A.initialState = { v: null }
    A.intent = ({ DOM }) => ({ V: DOM.select('.c').events('value-change').detail() })
    A.model = { V: (s, v) => ({ ...s, v: v === 'lis' ? 'par' : v }) }
    await real(A)
    await choose('.c', 'Lis', 'lis')
    expect(t.state.v).toBe('par')
    expect(t.query('.c input[role=combobox]').value).toBe('Paris')
  })

  it('uncontrolled defaultValue: the input shows the label', async () => {
    function A() { return h('div', null, h(Combobox, { className: 'c', label: 'City', items: ITEMS, defaultValue: 'lis' })) }
    await real(A)
    expect(t.query('.c input[role=combobox]').value).toBe('Lisbon')
  })

  it('controlled open', async () => {
    function A({ state }) { return h('div', null, h(Combobox, { className: 'c', label: 'City', items: ITEMS, open: state.open, openOnClick: true })) }
    A.initialState = { open: false }
    A.intent = ({ DOM }) => ({ OPEN: DOM.select('.c').events('open-change').detail() })
    A.model = { OPEN: (s, open) => ({ ...s, open }) }
    await real(A)
    t.query('.c [data-part=trigger]').click()
    await settle()
    expect(t.state.open).toBe(true)
    expect(t.query('.c [data-part=content]').hidden).toBe(false)
    key(t.query('.c input[role=combobox]'), 'Escape')
    await settle()
    expect(t.state.open).toBe(false)
    expect(t.query('.c [data-part=content]').hidden).toBe(true)
  })
})

describe('Combobox: items while open', () => {
  it('async results replace the items while open (filter={false}): the list shows them, highlight survives a removed item', async () => {
    function A({ state }) { return h('div', null, h(Combobox, { className: 'c', label: 'User', items: state.items, filter: false })) }
    A.initialState = { items: [] }
    A.intent = ({ DOM }) => ({ Q: DOM.select('.c').events('input-change').detail() })
    A.model = { Q: (s) => s, RESULTS: (s, items) => ({ ...s, items }) }
    await real(A)
    const input = t.query('.c input[role=combobox]')
    input.focus()
    type(input, 'a')
    await settle()
    rec('[probe] combobox open with no items:', t.query('.c [data-part=content]').hidden ? 'closed' : 'open')
    t.simulateAction('RESULTS', ITEMS)
    await settle()
    rec('[probe] after async results: open?', !t.query('.c [data-part=content]').hidden, 'options', shown('.c'))
    key(input, 'ArrowDown')
    await settle()
    const hl = t.query('.c [data-highlighted]')?.dataset.value
    t.simulateAction('RESULTS', ITEMS.filter((i) => i.value !== hl))
    await settle()
    rec('[probe] highlighted', hl, 'removed: highlighted now', t.query('.c [data-highlighted]')?.dataset.value ?? null, 'activedescendant', input.getAttribute('aria-activedescendant'))
    key(input, 'Enter')
    await settle()
  })

  it('the typed text keeps filtering after the items change', async () => {
    function A({ state }) { return h('div', null, h(Combobox, { className: 'c', label: 'City', items: state.items })) }
    A.initialState = { items: ITEMS }
    A.model = { MORE: (s) => ({ ...s, items: [...ITEMS, { value: 'lon', label: 'London' }] }) }
    await real(A)
    const input = t.query('.c input[role=combobox]')
    input.focus()
    type(input, 'l')
    await settle()
    expect(shown('.c')).toEqual(['lis'])
    t.simulateAction('MORE')
    await settle()
    expect(shown('.c')).toEqual(['lis', 'lon'])
  })

  it('empty items, typed text: the list (empty) does not throw on Enter', async () => {
    function A() { return h('div', null, h(Combobox, { className: 'c', label: 'City', items: [] })) }
    await real(A)
    const input = t.query('.c input[role=combobox]')
    input.focus()
    type(input, 'x')
    key(input, 'ArrowDown')
    key(input, 'Enter')
    await settle()
    rec('[probe] empty combobox: input', input.value)
  })

  it('disabled items: skipped by the arrows, a click does not select', async () => {
    function A({ state }) { return h('div', null, h(Combobox, { className: 'c', label: 'City', items: [{ value: 'a', label: 'Aa', disabled: true }, { value: 'b', label: 'Ab' }], value: state.v })) }
    A.initialState = { v: null }
    A.intent = ({ DOM }) => ({ V: DOM.select('.c').events('value-change').detail() })
    A.model = { V: (s, v) => ({ ...s, v }) }
    await real(A)
    const input = t.query('.c input[role=combobox]')
    input.focus()
    type(input, 'A')
    await settle()
    t.query('.c [role=option][data-value=a]').click()
    await settle()
    expect(t.state.v).toBe(null)
    key(input, 'ArrowDown')
    await settle()
    expect(t.query('.c [data-highlighted]')?.dataset.value).toBe('b')
  })
})

describe('Combobox: multiple', () => {
  it('multiple: picks accumulate; value-change gives the array; the input clears', async () => {
    function A({ state }) { return h('form', { className: 'f' }, h(Combobox, { className: 'c', label: 'Cities', name: 'cities', multiple: true, items: ITEMS, value: state.v })) }
    A.initialState = { v: [] }
    A.intent = ({ DOM }) => ({ V: DOM.select('.c').events('value-change').detail() })
    A.model = { V: (s, v) => ({ ...s, v }) }
    await real(A)
    await choose('.c', 'P', 'par')
    await choose('.c', 'L', 'lis')
    expect(t.state.v).toEqual(['par', 'lis'])
    expect(new FormData(t.query('.f')).getAll('cities')).toEqual(['par', 'lis'])
    rec('[probe] multiple combobox: input text', JSON.stringify(t.query('.c input[role=combobox]').value), 'selected shown anywhere?', t.query('.c').textContent.includes('Paris'))
  })
})

describe('Combobox: forms', () => {
  it('the form behavior hears a pick (name + form)', async () => {
    function A({ state }) { return h('form', null, h(Combobox, { className: 'c', label: 'City', name: 'city', items: ITEMS, value: state.form.values.city })) }
    A.uses = { form: form(ANY, { values: { city: '' } }) }
    await real(A)
    await choose('.c', 'Par', 'par')
    await settle()
    rec('[probe] form behavior + combobox: values', t.state.form.values)
    expect(t.state.form.values.city).toBe('par')
  })

  it('processForm on submit: the value, not the label', async () => {
    function A({ state }) { return h('form', { className: 'f' }, h(Combobox, { className: 'c', label: 'City', name: 'city', items: ITEMS, defaultValue: 'nyc' })) }
    A.initialState = { sent: null }
    A.intent = ({ DOM }) => ({ S: processForm(DOM.select('.f'), { events: 'submit' }) })
    A.model = { S: (s, v) => ({ ...s, sent: v.city }) }
    await real(A)
    await choose('.c', 'Lis', 'lis')
    t.query('.f').requestSubmit()
    await settle()
    expect(t.state.sent).toBe('lis')
  })

  it('native form reset: an uncontrolled combobox goes back to its defaultValue (input and hidden input)', async () => {
    function A() { return h('form', { className: 'f' }, h(Combobox, { className: 'c', label: 'City', name: 'city', items: ITEMS, defaultValue: 'nyc' })) }
    await real(A)
    await choose('.c', 'Lis', 'lis')
    expect(new FormData(t.query('.f')).get('city')).toBe('lis')
    t.query('.f').reset()
    await settle()
    rec('[probe] combobox reset: input', JSON.stringify(t.query('.c input[role=combobox]').value), 'formdata', new FormData(t.query('.f')).get('city'))
    expect(t.query('.c input[role=combobox]').value).toBe('New York')
    expect(new FormData(t.query('.f')).get('city')).toBe('nyc')
  })
})

describe('Combobox: several, Collection', () => {
  it('in Collection rows', async () => {
    function Row({ state }) { return h('li', null, h(Combobox, { className: 'cb', label: 'City ' + state.id, items: ITEMS, value: state.city })) }
    Row.intent = ({ DOM }) => ({ C: DOM.select('.cb').events('value-change').detail() })
    Row.model = { C: (s, city) => ({ ...s, city }) }
    function L() { return h('ul', null, h(Collection, { of: Row, from: 'rows' })) }
    L.initialState = { rows: [{ id: 1, city: null }, { id: 2, city: 'par' }] }
    await real(L)
    const rows = t.queryAll('li')
    expect(rows[1].querySelector('input[role=combobox]').value).toBe('Paris')
    const input = rows[0].querySelector('input[role=combobox]')
    input.focus()
    type(input, 'Lis')
    await settle()
    rows[0].querySelector('[role=option][data-value=lis]').click()
    await settle()
    expect(t.state.rows.map((r) => r.city)).toEqual(['lis', 'par'])
  })
})
