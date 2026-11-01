// @vitest-environment jsdom
// UI sweep round 2 (dev-plans/research/ui-sweep/zag.md): Menu, Select and Combobox.
// - Q2: allowCustomValue commits the typed text on blur / Enter (React Aria's allowsCustomValue)
// - Q3: positioning strategy 'fixed' by default (Radix's Popper), a `positioning` prop overrides it
// - F-2: chips for a multiple Combobox (remove buttons, Backspace, the remove command)
// - F-4: Combobox `empty` (a row and a status region)
// - F-3: groups (Select, Combobox); Menu checkbox / radio / link items and submenus
import { describe, it, expect, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { ABORT } from '../src/index.ts'
import { form } from '../src/extra/form.ts'
import { Menu } from '../src/ui-menu.ts'
import { Select } from '../src/ui-select.ts'
import { Combobox } from '../src/ui-combobox.ts'

export const ANY = { '~standard': { version: 1, vendor: 'test', validate: (value) => ({ value }) } }
export const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms))
let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })
const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
const type = (input, text) => { input.value = text; input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text })) }
const real = async (C) => { t = renderComponent(C, { dom: 'real' }); await t.ready(); await settle(); return t }
const ITEMS = [{ value: 'nyc', label: 'New York' }, { value: 'par', label: 'Paris' }, { value: 'lis', label: 'Lisbon' }]
const input = (sel) => t.query(sel + ' input[role=combobox]')

describe('Q2: allowCustomValue commits the typed text', () => {
  function app(extra = {}) {
    function A({ state }) {
      return h('form', { className: 'f' },
        h(Combobox, { className: 'c', label: 'City', name: 'city', items: ITEMS, allowCustomValue: true, value: state.v, ...extra }),
        h('input', { className: 'other' }))
    }
    A.initialState = { v: null, events: [] }
    A.intent = ({ DOM }) => ({ V: DOM.select('.c').events('value-change').detail() })
    A.model = { V: (s, v) => (s.refuse ? ABORT : { ...s, v, events: [...s.events, v] }), REFUSE: (s) => ({ ...s, refuse: true }) }
    return A
  }

  it('on blur: value-change with the text, the controlled value keeps it, the input still shows it, the form submits it', async () => {
    await real(app())
    input('.c').focus()
    type(input('.c'), 'Rome')
    await settle()
    expect(t.state.events).toEqual([])
    t.query('.other').focus()
    await settle()
    expect(t.state.v).toBe('Rome')
    expect(t.state.events).toEqual(['Rome'])
    expect(input('.c').value).toBe('Rome')
    expect(new FormData(t.query('.f')).get('city')).toBe('Rome')
    expect(t.query('.c [data-part=content]').hidden).toBe(true)
  })

  it("Enter with no active option commits; text equal to an item's label picks the item; '' clears", async () => {
    await real(app())
    input('.c').focus()
    type(input('.c'), 'Oslo')
    await settle()
    key(input('.c'), 'Enter')
    await settle()
    expect(t.state.v).toBe('Oslo')
    type(input('.c'), 'Paris')
    await settle()
    t.query('.other').focus()
    await settle()
    expect(t.state.v).toBe('par')
    expect(input('.c').value).toBe('Paris')
    input('.c').focus()
    type(input('.c'), '')
    await settle()
    t.query('.other').focus()
    await settle()
    expect(t.state.v).toBe(null)
    expect(t.state.events).toEqual(['Oslo', 'par', null])
  })

  it('a refused commit: the input goes back to the state value', async () => {
    const A = app()
    A.initialState = { v: 'nyc', events: [], refuse: true }
    await real(A)
    input('.c').focus()
    type(input('.c'), 'Rome')
    await settle()
    t.query('.other').focus()
    await settle()
    expect(t.state.v).toBe('nyc')
    expect(input('.c').value).toBe('New York')
  })

  it('uncontrolled: the committed text stays, and the form behavior gets it', async () => {
    function A({ state }) {
      return h('form', null,
        h(Combobox, { className: 'c', label: 'City', name: 'city', items: ITEMS, allowCustomValue: true, defaultValue: 'Atlantis' }),
        h('input', { className: 'other', name: 'other' }))
    }
    A.uses = { form: form(ANY, { values: { city: '', other: '' } }) }
    await real(A)
    expect(input('.c').value).toBe('Atlantis')
    input('.c').focus()
    type(input('.c'), 'Rome')
    await settle()
    t.query('.other').focus()
    await settle()
    expect(t.state.form.values.city).toBe('Rome')
    expect(t.state.form.touched.city).toBe(true)
    expect(input('.c').value).toBe('Rome')
  })

  it('without allowCustomValue nothing is committed', async () => {
    await real(app({ allowCustomValue: false }))
    input('.c').focus()
    type(input('.c'), 'Rome')
    await settle()
    t.query('.other').focus()
    await settle()
    expect(t.state.events).toEqual([])
  })
})

