// PLAN-5 2-Z: the Zag-based UI parts (sygnal/ui/menu, sygnal/ui/select, sygnal/ui/combobox, on fromZag) and the
// React adapter (sygnal/react) in a real engine (BROWSER=chromium|firefox|webkit), driven by
// Playwright's trusted pointer and keyboard (window.__pw / __pwInput): roles and accessible
// names, keyboard navigation, typeahead, selection, filtering (Combobox), Escape / outside
// click, focus return, controlled values, and Zag's positioning.
import { run } from 'sygnal'
import { Menu } from 'sygnal/ui/menu'
import { Select } from 'sygnal/ui/select'
import { Combobox } from 'sygnal/ui/combobox'
import { fromReact } from 'sygnal/react'
import { createElement as r, useState } from 'react'
import { mountOnScreen, clearStage, assert, runTest as run_, wait } from '../harness.js'

const CAT = 'Zag UI parts + React adapter (PLAN-5 2-Z)'
const hasPw = () => typeof window.__pw === 'function'

let style
const css = () => {
  if (style) return
  style = document.createElement('style')
  style.textContent = `
    .ui-p5z [data-part=content] { background: #fff; border: 1px solid #888; min-width: 140px; }
    .ui-p5z [data-part=item][data-highlighted] { background: #dbeafe; }
    .ui-p5z [data-part=item] { padding: 2px 6px; }
    .ui-p5z [data-part=content][hidden] { display: none; }
  `
  document.head.appendChild(style)
}

const runTest = (name, fn, ms = 8000) => run_(CAT, name, async () => {
  if (!hasPw()) return
  css()
  window.scrollTo(0, 0)
  try { await fn() } catch (e) {
    throw e instanceof TypeError ? new Error(`${e.message} @ ${String(e.stack).split('\n').slice(0, 3).join(' | ')}`) : e
  } finally { await window.__pw('mouse-away'); clearStage() }
}, ms)

const until = async (pred, what, ms = 2000) => {
  const t0 = Date.now()
  let err
  const ok = () => { try { return pred() } catch (e) { err = e; return false } }
  while (!ok()) {
    if (Date.now() - t0 > ms) {
      let w
      try { w = typeof what === 'function' ? what() : what } catch (e) { w = `${what} (${e.message})` }
      throw new Error(`timed out: ${w}${err ? ` [${err.message}]` : ''}`)
    }
    await wait(10)
  }
}
const key = (...keys) => window.__pwInput(keys.map((k) => ['key', k]))
const role = (scope, o) => window.__pw('role', scope, o)

async function mount(App) {
  const { id, el } = mountOnScreen()
  el.className = 'ui-p5z'
  const app = run(App, {}, { mountPoint: id })
  await until(() => el.firstElementChild, 'mounted')
  await wait(30)
  return { id, el, app, $: (s) => el.querySelector(s), $$: (s) => [...el.querySelectorAll(s)] }
}

// ── fixtures (canonical forms) ──────────────────────────────────────────────────────────────
const ACTIONS = [{ value: 'edit', label: 'Edit' }, { value: 'copy', label: 'Copy' }, { separator: true }, { value: 'delete', label: 'Delete', disabled: true }, { value: 'archive', label: 'Archive' }]
function Toolbar({ state }) {
  return (
    <div>
      <button className="outside">Outside</button>
      <Menu className="actions" label="Actions" items={ACTIONS} />
      <p className="last">{state.last}</p>
    </div>
  )
}
Toolbar.initialState = { last: '' }
Toolbar.intent = ({ DOM }) => ({ PICK: DOM.select('.actions').events('select').detail() })
Toolbar.model = { PICK: (state, last) => ({ ...state, last }) }

const SIZES = [{ value: 's', label: 'Small' }, { value: 'm', label: 'Medium' }, { value: 'l', label: 'Large', disabled: true }, { value: 'xl', label: 'Extra large' }]
function Order({ state }) {
  return (
    <form className="order">
      <Select className="size" label="Size" items={SIZES} value={state.size} placeholder="Pick a size" name="size" />
      <button type="button" className="medium">Medium</button>
      <p className="out">{String(state.size)}</p>
    </form>
  )
}
Order.initialState = { size: null }
Order.intent = ({ DOM }) => ({
  SIZE: DOM.select('.size').events('value-change').detail(),
  MEDIUM: DOM.click('.medium'),
})
Order.model = { SIZE: (state, size) => ({ ...state, size }), MEDIUM: (state) => ({ ...state, size: 'm' }) }

