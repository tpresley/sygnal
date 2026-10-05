// @vitest-environment jsdom
// PLAN-5 3-G: Combobox in forms.
// - G-434: `form` reaches the hidden inputs as an attribute (HTMLInputElement.form is read-only:
//   as a DOM property the render threw, SYG660), so a combobox outside its <form> submits with it.
// - G-435: with `allowCustomValue`, the typed text is submitted (the hidden input carried only the
//   selected value, so a custom entry was lost); an item's label submits that item's value.
import { it, expect, afterEach } from 'vitest'
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

it('G-434: name + form: renders, the hidden inputs carry the form attribute, FormData of that form has them', async () => {
  const errors = []
  function A() {
    return h('div', null,
      h('form', { id: 'trip', className: 'f' }),
      h(Combobox, { className: 'c', label: 'City', name: 'city', form: 'trip', items: ITEMS, defaultValue: 'par' }),
      h(Combobox, { className: 'm', label: 'Cities', name: 'cities', form: 'trip', multiple: true, items: ITEMS, defaultValue: ['nyc', 'lis'] }))
  }
  A.onError = (e) => { errors.push(e); return h('p', null, 'failed') }
  t = renderComponent(A, { dom: 'real' })
  await t.ready()
  await settle(60)
  expect(errors).toEqual([])
  const hidden = t.queryAll('input[type=hidden]')
  expect(hidden.map((i) => i.getAttribute('form'))).toEqual(['trip', 'trip', 'trip'])
  expect(hidden[0].form).toBe(t.query('.f'))
  expect([...new FormData(t.query('.f'))]).toEqual([['city', 'par'], ['cities', 'nyc'], ['cities', 'lis']])
  // the visible input has neither name nor form
  expect(t.query('.c [data-part=input]').hasAttribute('form')).toBe(false)
})

it('G-435: allowCustomValue submits the typed text; a selection submits its value; an item label typed submits that value', async () => {
  function A() {
    return h('form', { className: 'f' },
      h(Combobox, { className: 'c', label: 'City', name: 'city', items: ITEMS, allowCustomValue: true }),
      h(Combobox, { className: 's', label: 'Strict', name: 'strict', items: ITEMS }))
  }
  t = renderComponent(A, { dom: 'real' })
  await t.ready()
  await settle(60)
  const form = t.query('.f'), input = t.query('.c input')
  expect([...new FormData(form)]).toEqual([['city', ''], ['strict', '']])
  input.focus()
  type(input, 'Rome')
  await settle()
  expect(new FormData(form).get('city')).toBe('Rome')
  key(input, 'Escape')
  input.blur()
  await settle()
  expect(input.value).toBe('Rome')
  expect(new FormData(form).get('city')).toBe('Rome')
  // pick an item: its value (not its label)
  input.focus()
  type(input, 'Lis')
  await settle()
  key(input, 'ArrowDown')
  await settle()
  key(input, 'Enter')
  await settle()
  expect(input.value).toBe('Lisbon')
  expect(new FormData(form).get('city')).toBe('lis')
  // type an item's label without picking it: that item's value
  type(input, 'Paris')
  await settle()
  expect(new FormData(form).get('city')).toBe('par')
  // without allowCustomValue: only a selected value is submitted
  const strict = t.query('.s input')
  strict.focus()
  type(strict, 'Rome')
  await settle()
  expect(new FormData(form).get('strict')).toBe('')
})
