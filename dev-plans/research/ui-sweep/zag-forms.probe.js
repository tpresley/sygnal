// @vitest-environment jsdom
// UI sweep (zag.md): the parts with the form behavior and processForm, multiple and refused picks (ZS-1)
import { describe, it, expect, afterEach } from 'vitest'
import { createElement as h } from '../../../src/pragma/index.js'
import { renderComponent } from '../../../src/extra/testing.js'
import { ABORT, processForm } from '../../../src/index.ts'
import { form } from '../../../src/extra/form.ts'
import { Select } from '../../../src/ui-select.ts'
import { Combobox } from '../../../src/ui-combobox.ts'
import { rec } from './zag-rec.js'

const ANY = { '~standard': { version: 1, vendor: 'probe', validate: (value) => ({ value }) } }
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms))
let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })
const type = (input, text) => { input.value = text; input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text })) }
const real = async (C) => { t = renderComponent(C, { dom: 'real' }); await t.ready(); await settle(); return t }
const ITEMS = [{ value: 'nyc', label: 'New York' }, { value: 'par', label: 'Paris' }, { value: 'lis', label: 'Lisbon' }]
const pickSelect = async (sel, v) => { if (t.query(sel + ' [data-part=content]').hidden) t.query(sel + ' [data-part=trigger]').click(); await settle(); t.query(`${sel} [role=option][data-value="${v}"]`).click(); await settle() }
const pickCombo = async (sel, q, v) => { const i = t.query(sel + ' input[role=combobox]'); i.focus(); type(i, q); await settle(); t.query(`${sel} [role=option][data-value="${v}"]`).click(); await settle() }

describe('form behavior', () => {
  it('Select multiple → an array in form.values; the select shows the picks', async () => {
    function A({ state }) { return h('form', null, h(Select, { className: 's', label: 'Tags', name: 'tags', multiple: true, items: ITEMS, value: state.form.values.tags })) }
    A.uses = { form: form(ANY, { values: { tags: [] } }) }
    await real(A)
    await pickSelect('.s', 'par')
    await pickSelect('.s', 'lis')
    expect(t.state.form.values.tags).toEqual(['par', 'lis'])
    expect([...t.query('.s select').selectedOptions].map((o) => o.value)).toEqual(['par', 'lis'])
  })

  it('Combobox multiple → an array in form.values', async () => {
    function A({ state }) { return h('form', null, h(Combobox, { className: 'c', label: 'Cities', name: 'cities', multiple: true, items: ITEMS, value: state.form.values.cities })) }
    A.uses = { form: form(ANY, { values: { cities: [] } }) }
    await real(A)
    await pickCombo('.c', 'P', 'par')
    await pickCombo('.c', 'L', 'lis')
    expect(t.state.form.values.cities).toEqual(['par', 'lis'])
    expect(t.queryAll('.c input[type=hidden]').map((i) => i.value)).toEqual(['par', 'lis'])
  })

  it('a controlled combobox in the form behavior shows the label after the pick', async () => {
    function A({ state }) { return h('form', null, h(Combobox, { className: 'c', label: 'City', name: 'city', items: ITEMS, value: state.form.values.city })) }
    A.uses = { form: form(ANY, { values: { city: 'nyc' } }) }
    await real(A)
    expect(t.query('.c input[role=combobox]').value).toBe('New York')
    await pickCombo('.c', 'Lis', 'lis')
    expect(t.state.form.values.city).toBe('lis')
    expect(t.query('.c input[role=combobox]').value).toBe('Lisbon')
    t.simulateAction('form.RESET')
    await settle()
    expect(t.state.form.values.city).toBe('nyc')
    expect(t.query('.c input[role=combobox]').value).toBe('New York')
  })

  it('blur: the Select field is marked touched (show: blur)', async () => {
    function A({ state }) { return h('form', null, h(Select, { className: 's', label: 'Size', name: 'size', items: ITEMS, value: state.form.values.size }), h('input', { name: 'other' })) }
    A.uses = { form: form(ANY, { values: { size: '', other: '' } }) }
    await real(A)
    const tr = t.query('.s [data-part=trigger]')
    tr.focus()
    t.query('input[name=other]').focus()
    await settle()
    expect(t.state.form.touched).toEqual({ size: true })
  })
})

describe('processForm', () => {
  it('default events (input, submit): one entry per pick, the picked value', async () => {
    const seen = []
    function A() { return h('form', { className: 'f' }, h(Select, { className: 's', label: 'Size', name: 'size', items: ITEMS })) }
    A.initialState = {}
    A.intent = ({ DOM }) => ({ F: processForm(DOM.select('.f')) })
    A.model = { F: (s, v) => { seen.push(v.size); return s } }
    await real(A)
    await pickSelect('.s', 'par')
    expect(seen).toEqual(['par'])
  })

  it('refused pick (ABORT on value-change): the hidden field keeps the state value', async () => {
    function A({ state }) { return h('form', { className: 'f' }, h(Select, { className: 's', label: 'Size', name: 'size', items: ITEMS, value: state.v })) }
    A.initialState = { v: 'nyc' }
    A.intent = ({ DOM }) => ({ V: DOM.select('.s').events('value-change').detail() })
    A.model = { V: () => ABORT }
    await real(A)
    await pickSelect('.s', 'par')
    expect(new FormData(t.query('.f')).get('size')).toBe('nyc')
    expect(t.queryAll('.f [name=size]')).toHaveLength(1)
  })
})
