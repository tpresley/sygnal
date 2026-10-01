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
    await settle()
    expect(names(t.html())).toEqual(['b', 'a', 'c'])
    t.simulateEvent('.toggle', 'click')
    await settle(80)
    expect(names(t.html())).toEqual(['b', 'c'])
    t.simulateEvent('.toggle', 'click')
    await settle(500)
    console.log('DBG', t.html(), JSON.stringify(t.state))
    expect(names(t.html())).toEqual(['b', 'a', 'c'])
  })

  it('a filter prop change re-filters (child bound with state=)', async () => {
    function List({ filter }) {
      return h('ul', null, h(Collection, { of: Item, from: 'items', filter }))
    }
    const App = makeApp(List, s => ({ state: 'list', filter: s.hideDone ? notDone : undefined }))
    t = renderComponent(App)
    await t.ready()
    await settle()
    expect(names(t.html())).toEqual(['b', 'a', 'c'])
    t.simulateEvent('.toggle', 'click')
    await settle(80)
    expect(names(t.html())).toEqual(['b', 'c'])
  })

  it('a sort prop change re-sorts (child bound with state=)', async () => {
    function List({ sort }) {
      return h('ul', null, h(Collection, { of: Item, from: 'items', sort }))
    }
    const App = makeApp(List, s => ({ state: 'list', sort: { name: s.desc ? 'desc' : 'asc' } }))
    t = renderComponent(App)
    await t.ready()
    await settle()
    expect(names(t.html())).toEqual(['a', 'b', 'c'])
    t.simulateEvent('.toggle', 'click')
    await settle(80)
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
    await settle()
    t.simulateEvent('.toggle', 'click')
    await settle(80)
    expect(names(t.html())).toEqual(['b', 'c'])
    t.simulateEvent('.toggle', 'click')
    await settle(80)
    expect(names(t.html())).toEqual(['b', 'a', 'c'])
  })
})
