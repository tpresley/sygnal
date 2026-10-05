// @vitest-environment jsdom
// PLAN-5 2-Z (U-1): Menu, Select and Combobox from sygnal/ui/zag (fromZag widgets). Canonical
// forms: a class on the tag, DOM.select(...).events(...).detail() in the intent, ELEMENT commands.
// jsdom (dom: 'real') with dispatched keyboard events; the browser suite
// (browser-tests/src/tests/ui-zag-p5z.jsx) runs them in Chromium, Firefox and WebKit with real input.
import { describe, it, expect, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { renderToString } from '../src/extra/ssr.ts'
import { Menu, Select, Combobox } from '../src/ui-zag.ts'

// jsdom lacks what Zag uses: ResizeObserver (positioning), CSS.escape (selectors) and scrollTo
// (scrolling the highlighted option into view)
globalThis.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} }
globalThis.CSS ||= {}
CSS.escape ||= (s) => String(s).replace(/[^\w-]/g, (c) => '\\' + c)
Element.prototype.scrollTo ||= function () {}

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms))
let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  document.body.innerHTML = ''
})
const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
const type = (input, text) => {
  input.value = text
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }))
}
const real = async (C) => {
  t = renderComponent(C, { dom: 'real' })
  await t.ready()
  await settle()
  return t
}

// ── Menu ─────────────────────────────────────────────────────────────────────────────────────
const ITEMS = [{ value: 'edit', label: 'Edit' }, { value: 'copy', label: 'Copy' }, { separator: true }, { value: 'delete', label: 'Delete', disabled: true }, { value: 'archive', label: 'Archive' }]
function Toolbar({ state }) {
  return h('div', null,
    h(Menu, { className: 'actions', label: 'Actions', items: ITEMS }),
    h('button', { className: 'open-actions' }, 'open'),
    h('p', { className: 'last' }, state.last))
}
Toolbar.initialState = { last: '' }
Toolbar.intent = ({ DOM }) => ({
  PICK: DOM.select('.actions').events('select').detail(),
  OPEN_ACTIONS: DOM.click('.open-actions'),
})
Toolbar.model = {
  PICK: (s, last) => ({ ...s, last }),
  OPEN_ACTIONS: { ELEMENT: { open: '.actions' } },
}

describe('Menu', () => {
  it('renders a menu button with Zag roles and states', async () => {
    await real(Toolbar)
    const trigger = t.query('.actions [data-part=trigger]')
    expect(trigger.tagName).toBe('BUTTON')
    expect(trigger.textContent).toBe('Actions')
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    const content = t.query('.actions [data-part=content]')
    expect(content.getAttribute('role')).toBe('menu')
    expect(content.hidden).toBe(true)
    expect(t.queryAll('.actions [role=menuitem]').map((e) => e.textContent)).toEqual(['Edit', 'Copy', 'Delete', 'Archive'])
    expect(t.query('.actions [role=menuitem][data-value=delete]').getAttribute('aria-disabled')).toBe('true')
    expect(t.query('.actions [role=separator]')).toBeTruthy()
  })

  it('keyboard: ArrowDown opens on the first item, disabled items are skipped, Enter selects and focus returns', async () => {
    await real(Toolbar)
    const trigger = t.query('.actions [data-part=trigger]')
    trigger.focus()
    key(trigger, 'ArrowDown')
    await settle()
    const content = t.query('.actions [data-part=content]')
    expect(content.hidden).toBe(false)
    const hl = () => t.query('.actions [data-highlighted]')?.dataset.value
    expect(hl()).toBe('edit')
    key(content, 'ArrowDown')
    await settle()
    expect(hl()).toBe('copy')
    key(content, 'ArrowDown')
    await settle()
    expect(hl()).toBe('archive')
    key(content, 'Enter')
    await t.next((s) => s.last === 'archive')
    await settle()
    expect(content.hidden).toBe(true)
    expect(document.activeElement).toBe(trigger)
  })

  it('typeahead jumps to an item', async () => {
    await real(Toolbar)
    const trigger = t.query('.actions [data-part=trigger]')
    trigger.focus()
    key(trigger, 'ArrowDown')
    await settle()
    const content = t.query('.actions [data-part=content]')
    key(content, 'a')
    await settle()
    expect(t.query('.actions [data-highlighted]').dataset.value).toBe('archive')
  })

  it('Escape closes it; the open command opens it', async () => {
    await real(Toolbar)
    t.query('.open-actions').click()
    await settle()
    const content = t.query('.actions [data-part=content]')
    expect(content.hidden).toBe(false)
    key(content, 'Escape')
    await settle()
    expect(content.hidden).toBe(true)
  })

  it('mock DOM: the host renders; t.widget dispatches select', async () => {
    t = renderComponent(Toolbar, { strict: true })
    await t.ready()
    expect(t.widget('.actions').props.items).toBe(ITEMS)
    t.widget('.actions').dispatch('select', 'copy')
    await t.next((s) => s.last === 'copy')
    t.simulateEvent('.open-actions', 'click')
    await t.settle()
    expect(t.commands('ELEMENT').map((c) => c.open)).toEqual(['.actions'])
    t.expectNoDiagnostics()
  })
})

