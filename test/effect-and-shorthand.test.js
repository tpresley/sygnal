import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { setup } from '../src/cycle/run/index'
import { withState } from '../src/cycle/state/index'
import { mockDOMSource } from '../src/cycle/dom/index'
import xs from 'xstream'

if (typeof globalThis.window === 'undefined') {
  globalThis.window = undefined
}

import component, { ABORT } from '../src/component.js'
import eventBusDriver from '../src/extra/eventDriver.js'
import logDriver from '../src/extra/logDriver.js'
import { createElement } from '../src/pragma/index.js'


function createTestComponent(componentDef, mockConfig = {}) {
  const name = componentDef.name || 'TestComponent'
  const view = componentDef
  const { intent, model, initialState, calculated } = componentDef

  const app = component({ name, view, intent, model, initialState, calculated })
  const wrapped = withState(app, 'STATE')
  const mockDOM = () => mockDOMSource(mockConfig)

  const { sources, sinks, run: _run } = setup(wrapped, {
    DOM: mockDOM,
    EVENTS: eventBusDriver,
    LOG: logDriver,
  })

  const dispose = _run()

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


describe('Model shorthand (ACTION | DRIVER)', () => {
  let testEnv

  afterEach(() => {
    if (testEnv) {
      testEnv.dispose()
      testEnv = null
    }
  })

  it('expands shorthand to equivalent object entry', async () => {
    let effectRan = false

    function ShortComp() {
      return createElement('div', null, 'test')
    }
    ShortComp.initialState = { count: 0 }
    ShortComp.intent = ({ DOM }) => ({
      DO_THING: DOM.select('.btn').events('click'),
    })
    ShortComp.model = {
      'DO_THING | EFFECT': () => { effectRan = true },
    }

    testEnv = createTestComponent(ShortComp, {
      '.btn': { click: xs.of({}) },
    })

    await settle(100)
    expect(effectRan).toBe(true)
  })

  it('works with EVENTS sink', async () => {
    const events = []

    function ShortComp() {
      return createElement('div', null, 'test')
    }
    ShortComp.initialState = {}
    ShortComp.intent = ({ DOM }) => ({
      NOTIFY: DOM.select('.btn').events('click'),
    })
    ShortComp.model = {
      'NOTIFY | EVENTS': () => ({ type: 'test-event', data: 'hello' }),
    }

    testEnv = createTestComponent(ShortComp, {
      '.btn': { click: xs.of({}) },
    })

    testEnv.sinks.EVENTS.addListener({
      next: v => events.push(v),
      error: () => {},
    })

    await settle(100)
    expect(events.some(e => e.type === 'test-event')).toBe(true)
  })

  it('works with whitespace around pipe', async () => {
    let effectRan = false

    function ShortComp() {
      return createElement('div', null, 'test')
    }
    ShortComp.initialState = {}
    ShortComp.intent = ({ DOM }) => ({
      ACT: DOM.select('.btn').events('click'),
    })
    ShortComp.model = {
      '  ACT   |   EFFECT  ': () => { effectRan = true },
    }

    testEnv = createTestComponent(ShortComp, {
      '.btn': { click: xs.of({}) },
    })

    await settle(100)
    expect(effectRan).toBe(true)
  })

  it('throws on invalid shorthand format', () => {
    function BadComp() {
      return createElement('div', null, 'test')
    }
    BadComp.initialState = {}
    BadComp.intent = ({ DOM }) => ({
      ACT: DOM.select('.btn').events('click'),
    })
    BadComp.model = {
      'ACT|': () => {},
    }

    expect(() => {
      createTestComponent(BadComp, {
        '.btn': { click: xs.of({}) },
      })
    }).toThrow('Invalid shorthand')
  })

  it('throws if intent action name contains pipe', () => {
    function BadComp() {
      return createElement('div', null, 'test')
    }
    BadComp.initialState = {}
    BadComp.intent = ({ DOM }) => ({
      'MY|ACTION': DOM.select('.btn').events('click'),
    })
    BadComp.model = {
      'MY|ACTION': (state) => state,
    }

    expect(() => {
      createTestComponent(BadComp, {
        '.btn': { click: xs.of({}) },
      })
    }).toThrow("contains '|'")
  })

  it('can mix shorthand and longhand in the same model', async () => {
    let effectRan = false

    function MixComp() {
      return createElement('div', null, 'test')
    }
    MixComp.initialState = { count: 0 }
    MixComp.intent = ({ DOM }) => ({
      INCREMENT: DOM.select('.inc').events('click'),
      SIDE_EFFECT: DOM.select('.fx').events('click'),
    })
    MixComp.model = {
      // Longhand (regular state reducer)
      INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
      // Shorthand
      'SIDE_EFFECT | EFFECT': () => { effectRan = true },
    }

    testEnv = createTestComponent(MixComp, {
      '.inc': { click: xs.of({}) },
      '.fx': { click: xs.of({}) },
    })

    await settle(100)
    expect(effectRan).toBe(true)
    const last = testEnv.states[testEnv.states.length - 1]
    expect(last.count).toBe(1)
  })

  it('warns on duplicate action/sink from shorthand and longhand', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    function DupComp() {
      return createElement('div', null, 'test')
    }
    DupComp.initialState = {}
    DupComp.intent = ({ DOM }) => ({
      FIRE: DOM.select('.btn').events('click'),
    })
    DupComp.model = {
      FIRE: {
        EFFECT: () => {},
      },
      'FIRE | EFFECT': () => {},
    }

    const env = createTestComponent(DupComp, {
      '.btn': { click: xs.never() },
    })

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Duplicate model entry for action 'FIRE' on sink 'EFFECT'"),
    )

    env.dispose()
    warnSpy.mockRestore()
  })

  it('warns on duplicate action/sink from two shorthand entries', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    function DupComp() {
      return createElement('div', null, 'test')
    }
    DupComp.initialState = {}
    DupComp.intent = ({ DOM }) => ({
      ACT: DOM.select('.btn').events('click'),
    })
    DupComp.model = {
      'ACT | EVENTS': () => ({ type: 'a', data: 1 }),
      ' ACT|EVENTS ': () => ({ type: 'b', data: 2 }),
    }

    const env = createTestComponent(DupComp, {
      '.btn': { click: xs.never() },
    })

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Duplicate model entry for action 'ACT' on sink 'EVENTS'"),
    )

    env.dispose()
    warnSpy.mockRestore()
  })

  it('warns on duplicate when plain function overlaps shorthand STATE', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    function DupComp() {
      return createElement('div', null, 'test')
    }
    DupComp.initialState = { x: 0 }
    DupComp.intent = ({ DOM }) => ({
      ACT: DOM.select('.btn').events('click'),
    })
    DupComp.model = {
      ACT: (state) => ({ ...state, x: 1 }),
      'ACT | STATE': (state) => ({ ...state, x: 2 }),
    }

    const env = createTestComponent(DupComp, {
      '.btn': { click: xs.never() },
    })

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Duplicate model entry for action 'ACT' on sink 'STATE'"),
    )

    env.dispose()
    warnSpy.mockRestore()
  })

  it('does not warn when different actions target the same sink', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    function OkComp() {
      return createElement('div', null, 'test')
    }
    OkComp.initialState = {}
    OkComp.intent = ({ DOM }) => ({
      A: DOM.select('.a').events('click'),
      B: DOM.select('.b').events('click'),
    })
    OkComp.model = {
      'A | EFFECT': () => {},
      'B | EFFECT': () => {},
    }

    const env = createTestComponent(OkComp, {
      '.a': { click: xs.never() },
      '.b': { click: xs.never() },
    })

    const dupWarns = warnSpy.mock.calls.filter(c => c[0]?.includes?.('Duplicate'))
    expect(dupWarns).toHaveLength(0)

    env.dispose()
    warnSpy.mockRestore()
  })
})
