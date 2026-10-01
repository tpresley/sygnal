import { describe, it, expect } from 'vitest'
import xs from 'xstream'
import { set, toggle, emit, event } from '../src/extra/reducers.js'
import { setup } from '../src/cycle/run/index'
import { withState } from '../src/cycle/state/index'
import { mockDOMSource } from '../src/cycle/dom/index'

// Ensure `window` is defined so component.js `window?.` optional chaining
// doesn't throw ReferenceError in Node (where `window` is undeclared).
if (typeof globalThis.window === 'undefined') {
  globalThis.window = undefined
}

import component from '../src/component.js'
import eventBusDriver from '../src/extra/eventDriver.js'
import logDriver from '../src/extra/logDriver.js'
import { createElement } from '../src/pragma/index.js'

describe('set()', () => {
  it('merges a static partial object into state', () => {
    const reducer = set({ isEditing: true })
    const state = { name: 'foo', isEditing: false }
    expect(reducer(state)).toEqual({ name: 'foo', isEditing: true })
  })

  it('does not mutate the original state', () => {
    const state = { a: 1, b: 2 }
    const reducer = set({ b: 3 })
    const next = reducer(state)
    expect(state.b).toBe(2)
    expect(next.b).toBe(3)
  })

  it('accepts a dynamic function that receives (state, data)', () => {
    const reducer = set((state, title) => ({ title }))
    const result = reducer({ title: 'old', count: 5 }, 'new')
    expect(result).toEqual({ title: 'new', count: 5 })
  })

  it('passes next and props to dynamic function', () => {
    let captured = {}
    const nextFn = () => {}
    const props = { x: 1 }
    const reducer = set((_state, _data, next, props) => {
      captured = { next, props }
      return { updated: true }
    })
    reducer({ updated: false }, null, nextFn, props)
    expect(captured.next).toBe(nextFn)
    expect(captured.props).toBe(props)
  })

  it('merges multiple fields from static object', () => {
    const reducer = set({ a: 10, b: 20 })
    expect(reducer({ a: 1, b: 2, c: 3 })).toEqual({ a: 10, b: 20, c: 3 })
  })
})

describe('toggle()', () => {
  it('flips a false field to true', () => {
    const reducer = toggle('visible')
    expect(reducer({ visible: false })).toEqual({ visible: true })
  })

  it('flips a true field to false', () => {
    const reducer = toggle('visible')
    expect(reducer({ visible: true })).toEqual({ visible: false })
  })

  it('preserves other state fields', () => {
    const reducer = toggle('open')
    expect(reducer({ open: false, name: 'x' })).toEqual({ open: true, name: 'x' })
  })

  it('does not mutate original state', () => {
    const state = { flag: true }
    toggle('flag')(state)
    expect(state.flag).toBe(true)
  })
})

describe('emit()', () => {
  it('returns a model entry with EVENTS sink', () => {
    const entry = emit('REFRESH')
    expect(entry).toHaveProperty('EVENTS')
    expect(typeof entry.EVENTS).toBe('function')
  })

  it('emits type with no data when called with type only', () => {
    const entry = emit('REFRESH')
    expect(entry.EVENTS({})).toEqual({ type: 'REFRESH', data: undefined })
  })

  it('emits type with static data', () => {
    const entry = emit('DELETE', { id: 42 })
    expect(entry.EVENTS({})).toEqual({ type: 'DELETE', data: { id: 42 } })
  })

  it('emits type with dynamic data from state', () => {
    const entry = emit('DELETE_LANE', (state) => ({ laneId: state.id }))
    expect(entry.EVENTS({ id: 7 })).toEqual({
      type: 'DELETE_LANE',
      data: { laneId: 7 },
    })
  })

  it('passes actionData to dynamic function', () => {
    const entry = emit('MOVE', (_state, actionData) => ({ pos: actionData }))
    expect(entry.EVENTS({ id: 1 }, 'left')).toEqual({
      type: 'MOVE',
      data: { pos: 'left' },
    })
  })
})