const CITIES = ['Amsterdam', 'Berlin', 'Lisbon', 'London', 'Paris', 'Prague']
function Trip({ state }) {
  return (
    <div>
      <Combobox className="city" label="City" items={CITIES} value={state.city} placeholder="Type a city" />
      <p className="out">{String(state.city)}</p>
    </div>
  )
}
Trip.initialState = { city: null }
Trip.intent = ({ DOM }) => ({ CITY: DOM.select('.city').events('value-change').detail() })
Trip.model = { CITY: (state, city) => ({ ...state, city }) }

// React state (the clicks it has seen) and a callback prop
function StarRating({ value, onChange }) {
  const [clicks, setClicks] = useState(0)
  return r('span', { className: 'stars', role: 'radiogroup', 'aria-label': 'Rating', 'data-clicks': clicks },
    [1, 2, 3, 4, 5].map((i) => r('button', {
      key: i, type: 'button', 'data-i': i, role: 'radio', 'aria-checked': value === i, 'aria-label': `${i} stars`,
      onClick: () => { setClicks((n) => n + 1); onChange(i) },
    }, value >= i ? '★' : '☆')))
}
const Stars = fromReact(StarRating, { events: { rate: 'onChange' } })
function Review({ state }) {
  return (
    <div>
      {state.show && <Stars className="rating" value={state.rating} />}
      <button className="hide">Hide</button>
      <p className="out">{state.rating}</p>
    </div>
  )
}
Review.initialState = { rating: 2, show: true }
Review.intent = ({ DOM }) => ({ RATE: DOM.select('.rating').events('rate').detail(), HIDE: DOM.click('.hide') })
Review.model = { RATE: (state, rating) => ({ ...state, rating }), HIDE: (state) => ({ ...state, show: false }) }

