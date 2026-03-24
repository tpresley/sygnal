import { describe, it, expect, afterEach } from 'vitest'
import xs from 'xstream'

if (typeof globalThis.window === 'undefined') {
  globalThis.window = undefined
}

import { renderComponent } from '../src/extra/testing.js'
import { createElement } from '../src/pragma/index.js'

const settle = (ms = 60) => new Promise(r => setTimeout(r, ms))


describe('renderComponent', () => {
  let t

  afterEach(() => {
    if (t) {
      t.dispose()
      t = null
    }
  })

  it('returns state$, dom$, events$, sinks, sources, and helpers', () => {
    function App() {
      return createElement('div', null, 'hello')
    }
    App.initialState = { x: 1 }

    t = renderComponent(App)

    expect(t).toHaveProperty('state$')
    expect(t).toHaveProperty('dom$')
    expect(t).toHaveProperty('events$')
    expect(t).toHaveProperty('sinks')
    expect(t).toHaveProperty('sources')
    expect(t).toHaveProperty('simulateAction')
    expect(t).toHaveProperty('waitForState')
    expect(t).toHaveProperty('states')
    expect(t).toHaveProperty('dispose')
    expect(typeof t.simulateAction).toBe('function')
    expect(typeof t.waitForState).toBe('function')
    expect(typeof t.dispose).toBe('function')
    expect(Array.isArray(t.states)).toBe(true)
  })

  it('collects initial state', async () => {
    function App() {
      return createElement('div', null, 'test')
    }
    App.initialState = { count: 0 }

    t = renderComponent(App)
    await settle(100)

    expect(t.states.length).toBeGreaterThanOrEqual(1)
    expect(t.states[0]).toEqual({ count: 0 })
  })

  it('accepts initialState override in options', async () => {
    function App() {
      return createElement('div', null, 'test')
    }
    App.initialState = { count: 0 }

    t = renderComponent(App, { initialState: { count: 42 } })
    await settle(100)

    expect(t.states[0]).toEqual({ count: 42 })
  })

  it('simulateAction triggers a state reducer', async () => {
    function Counter() {
      return createElement('div', null, 'test')
    }
    Counter.initialState = { count: 0 }
    Counter.intent = ({ DOM }) => ({
      INCREMENT: DOM.select('.inc').events('click'),
    })
    Counter.model = {
      INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
    }

    t = renderComponent(Counter)
    await settle(100)

    t.simulateAction('INCREMENT')
    await settle(100)

    const last = t.states[t.states.length - 1]
    expect(last.count).toBe(1)
  })

  it('simulateAction passes data to the reducer', async () => {
    function App() {
      return createElement('div', null, 'test')
    }
    App.initialState = { label: 'none' }
    App.intent = ({ DOM }) => ({
      SET_LABEL: DOM.select('.btn').events('click'),
    })
    App.model = {
      SET_LABEL: (state, label) => ({ ...state, label }),
    }

    t = renderComponent(App)
    await settle(100)

    t.simulateAction('SET_LABEL', 'hello')
    await settle(100)

    const last = t.states[t.states.length - 1]
    expect(last.label).toBe('hello')
  })

  it('simulateAction works with object-style model entries', async () => {
    function App() {
      return createElement('div', null, 'test')
    }
    App.initialState = { count: 0 }
    App.intent = ({ DOM }) => ({
      INC: DOM.select('.btn').events('click'),
    })
    App.model = {
      INC: {
        STATE: (state) => ({ ...state, count: state.count + 1 }),
      },
    }

    t = renderComponent(App)
    await settle(100)

    t.simulateAction('INC')
    await settle(100)

    expect(t.states[t.states.length - 1].count).toBe(1)
  })

  it('simulateAction handles EFFECT entries', async () => {
    let effectRan = false

    function App() {
      return createElement('div', null, 'test')
    }
    App.initialState = { result: null }
    App.intent = ({ DOM }) => ({
      FIRE: DOM.select('.btn').events('click'),
    })
    App.model = {
      FIRE: {
        EFFECT: (state, data, next) => {
          effectRan = true
          next('UPDATE', 'from-effect')
        },
      },
      UPDATE: (state, data) => ({ ...state, result: data }),
    }

    t = renderComponent(App)
    await settle(100)

    t.simulateAction('FIRE')
    await settle(200)

    expect(effectRan).toBe(true)
    expect(t.states[t.states.length - 1].result).toBe('from-effect')
  })

  it('simulateAction resolves shorthand model entries', async () => {
    let effectRan = false

    function App() {
      return createElement('div', null, 'test')
    }
    App.initialState = { x: 0 }
    App.intent = ({ DOM }) => ({
      DO: DOM.select('.btn').events('click'),
    })
    App.model = {
      'DO | EFFECT': () => { effectRan = true },
    }

    t = renderComponent(App)
    await settle(100)

    t.simulateAction('DO')
    await settle(100)

    expect(effectRan).toBe(true)
  })

  it('multiple simulateAction calls accumulate state', async () => {
    function Counter() {
      return createElement('div', null, 'test')
    }
    Counter.initialState = { count: 0 }
    Counter.intent = ({ DOM }) => ({
      INC: DOM.select('.inc').events('click'),
      DEC: DOM.select('.dec').events('click'),
    })
    Counter.model = {
      INC: (state) => ({ ...state, count: state.count + 1 }),
      DEC: (state) => ({ ...state, count: state.count - 1 }),
    }

    t = renderComponent(Counter)
    await settle(100)

    t.simulateAction('INC')
    await settle(50)
    t.simulateAction('INC')
    await settle(50)
    t.simulateAction('INC')
    await settle(50)
    t.simulateAction('DEC')
    await settle(100)

    expect(t.states[t.states.length - 1].count).toBe(2)
  })

  it('mockConfig drives the component via mock DOM events', async () => {
    function App() {
      return createElement('div', null, 'test')
    }
    App.initialState = { count: 0 }
    App.intent = ({ DOM }) => ({
      INC: DOM.select('.btn').events('click'),
    })
    App.model = {
      INC: (state) => ({ ...state, count: state.count + 1 }),
    }

    t = renderComponent(App, {
      mockConfig: { '.btn': { click: xs.of({}) } },
    })

    await settle(100)
    expect(t.states[t.states.length - 1].count).toBe(1)
  })
})


