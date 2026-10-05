// Strict mode (2A): runtime canonical-form checks SYG501 / SYG504 (SYG502 retired in 6.0)
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupChecks, diagnostics, settle, later } from './helpers.js'
import { configureStrict, isStrictEnabled, listCodes, getCodeInfo } from '../../src/extra/diagnostics/checks/index.js'
import { configureDiagnostics, getDiagnostics } from '../../src/extra/diagnostics/index.js'
import { renderComponent } from '../../src/extra/testing.js'
import { createElement } from '../../src/pragma/index.js'
import { ABORT } from '../../src/shared.js'
import { set } from '../../src/extra/reducers.js'
import { until } from '../support/wait.js'

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
    expect(getCodeInfo('SYG501')).toMatchObject({ severity: 'error', title: 'Removed in 6.0: view with positional arguments' })
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
  it('does not report a destructured single-argument view', async () => {
    function Lane({ state, context }) { return createElement('div', null, String(state.count)) }
    t = renderComponent(make({ view: Lane }), { strict: true })
    await settle(50)
    expect(diagnostics('SYG501')).toEqual([])
  })
})

// SYG502 is retired in 6.0 (PLAN-4 GS-4): returning the state object is "no change", like
// ABORT, and is never reported. Covered in test/p4-2a-gs4-same-object.test.js.

describe('SYG504 — shorthand model keys', () => {
  it('does not report object-form entries', async () => {
    const App = make({ model: { GO: { STATE: s => ({ ...s, count: 1 }), EFFECT: () => {} } } })
    t = renderComponent(App, { strict: true })
    await settle(50)
    expect(diagnostics('SYG504')).toEqual([])
  })
})