export async function uiZagTestsP5Z() {
  // ── Menu ─────────────────────────────────────────────────────────────
  await runTest('Menu: roles and names; a click opens it, a click on an item selects and closes', async () => {
    const { id, app, $ } = await mount(Toolbar)
    try {
      assert(await role(id, { role: 'button', name: 'Actions', expanded: false }) === 1, 'no collapsed "Actions" menu button')
      await window.__pw('click', `${id} .actions [data-part=trigger]`)
      await until(() => !$('.actions [data-part=content]').hidden, 'menu open')
      assert(await role(id, { role: 'menu' }) === 1, 'no menu')
      assert(await role(id, { role: 'menuitem', name: 'Copy' }) === 1, 'no "Copy" menuitem')
      assert(await role(id, { role: 'menuitem', name: 'Delete', disabled: true }) === 1, 'no disabled "Delete"')
      await window.__pw('click', `${id} .actions [data-value=copy]`)
      await until(() => $('.last').textContent === 'copy', () => $('.last').textContent)
      await until(() => $('.actions [data-part=content]').hidden, 'closed after selecting')
    } finally { app.dispose() }
  })

  await runTest('Menu: keyboard (ArrowDown opens on the first item, skips disabled, Enter selects, focus returns)', async () => {
    const { id, app, $ } = await mount(Toolbar)
    try {
      await window.__pw('focus', `${id} .actions [data-part=trigger]`)
      await key('ArrowDown')
      await until(() => $('.actions [data-highlighted]')?.dataset.value === 'edit', () => `highlighted ${$('.actions [data-highlighted]')?.dataset.value}`)
      await until(() => document.activeElement === $('.actions [data-part=content]'), () => `focus in ${document.activeElement?.dataset?.part}; content hidden=${$('.actions [data-part=content]').hidden} tabindex=${$('.actions [data-part=content]').getAttribute('tabindex')} id=${$('.actions [data-part=content]').id} byId=${!!document.getElementById($('.actions [data-part=content]').id)}`)
      await key('ArrowDown', 'ArrowDown')
      await until(() => $('.actions [data-highlighted]')?.dataset.value === 'archive', () => `highlighted ${$('.actions [data-highlighted]')?.dataset.value}`)
      await key('End', 'Home')
      await until(() => $('.actions [data-highlighted]')?.dataset.value === 'edit', 'Home')
      await key('Enter')
      await until(() => $('.last').textContent === 'edit', () => $('.last').textContent)
      await until(() => document.activeElement === $('.actions [data-part=trigger]'), () => `focus on ${document.activeElement?.tagName}`)
    } finally { app.dispose() }
  })

  await runTest('Menu: typeahead; Escape closes and returns the focus; an outside click closes', async () => {
    const { id, app, $ } = await mount(Toolbar)
    try {
      await window.__pw('focus', `${id} .actions [data-part=trigger]`)
      await key('Enter')
      await until(() => !$('.actions [data-part=content]').hidden, 'open')
      await until(() => document.activeElement === $('.actions [data-part=content]'), 'focus in the menu')
      await key('a')
      await until(() => $('.actions [data-highlighted]')?.dataset.value === 'archive', () => `typeahead → ${$('.actions [data-highlighted]')?.dataset.value}`)
      await key('Escape')
      await until(() => $('.actions [data-part=content]').hidden, 'Escape closes')
      await until(() => document.activeElement === $('.actions [data-part=trigger]'), 'focus returned')
      await window.__pw('click', `${id} .actions [data-part=trigger]`)
      await until(() => !$('.actions [data-part=content]').hidden, 'reopened')
      await window.__pw('click', `${id} .outside`)
      await until(() => $('.actions [data-part=content]').hidden, 'outside click closes')
      assert($('.last').textContent === '', 'nothing selected')
    } finally { app.dispose() }
  })

  await runTest('Menu: positioned below its trigger', async () => {
    const { id, app, $ } = await mount(Toolbar)
    try {
      await window.__pw('click', `${id} .actions [data-part=trigger]`)
      await until(() => !$('.actions [data-part=content]').hidden, 'open')
      await wait(50)
      const t = $('.actions [data-part=trigger]').getBoundingClientRect(), c = $('.actions [data-part=content]').getBoundingClientRect()
      assert(c.top >= t.bottom - 1 && c.top - t.bottom < 40 && Math.abs(c.left - t.left) < 40, `trigger ${t.left},${t.bottom} content ${c.left},${c.top}`)
    } finally { app.dispose() }
  })

  // ── Select ───────────────────────────────────────────────────────────
  await runTest('Select: a combobox named by its label; keyboard opens, skips disabled, selects; focus returns', async () => {
    const { id, app, $ } = await mount(Order)
    try {
      assert(await role(id, { role: 'combobox', name: 'Size' }) === 1, 'no combobox named "Size"')
      await window.__pw('focus', `${id} .size [data-part=trigger]`)
      await key('ArrowDown')
      await until(() => !$('.size [data-part=content]').hidden, 'open')
      assert(await role(id, { role: 'listbox' }) === 1, 'no listbox')
      assert(await role(id, { role: 'option', name: 'Large', disabled: true }) === 1, 'no disabled "Large" option')
      await until(() => $('.size [data-highlighted]')?.dataset.value === 's', () => `highlighted ${$('.size [data-highlighted]')?.dataset.value}`)
      await until(() => document.activeElement === $('.size [data-part=content]'), () => `focus in ${document.activeElement?.dataset?.part}`)
      await key('ArrowDown', 'ArrowDown')
      await until(() => $('.size [data-highlighted]')?.dataset.value === 'xl', () => `highlighted ${$('.size [data-highlighted]')?.dataset.value}`)
      await key('Enter')
      await until(() => $('.out').textContent === 'xl', () => $('.out').textContent)
      await until(() => $('.size [data-part=value-text]').textContent === 'Extra large', 'value text')
      await until(() => document.activeElement === $('.size [data-part=trigger]'), 'focus returned')
      assert(new FormData($('.order')).get('size') === 'xl', `form value ${new FormData($('.order')).get('size')}`)
      assert(await role(id, { role: 'option', name: 'Extra large', selected: true, includeHidden: true }) === 1, 'Extra large not selected')
    } finally { app.dispose() }
  })

  await runTest('Select: typeahead on the closed trigger; the app sets the value (controlled); a click selects', async () => {
    const { id, app, $ } = await mount(Order)
    try {
      await window.__pw('focus', `${id} .size [data-part=trigger]`)
      await key('m')
      await until(() => $('.out').textContent === 'm', () => `typeahead → ${$('.out').textContent}`)
      await window.__pw('click', `${id} .medium`)
      await window.__pw('click', `${id} .size [data-part=trigger]`)
      await until(() => !$('.size [data-part=content]').hidden, 'open')
      await window.__pw('click', `${id} .size [role=option][data-value=s]`)
      await until(() => $('.out').textContent === 's', () => $('.out').textContent)
      await until(() => $('.size [data-part=value-text]').textContent === 'Small', 'value text')
      await window.__pw('click', `${id} .medium`)
      await until(() => $('.size [data-part=value-text]').textContent === 'Medium', () => `controlled → ${$('.size [data-part=value-text]').textContent}`)
    } finally { app.dispose() }
  })

  // ── Combobox ─────────────────────────────────────────────────────────
  await runTest('Combobox: named by its label; typing filters; ArrowDown + Enter selects; Escape closes', async () => {
    const { id, app, $, $$ } = await mount(Trip)
    try {
      assert(await role(id, { role: 'combobox', name: 'City' }) === 1, 'no combobox named "City"')
      await window.__pw('type', `${id} .city input`, 'lo')
      await until(() => !$('.city [data-part=content]').hidden, 'open while typing')
      await until(() => $$('.city [role=option]').map((o) => o.dataset.value).join() === 'London', () => $$('.city [role=option]').map((o) => o.dataset.value).join())
      assert(await role(id, { role: 'option', name: 'London' }) === 1, 'no "London" option')
      await key('ArrowDown')
      await until(() => $('.city input').getAttribute('aria-activedescendant') === $('.city [role=option][data-value=London]').id, 'active descendant')
      await key('Enter')
      await until(() => $('.out').textContent === 'London', () => $('.out').textContent)
      assert($('.city input').value === 'London', `input shows ${$('.city input').value}`)
      assert(document.activeElement === $('.city input'), 'focus stays in the input')
      // all the options again on the next open
      await window.__pw('click', `${id} .city [data-part=trigger]`)
      await until(() => $$('.city [role=option]').length === 6 && !$('.city [data-part=content]').hidden, () => `${$$('.city [role=option]').length} options`)
      await key('Escape')
      await until(() => $('.city [data-part=content]').hidden, 'Escape closes')
    } finally { app.dispose() }
  })

  await runTest('Combobox: a click on a filtered option selects it', async () => {
    const { id, app, $, $$ } = await mount(Trip)
    try {
      await window.__pw('type', `${id} .city input`, 'pr')
      await until(() => $$('.city [role=option]').map((o) => o.dataset.value).join() === 'Prague', () => $$('.city [role=option]').map((o) => o.dataset.value).join())
      await window.__pw('click', `${id} .city [role=option][data-value=Prague]`)
      await until(() => $('.out').textContent === 'Prague', () => $('.out').textContent)
      await until(() => $('.city [data-part=content]').hidden, 'closed')
    } finally { app.dispose() }
  })

  // PLAN-5 2-T (G-413): names from aria-label / aria-labelledby props reach the control
  await runTest('G-413: aria-label / aria-labelledby props name the Combobox input and the Select trigger', async () => {
    function Named() {
      return (
        <div>
          <h3 id="p5t-dest">Destination</h3>
          <p id="p5t-hint">Where you go</p>
          <Combobox className="city" aria-label="Town" aria-describedby="p5t-hint" items={['Paris', 'Prague']} />
          <Select className="size" aria-labelledby="p5t-dest" items={['S', 'M']} />
        </div>
      )
    }
    const { id, app, $ } = await mount(Named)
    try {
      assert(await role(id, { role: 'combobox', name: 'Town' }) === 1, 'no combobox named "Town"')
      assert(await role(id, { role: 'combobox', name: 'Destination' }) === 1, 'no combobox named "Destination"')
      assert(!$('.city').hasAttribute('aria-label') && !$('.size').hasAttribute('aria-labelledby'), 'naming props left on the host')
      assert($('.city input').getAttribute('aria-describedby') === 'p5t-hint', 'no description on the input')
    } finally { app.dispose() }
  })

  // ── React adapter ────────────────────────────────────────────────────
  await runTest('fromReact: a React component inside Sygnal (real clicks, props in, events out, unmount)', async () => {
    const { id, app, $ } = await mount(Review)
    try {
      await until(() => $('.rating .stars'), 'React rendered')
      assert($('.rating .stars').textContent === '★★☆☆☆', $('.rating .stars').textContent)
      assert(await role(id, { role: 'radio', name: '2 stars', checked: true }) === 1, 'no checked "2 stars"')
      await window.__pw('click', `${id} .rating [data-i="4"]`)
      await until(() => $('.out').textContent === '4', () => $('.out').textContent)
      await until(() => $('.rating .stars').textContent === '★★★★☆', () => $('.rating .stars').textContent)
      assert($('.rating .stars').dataset.clicks === '1', 'React state kept across the update')
      await window.__pw('click', `${id} .hide`)
      await until(() => !$('.rating'), 'host removed')
    } finally { app.dispose() }
  })
}