// ── Select ───────────────────────────────────────────────────────────────────────────────────
const SIZES = [{ value: 's', label: 'Small' }, { value: 'm', label: 'Medium' }, { value: 'l', label: 'Large', disabled: true }, { value: 'xl', label: 'Extra large' }]
function Order({ state }) {
  return h('form', null,
    h(Select, { className: 'size', label: 'Size', items: SIZES, value: state.size, placeholder: 'Pick a size', name: 'size' }),
    h('button', { type: 'button', className: 'reset' }, 'reset'),
    h('p', { className: 'out' }, String(state.size)))
}
Order.initialState = { size: null }
Order.intent = ({ DOM }) => ({
  SIZE: DOM.select('.size').events('value-change').detail(),
  RESET: DOM.click('.reset'),
})
Order.model = { SIZE: (s, size) => ({ ...s, size }), RESET: (s) => ({ ...s, size: 'm' }) }

describe('Select', () => {
  it('renders a labelled select-only combobox and a listbox', async () => {
    await real(Order)
    const trigger = t.query('.size [data-part=trigger]')
    expect(trigger.getAttribute('role')).toBe('combobox')
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox')
    const label = t.query('.size [data-part=label]')
    expect(label.textContent).toBe('Size')
    expect(trigger.getAttribute('aria-labelledby')).toBe(label.id)
    expect(t.query('.size [data-part=value-text]').textContent).toBe('Pick a size')
    expect(t.query('.size [data-part=content]').getAttribute('role')).toBe('listbox')
    expect(t.queryAll('.size [role=option]').map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'false', 'false', 'false'])
    const hidden = t.query('.size select')
    expect(hidden.name).toBe('size')
    expect(hidden.getAttribute('aria-hidden')).toBe('true')
  })

  it('keyboard: opens, skips the disabled item, selects; the value reaches state and comes back controlled', async () => {
    await real(Order)
    const trigger = t.query('.size [data-part=trigger]')
    trigger.focus()
    key(trigger, 'ArrowDown')
    await settle()
    const content = t.query('.size [data-part=content]')
    expect(content.hidden).toBe(false)
    const hl = () => t.query('.size [data-highlighted]')?.dataset.value
    expect(hl()).toBe('s')
    key(content, 'ArrowDown')
    key(content, 'ArrowDown')
    await settle()
    expect(hl()).toBe('xl')
    key(content, 'Enter')
    await t.next((s) => s.size === 'xl')
    await settle()
    expect(t.query('.size [data-part=value-text]').textContent).toBe('Extra large')
    expect(t.query('.size [role=option][data-value=xl]').getAttribute('aria-selected')).toBe('true')
    expect(t.query('.size select').value).toBe('xl')
    expect(document.activeElement).toBe(trigger)
    // the app sets the value: the select follows (controlled)
    t.query('.reset').click()
    await t.next((s) => s.size === 'm')
    await settle()
    expect(t.query('.size [data-part=value-text]').textContent).toBe('Medium')
  })

  it('a click on an option selects it; multiple sends the array', async () => {
    function Tags({ state }) {
      return h('div', null, h(Select, { className: 'tags', label: 'Tags', multiple: true, items: ['red', 'green', 'blue'], value: state.tags }))
    }
    Tags.initialState = { tags: ['red'] }
    Tags.intent = ({ DOM }) => ({ TAGS: DOM.select('.tags').events('value-change').detail() })
    Tags.model = { TAGS: (s, tags) => ({ ...s, tags }) }
    await real(Tags)
    t.query('.tags [data-part=trigger]').click()
    await settle()
    t.query('.tags [role=option][data-value=blue]').click()
    await t.next((s) => s.tags.length === 2)
    expect(t.state.tags).toEqual(['red', 'blue'])
    await settle()
    expect([...t.query('.tags select').selectedOptions].map((o) => o.value)).toEqual(['red', 'blue'])
  })
})