describe("Q3: positioning strategy 'fixed' by default", () => {
  it('all three parts; a positioning prop overrides it and keeps the rest', async () => {
    function A() {
      return h('div', null,
        h(Menu, { className: 'm', label: 'A', items: ['x'] }),
        h(Select, { className: 's', label: 'S', items: ['x'], positioning: { placement: 'top' } }),
        h(Combobox, { className: 'c', label: 'C', items: ['x'], positioning: { strategy: 'absolute' } }))
    }
    await real(A)
    const pos = (sel) => t.widget(sel).instance.machine.service.prop('positioning')
    expect(pos('.m').strategy).toBe('fixed')
    expect(pos('.s')).toMatchObject({ strategy: 'fixed', placement: 'top' })
    expect(pos('.c').strategy).toBe('absolute')
  })
})

describe('F-2: chips for a multiple Combobox', () => {
  function Tags({ state }) {
    return h('form', { className: 'f' },
      h(Combobox, { className: 'c', label: 'Cities', name: 'cities', multiple: true, items: ITEMS, value: state.v, ...state.extra }),
      h('button', { type: 'button', className: 'rm' }, 'rm'))
  }
  Tags.initialState = { v: ['nyc', 'par'], extra: {} }
  Tags.intent = ({ DOM }) => ({ V: DOM.select('.c').events('value-change').detail(), RM: DOM.click('.rm') })
  Tags.model = { V: (s, v) => ({ ...s, v }), RM: { ELEMENT: { remove: '.c', value: 'nyc' } } }
  const chips = () => t.queryAll('.c [data-part=item-chip]').map((c) => c.dataset.value)

  it('a chip per value, in a labelled grid (round 3); a remove button per chip, named, out of the tab order', async () => {
    await real(Tags)
    const list = t.query('.c [data-part=item-chips]')
    expect(list.getAttribute('role')).toBe('grid')
    expect(list.getAttribute('aria-label')).toBe('Cities')
    expect(chips()).toEqual(['nyc', 'par'])
    expect(t.query('.c [data-part=item-chip]').getAttribute('role')).toBe('row')
    const b = t.query('.c [data-value=par] [data-part=item-chip-remove]')
    expect(b.getAttribute('aria-label')).toBe('Remove Paris')
    expect(b.getAttribute('tabindex')).toBe('-1')
    b.click()
    await settle()
    expect(t.state.v).toEqual(['nyc'])
    expect(chips()).toEqual(['nyc'])
  })

  it('Backspace in the empty input removes the last; not while there is text', async () => {
    await real(Tags)
    input('.c').focus()
    type(input('.c'), 'x')
    key(input('.c'), 'Backspace')
    await settle()
    expect(t.state.v).toEqual(['nyc', 'par'])
    type(input('.c'), '')
    key(input('.c'), 'Backspace')
    await settle()
    expect(t.state.v).toEqual(['nyc'])
  })

  it('the remove command; the chips follow the controlled value', async () => {
    await real(Tags)
    t.query('.rm').click()
    await settle()
    expect(t.state.v).toEqual(['par'])
    t.simulateAction('V', ['par', 'lis'])
    await settle()
    expect(chips()).toEqual(['par', 'lis'])
  })

  it('options: chips={false}, removeLabel, disabled', async () => {
    const A = ({ state }) => h('div', null,
      h(Combobox, { className: 'a', label: 'A', multiple: true, items: ITEMS, defaultValue: ['par'], chips: false }),
      h(Combobox, { className: 'b', label: 'B', multiple: true, items: ITEMS, defaultValue: ['par'], removeLabel: (l) => `${l} entfernen` }),
      h(Combobox, { className: 'd', label: 'D', multiple: true, items: ITEMS, defaultValue: ['par'], disabled: true }))
    await real(A)
    expect(t.query('.a [data-part=item-chip]')).toBe(null)
    expect(t.query('.b [data-part=item-chip-remove]').getAttribute('aria-label')).toBe('Paris entfernen')
    expect(t.query('.d [data-part=item-chip-remove]').disabled).toBe(true)
  })
})