describe('waitForState', () => {
  let t

  afterEach(() => {
    if (t) {
      t.dispose()
      t = null
    }
  })

  it('resolves immediately if state already matches', async () => {
    function App() {
      return createElement('div', null, 'test')
    }
    App.initialState = { count: 5 }

    t = renderComponent(App)
    await settle(100)

    const state = await t.waitForState(s => s.count === 5)
    expect(state.count).toBe(5)
  })

  it('resolves when state matches after simulateAction', async () => {
    function App() {
      return createElement('div', null, 'test')
    }
    App.initialState = { count: 0 }
    App.intent = ({ DOM }) => ({
      INC: DOM.select('.btn').events('click'),
    })
    App.model = {
      INC: (state) => ({ ...state, count: state.count + 1 }),
    }

    t = renderComponent(App)
    await settle(100)

    // Trigger action after a delay
    setTimeout(() => t.simulateAction('INC'), 50)

    const state = await t.waitForState(s => s.count === 1)
    expect(state.count).toBe(1)
  })

  it('rejects on timeout', async () => {
    function App() {
      return createElement('div', null, 'test')
    }
    App.initialState = { count: 0 }

    t = renderComponent(App)
    await settle(100)

    await expect(
      t.waitForState(s => s.count === 999, 200)
    ).rejects.toThrow('timed out')
  })
})


describe('DISPOSE built-in action', () => {
  let t

  afterEach(() => {
    if (t) {
      t.dispose()
      t = null
    }
  })

  it('fires DISPOSE EFFECT handler on disposal', async () => {
    let disposeEffectRan = false

    function App() {
      return createElement('div', null, 'test')
    }
    App.initialState = { x: 1 }
    App.intent = ({ DOM }) => ({
      _NOOP: DOM.select('.__noop__').events('click'),
    })
    App.model = {
      DISPOSE: {
        EFFECT: () => { disposeEffectRan = true },
      },
    }

    t = renderComponent(App)
    await settle(100)

    expect(disposeEffectRan).toBe(false)
    t.dispose()
    t = null
    await settle(100)
    expect(disposeEffectRan).toBe(true)
  })

  it('DISPOSE EFFECT receives current state', async () => {
    const captured = []

    function App() {
      return createElement('div', null, 'test')
    }
    App.initialState = { count: 0 }
    App.intent = ({ DOM }) => ({
      INC: DOM.select('.btn').events('click'),
    })
    App.model = {
      INC: (state) => ({ ...state, count: state.count + 1 }),
      DISPOSE: {
        EFFECT: (state) => { captured.push(state.count) },
      },
    }

    t = renderComponent(App, {
      mockConfig: { '.btn': { click: xs.of({}) } }
    })
    await settle(100)

    // State should have been incremented
    expect(t.states[t.states.length - 1].count).toBe(1)

    t.dispose()
    t = null
    await settle(100)
    expect(captured).toEqual([1])
  })

  it('DISPOSE with model shorthand fires EFFECT', async () => {
    let effectRan = false

    function App() {
      return createElement('div', null, 'test')
    }
    App.initialState = { x: 1 }
    App.intent = ({ DOM }) => ({
      _NOOP: DOM.select('.__noop__').events('click'),
    })
    App.model = {
      'DISPOSE | EFFECT': () => { effectRan = true },
    }

    t = renderComponent(App)
    await settle(100)

    expect(effectRan).toBe(false)
    t.dispose()
    t = null
    await settle(100)
    expect(effectRan).toBe(true)
  })
})


describe('dispose', () => {
  it('cleans up without errors', async () => {
    function App() {
      return createElement('div', null, 'test')
    }
    App.initialState = { x: 1 }

    const t = renderComponent(App)
    await settle(100)

    expect(() => t.dispose()).not.toThrow()
  })

  it('stops collecting state after dispose', async () => {
    function App() {
      return createElement('div', null, 'test')
    }
    App.initialState = { count: 0 }
    App.intent = ({ DOM }) => ({
      INC: DOM.select('.btn').events('click'),
    })
    App.model = {
      INC: (state) => ({ ...state, count: state.count + 1 }),
    }

    const t = renderComponent(App)
    await settle(100)

    const countBefore = t.states.length
    t.dispose()

    // Attempting to simulate after dispose shouldn't add states
    // (stream is completed, so shamefullySendNext may throw or be no-op)
    await settle(100)
    expect(t.states.length).toBe(countBefore)
  })
})