// ── Combobox ─────────────────────────────────────────────────────────────────────────────────
const CITIES = ['Amsterdam', 'Berlin', 'Lisbon', 'London', 'Paris', 'Prague']
function Trip({ state }) {
  return h('div', null,
    h(Combobox, { className: 'city', label: 'City', items: CITIES, value: state.city, placeholder: 'Type a city' }),
    h('p', { className: 'typed' }, state.typed))
}
Trip.initialState = { city: null, typed: '' }
Trip.intent = ({ DOM }) => ({
  CITY: DOM.select('.city').events('value-change').detail(),
  TYPED: DOM.select('.city').events('input-change').detail(),
})
Trip.model = { CITY: (s, city) => ({ ...s, city }), TYPED: (s, typed) => ({ ...s, typed }) }

describe('Combobox', () => {
  it('renders a labelled editable combobox', async () => {
    await real(Trip)
    const input = t.query('.city input')
    expect(input.getAttribute('role')).toBe('combobox')
    expect(input.getAttribute('aria-autocomplete')).toBe('list')
    expect(input.getAttribute('placeholder')).toBe('Type a city')
    expect(t.query('.city label').getAttribute('for')).toBe(input.id)
    expect(t.query('.city [data-part=content]').getAttribute('role')).toBe('listbox')
  })

  it('typing filters the options; ArrowDown + Enter selects; input-change carries the typed text', async () => {
    await real(Trip)
    const input = t.query('.city input')
    input.focus()
    type(input, 'l')
    await settle()
    expect(t.queryAll('.city [role=option]').map((o) => o.textContent.replace('✓', ''))).toEqual(['Berlin', 'Lisbon', 'London'])
    expect(t.state.typed).toBe('l')
    type(input, 'lo')
    await settle()
    expect(t.queryAll('.city [role=option]').map((o) => o.dataset.value)).toEqual(['London'])
    key(input, 'ArrowDown')
    await settle()
    expect(input.getAttribute('aria-activedescendant')).toBe(t.query('.city [role=option][data-value=London]').id)
    key(input, 'Enter')
    await t.next((s) => s.city === 'London')
    await settle()
    expect(input.value).toBe('London')
    expect(t.state.typed).toBe('lo')
    // closed: the filter is reset, all the options are back for the next open
    expect(t.queryAll('.city [role=option]')).toHaveLength(6)
  })

  it('filter={false} leaves the filtering to the app', async () => {
    function App({ state }) {
      return h('div', null, h(Combobox, { className: 'c', label: 'C', items: CITIES.filter((c) => c.startsWith(state.q)), filter: false }))
    }
    App.initialState = { q: '' }
    App.intent = ({ DOM }) => ({ Q: DOM.select('.c').events('input-change').detail() })
    App.model = { Q: (s, q) => ({ ...s, q }) }
    await real(App)
    const input = t.query('.c input')
    input.focus()
    type(input, 'P')
    await t.next((s) => s.q === 'P')
    await settle()
    expect(t.queryAll('.c [role=option]').map((o) => o.dataset.value)).toEqual(['Paris', 'Prague'])
  })
})

describe('server rendering', () => {
  it('renders each part\'s fallback in its host', async () => {
    const html = renderToString(() => h('div', null,
      h(Menu, { className: 'm', label: 'Actions', items: [] }),
      h(Select, { className: 's', label: 'Size', items: [], placeholder: 'Pick' }),
      h(Combobox, { className: 'c', label: 'City', items: [], placeholder: 'Type' })))
    expect(html).toContain('<div class="m"><button type="button" aria-haspopup="menu" aria-expanded="false">Actions</button></div>')
    expect(html).toContain('<label>Size</label>')
    expect(html).toContain('placeholder="Type"')
  })
})