describe('F-4: Combobox empty', () => {
  it('a data-part="empty" row and the status text while open with no items', async () => {
    function A() { return h('div', null, h(Combobox, { className: 'c', label: 'City', items: ITEMS, empty: 'No results' })) }
    await real(A)
    const row = t.query('.c [data-part=empty]'), status = t.query('.c [role=status]')
    expect(row.hidden).toBe(true)
    expect(status.textContent).toBe('')
    input('.c').focus()
    type(input('.c'), 'zzz')
    await settle()
    expect(row.hidden).toBe(false)
    expect(row.textContent).toBe('No results')
    expect(status.textContent).toBe('No results')
    type(input('.c'), 'Par')
    await settle()
    expect(row.hidden).toBe(true)
    expect(status.textContent).toBe('')
  })
})

describe('F-3: groups', () => {
  const GROUPED = [{ group: 'Fruit', items: ['Apple', 'Banana'] }, { group: 'Vegetables', items: [{ value: 'kale', label: 'Kale' }] }]
  it('Select: labelled role=group per group; arrows move across groups; the hidden select has every item', async () => {
    function A({ state }) { return h('div', null, h(Select, { className: 's', label: 'Food', name: 'food', items: GROUPED, value: state.v })) }
    A.initialState = { v: null }
    A.intent = ({ DOM }) => ({ V: DOM.select('.s').events('value-change').detail() })
    A.model = { V: (s, v) => ({ ...s, v }) }
    await real(A)
    const groups = t.queryAll('.s [role=group]')
    expect(groups).toHaveLength(2)
    const label = t.query('#' + CSS.escape(groups[1].getAttribute('aria-labelledby')))
    expect(label.textContent).toBe('Vegetables')
    expect([...groups[0].querySelectorAll('[role=option]')].map((o) => o.dataset.value)).toEqual(['Apple', 'Banana'])
    expect([...t.query('.s select').options].map((o) => o.value)).toEqual(['', 'Apple', 'Banana', 'kale'])
    const tr = t.query('.s [data-part=trigger]')
    tr.focus()
    key(tr, 'ArrowDown')
    await settle()
    const content = t.query('.s [data-part=content]')
    key(content, 'ArrowDown'); key(content, 'ArrowDown')
    await settle()
    expect(t.query('.s [data-highlighted]').dataset.value).toBe('kale')
    key(content, 'Enter')
    await settle()
    expect(t.state.v).toBe('kale')
  })

  it('Combobox: filtering keeps the groups that match', async () => {
    function A() { return h('div', null, h(Combobox, { className: 'c', label: 'Food', items: GROUPED })) }
    await real(A)
    input('.c').focus()
    type(input('.c'), 'a')
    await settle()
    expect(t.queryAll('.c [role=group]').map((g) => g.querySelector('[data-part=item-group-label]').textContent)).toEqual(['Fruit', 'Vegetables'])
    type(input('.c'), 'an')
    await settle()
    expect(t.queryAll('.c [role=group]')).toHaveLength(1)
    expect(t.queryAll('.c [role=option]').map((o) => o.dataset.value)).toEqual(['Banana'])
  })
})

