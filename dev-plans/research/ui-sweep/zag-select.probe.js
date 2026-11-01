// @vitest-environment jsdom
// UI sweep (zag.md): Select probes. Each `it` states the behaviour an app author would expect;
// a failure is a finding (see zag.md for the classification).
import { describe, it, expect, afterEach } from 'vitest'
import { createElement as h } from '../../../src/pragma/index.js'
import { renderComponent } from '../../../src/extra/testing.js'
import { ABORT, Collection, processForm } from '../../../src/index.ts'
import { form } from '../../../src/extra/form.ts'
import { Select } from '../../../src/ui-select.ts'
import { rec } from './zag-rec.js'

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms))
let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })
const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
const real = async (C, o = {}) => { t = renderComponent(C, { dom: 'real', ...o }); await t.ready(); await settle(); return t }
const text = (sel) => t.query(sel + ' [data-part=value-text]').textContent
const pick = async (sel, value) => {
  t.query(sel + ' [data-part=trigger]').click()
  await settle()
  t.query(`${sel} [role=option][data-value="${value}"]`).click()
  await settle()
}
// a Standard Schema that accepts anything
export const ANY = { '~standard': { version: 1, vendor: 'probe', validate: (value) => ({ value }) } }
const SIZES = [{ value: 's', label: 'Small' }, { value: 'm', label: 'Medium' }, { value: 'l', label: 'Large' }]

