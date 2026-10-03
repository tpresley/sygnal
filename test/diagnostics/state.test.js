// SYG201 (reducer dropped keys) and SYG202 (reducer returned undefined)
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupChecks, diagnostics, settle, later, times } from './helpers.js'
import { renderComponent } from '../../src/extra/testing.js'
import { createElement } from '../../src/pragma/index.js'
import { ABORT } from '../../src/component.js'
import { set, toggle } from '../../src/extra/reducers.js'
import { until } from '../support/wait.js'

let t
beforeEach(() => setupChecks())
afterEach(() => { if (t) t.dispose(); t = null })

const view = () => createElement('div', null, 'x')

function make(model, initialState = { count: 0, label: 'hi', open: false }, extra = {}) {
  function App() { return view() }
  App.initialState = initialState
  App.intent = ({ DOM }) => ({ GO: DOM.select('.go').events('click') })
  App.model = model
  Object.assign(App, extra)
  return App
}

describe('SYG201 — STATE reducer dropped keys', () => {
  it('reports keys missing from the returned state, once per action', async () => {
    const App = make({ GO: state => ({ count: state.count + 1 }) })
    t = renderComponent(App, { mockConfig: { '.go': { click: times(2) } } })
    await t.waitForState(s => s && s.count === 1)
    await until(() => expect(diagnostics('SYG201')).toHaveLength(1))   // G-176: wait for the report
    await settle(120)
    const found = diagnostics('SYG201')
    expect(found).toHaveLength(1)
    expect(found[0].severity).toBe('warn')
    expect(found[0].data).toEqual({ action: 'GO', droppedKeys: ['label', 'open'] })
    expect(found[0].text).toContain('...state')
  })

  it('does not report spreads, set()/toggle() helpers, or calculated fields', async () => {
    const App = make({ GO: state => ({ ...state, count: state.count + 1 }) })
    t = renderComponent(App, { mockConfig: { '.go': { click: later() } } })
    await t.waitForState(s => s && s.count === 1)
    t.dispose()

    const SetApp = make({ GO: set({ count: 5 }) })
    t = renderComponent(SetApp, { mockConfig: { '.go': { click: later() } } })
    await t.waitForState(s => s && s.count === 5)
    t.dispose()

    const ToggleApp = make({ GO: toggle('open') })
    t = renderComponent(ToggleApp, { mockConfig: { '.go': { click: later() } } })
    await t.waitForState(s => s && s.open === true)
    t.dispose()

    // 'double' is a calculated field: dropping it from the reducer result is fine
    const CalcApp = make(
      { GO: state => ({ count: state.count + 1, label: state.label, open: state.open }) },
      { count: 1, label: 'hi', open: false },
      { calculated: { double: s => s.count * 2 } },
    )
    t = renderComponent(CalcApp, { mockConfig: { '.go': { click: later() } } })
    await t.waitForState(s => s && s.count === 2)
    await settle(50)

    expect(diagnostics('SYG201')).toEqual([])
  })
})

describe('SYG202 — STATE reducer returned undefined', () => {
  it('reports a reducer that returns undefined', async () => {
    const App = make({
      GO: (state) => { state.count++ }, // mutates and forgets to return
    })
    t = renderComponent(App, { mockConfig: { '.go': { click: later() } } })
    await until(() => expect(diagnostics('SYG202')).toHaveLength(1))   // G-176: wait for the report
    await settle(150)
    const found = diagnostics('SYG202')
    expect(found).toHaveLength(1)
    expect(found[0].severity).toBe('warn')
    expect(found[0].data.action).toBe('GO')
    expect(found[0].fix).toContain('ABORT')
  })

  it('a Collection item returning undefined (documented removal) is info, not warn', async () => {
    const { Collection } = await import('../../src/collection.js')
    function Item({ state }) { return createElement('li', { className: 'item' }, createElement('button', { className: 'rm' }, String(state.id))) }
    Item.intent = ({ DOM }) => ({ REMOVE: DOM.select('.rm').events('click') })
    Item.model = { REMOVE: () => undefined }
    function List() { return createElement('ul', null, createElement(Collection, { of: Item, from: 'items' })) }
    List.initialState = { items: [{ id: 1 }, { id: 2 }] }
    t = renderComponent(List)
    await t.ready()
    t.simulateEvent('.rm', 'click')
    await t.waitForState(s => s.items.length === 1)
    await until(() => expect(diagnostics('SYG202')).toHaveLength(1))   // G-176: wait for the report
    await settle(50)
    const found = diagnostics('SYG202')
    expect(found).toHaveLength(1)
    expect(found[0].severity).toBe('info')
    expect(found[0].message).toContain('Collection item')
  })

  it('does not report ABORT or a returned state', async () => {
    const App = make({ GO: state => (state.count > 10 ? { ...state, count: 0 } : ABORT) })
    t = renderComponent(App, { mockConfig: { '.go': { click: later() } } })
    await settle(150)
    expect(diagnostics('SYG202')).toEqual([])
    expect(diagnostics('SYG201')).toEqual([])
  })
})
