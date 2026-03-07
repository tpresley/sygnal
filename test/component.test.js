import { describe, it, expect, afterEach } from 'vitest'
import { setup } from '@cycle/run'
import { withState } from '@cycle/state'
import { mockDOMSource } from '@cycle/dom'
import xs from 'xstream'

// Ensure `window` is defined so component.js `window?.` optional chaining
// doesn't throw ReferenceError in Node (where `window` is undeclared).
if (typeof globalThis.window === 'undefined') {
  globalThis.window = undefined
}

import component, { ABORT } from '../src/component.js'
import eventBusDriver from '../src/extra/eventDriver.js'
import logDriver from '../src/extra/logDriver.js'
import { createElement } from '../src/pragma/index.js'


// ─── Test helper ───────────────────────────────────────────────────────────────

function createTestComponent(componentDef, mockConfig = {}) {
  const name = componentDef.name || 'TestComponent'
  const view = componentDef
  const {
    intent,
    model,
    context,
    initialState,
    calculated,
    storeCalculatedInState,
  } = componentDef

  const app = component({
    name,
    view,
    intent,
    model,
    context,
    initialState,
    calculated,
    storeCalculatedInState,
  })

  const wrapped = withState(app, 'STATE')

  const mockDOM = () => mockDOMSource(mockConfig)

  const { sources, sinks, run: _run } = setup(wrapped, {
    DOM: mockDOM,
    EVENTS: eventBusDriver,
    LOG: logDriver,
  })

  const dispose = _run()

  // Helper: collect state values
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

  // Helper: collect vnode output
  const vnodes = []
  let vnodeListener
  if (sinks.DOM) {
    vnodeListener = {
      next: v => vnodes.push(v),
      error: () => {},
      complete: () => {},
    }
    sinks.DOM.addListener(vnodeListener)
  }

  return {
    sources,
    sinks,
    states,
    vnodes,
    dispose() {
      if (stateListener && sources.STATE?.stream) {
        sources.STATE.stream.removeListener(stateListener)
      }
      if (vnodeListener && sinks.DOM) {
        sinks.DOM.removeListener(vnodeListener)
      }
      dispose()
    },
  }
}

// Wait for async stream pipeline to settle
const settle = (ms = 60) => new Promise(r => setTimeout(r, ms))


// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('component integration (mockDOMSource)', () => {
  let testEnv

  afterEach(() => {
    if (testEnv) {
      testEnv.dispose()
      testEnv = null
    }
  })


  describe('basic state initialization', () => {
    it('initializes state from initialState', async () => {
      function MyComponent({ state }) {
        return createElement('div', null, String(state.count))
      }
      MyComponent.initialState = { count: 0 }

      testEnv = createTestComponent(MyComponent)
      await settle()

      expect(testEnv.states.length).toBeGreaterThan(0)
      expect(testEnv.states[testEnv.states.length - 1]).toEqual({ count: 0 })
    })

    it('state with multiple fields initializes correctly', async () => {
      function Multi({ state }) {
        return createElement('div', null, `${state.name}-${state.age}`)
      }
      Multi.initialState = { name: 'Alice', age: 30 }

      testEnv = createTestComponent(Multi)
      await settle()

      const lastState = testEnv.states[testEnv.states.length - 1]
      expect(lastState.name).toBe('Alice')
      expect(lastState.age).toBe(30)
    })
  })


  describe('intent → model → state', () => {
    it('processes a click event through intent and model', async () => {
      function Counter({ state }) {
        return createElement('div', null,
          createElement('span', { className: 'count' }, String(state.count)),
          createElement('button', { className: 'increment' }, '+'),
        )
      }
      Counter.initialState = { count: 0 }
      Counter.intent = ({ DOM }) => ({
        INCREMENT: DOM.select('.increment').events('click'),
      })
      Counter.model = {
        INCREMENT: (state) => ({ count: state.count + 1 }),
      }

      testEnv = createTestComponent(Counter, {
        '.increment': {
          click: xs.of({}),
        },
      })
      await settle()

      const lastState = testEnv.states[testEnv.states.length - 1]
      expect(lastState.count).toBe(1)
    })

    it('processes multiple events from a single intent', async () => {
      function Counter({ state }) {
        return createElement('div', null, String(state.count))
      }
      Counter.initialState = { count: 0 }
      Counter.intent = ({ DOM }) => ({
        INCREMENT: DOM.select('.btn').events('click'),
      })
      Counter.model = {
        INCREMENT: (state) => ({ count: state.count + 1 }),
      }

      // Emit 3 click events
      const click$ = xs.of({}, {}, {})

      testEnv = createTestComponent(Counter, {
        '.btn': { click: click$ },
      })
      await settle()

      const lastState = testEnv.states[testEnv.states.length - 1]
      expect(lastState.count).toBe(3)
    })
  })


  describe('multiple actions', () => {
    it('handles INCREMENT and DECREMENT', async () => {
      function Counter({ state }) {
        return createElement('div', null, String(state.count))
      }
      Counter.initialState = { count: 10 }
      Counter.intent = ({ DOM }) => ({
        INCREMENT: DOM.select('.inc').events('click'),
        DECREMENT: DOM.select('.dec').events('click'),
      })
      Counter.model = {
        INCREMENT: (state) => ({ count: state.count + 1 }),
        DECREMENT: (state) => ({ count: state.count - 1 }),
      }

      testEnv = createTestComponent(Counter, {
        '.inc': { click: xs.of({}) },
        '.dec': { click: xs.of({}, {}) },
      })
      await settle()

      const lastState = testEnv.states[testEnv.states.length - 1]
      // +1 from increment, -2 from decrement = 10 + 1 - 2 = 9
      expect(lastState.count).toBe(9)
    })
  })


  describe('ABORT handling', () => {
    it('leaves state unchanged when reducer returns ABORT', async () => {
      function Guarded({ state }) {
        return createElement('div', null, String(state.count))
      }
      Guarded.initialState = { count: 5 }
      Guarded.intent = ({ DOM }) => ({
        TRY_DECREMENT: DOM.select('.btn').events('click'),
      })
      Guarded.model = {
        TRY_DECREMENT: (state) => {
          if (state.count <= 0) return ABORT
          return { count: state.count - 1 }
        },
      }

      testEnv = createTestComponent(Guarded, {
        '.btn': { click: xs.of({}) },
      })
      await settle()

      const lastState = testEnv.states[testEnv.states.length - 1]
      expect(lastState.count).toBe(4) // 5 - 1 = 4, not ABORTed
    })

    it('ABORT prevents state change when condition met', async () => {
      function Guarded({ state }) {
        return createElement('div', null, String(state.count))
      }
      Guarded.initialState = { count: 0 }
      Guarded.intent = ({ DOM }) => ({
        TRY_DECREMENT: DOM.select('.btn').events('click'),
      })
      Guarded.model = {
        TRY_DECREMENT: (state) => {
          if (state.count <= 0) return ABORT
          return { count: state.count - 1 }
        },
      }

      testEnv = createTestComponent(Guarded, {
        '.btn': { click: xs.of({}) },
      })
      await settle()

      const lastState = testEnv.states[testEnv.states.length - 1]
      expect(lastState.count).toBe(0) // Was 0, ABORT prevented change
    })
  })


  describe('calculated fields integration', () => {
    it('calculated values appear in state passed to view', async () => {
      let viewReceivedState = null

      function Calc({ state }) {
        viewReceivedState = { ...state }
        return createElement('div', null, String(state.total))
      }
      Calc.initialState = { price: 10, qty: 3 }
      Calc.calculated = {
        total: (state) => state.price * state.qty,
      }

      testEnv = createTestComponent(Calc)
      await settle()

      expect(viewReceivedState).toBeDefined()
      expect(viewReceivedState.total).toBe(30)
    })

    it('calculated fields with dependency tracking', async () => {
      let viewReceivedState = null

      function CalcDeps({ state }) {
        viewReceivedState = { ...state }
        return createElement('div', null, String(state.total))
      }
      CalcDeps.initialState = { price: 10, qty: 2 }
      CalcDeps.calculated = {
        subtotal: [['price', 'qty'], (state) => state.price * state.qty],
        tax:      [['subtotal'],     (state) => state.subtotal * 0.1],
        total:    [['subtotal', 'tax'], (state) => state.subtotal + state.tax],
      }

      testEnv = createTestComponent(CalcDeps)
      await settle()

      expect(viewReceivedState).toBeDefined()
      expect(viewReceivedState.subtotal).toBe(20)
      expect(viewReceivedState.tax).toBe(2)
      expect(viewReceivedState.total).toBe(22)
    })

    it('calculated fields update when state changes', async () => {
      let viewReceivedState = null

      function CalcUpdate({ state }) {
        viewReceivedState = { ...state }
        return createElement('div', null,
          createElement('button', { className: 'add' }, '+'),
          String(state.doubled),
        )
      }
      CalcUpdate.initialState = { value: 5 }
      CalcUpdate.intent = ({ DOM }) => ({
        ADD: DOM.select('.add').events('click'),
      })
      CalcUpdate.model = {
        ADD: (state) => ({ ...state, value: state.value + 1 }),
      }
      CalcUpdate.calculated = {
        doubled: [['value'], (state) => state.value * 2],
      }

      testEnv = createTestComponent(CalcUpdate, {
        '.add': { click: xs.of({}) },
      })
      await settle()

      expect(viewReceivedState.value).toBe(6) // 5 + 1
      expect(viewReceivedState.doubled).toBe(12) // 6 * 2
    })
  })


  describe('context', () => {
    it('context values are derived from state', async () => {
      let viewReceivedContext = null

      function WithContext({ state, context }) {
        viewReceivedContext = { ...context }
        return createElement('div', null, String(state.count))
      }
      WithContext.initialState = { count: 42 }
      WithContext.context = {
        doubled: (state) => state.count * 2,
        isPositive: (state) => state.count > 0,
      }

      testEnv = createTestComponent(WithContext)
      await settle()

      expect(viewReceivedContext).toBeDefined()
      expect(viewReceivedContext.doubled).toBe(84)
      expect(viewReceivedContext.isPositive).toBe(true)
    })

    it('context updates when state changes', async () => {
      let viewReceivedContext = null

      function CtxUpdate({ state, context }) {
        viewReceivedContext = { ...context }
        return createElement('div', null,
          createElement('button', { className: 'inc' }, '+'),
          String(context.label),
        )
      }
      CtxUpdate.initialState = { count: 0 }
      CtxUpdate.intent = ({ DOM }) => ({
        INCREMENT: DOM.select('.inc').events('click'),
      })
      CtxUpdate.model = {
        INCREMENT: (state) => ({ count: state.count + 1 }),
      }
      CtxUpdate.context = {
        label: (state) => `Count is ${state.count}`,
      }

      testEnv = createTestComponent(CtxUpdate, {
        '.inc': { click: xs.of({}) },
      })
      await settle()

      expect(viewReceivedContext.label).toBe('Count is 1')
    })
  })


  describe('EVENTS driver round-trip', () => {
    it('component emits and receives EVENTS', async () => {
      const receivedEvents = []

      function EventComp({ state }) {
        return createElement('div', null,
          createElement('button', { className: 'emit' }, 'emit'),
        )
      }
      EventComp.initialState = { value: 'hello' }
      EventComp.intent = ({ DOM, EVENTS }) => ({
        EMIT: DOM.select('.emit').events('click'),
        RECEIVED: EVENTS.select('MY_EVENT'),
      })
      EventComp.model = {
        EMIT: {
          EVENTS: (state) => ({ type: 'MY_EVENT', data: state.value }),
          STATE: (state) => state,
        },
        RECEIVED: (state, data) => ({ ...state, received: data }),
      }

      testEnv = createTestComponent(EventComp, {
        '.emit': { click: xs.of({}) },
      })

      // Also listen on the EVENTS source directly
      testEnv.sources.EVENTS.select('MY_EVENT').addListener({
        next: v => receivedEvents.push(v),
        error: () => {},
        complete: () => {},
      })

      await settle()

      expect(receivedEvents.length).toBeGreaterThan(0)
      expect(receivedEvents[0]).toBe('hello')
    })
  })


  describe('data rewriting in intent', () => {
    it('intent .map() extracts data from events', async () => {
      function Input({ state }) {
        return createElement('div', null,
          createElement('input', { className: 'name-input' }),
          createElement('span', null, state.name),
        )
      }
      Input.initialState = { name: 'World' }
      Input.intent = ({ DOM }) => ({
        CHANGE_NAME: DOM.select('.name-input')
          .events('input')
          .map(e => e.target.value),
      })
      Input.model = {
        CHANGE_NAME: (state, data) => ({ name: data }),
      }

      testEnv = createTestComponent(Input, {
        '.name-input': {
          input: xs.of({ target: { value: 'Sygnal' } }),
        },
      })
      await settle()

      const lastState = testEnv.states[testEnv.states.length - 1]
      expect(lastState.name).toBe('Sygnal')
    })

    it('intent .map() extracts multiple data values', async () => {
      function Form({ state }) {
        return createElement('div', null, state.field)
      }
      Form.initialState = { field: '' }
      Form.intent = ({ DOM }) => ({
        UPDATE: DOM.select('.input')
          .events('input')
          .map(e => e.target.value),
      })
      Form.model = {
        UPDATE: (state, data) => ({ field: data }),
      }

      // Simulate typing "abc" — three input events
      const input$ = xs.of(
        { target: { value: 'a' } },
        { target: { value: 'ab' } },
        { target: { value: 'abc' } },
      )

      testEnv = createTestComponent(Form, {
        '.input': { input: input$ },
      })
      await settle()

      const lastState = testEnv.states[testEnv.states.length - 1]
      expect(lastState.field).toBe('abc')
    })
  })


  describe('view output', () => {
    it('produces vnode output on the DOM sink', async () => {
      function Simple({ state }) {
        return createElement('div', { className: 'root' },
          createElement('h1', null, `Hello ${state.name}`),
        )
      }
      Simple.initialState = { name: 'World' }

      testEnv = createTestComponent(Simple)
      await settle()

      expect(testEnv.vnodes.length).toBeGreaterThan(0)
      const vnode = testEnv.vnodes[testEnv.vnodes.length - 1]
      expect(vnode.sel).toContain('div')
    })

    it('view updates when state changes', async () => {
      function Updatable({ state }) {
        return createElement('div', null,
          createElement('span', { className: 'value' }, String(state.count)),
          createElement('button', { className: 'inc' }, '+'),
        )
      }
      Updatable.initialState = { count: 0 }
      Updatable.intent = ({ DOM }) => ({
        INCREMENT: DOM.select('.inc').events('click'),
      })
      Updatable.model = {
        INCREMENT: (state) => ({ count: state.count + 1 }),
      }

      testEnv = createTestComponent(Updatable, {
        '.inc': { click: xs.of({}) },
      })
      await settle()

      // Should have at least 2 vnodes — initial render + after increment
      expect(testEnv.vnodes.length).toBeGreaterThanOrEqual(2)
    })
  })


  describe('DOM source Proxy shorthand', () => {
    it('DOM.click(".selector") works as shorthand', async () => {
      function ShorthandComp({ state }) {
        return createElement('div', null, String(state.count))
      }
      ShorthandComp.initialState = { count: 0 }
      ShorthandComp.intent = ({ DOM }) => ({
        // Use the Proxy shorthand: DOM.click('.btn') instead of DOM.select('.btn').events('click')
        INCREMENT: DOM.click('.btn'),
      })
      ShorthandComp.model = {
        INCREMENT: (state) => ({ count: state.count + 1 }),
      }

      testEnv = createTestComponent(ShorthandComp, {
        '.btn': { click: xs.of({}) },
      })
      await settle()

      const lastState = testEnv.states[testEnv.states.length - 1]
      expect(lastState.count).toBe(1)
    })
  })


  describe('model with multi-sink entries', () => {
    it('model entry can target both STATE and EVENTS sinks', async () => {
      const emittedEvents = []

      function MultiSink({ state }) {
        return createElement('div', null,
          createElement('button', { className: 'action' }, 'go'),
        )
      }
      MultiSink.initialState = { count: 0 }
      MultiSink.intent = ({ DOM }) => ({
        DO_THING: DOM.select('.action').events('click'),
      })
      MultiSink.model = {
        DO_THING: {
          STATE: (state) => ({ count: state.count + 1 }),
          EVENTS: (state) => ({ type: 'THING_DONE', data: { count: state.count + 1 } }),
        },
      }

      testEnv = createTestComponent(MultiSink, {
        '.action': { click: xs.of({}) },
      })

      testEnv.sources.EVENTS.select('THING_DONE').addListener({
        next: v => emittedEvents.push(v),
        error: () => {},
        complete: () => {},
      })

      await settle()

      const lastState = testEnv.states[testEnv.states.length - 1]
      expect(lastState.count).toBe(1)
      expect(emittedEvents.length).toBeGreaterThan(0)
    })
  })


  describe('BOOTSTRAP action', () => {
    it('BOOTSTRAP model runs on component initialization', async () => {
      function BootComp({ state }) {
        return createElement('div', null, String(state.ready))
      }
      BootComp.initialState = { ready: false }
      // BOOTSTRAP requires an intent (it's wired into the action$ stream which
      // only exists when intent is defined)
      BootComp.intent = ({ DOM }) => ({
        _NOOP: DOM.select('.__noop__').events('click'),
      })
      BootComp.model = {
        BOOTSTRAP: (state) => ({ ...state, ready: true }),
      }

      testEnv = createTestComponent(BootComp)
      await settle()

      const lastState = testEnv.states[testEnv.states.length - 1]
      expect(lastState.ready).toBe(true)
    })
  })


  describe('reducer receives event data', () => {
    it('model reducer receives data from intent', async () => {
      function DataComp({ state }) {
        return createElement('div', null, state.message)
      }
      DataComp.initialState = { message: '' }
      DataComp.intent = ({ DOM }) => ({
        SET_MESSAGE: DOM.select('.input').events('input')
          .map(e => e.target.value),
      })
      DataComp.model = {
        SET_MESSAGE: (state, data) => ({ message: data }),
      }

      testEnv = createTestComponent(DataComp, {
        '.input': {
          input: xs.of({ target: { value: 'hello world' } }),
        },
      })
      await settle()

      const lastState = testEnv.states[testEnv.states.length - 1]
      expect(lastState.message).toBe('hello world')
    })
  })


  describe('error messages include component name', () => {
    it('sources validation error includes component name', () => {
      expect(() => {
        component({
          name: 'BadSources',
          view: () => createElement('div'),
        })('not-a-sources-object')
      }).toThrow('[BadSources]')
    })

    it('sources validation error for null sources includes name', () => {
      expect(() => {
        component({
          name: 'NullSources',
          view: () => createElement('div'),
        })(null)
      }).toThrow('[NullSources]')
    })

    it('intent validation error includes component name', () => {
      function BadIntent({ state }) {
        return createElement('div', null, 'test')
      }
      BadIntent.initialState = { x: 1 }
      BadIntent.intent = 'not a function'

      expect(() => {
        createTestComponent(BadIntent)
      }).toThrow('[BadIntent]')
    })

    it('intent return type error includes component name', () => {
      function BadReturn({ state }) {
        return createElement('div', null, 'test')
      }
      BadReturn.initialState = { x: 1 }
      BadReturn.intent = () => 'not an object or stream'

      expect(() => {
        createTestComponent(BadReturn)
      }).toThrow('[BadReturn]')
    })
  })


  describe('component with no intent/model (view-only)', () => {
    it('renders initial state without actions', async () => {
      function ViewOnly({ state }) {
        return createElement('div', null, `Hello ${state.name}`)
      }
      ViewOnly.initialState = { name: 'World' }

      testEnv = createTestComponent(ViewOnly)
      await settle()

      expect(testEnv.states.length).toBeGreaterThan(0)
      expect(testEnv.states[testEnv.states.length - 1].name).toBe('World')
    })
  })


  describe('component ID uniqueness', () => {
    it('same-name components under different non-component parents do not collide', async () => {
      let renderCount = 0

      function Child({ state }) {
        renderCount++
        return createElement('span', null, String(state.value))
      }
      Child.initialState = { value: 0 }

      function IDParent({ state }) {
        return createElement('div', null,
          createElement('div', null,
            createElement('span', null, 'spacer'),
            createElement(Child, null),
          ),
          createElement('div', null,
            createElement(Child, null),
          ),
        )
      }
      IDParent.initialState = {}
      IDParent.intent = ({ DOM }) => ({
        _NOOP: DOM.select('.__noop__').events('click'),
      })
      IDParent.model = {}

      testEnv = createTestComponent(IDParent)
      await settle()

      // Both Child instances should be instantiated — if IDs collide, only one renders
      expect(renderCount).toBeGreaterThanOrEqual(2)
    })
  })
})