describe('Select: controlled value', () => {
  it('a reducer that rejects the choice (ABORT): the trigger keeps showing the state value', async () => {
    function A({ state }) { return h('div', null, h(Select, { className: 's', label: 'Size', items: SIZES, value: state.size })) }
    A.initialState = { size: 's' }
    A.intent = ({ DOM }) => ({ SIZE: DOM.select('.s').events('value-change').detail() })
    A.model = { SIZE: (s, v) => (v === 'l' ? ABORT : { ...s, size: v }) }
    await real(A)
    await pick('.s', 'l')
    expect(t.state.size).toBe('s')
    expect(text('.s')).toBe('Small')
    expect(t.query('.s select').value).toBe('s')
    expect(t.query('.s [role=option][data-value=l]').getAttribute('aria-selected')).toBe('false')
  })

  it('a reducer that overrides the choice: the trigger shows the override', async () => {
    function A({ state }) { return h('div', null, h(Select, { className: 's', label: 'Size', items: SIZES, value: state.size })) }
    A.initialState = { size: 's' }
    A.intent = ({ DOM }) => ({ SIZE: DOM.select('.s').events('value-change').detail() })
    A.model = { SIZE: (s, v) => ({ ...s, size: v === 'l' ? 'm' : v }) }
    await real(A)
    await pick('.s', 'l')
    expect(t.state.size).toBe('m')
    expect(text('.s')).toBe('Medium')
  })

  it('a value not in the items, then the items arrive (async load): the label shows', async () => {
    function A({ state }) { return h('div', null, h(Select, { className: 's', label: 'Size', items: state.items, value: state.size, placeholder: 'Pick' })) }
    A.initialState = { size: 'm', items: [] }
    A.model = { LOAD: (s) => ({ ...s, items: SIZES }) }
    await real(A)
    expect(text('.s')).toBe('Pick')
    t.simulateAction('LOAD')
    await settle()
    expect(text('.s')).toBe('Medium')
  })

  it('the selected item is removed from the items: the trigger stops showing it', async () => {
    function A({ state }) { return h('div', null, h(Select, { className: 's', label: 'Size', items: state.items, value: state.size, placeholder: 'Pick' })) }
    A.initialState = { size: 'm', items: SIZES }
    A.model = { DROP: (s) => ({ ...s, items: SIZES.filter((i) => i.value !== 'm') }) }
    await real(A)
    expect(text('.s')).toBe('Medium')
    t.simulateAction('DROP')
    await settle()
    // what an author expects is debatable; record it
    rec('[probe] removed selected item, trigger shows:', JSON.stringify(text('.s')), 'hidden select:', t.query('.s select').value)
  })

  it('an item relabelled: the trigger follows the new label', async () => {
    function A({ state }) { return h('div', null, h(Select, { className: 's', label: 'Size', items: state.items, value: 'm' })) }
    A.initialState = { items: SIZES }
    A.model = { RELABEL: (s) => ({ ...s, items: SIZES.map((i) => (i.value === 'm' ? { ...i, label: 'Med' } : i)) }) }
    await real(A)
    t.simulateAction('RELABEL')
    await settle()
    expect(text('.s')).toBe('Med')
  })

  it('numeric item values: value-change gives a string (types allow number items)', async () => {
    function A({ state }) { return h('div', null, h(Select, { className: 's', label: 'N', items: [{ value: 1, label: 'One' }, { value: 2, label: 'Two' }], value: state.n })) }
    A.initialState = { n: 1 }
    A.intent = ({ DOM }) => ({ N: DOM.select('.s').events('value-change').detail() })
    A.model = { N: (s, n) => ({ ...s, n }) }
    await real(A)
    expect(text('.s')).toBe('One')
    await pick('.s', '2')
    rec('[probe] numeric items: value-change detail', JSON.stringify(t.state.n), typeof t.state.n)
  })

  it('controlled open: open={state.open} follows open-change, and a reducer can refuse to open', async () => {
    function A({ state }) { return h('div', null, h(Select, { className: 's', label: 'Size', items: SIZES, open: state.open })) }
    A.initialState = { open: false, locked: true }
    A.intent = ({ DOM }) => ({ OPEN: DOM.select('.s').events('open-change').detail() })
    A.model = { OPEN: (s, open) => (s.locked ? ABORT : { ...s, open }), UNLOCK: (s) => ({ ...s, locked: false }) }
    await real(A)
    t.query('.s [data-part=trigger]').click()
    await settle()
    expect(t.query('.s [data-part=content]').hidden).toBe(true)
    t.simulateAction('UNLOCK')
    await settle()
    t.query('.s [data-part=trigger]').click()
    await settle()
    expect(t.state.open).toBe(true)
    expect(t.query('.s [data-part=content]').hidden).toBe(false)
  })

  it('uncontrolled (defaultValue): the pick shows and value-change fires', async () => {
    function A({ state }) { return h('div', null, h(Select, { className: 's', label: 'Size', items: SIZES, defaultValue: 's' }), h('p', null, state.v)) }
    A.initialState = { v: '' }
    A.intent = ({ DOM }) => ({ V: DOM.select('.s').events('value-change').detail() })
    A.model = { V: (s, v) => ({ ...s, v }) }
    await real(A)
    expect(text('.s')).toBe('Small')
    await pick('.s', 'l')
    expect(t.state.v).toBe('l')
    expect(text('.s')).toBe('Large')
  })

  it('empty items: the trigger opens an empty list without errors', async () => {
    function A() { return h('div', null, h(Select, { className: 's', label: 'Size', items: [], placeholder: 'None' })) }
    await real(A)
    const tr = t.query('.s [data-part=trigger]')
    tr.focus()
    key(tr, 'ArrowDown')
    await settle()
    key(t.query('.s [data-part=content]'), 'Enter')
    await settle()
    expect(text('.s')).toBe('None')
  })

  it('disabled: the trigger is disabled, a click does not open it', async () => {
    function A() { return h('div', null, h(Select, { className: 's', label: 'Size', items: SIZES, disabled: true })) }
    await real(A)
    const tr = t.query('.s [data-part=trigger]')
    expect(tr.disabled).toBe(true)
    tr.click()
    await settle()
    expect(t.query('.s [data-part=content]').hidden).toBe(true)
    expect(t.query('.s select').disabled).toBe(true)
  })

  it('typeahead on the closed trigger selects', async () => {
    function A({ state }) { return h('div', null, h(Select, { className: 's', label: 'Size', items: SIZES, value: state.v })) }
    A.initialState = { v: null }
    A.intent = ({ DOM }) => ({ V: DOM.select('.s').events('value-change').detail() })
    A.model = { V: (s, v) => ({ ...s, v }) }
    await real(A)
    const tr = t.query('.s [data-part=trigger]')
    tr.focus()
    key(tr, 'l')
    await settle()
    expect(t.state.v).toBe('l')
  })

  it('Escape closes and the focus stays on the trigger', async () => {
    function A() { return h('div', null, h(Select, { className: 's', label: 'Size', items: SIZES })) }
    await real(A)
    const tr = t.query('.s [data-part=trigger]')
    tr.focus()
    key(tr, 'ArrowDown')
    await settle()
    key(t.query('.s [data-part=content]'), 'Escape')
    await settle()
    expect(t.query('.s [data-part=content]').hidden).toBe(true)
    expect(document.activeElement).toBe(tr)
  })
})

