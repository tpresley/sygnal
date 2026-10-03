// PLAN-2 2-C: component bugs (G-102, G-107, G-108, G-109)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupChecks } from './diagnostics/helpers.js'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/index.js'

let t
beforeEach(() => setupChecks())
afterEach(() => { if (t) t.dispose(); t = null; vi.restoreAllMocks() })

const settle = (ms = 40) => new Promise(r => setTimeout(r, ms))
const names = (html) => [...html.matchAll(/<li>([^<]*)<\/li>/g)].map(m => m[1])
// G-132: poll for a condition (bounded) instead of sleeping a fixed time
async function until(cond, { timeout = 5000, interval = 5 } = {}) {
  const end = Date.now() + timeout
  while (!cond()) {
    if (Date.now() > end) throw new Error(`condition not met within ${timeout} ms`)
    await new Promise(r => setTimeout(r, interval))
  }
}
const sameNames = (t, expected) => () => JSON.stringify(names(t.html())) === JSON.stringify(expected)

function Item({ state }) { return h('li', null, state.name) }

const ITEMS = [
  { id: 1, name: 'b', done: false },
  { id: 2, name: 'a', done: true },
  { id: 3, name: 'c', done: false },
]

// A parent whose button toggles a field it passes down as a Collection prop
function makeApp(Child, childProps) {
  function App({ state }) {
    return h('div', null,
      h('button', { className: 'toggle' }, 'toggle'),
      h(Child, childProps(state)))
  }
  App.initialState = { items: ITEMS, hideDone: false, desc: false, list: { items: ITEMS } }
  App.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.toggle') })
  App.model = { TOGGLE: s => ({ ...s, hideDone: !s.hideDone, desc: !s.desc }) }
  return App
}

const notDone = item => !item.done

describe('G-102: Collection props inside a child component', () => {
  it('a filter prop change re-filters (child shares the parent state)', async () => {
    function List({ filter }) {
      return h('ul', null, h(Collection, { of: Item, from: 'items', filter }))
    }
    const App = makeApp(List, s => ({ filter: s.hideDone ? notDone : undefined }))
    t = renderComponent(App)
    await t.ready()
    await until(sameNames(t, ['b', 'a', 'c']))   // G-176: not a fixed settle
    expect(names(t.html())).toEqual(['b', 'a', 'c'])
    t.simulateEvent('.toggle', 'click')
    await until(sameNames(t, ['b', 'c']))   // G-176: not a fixed settle
    expect(names(t.html())).toEqual(['b', 'c'])
    t.simulateEvent('.toggle', 'click')
    await until(sameNames(t, ['b', 'a', 'c']))   // G-176: not a fixed settle
    expect(names(t.html())).toEqual(['b', 'a', 'c'])
  })

  it('a filter prop change re-filters (child bound with state=)', async () => {
    function List({ filter }) {
      return h('ul', null, h(Collection, { of: Item, from: 'items', filter }))
    }
    const App = makeApp(List, s => ({ state: 'list', filter: s.hideDone ? notDone : undefined }))
    t = renderComponent(App)
    await t.ready()
    await until(sameNames(t, ['b', 'a', 'c']))   // G-176: not a fixed settle
    expect(names(t.html())).toEqual(['b', 'a', 'c'])
    t.simulateEvent('.toggle', 'click')
    await until(sameNames(t, ['b', 'c']))   // G-176: not a fixed settle
    expect(names(t.html())).toEqual(['b', 'c'])
  })

  it('a sort prop change re-sorts (child bound with state=)', async () => {
    function List({ sort }) {
      return h('ul', null, h(Collection, { of: Item, from: 'items', sort }))
    }
    const App = makeApp(List, s => ({ state: 'list', sort: { name: s.desc ? 'desc' : 'asc' } }))
    t = renderComponent(App)
    await t.ready()
    await until(sameNames(t, ['a', 'b', 'c']))
    expect(names(t.html())).toEqual(['a', 'b', 'c'])
    t.simulateEvent('.toggle', 'click')
    await until(sameNames(t, ['c', 'b', 'a']))
    expect(names(t.html())).toEqual(['c', 'b', 'a'])
  })

  it('still works in the root component', async () => {
    function App({ state }) {
      return h('div', null,
        h('button', { className: 'toggle' }, 'toggle'),
        h('ul', null, h(Collection, { of: Item, from: 'items', filter: state.hideDone ? notDone : undefined })))
    }
    App.initialState = { items: ITEMS, hideDone: false }
    App.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.toggle') })
    App.model = { TOGGLE: s => ({ ...s, hideDone: !s.hideDone }) }
    t = renderComponent(App)
    await t.ready()
    await until(sameNames(t, ['b', 'a', 'c']))
    t.simulateEvent('.toggle', 'click')
    await until(sameNames(t, ['b', 'c']))   // G-176: not a fixed settle
    expect(names(t.html())).toEqual(['b', 'c'])
    t.simulateEvent('.toggle', 'click')
    await until(sameNames(t, ['b', 'a', 'c']))   // G-176: not a fixed settle
    expect(names(t.html())).toEqual(['b', 'a', 'c'])
  })
})

describe('G-107: BOOTSTRAP without an intent', () => {
  it('fires for a root component with a model but no intent', async () => {
    function App({ state }) { return h('p', null, String(state.booted)) }
    App.initialState = { booted: false }
    App.model = { BOOTSTRAP: s => ({ ...s, booted: true }) }
    t = renderComponent(App)
    await t.ready()
    await until(() => t.html() === '<p>true</p>')
    expect(t.html()).toBe('<p>true</p>')
  })

  it('fires for a sub-component with a model but no intent, like the root', async () => {
    let boots = 0
    function Child({ state }) { return h('i', null, String(state.booted)) }
    Child.model = { BOOTSTRAP: s => { boots++; return { ...s, booted: true } } }
    function App() { return h('div', null, h(Child)) }
    App.initialState = { booted: false }
    t = renderComponent(App)
    await t.ready()
    await until(() => t.html() === '<div><i>true</i></div>')
    await settle(60)
    expect(boots).toBe(1)
    expect(t.html()).toBe('<div><i>true</i></div>')
  })
})
