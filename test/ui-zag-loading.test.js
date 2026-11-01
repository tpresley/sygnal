// @vitest-environment jsdom
// 7.2.0-preview.0: a controlled Combobox with allowCustomValue whose value arrives before its items
// (async loading) showed the raw value ("par", then "Paris"). With `loading` it shows nothing until
// the value's item arrives, as React Aria's ComboBox (the selected item's text, '' while it isn't in
// the collection); the listbox is aria-busy and `empty` waits
import { it, expect, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { Combobox } from '../src/ui-combobox.ts'

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms))
let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })
const ITEMS = [{ value: 'nyc', label: 'New York' }, { value: 'par', label: 'Paris' }]

function City({ state }) {
  return h('div', null, h(Combobox, { className: 'c', label: 'City', allowCustomValue: true, items: state.items, value: state.v, loading: state.loading, empty: 'No cities' }))
}
City.model = { LOADED: (s) => ({ ...s, items: ITEMS, loading: false }) }
const app = async (state) => {
  City.initialState = state
  t = renderComponent(City, { dom: 'real' })
  await t.ready()
  await settle()
}
const input = () => t.query('.c input[role=combobox]')
const listbox = () => t.query('.c [role=listbox]')

it('loading: the value shows nothing until its item arrives, then its label; the listbox is aria-busy', async () => {
  await app({ items: [], v: 'par', loading: true })
  expect(input().value).toBe('')
  expect(listbox().getAttribute('aria-busy')).toBe('true')
  await t.simulateAction('LOADED')
  await settle()
  expect(input().value).toBe('Paris')
  expect(listbox().hasAttribute('aria-busy')).toBe(false)
})

it('loading: a value the loaded items don\'t have is custom text again', async () => {
  await app({ items: [], v: 'Atlantis', loading: true })
  expect(input().value).toBe('')
  await t.simulateAction('LOADED')
  await settle()
  expect(input().value).toBe('Atlantis')
})

it('without loading a value no item has is custom text (unchanged)', async () => {
  await app({ items: [], v: 'Atlantis', loading: false })
  expect(input().value).toBe('Atlantis')
})

it('loading: the empty row waits', async () => {
  await app({ items: [], v: null, loading: true })
  t.query('.c [data-part=trigger]').click()
  await settle()
  expect(t.query('.c [data-part=empty]').hidden).toBe(true)
})

it('not loading: the empty row shows (the check above can fail)', async () => {
  await app({ items: [], v: null, loading: false })
  t.query('.c [data-part=trigger]').click()
  await settle()
  expect(t.query('.c [data-part=empty]').hidden).toBe(false)
})