describe('event()', () => {
  it('returns a sink function, not a model entry', () => {
    const sink = event('REFRESH')
    expect(typeof sink).toBe('function')
    expect(sink).not.toHaveProperty('EVENTS')
  })

  it('emits type with undefined data when called with type only', () => {
    expect(event('RESET')({})).toEqual({ type: 'RESET', data: undefined })
  })

  it('emits a static payload', () => {
    expect(event('SET_MODE', 'dark')({})).toEqual({ type: 'SET_MODE', data: 'dark' })
    const payload = { id: 42 }
    expect(event('DELETE', payload)({}).data).toBe(payload)
  })

  it('keeps falsy static payloads', () => {
    expect(event('COUNT', 0)({})).toEqual({ type: 'COUNT', data: 0 })
    expect(event('FLAG', false)({})).toEqual({ type: 'FLAG', data: false })
    expect(event('NOTHING', null)({})).toEqual({ type: 'NOTHING', data: null })
  })

  it('computes a dynamic payload from state', () => {
    const sink = event('DELETE_LANE', (state) => ({ laneId: state.id }))
    expect(sink({ id: 7 })).toEqual({ type: 'DELETE_LANE', data: { laneId: 7 } })
  })

  it('passes (state, data, next, props) to the payload function', () => {
    let captured
    const nextFn = () => {}
    const props = { p: 1 }
    const state = { s: 1 }
    const sink = event('MOVE', (...args) => {
      captured = args
      return 'ok'
    })
    expect(sink(state, 'left', nextFn, props)).toEqual({ type: 'MOVE', data: 'ok' })
    expect(captured[0]).toBe(state)
    expect(captured[1]).toBe('left')
    expect(captured[2]).toBe(nextFn)
    expect(captured[3]).toBe(props)
  })

  it('emit() is equivalent to { EVENTS: event() }', () => {
    const fn = (state, data) => ({ id: state.id, data })
    expect(emit('X', fn).EVENTS({ id: 3 }, 'd')).toEqual(event('X', fn)({ id: 3 }, 'd'))
    expect(emit('Y', 5).EVENTS({})).toEqual(event('Y', 5)({}))
    expect(emit('Z').EVENTS({})).toEqual(event('Z')({}))
  })

  it('is exported from the package entry', async () => {
    const sygnal = await import('../src/index.ts')
    expect(sygnal.event).toBe(event)
  })
})

describe('event() runtime integration', () => {
  const settle = (ms = 100) => new Promise((r) => setTimeout(r, ms))

  function runApp(App) {
    const app = component({
      name: App.name,
      view: App,
      intent: App.intent,
      model: App.model,
      initialState: App.initialState,
    })
    const { sources, sinks, run: start } = setup(withState(app, 'STATE'), {
      DOM: () => mockDOMSource({}),
      EVENTS: eventBusDriver,
      LOG: logDriver,
    })
    const dispose = start()
    // Keep the DOM sink subscribed so sub-components get instantiated
    const domListener = { next: () => {}, error: () => {}, complete: () => {} }
    sinks.DOM.addListener(domListener)
    return {
      sources,
      dispose() {
        sinks.DOM.removeListener(domListener)
        dispose()
      },
    }
  }

  it('an EVENTS emission via event() reaches EVENTS.select in another component', async () => {
    const received = []

    // Emitter: object-form entry combining STATE with EVENTS: event(...)
    function Emitter({ state }) {
      return createElement('div', { className: 'emitter' }, String(state.count))
    }
    Emitter.intent = () => ({ FIRE: xs.periodic(20).take(1).mapTo('clicked') })
    Emitter.model = {
      FIRE: {
        STATE: (state) => ({ ...state, count: state.count + 1 }),
        EVENTS: event('DELETE_LANE', (state, data, _next, props) => ({
          laneId: props.laneId,
          count: state.count,
          via: data,
        })),
      },
    }

    // Receiver: a sibling subscribing to the event on the bus
    function Receiver() {
      return createElement('div', { className: 'receiver' })
    }
    Receiver.intent = ({ EVENTS }) => ({ GOT: EVENTS.select('DELETE_LANE') })
    Receiver.model = {
      GOT: { EFFECT: (_state, data) => { received.push(data) } },
    }

    // Emitter shares the parent's state (no isolatedState); laneId comes in as a prop
    function App() {
      return createElement('div', null, createElement(Emitter, { laneId: 'lane-1' }), createElement(Receiver))
    }
    App.initialState = { count: 0 }

    const appEnv = runApp(App)
    const busEvents = []
    appEnv.sources.EVENTS.select('DELETE_LANE').addListener({
      next: (d) => busEvents.push(d),
      error: () => {},
      complete: () => {},
    })

    await settle(150)
    appEnv.dispose()

    expect(received).toEqual([{ laneId: 'lane-1', count: 0, via: 'clicked' }])
    expect(busEvents).toEqual([{ laneId: 'lane-1', count: 0, via: 'clicked' }])
  })

  it('a static-payload event() reaches EVENTS.select', async () => {
    const received = []

    function Emitter() { return createElement('div') }
    Emitter.intent = () => ({ GO: xs.periodic(20).take(1) })
    Emitter.model = { GO: { EVENTS: event('SET_MODE', 'dark') } }

    function Receiver() { return createElement('div') }
    Receiver.intent = ({ EVENTS }) => ({ MODE: EVENTS.select('SET_MODE') })
    Receiver.model = { MODE: { EFFECT: (_s, mode) => { received.push(mode) } } }

    function App() {
      return createElement('div', null, createElement(Emitter), createElement(Receiver))
    }
    App.initialState = {}

    const appEnv = runApp(App)
    await settle(150)
    appEnv.dispose()

    expect(received).toEqual(['dark'])
  })
})
