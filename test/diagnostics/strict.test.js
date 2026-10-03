// Strict mode (2A): runtime canonical-form checks SYG501 / SYG502 / SYG504
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupChecks, diagnostics, settle, later } from './helpers.js'
import { configureStrict, isStrictEnabled, listCodes, getCodeInfo } from '../../src/extra/diagnostics/checks/index.js'
import { configureDiagnostics, getDiagnostics } from '../../src/extra/diagnostics/index.js'
import { renderComponent } from '../../src/extra/testing.js'
import { createElement } from '../../src/pragma/index.js'
import { ABORT } from '../../src/component.js'
import { set } from '../../src/extra/reducers.js'

let t
beforeEach(() => { setupChecks(); configureStrict(undefined); delete globalThis.__SYGNAL_STRICT__ })
afterEach(() => { if (t) t.dispose(); t = null; configureStrict(undefined); delete globalThis.__SYGNAL_STRICT__ })

const strictCodes = () => getDiagnostics().filter(d => /^SYG5/.test(d.code)).map(d => d.code)

function make({ view, model, initialState = { count: 0 }, extra = {} } = {}) {
  const App = view || function App({ state }) { return createElement('div', null, String(state.count)) }
  App.initialState = initialState
  App.intent = ({ DOM }) => ({ GO: DOM.select('.go').events('click') })
  App.model = model || { GO: s => ({ ...s, count: s.count + 1 }) }
  Object.assign(App, extra)
  return App
}

describe('strict mode switch', () => {
  it('is off by default, and configureStrict / __SYGNAL_STRICT__ turn it on', () => {
    expect(isStrictEnabled()).toBe(false)
    globalThis.__SYGNAL_STRICT__ = true
    expect(isStrictEnabled()).toBe(true)
    configureStrict(false)
    expect(isStrictEnabled()).toBe(false)
    configureStrict(undefined)
    delete globalThis.__SYGNAL_STRICT__
    configureStrict(true)
    expect(isStrictEnabled()).toBe(true)
  })

  it('registers the SYG5xx codes with titles and severities', () => {
    expect(getCodeInfo('SYG501')).toMatchObject({ severity: 'warn', title: 'View uses positional arguments' })
    expect(getCodeInfo('SYG507')).toMatchObject({ severity: 'info' })
    expect(getCodeInfo('SYG508')).toMatchObject({ severity: 'warn', title: 'select()/errors() round trip where reply actions would do' })
    expect(listCodes().filter(c => /^SYG5/.test(c.code))).toHaveLength(8)
  })

  it('reports nothing when strict is off, even for every non-canonical form', async () => {
    function Positional(props, state) { return createElement('div', null, String(state.count)) }
    const App = make({
      view: Positional,
      model: { GO: s => s, 'GO | EFFECT': () => {} },
    })
    t = renderComponent(App, { mockConfig: { '.go': { click: later() } } })
    await settle(150)
    expect(strictCodes()).toEqual([])
  })

  it('renderComponent({ strict: true }) restores the previous setting on dispose', () => {
    t = renderComponent(make(), { strict: true })
    expect(isStrictEnabled()).toBe(true)
    t.dispose(); t = null
    expect(isStrictEnabled()).toBe(false)
  })

  it('needs diagnostics on: mode off reports nothing', async () => {
    function Positional(props, state) { return createElement('div', null, 'x') }
    t = renderComponent(make({ view: Positional }), { strict: true, diagnostics: 'off' })
    await settle(50)
    expect(strictCodes()).toEqual([])
  })
})

describe('SYG501 — positional view arguments', () => {
  it('reports a view that takes (props, state, context)', async () => {
    function Lane(props, state, context) { return createElement('div', null, String(state.count)) }
    t = renderComponent(make({ view: Lane }), { strict: true })
    await settle(50)
    const found = diagnostics('SYG501')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ severity: 'warn', component: 'Lane', data: { arity: 3 } })
    expect(found[0].fix).toContain('function Lane({ state, context, ...props })')
  })

  it('does not report a destructured single-argument view', async () => {
    function Lane({ state, context }) { return createElement('div', null, String(state.count)) }
    t = renderComponent(make({ view: Lane }), { strict: true })
    await settle(50)
    expect(diagnostics('SYG501')).toEqual([])
  })
})