describe('F-3: Menu item kinds', () => {
  function View({ state }) {
    return h('div', null, h(Menu, { className: 'm', label: 'View', items: [
      { type: 'checkbox', value: 'grid', label: 'Show grid', checked: state.grid },
      { separator: true },
      { type: 'radio', value: 'small', label: 'Small', checked: state.size === 'small' },
      { type: 'radio', value: 'large', label: 'Large', checked: state.size === 'large' },
      { href: '/help', value: 'help', label: 'Help' },
      { value: 'share', label: 'Share', items: [{ value: 'mail', label: 'Mail' }, { value: 'link', label: 'Copy link' }] },
    ] }), h('p', null, state.last))
  }
  View.initialState = { grid: false, size: 'small', last: '', checks: [] }
  View.intent = ({ DOM }) => ({ CHECK: DOM.select('.m').events('checked-change').detail(), PICK: DOM.select('.m').events('select').detail() })
  View.model = {
    CHECK: (s, d) => ({ ...s, checks: [...s.checks, d], ...(d.type === 'checkbox' ? { [d.value]: d.checked } : { size: d.value }) }),
    PICK: (s, last) => ({ ...s, last }),
  }
  const open = async () => { t.query('.m [data-part=trigger]').click(); await settle() }

  it('checkbox / radio items: roles, aria-checked, the indicator; a click reports checked-change and the state drives them', async () => {
    await real(View)
    await open()
    const grid = t.query('.m [data-value=grid]')
    expect(grid.getAttribute('role')).toBe('menuitemcheckbox')
    expect(grid.getAttribute('aria-checked')).toBe('false')
    expect(t.query('.m [data-value=small]').getAttribute('role')).toBe('menuitemradio')
    expect(t.query('.m [data-value=small]').getAttribute('aria-checked')).toBe('true')
    grid.click()
    await settle()
    expect(t.state.checks).toEqual([{ value: 'grid', checked: true, type: 'checkbox' }])
    expect(t.state.grid).toBe(true)
    await open()
    expect(t.query('.m [data-value=grid]').getAttribute('aria-checked')).toBe('true')
    expect(t.query('.m [data-value=grid] [data-part=item-indicator]').hidden).toBe(false)
    t.query('.m [data-value=large]').click()
    await settle()
    expect(t.state.size).toBe('large')
    await open()
    expect(t.query('.m [data-value=small]').getAttribute('aria-checked')).toBe('false')
  })

  it('a link item is an <a href> menuitem', async () => {
    await real(View)
    const a = t.query('.m [data-value=help]')
    expect(a.tagName).toBe('A')
    expect(a.getAttribute('href')).toBe('/help')
    expect(a.getAttribute('role')).toBe('menuitem')
  })

  it('a submenu: a trigger item; ArrowRight opens it, ArrowLeft closes it; a pick in it is select', async () => {
    await real(View)
    const tr = t.query('.m [data-part=trigger]')
    tr.focus()
    key(tr, 'ArrowDown')
    await settle()
    const share = t.query('.m [data-part=trigger-item]')
    expect(share.textContent).toContain('Share')
    expect(share.getAttribute('aria-haspopup')).toBe('menu')
    const subContent = () => t.queryAll('.m [data-part=content]')[1]
    expect(subContent().hidden).toBe(true)
    const content = t.query('.m [data-part=content]')
    for (let i = 0; i < 5 && t.query('.m [data-highlighted]') !== share; i++) { key(content, 'ArrowDown'); await settle() }
    expect(t.query('.m [data-highlighted]')).toBe(share)
    key(content, 'ArrowRight')
    await settle(60)
    expect(subContent().hidden).toBe(false)
    key(subContent(), 'ArrowLeft')
    await settle(60)
    expect(subContent().hidden).toBe(true)
    key(content, 'ArrowRight')
    await settle(60)
    t.query('.m [data-value=link]').click()
    await settle()
    expect(t.state.last).toBe('link')
  })
})

it("F-3: a checked item's ✓ indicator is aria-hidden (not part of its name)", async () => {
  function A() { return h('div', null, h(Menu, { className: 'm', label: 'V', items: [{ type: 'checkbox', value: 'g', label: 'Grid', checked: true }] })) }
  await real(A)
  expect(t.query('.m [data-value=g] [data-part=item-indicator]').getAttribute('aria-hidden')).toBe('true')
})
