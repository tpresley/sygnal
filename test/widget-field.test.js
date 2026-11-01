// @vitest-environment jsdom
// UI sweep round 2 (dev-plans/research/ui-sweep/zag.md): the widget field contract (src/extra/field.ts).
// A widget declaring `field` is a form field named by its `name` prop: the form behavior reads its
// value from the field event (real and mock DOM) and its touched state from the focus leaving the
// host; processForm entries get its value; its own native / nameless input events don't count.
import { describe, it, expect, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { defineWidget, processForm } from '../src/index.ts'
import { form } from '../src/extra/form.ts'
import { Select } from '../src/ui-select.ts'

const ANY = { '~standard': { version: 1, vendor: 'test', validate: (value) => ({ value }) } }
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms))
let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })

// a date-picker-like widget: a button that picks a fixed date, and an inner nameless input
const Picker = defineWidget({
  name: 'Picker',
  events: ['pick'],
  field: { event: 'pick', read: (x) => x.value },
  mount: (el, p, dispatch) => {
    const x = { value: p.value ?? null }
    const b = el.appendChild(document.createElement('button'))
    b.className = 'go'
    b.type = 'button'
    b.onclick = () => { x.value = '2026-11-01'; dispatch('pick', x.value) }
    const i = el.appendChild(document.createElement('input'))
    i.className = 'raw'
    return x
  },
  update: (x, p) => { x.value = p.value ?? null },
})

function Due({ state }) {
  return h('form', { className: 'f' },
    h(Picker, { className: 'due', name: 'due', value: state.form.values.due }),
    h('input', { className: 'note', name: 'note' }))
}
Due.uses = { form: form(ANY, { values: { due: null, note: '' } }) }

describe('the widget field contract', () => {
  it('real DOM: the field event is a change of the named field; the inner nameless input is not', async () => {
    t = renderComponent(Due, { dom: 'real' })
    await t.ready()
    const raw = t.query('.raw')
    raw.value = 'typed'
    raw.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    expect(t.state.form.values).toEqual({ due: null, note: '' })
    t.query('.go').click()
    await settle()
    expect(t.state.form.values.due).toBe('2026-11-01')
  })

  it('real DOM: touched when the focus leaves the host, not when it moves inside it', async () => {
    t = renderComponent(Due, { dom: 'real' })
    await t.ready()
    t.query('.go').focus()
    t.query('.raw').focus()
    await settle()
    expect(t.state.form.touched).toEqual({})
    t.query('.note').focus()
    await settle()
    expect(t.state.form.touched).toEqual({ due: true })
  })

  it('mock DOM: t.widget(...).dispatch of the field event reaches the form; focusout on the host touches it', async () => {
    t = renderComponent(Due)
    await t.ready()
    t.widget('.due').dispatch('pick', '2026-12-24')
    await t.next((s) => s.form.values.due === '2026-12-24')
    t.simulateEvent('.due', 'focusout')
    await t.next((s) => s.form.touched.due === true)
  })

  it('mock DOM: a Select in the form behavior', async () => {
    function A({ state }) { return h('form', null, h(Select, { className: 's', label: 'Size', name: 'size', items: ['s', 'm'], value: state.form.values.size })) }
    A.uses = { form: form(ANY, { values: { size: '' } }) }
    t = renderComponent(A)
    await t.ready()
    t.widget('.s').dispatch('value-change', 'm')
    await t.next((s) => s.form.values.size === 'm')
  })

  it('processForm: the field value is in the entries (while the pick is dispatched too); disabled has none', async () => {
    const seen = []
    function A({ state }) {
      return h('form', { className: 'f' },
        h(Picker, { className: 'due', name: 'due', value: null }),
        h(Picker, { className: 'off', name: 'off', value: 'x', disabled: true }))
    }
    A.initialState = {}
    A.intent = ({ DOM }) => ({ F: processForm(DOM.select('.f')) })
    A.model = { F: (s, v) => { seen.push({ due: v.due, off: v.off }); return s } }
    t = renderComponent(A, { dom: 'real' })
    await t.ready()
    t.query('.due .go').click()
    await settle()
    expect(seen).toEqual([{ due: '2026-11-01', off: undefined }])
  })

  it('an intent still hears the widget event itself; a widget without field is unchanged', async () => {
    const Plain = defineWidget({ events: ['pick'], mount: (el, p, d) => { el.onclick = () => d('pick', 1) } })
    const got = []
    function A() { return h('form', null, h(Plain, { className: 'p', name: 'p' }), h(Picker, { className: 'due', name: 'due' })) }
    A.initialState = {}
    A.uses = { form: form(ANY, { values: { p: 0, due: null } }) }
    A.intent = ({ DOM }) => ({ PICK: DOM.select('.due').events('pick').detail() })
    A.model = { PICK: (s, d) => { got.push(d); return s } }
    t = renderComponent(A, { dom: 'real' })
    await t.ready()
    t.query('.p').click()
    t.query('.due .go').click()
    await settle()
    expect(got).toEqual(['2026-11-01'])
    expect(t.state.form.values).toEqual({ p: 0, due: '2026-11-01' })
  })
})