describe('SYG502 — no-op STATE reducer without ABORT', () => {
  it('reports a reducer that returns the identical state object', async () => {
    const App = make({ model: { GO: (state, _d) => (state.count > 5 ? { ...state, count: 0 } : state) } })
    t = renderComponent(App, { strict: true, mockConfig: { '.go': { click: later() } } })
    await settle(150)
    const found = diagnostics('SYG502')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ severity: 'warn', component: 'App', data: { action: 'GO' } })
    expect(found[0].fix).toContain('ABORT')
  })

  it('also sees through calculated fields (the reducer gets the enhanced state)', async () => {
    const App = make({
      model: { GO: state => state },
      extra: { calculated: { double: s => s.count * 2 } },
    })
    t = renderComponent(App, { strict: true, mockConfig: { '.go': { click: later() } } })
    await settle(150)
    expect(diagnostics('SYG502')).toHaveLength(1)
  })

  it('does not report ABORT, new objects, set(), or undefined (that is SYG202)', async () => {
    const App = make({
      model: {
        GO: state => ABORT,
        GO2: set({ count: 3 }),
        GO3: state => ({ ...state }),
        GO4: () => undefined,
      },
    })
    t = renderComponent(App, { strict: true })
    for (const a of ['GO', 'GO2', 'GO3', 'GO4']) t.simulateAction(a)
    await settle(150)
    expect(diagnostics('SYG502')).toEqual([])
    expect(diagnostics('SYG202')).toHaveLength(1)
  })

  it('does not report primitive state (a reducer may legitimately return the same number)', async () => {
    const App = make({ initialState: 5, model: { GO: (s, d) => 5 }, view: function App({ state }) { return createElement('div', null, String(state)) } })
    t = renderComponent(App, { strict: true, mockConfig: { '.go': { click: later() } } })
    await settle(150)
    expect(diagnostics('SYG502')).toEqual([])
  })
})

describe('SYG504 — shorthand model keys', () => {
  it("reports 'ACTION | SINK' keys with the object-form rewrite", async () => {
    const App = make({
      model: {
        GO: s => ({ ...s, count: s.count + 1 }),
        'GO | EFFECT': () => {},
        'PING | EVENTS': () => ({ type: 'PING', data: 1 }),
      },
    })
    t = renderComponent(App, { strict: true })
    await settle(50)
    const found = diagnostics('SYG504')
    expect(found.map(d => d.data.key)).toEqual(['GO | EFFECT', 'PING | EVENTS'])
    expect(found[0].fix).toContain('GO: { EFFECT: (state, data, next) => ... }')
    expect(found[1].fix).toContain("PING: { EVENTS: event('TYPE', (state, data) => payload) }")
  })

  it('does not report object-form entries', async () => {
    const App = make({ model: { GO: { STATE: s => ({ ...s, count: 1 }), EFFECT: () => {} } } })
    t = renderComponent(App, { strict: true })
    await settle(50)
    expect(diagnostics('SYG504')).toEqual([])
  })
})

describe('dedupe', () => {
  it('reports once per component name across live instances', async () => {
    configureDiagnostics({ mode: 'collect' })
    function Lane(props, state) { return createElement('div', null, 'x') }
    const App = make({ view: Lane })
    const outer = renderComponent(App, { strict: true })
    await settle(30)
    t = renderComponent(App, { strict: true })
    await settle(30)
    expect(diagnostics('SYG501')).toHaveLength(1)
    t.dispose()
    outer.dispose()
    // G-051: the dedupe is reset when the next outermost renderComponent starts
    t = renderComponent(App, { strict: true })
    await settle(30)
    expect(diagnostics('SYG501')).toHaveLength(2)
  })
})
