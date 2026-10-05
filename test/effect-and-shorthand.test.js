import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { mockDOMSource } from '../src/cycle/dom/index'
import xs from 'xstream'


import { ABORT } from '../src/shared.js'
import run from '../src/extra/run.js'
import eventBusDriver from '../src/extra/eventDriver.js'
import logDriver from '../src/extra/logDriver.js'
import { createElement } from '../src/pragma/index.js'


// R5 (06 §3): the harness runs the component with run() (the core), with the same drivers it had
// under the removed component() + setup + withState harness
function startApp(view, drivers) {
  const app = run(view, drivers, { useDefaultDrivers: false })
  return { sources: app.sources, sinks: app.sinks, dispose: () => app.dispose(), setState: (v) => app.__runtime.setState('root', () => v) }
}

function createTestComponent(componentDef, mockConfig = {}) {
  const view = componentDef

  const { sources, sinks, dispose, setState } = startApp(view, {
    DOM: () => mockDOMSource(mockConfig),
    EVENTS: eventBusDriver,
    LOG: logDriver,
  })

  const states = []
  let stateListener
  if (sources.STATE && sources.STATE.stream) {
    stateListener = {
      next: s => states.push(s),
      error: () => {},
      complete: () => {},
    }
    sources.STATE.stream.addListener(stateListener)
  }

  return {
    sources,
    sinks,
    states,
    dispose() {
      if (stateListener && sources.STATE?.stream) {
        sources.STATE.stream.removeListener(stateListener)
      }
      dispose()
    },
  }
}

const settle = (ms = 60) => new Promise(r => setTimeout(r, ms))


describe('EFFECT sink', () => {
  let testEnv

  afterEach(() => {
    if (testEnv) {
      testEnv.dispose()
      testEnv = null
    }
  })

  it('runs side effects without changing state', async () => {
    let effectRan = false

    function EffectComp() {
      return createElement('div', null, 'test')
    }
    EffectComp.initialState = { count: 0 }
    EffectComp.intent = ({ DOM }) => ({
      DO_THING: DOM.select('.btn').events('click'),
    })
    EffectComp.model = {
      DO_THING: {
        EFFECT: () => { effectRan = true },
      },
    }

    testEnv = createTestComponent(EffectComp, {
      '.btn': { click: xs.of({}) },
    })

    await settle(100)
    expect(effectRan).toBe(true)
    // State should only have the initial state, no updates from EFFECT
    const nonInitStates = testEnv.states.filter(s => s !== undefined)
    expect(nonInitStates.length).toBeGreaterThanOrEqual(1)
    expect(nonInitStates[nonInitStates.length - 1]).toEqual({ count: 0 })
  })

  it('receives state, data, and next arguments', async () => {
    let receivedState = null
    let receivedData = null
    let receivedNext = null

    function EffectComp() {
      return createElement('div', null, 'test')
    }
    EffectComp.initialState = { value: 42 }
    EffectComp.intent = ({ DOM }) => ({
      TRIGGER: DOM.select('.btn').events('click'),
    })
    EffectComp.model = {
      TRIGGER: {
        EFFECT: (state, data, next) => {
          receivedState = state
          receivedData = data
          receivedNext = next
        },
      },
    }

    testEnv = createTestComponent(EffectComp, {
      '.btn': { click: xs.of({ payload: 'hello' }) },
    })

    await settle(100)
    expect(receivedState).toEqual({ value: 42 })
    expect(receivedData).toEqual({ payload: 'hello' })
    expect(typeof receivedNext).toBe('function')
  })

  it('can dispatch follow-up actions via next()', async () => {
    function EffectComp() {
      return createElement('div', null, 'test')
    }
    EffectComp.initialState = { result: null }
    EffectComp.intent = ({ DOM }) => ({
      TRIGGER: DOM.select('.btn').events('click'),
    })
    EffectComp.model = {
      TRIGGER: {
        EFFECT: (state, data, next) => {
          next('UPDATE', 'from-effect')
        },
      },
      UPDATE: (state, data) => ({ ...state, result: data }),
    }

    testEnv = createTestComponent(EffectComp, {
      '.btn': { click: xs.of({}) },
    })

    await settle(150)
    const last = testEnv.states[testEnv.states.length - 1]
    expect(last.result).toBe('from-effect')
  })

  it('warns when reducer returns a value', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    function EffectComp() {
      return createElement('div', null, 'test')
    }
    EffectComp.initialState = { count: 0 }
    EffectComp.intent = ({ DOM }) => ({
      BAD: DOM.select('.btn').events('click'),
    })
    EffectComp.model = {
      BAD: {
        EFFECT: (state) => ({ ...state, count: 1 }),
      },
    }

    testEnv = createTestComponent(EffectComp, {
      '.btn': { click: xs.of({}) },
    })

    await settle(100)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('EFFECT handler'),
    )
    warnSpy.mockRestore()
  })

  it('can combine EFFECT with STATE sink in same action', async () => {
    let effectRan = false

    function EffectComp() {
      return createElement('div', null, 'test')
    }
    EffectComp.initialState = { count: 0 }
    EffectComp.intent = ({ DOM }) => ({
      BOTH: DOM.select('.btn').events('click'),
    })
    EffectComp.model = {
      BOTH: {
        STATE: (state) => ({ ...state, count: state.count + 1 }),
        EFFECT: () => { effectRan = true },
      },
    }

    testEnv = createTestComponent(EffectComp, {
      '.btn': { click: xs.of({}) },
    })

    await settle(100)
    expect(effectRan).toBe(true)
    const last = testEnv.states[testEnv.states.length - 1]
    expect(last.count).toBe(1)
  })
})

// R5 (D164): the 'ACTION | SINK' model keys were removed; their tests went with them (SYG612
// reports the form in dev, test/p46-r4-diagnostics.test.js)
