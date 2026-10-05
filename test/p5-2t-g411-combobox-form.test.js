// @vitest-environment jsdom
// PLAN-5 2-T, G-411: a Combobox in a form submits its value, not the label the visible input
// shows: the input has no `name`; hidden inputs carry api.value (one per value with `multiple`).
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

it('single and multiple: FormData has the values; the visible input has no name', async () => {
  function A() {
    return h('form', { className: 'f' },
      h(Combobox, { className: 'c', label: 'City', name: 'city', items: ITEMS, defaultValue: 'nyc' }),
      h(Combobox, { className: 'm', label: 'Cities', name: 'cities', multiple: true, items: ITEMS, defaultValue: ['nyc', 'par'] }),
      h(Combobox, { className: 'e', label: 'Empty', name: 'none', items: ITEMS }))
  }
  t = renderComponent(A, { dom: 'real' })
  await t.ready()
  await settle(60)
  expect(t.query('.c [data-part=input]').hasAttribute('name')).toBe(false)
  expect(t.query('.c [data-part=input]').value).toBe('New York')
  expect([...new FormData(t.query('.f'))]).toEqual([['city', 'nyc'], ['cities', 'nyc'], ['cities', 'par'], ['none', '']])
})

it('a pick updates the submitted value; no name: no hidden input', async () => {
  function A({ state }) {
    return h('form', { className: 'f' },
      h(Combobox, { className: 'c', label: 'City', name: 'city', items: ITEMS, value: state.city }),
      h(Combobox, { className: 'x', label: 'Unnamed', items: ITEMS }))
  }
  A.initialState = { city: null }
  A.intent = ({ DOM }) => ({ CITY: DOM.select('.c').events('value-change').detail() })
  A.model = { CITY: (s, city) => ({ ...s, city }) }
  t = renderComponent(A, { dom: 'real' })
  await t.ready()
  await settle(60)
  expect([...new FormData(t.query('.f'))]).toEqual([['city', '']])
  const input = t.query('.c input')
  input.focus()
  type(input, 'Lis')
  await settle()
  key(input, 'ArrowDown')
  await settle()
  key(input, 'Enter')
  await t.next((s) => s.city === 'lis')
  await settle()
  expect([...new FormData(t.query('.f'))]).toEqual([['city', 'lis']])
  expect(t.queryAll('.x input[type=hidden]')).toHaveLength(0)
})
