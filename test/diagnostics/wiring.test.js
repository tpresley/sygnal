// SYG101 (intent action without model entry) and SYG102 (unreachable model entry)
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import xs from 'xstream'
import { setupChecks, diagnostics, settle } from './helpers.js'
import { renderComponent } from '../../src/extra/testing.js'
import { createElement } from '../../src/pragma/index.js'

let t
beforeEach(() => setupChecks())
afterEach(() => { if (t) t.dispose(); t = null })

describe('SYG101 — intent action has no model entry', () => {
  it('reports an intent action with no model entry, with a did-you-mean hint', async () => {
    function App() { return createElement('div', null, 'x') }
    App.initialState = { n: 0 }
    App.intent = ({ DOM }) => ({
      INCREMENT: DOM.select('.inc').events('click'),
      DECREMNT: DOM.select('.dec').events('click'),
    })
    App.model = {
      INCREMENT: s => ({ ...s, n: s.n + 1 }),
      DECREMENT: s => ({ ...s, n: s.n - 1 }),
    }
    t = renderComponent(App)
    await settle(50)
    const found = diagnostics('SYG101')
    expect(found).toHaveLength(1)
    expect(found[0].severity).toBe('warn')
    expect(found[0].component).toBe('App')
    expect(found[0].message).toContain("'DECREMNT'")
    expect(found[0].message).toContain("did you mean 'DECREMENT'")
    expect(found[0].data.action).toBe('DECREMNT')
  })

  it('does not report matched actions, shorthand entries, built-ins or synthetic __ actions', async () => {
    function App() { return createElement('div', null, 'x') }
    App.initialState = { n: 0 }
    App.intent = ({ DOM }) => ({
      INCREMENT: DOM.select('.inc').events('click'),
      LOG_IT: DOM.select('.log').events('click'),
      DISPOSE: xs.never(),
      __PRIVATE__: xs.never(),
    })
    App.model = {
      INCREMENT: s => ({ ...s, n: s.n + 1 }),
      'LOG_IT | EFFECT': () => {},
    }
    t = renderComponent(App) // also injects __TEST_ACTION__ (G-013)
    await settle(50)
    expect(diagnostics('SYG101')).toEqual([])
  })

  it('reports once per component name, not once per instance', async () => {
    function App() { return createElement('div', null, 'x') }
    App.intent = ({ DOM }) => ({ CLICK: DOM.select('.b').events('click') })
    App.model = {}
    t = renderComponent(App)
    const t2 = renderComponent(App)
    await settle(50)
    t2.dispose()
    expect(diagnostics('SYG101')).toHaveLength(1)
  })
})

describe('SYG102 — model entry is unreachable', () => {
  it('reports (info) a model entry with no intent action of that name', async () => {
    function App() { return createElement('div', null, 'x') }
    App.initialState = { n: 0 }
    App.intent = ({ DOM }) => ({ INCREMENT: DOM.select('.inc').events('click') })
    App.model = {
      INCREMENT: s => ({ ...s, n: s.n + 1 }),
      RESET: s => ({ ...s, n: 0 }),
    }
    t = renderComponent(App)
    await settle(50)
    const found = diagnostics('SYG102')
    expect(found).toHaveLength(1)
    expect(found[0].severity).toBe('info')
    expect(found[0].data.action).toBe('RESET')
    expect(found[0].text).toContain("next('RESET')")
  })

  it('does not report built-ins, hmrActions, shorthand-expanded entries or single-stream intents', async () => {
    function App() { return createElement('div', null, 'x') }
    App.initialState = { n: 0 }
    App.intent = ({ DOM }) => ({ SAVE: DOM.select('.save').events('click') })
    App.model = {
      BOOTSTRAP: { EFFECT: () => {} },
      INITIALIZE: { EFFECT: () => {} },
      DISPOSE: { EFFECT: () => {} },
      'SAVE | EFFECT': () => {},
    }
    t = renderComponent(App)
    await settle(50)
    expect(diagnostics('SYG102')).toEqual([])

    // single-stream intent: action names are unknown, so nothing is reported
    const { default: component } = await import('../../src/component.js')
    const { withState } = await import('../../src/cycle/state/index.js')
    const { setup } = await import('../../src/cycle/run/index.js')
    const { mockDOMSource } = await import('../../src/cycle/dom/index.js')
    const Single = component({
      name: 'Single',
      view: () => createElement('div', null, 'y'),
      intent: () => xs.never(),
      model: { A: s => s, B: s => s },
      initialState: {},
    })
    const { run } = setup(withState(Single), { DOM: () => mockDOMSource({}) })
    const stop = run()

    // hmrActions are triggered on hot reload, so they are reachable
    const Hmr = component({
      name: 'Hmr',
      view: () => createElement('div', null, 'z'),
      intent: () => ({}),
      model: { REFRESH: s => s },
      hmrActions: ['REFRESH'],
      initialState: {},
    })
    const r2 = setup(withState(Hmr), { DOM: () => mockDOMSource({}) })
    const stop2 = r2.run()
    await settle(30)
    stop()
    stop2()
    expect(diagnostics('SYG102')).toEqual([])
  })
})