describe('Select: several instances, Collection, isolation', () => {
  it('two Selects on a page: separate ids, separate values', async () => {
    function A({ state }) {
      return h('div', null,
        h(Select, { className: 'a', label: 'A', items: SIZES, value: state.a }),
        h(Select, { className: 'b', label: 'B', items: SIZES, value: state.b }))
    }
    A.initialState = { a: null, b: null }
    A.intent = ({ DOM }) => ({ A: DOM.select('.a').events('value-change').detail(), B: DOM.select('.b').events('value-change').detail() })
    A.model = { A: (s, a) => ({ ...s, a }), B: (s, b) => ({ ...s, b }) }
    await real(A)
    expect(t.query('.a [data-part=trigger]').id).not.toBe(t.query('.b [data-part=trigger]').id)
    await pick('.b', 'm')
    expect(t.state).toEqual({ a: null, b: 'm' })
  })

  it('in Collection items: each row its own value', async () => {
    function Row({ state }) { return h('li', null, h(Select, { className: 'sz', label: state.name, items: SIZES, value: state.size })) }
    Row.intent = ({ DOM }) => ({ SIZE: DOM.select('.sz').events('value-change').detail() })
    Row.model = { SIZE: (s, size) => ({ ...s, size }) }
    function List() { return h('ul', null, h(Collection, { of: Row, from: 'rows' })) }
    List.initialState = { rows: [{ id: 1, name: 'one', size: null }, { id: 2, name: 'two', size: 'l' }] }
    await real(List)
    const rows = t.queryAll('li')
    expect(rows[1].querySelector('[data-part=value-text]').textContent).toBe('Large')
    rows[0].querySelector('[data-part=trigger]').click()
    await settle()
    rows[0].querySelector('[role=option][data-value=m]').click()
    await settle()
    expect(t.state.rows.map((r) => r.size)).toEqual(['m', 'l'])
  })
})

describe('Select: forms', () => {
  it('FormData has the value; processForm reads it on submit', async () => {
    function A({ state }) {
      return h('form', { className: 'f' }, h(Select, { className: 's', label: 'Size', name: 'size', items: SIZES, value: state.size }), h('button', { type: 'submit' }, 'go'))
    }
    A.initialState = { size: 'm', sent: null }
    A.intent = ({ DOM }) => ({ SUBMIT: processForm(DOM.select('.f'), { events: 'submit' }), SIZE: DOM.select('.s').events('value-change').detail() })
    A.model = { SUBMIT: (s, v) => ({ ...s, sent: v.size }), SIZE: (s, size) => ({ ...s, size }) }
    await real(A)
    expect(new FormData(t.query('.f')).get('size')).toBe('m')
    await pick('.s', 'l')
    expect(new FormData(t.query('.f')).get('size')).toBe('l')
    t.query('.f').requestSubmit()
    await settle()
    expect(t.state.sent).toBe('l')
  })

  it('processForm on input/change hears the pick', async () => {
    function A() { return h('form', { className: 'f' }, h(Select, { className: 's', label: 'Size', name: 'size', items: SIZES })) }
    A.initialState = { live: null }
    A.intent = ({ DOM }) => ({ LIVE: processForm(DOM.select('.f'), { events: ['input', 'change'] }) })
    A.model = { LIVE: (s, v) => ({ ...s, live: v.size }) }
    await real(A)
    await pick('.s', 'l')
    await settle()
    expect(t.state.live).toBe('l')
  })

  it('the form behavior: a pick reaches form.values', async () => {
    function A({ state }) {
      return h('form', null, h(Select, { className: 's', label: 'Size', name: 'size', items: SIZES, value: state.form.values.size }))
    }
    A.uses = { form: form(ANY, { values: { size: '' } }) }
    await real(A)
    await pick('.s', 'm')
    await settle()
    expect(t.state.form.values.size).toBe('m')
  })

  it('native form reset: an uncontrolled select goes back to its defaultValue', async () => {
    function A() { return h('form', { className: 'f' }, h(Select, { className: 's', label: 'Size', name: 'size', items: SIZES, defaultValue: 's' })) }
    await real(A)
    await pick('.s', 'l')
    expect(text('.s')).toBe('Large')
    t.query('.f').reset()
    await settle()
    expect(text('.s')).toBe('Small')
    expect(new FormData(t.query('.f')).get('size')).toBe('s')
  })

  it('native form reset: a controlled select reports value-change back to the initial value', async () => {
    function A({ state }) { return h('form', { className: 'f' }, h(Select, { className: 's', label: 'Size', name: 'size', items: SIZES, value: state.size })) }
    A.initialState = { size: 's' }
    A.intent = ({ DOM }) => ({ SIZE: DOM.select('.s').events('value-change').detail() })
    A.model = { SIZE: (s, size) => ({ ...s, size }) }
    await real(A)
    await pick('.s', 'l')
    expect(t.state.size).toBe('l')
    t.query('.f').reset()
    await settle()
    rec('[probe] controlled reset: state', t.state.size, 'shown', text('.s'), 'formdata', new FormData(t.query('.f')).get('size'))
  })
})

describe('Select: the native-habit event name', () => {
  it("events('change') (a native select's habit) instead of 'value-change': what the intent gets", async () => {
    const got = []
    function A() { return h('div', null, h(Select, { className: 's', label: 'Size', items: SIZES, name: 'size' })) }
    A.initialState = {}
    A.intent = ({ DOM }) => ({ C: DOM.select('.s').events('change').detail(), I: DOM.select('.s').events('input').detail() })
    A.model = { C: (s, d) => { got.push(['change', d]); return s }, I: (s, d) => { got.push(['input', d]); return s } }
    await real(A)
    await pick('.s', 'm')
    await settle()
    rec("[probe] events('change'/'input') on a Select:", got)
  })
})
