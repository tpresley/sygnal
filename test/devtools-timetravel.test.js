import { describe, it, expect, vi, beforeEach } from 'vitest'
import xs from 'xstream'
import { renderComponent } from '../dist/index.esm.js'

// Simulate the exact pattern used in _timeTravel:
// Push a reducer via shamefullySendNext on a merged stream

describe('devtools time-travel mechanism', () => {

  it('shamefullySendNext on a plain stream works', () => {
    const results = []
    const s = xs.create()
    s.subscribe({ next: v => results.push(v) })
    s.shamefullySendNext('hello')
    expect(results).toEqual(['hello'])
  })

  it('shamefullySendNext on xs.merge() stream — does it propagate?', () => {
    const results = []
    const a$ = xs.create()
    const b$ = xs.create()
    const merged$ = xs.merge(a$, b$)
    merged$.subscribe({ next: v => results.push(v) })

    // This is what _timeTravel does — pushes directly onto the merged stream
    merged$.shamefullySendNext('injected')
    expect(results).toEqual(['injected'])
  })

  it('shamefullySendNext on merge with filter chain', () => {
    const results = []
    const a$ = xs.create()
    const b$ = xs.never()
    const merged$ = xs.merge(a$, b$, xs.never())
    merged$.subscribe({ next: v => results.push(v) })

    merged$.shamefullySendNext('injected')
    expect(results).toEqual(['injected'])
  })

  it('reducer pushed via shamefullySendNext works through fold (state driver pattern)', () => {
    const states = []
    const reducer$ = xs.create()
    const state$ = reducer$.fold((state, reducer) => reducer(state), { count: 0 })
    state$.subscribe({ next: s => states.push(s) })

    // Normal reducer push
    reducer$.shamefullySendNext(s => ({ ...s, count: s.count + 1 }))
    expect(states).toEqual([{ count: 0 }, { count: 1 }])

    // Now simulate time-travel: push a replacement reducer
    const targetState = { count: 42 }
    reducer$.shamefullySendNext(() => ({ ...targetState }))
    expect(states).toEqual([{ count: 0 }, { count: 1 }, { count: 42 }])
  })

  it('reducer pushed on MERGED stream through fold — the actual pattern', () => {
    const states = []
    const model$ = xs.create()       // model reducers
    const subComp$ = xs.never()       // sub-component sinks
    const stateFilter$ = xs.never()   // the stream.filter(() => false) from component.ts

    // This mirrors initSinks() in component.ts:
    // acc[name] = xs.merge(model$, subComponentSink$, state$.filter(() => false))
    const stateSink = xs.merge(model$, subComp$, stateFilter$)

    // The state driver subscribes via fold
    const state$ = stateSink.fold((state, reducer) => reducer(state), { count: 0 })
    state$.subscribe({ next: s => states.push(s) })

    // Normal model action
    model$.shamefullySendNext(s => ({ ...s, count: 1 }))
    expect(states[states.length - 1]).toEqual({ count: 1 })

    // Time-travel: push directly on the merged stateSink (what devtools does)
    stateSink.shamefullySendNext(() => ({ count: 99 }))
    expect(states[states.length - 1]).toEqual({ count: 99 })
  })

  it('reducer on merged stream does NOT propagate when merged stream has no direct subscribers but fold does', () => {
    // More realistic: the fold subscribes to stateSink, but we also need to check
    // if shamefullySendNext bypasses the merge operator
    const states = []
    const model$ = xs.create()
    const stateSink = xs.merge(model$, xs.never())

    // withState wraps with fold internally
    const state$ = stateSink.fold((state, reducer) => {
      return typeof reducer === 'function' ? reducer(state) : state
    }, { count: 0 })
    state$.subscribe({ next: s => states.push(s) })

    // Time-travel attempt
    stateSink.shamefullySendNext(() => ({ count: 77 }))

    // Did it work?
    const lastState = states[states.length - 1]
    console.log('States after shamefullySendNext on merged stream:', JSON.stringify(states))
    console.log('Last state:', JSON.stringify(lastState))

    // This test documents the actual behavior
    expect(lastState).toEqual({ count: 77 })
  })

  describe('simulating full devtools _timeTravel path', () => {
    let devtools
    let mockSink
    let receivedReducers

    beforeEach(() => {
      receivedReducers = []
      mockSink = xs.create()
      mockSink.subscribe({ next: v => receivedReducers.push(v) })

      // Create a mock devtools instance with the same structure
      devtools = {
        _components: new Map(),
        _safeClone: (obj) => JSON.parse(JSON.stringify(obj)),
        _posted: [],
        _post(type, payload) { this._posted.push({ type, payload }) },
      }

      // Register a component
      const mockInstance = {
        stateSourceName: 'STATE',
        sinks: { STATE: mockSink },
      }
      devtools._components.set(1, {
        id: 1,
        name: 'TestComp',
        _instanceRef: new WeakRef(mockInstance),
      })
    })

    it('_timeTravel pushes a reducer to the component STATE sink', () => {
      // Inline the _timeTravel logic
      const componentId = 1
      const state = { count: 42, label: 'time-traveled' }

      const meta = devtools._components.get(componentId)
      const instance = meta._instanceRef?.deref()
      const stateSinkName = instance?.stateSourceName || 'STATE'
      const stateSink = instance?.sinks?.[stateSinkName]

      expect(stateSink).toBeDefined()
      expect(typeof stateSink.shamefullySendNext).toBe('function')

      const newState = devtools._safeClone(state)
      stateSink.shamefullySendNext(() => ({ ...newState }))

      expect(receivedReducers.length).toBe(1)
      expect(typeof receivedReducers[0]).toBe('function')

      // The reducer should return the target state regardless of input
      const result = receivedReducers[0]({ count: 0 })
      expect(result).toEqual({ count: 42, label: 'time-traveled' })
    })

    it('_timeTravel with WeakRef that has been GC-d falls back to root', () => {
      // Simulate GC by setting a component with a dead WeakRef
      const deadRef = new WeakRef({})
      // Force the ref to be dead - we can't truly force GC, so test the fallback path
      devtools._components.set(2, {
        id: 2,
        name: 'DeadComp',
        _instanceRef: deadRef,
      })

      // With a live instance that has no sinks
      const noSinkInstance = { stateSourceName: 'STATE', sinks: {} }
      devtools._components.set(3, {
        id: 3,
        name: 'NoSinkComp',
        _instanceRef: new WeakRef(noSinkInstance),
      })

      // Should fall through to root app fallback
      const rootReducers = []
      const rootSink = xs.create()
      rootSink.subscribe({ next: v => rootReducers.push(v) })

      // Mock window.__SYGNAL_DEVTOOLS_APP__
      globalThis.__SYGNAL_DEVTOOLS_APP__ = {
        sinks: { STATE: rootSink }
      }

      // Call _timeTravel logic for componentId 3 (has meta, has instance, but no STATE sink stream)
      const meta = devtools._components.get(3)
      const instance = meta._instanceRef?.deref()
      const stateSinkName = instance?.stateSourceName || 'STATE'
      const stateSink = instance?.sinks?.[stateSinkName]

      // stateSink should be undefined since sinks is empty
      expect(stateSink).toBeUndefined()

      // The fallback path uses __SYGNAL_DEVTOOLS_APP__
      const app = globalThis.__SYGNAL_DEVTOOLS_APP__
      if (app?.sinks?.STATE?.shamefullySendNext) {
        app.sinks.STATE.shamefullySendNext(() => ({ count: 99 }))
      }
      expect(rootReducers.length).toBe(1)
      expect(rootReducers[0]({ old: true })).toEqual({ count: 99 })

      delete globalThis.__SYGNAL_DEVTOOLS_APP__
    })
  })

  describe('realistic component sinks pattern', () => {
    it('the actual initSinks merge pattern receives shamefullySendNext', () => {
      const appliedStates = []

      // Replicate component.ts initSinks:
      // this.sinks[stateSourceName] = xs.merge(model$[name], subComponentSink$, sources[stateSourceName].stream.filter(() => false), ...peers$[name])
      const modelReducer$ = xs.create()
      const subCompSink$ = xs.never()
      const statePassthrough$ = xs.never() // sources[STATE].stream.filter(() => false)

      const stateSink = xs.merge(modelReducer$, subCompSink$, statePassthrough$)

      // withState wraps this: stateSink is consumed by fold in the state driver
      // The state driver does: sinks.STATE.fold((state, reducer) => reducer(state), defaultState)
      const state$ = stateSink.fold((state, reducer) => {
        if (typeof reducer === 'function') return reducer(state)
        return state
      }, { value: 'initial' })

      state$.subscribe({ next: s => appliedStates.push(s) })

      // Verify normal model flow works
      modelReducer$.shamefullySendNext(s => ({ ...s, value: 'from-model' }))
      expect(appliedStates[appliedStates.length - 1]).toEqual({ value: 'from-model' })

      // Now the critical test: devtools time-travel pushes on stateSink directly
      const targetState = { value: 'time-traveled', extra: true }
      stateSink.shamefullySendNext(() => ({ ...targetState }))

      console.log('All states:', JSON.stringify(appliedStates))
      const last = appliedStates[appliedStates.length - 1]
      console.log('Last state after time-travel:', JSON.stringify(last))

      // This is the key assertion — does it work?
      expect(last).toEqual({ value: 'time-traveled', extra: true })
    })
  })

  describe('withState pattern - the real issue', () => {
    it('shamefullySendNext on a stream consumed by fromObservable+concat', async () => {
      const { default: concat } = await import('xstream/extra/concat.js')
      const results = []

      // This is the component's STATE sink (from initSinks)
      const originalSink = xs.create()

      // This is what withState does:
      const reducerMimic$ = xs.create()
      const state$ = reducerMimic$.fold((state, reducer) => reducer(state), { count: 0 }).drop(1)
      state$.subscribe({ next: s => results.push(s) })

      const stream$ = concat(xs.fromObservable(originalSink), xs.never())
      stream$.subscribe({
        next: i => queueMicrotask(() => reducerMimic$._n(i)),
        error: err => queueMicrotask(() => reducerMimic$._e(err)),
      })

      // Normal push through the original sink (this is what model actions do)
      originalSink.shamefullySendNext(s => ({ ...s, count: 1 }))
      await new Promise(r => setTimeout(r, 50))
      console.log('After normal push:', JSON.stringify(results))
      expect(results[results.length - 1]).toEqual({ count: 1 })

      // Time-travel push directly on originalSink
      originalSink.shamefullySendNext(() => ({ count: 99 }))
      await new Promise(r => setTimeout(r, 50))
      console.log('After time-travel push:', JSON.stringify(results))
      expect(results[results.length - 1]).toEqual({ count: 99 })
    })

    it('shamefullySendNext on MERGED stream consumed by fromObservable+concat', async () => {
      const { default: concat } = await import('xstream/extra/concat.js')
      const results = []

      // Component's STATE sink from initSinks is a merge
      const model$ = xs.create()
      const stateSink = xs.merge(model$, xs.never())

      // withState pattern
      const reducerMimic$ = xs.create()
      const state$ = reducerMimic$.fold((state, reducer) => reducer(state), { count: 0 }).drop(1)
      state$.subscribe({ next: s => results.push(s) })

      const stream$ = concat(xs.fromObservable(stateSink), xs.never())
      stream$.subscribe({
        next: i => queueMicrotask(() => reducerMimic$._n(i)),
        error: err => queueMicrotask(() => reducerMimic$._e(err)),
      })

      // Normal push via model$ (inner stream of the merge)
      model$.shamefullySendNext(s => ({ ...s, count: 1 }))
      await new Promise(r => setTimeout(r, 50))
      console.log('After model push:', JSON.stringify(results))
      expect(results[results.length - 1]).toEqual({ count: 1 })

      // Time-travel: push directly on the merged stateSink
      stateSink.shamefullySendNext(() => ({ count: 99 }))
      await new Promise(r => setTimeout(r, 50))
      console.log('After time-travel on merged sink:', JSON.stringify(results))

      // THIS is the critical test
      const last = results[results.length - 1]
      if (last.count !== 99) {
        console.error('BUG CONFIRMED: shamefullySendNext on merged sink does NOT propagate through withState fromObservable+concat')
      }
      expect(last).toEqual({ count: 99 })
    })
  })

  describe('real Sygnal component time-travel', () => {
    it('renderComponent basic check', async () => {
      function Counter({ state }) {
        return { sel: 'div', data: {}, children: [String(state.count)] }
      }
      Counter.model = {
        INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
      }
      Counter.initialState = { count: 0 }

      const result = renderComponent(Counter)

      // Wait for initial state to be emitted
      await new Promise(r => setTimeout(r, 50))
      console.log('initial states:', JSON.stringify(result.states))

      result.simulateAction('INCREMENT')
      await new Promise(r => setTimeout(r, 200))
      console.log('states after INCREMENT:', JSON.stringify(result.states))

      const stateSink = result.sinks.STATE
      console.log('sinks keys:', Object.keys(result.sinks))
      console.log('STATE sink type:', stateSink?.constructor?.name)
      console.log('STATE sink._prod:', stateSink?._prod?.constructor?.name)
      console.log('STATE sink._ils length:', stateSink?._ils?.length)

      // Subscribe directly to STATE sink to see what it emits
      const sinkValues = []
      stateSink.addListener({ next: v => sinkValues.push(typeof v === 'function' ? 'reducer-fn' : v) })

      // Push a reducer — this is what _timeTravel does
      stateSink.shamefullySendNext(() => ({ count: 99 }))
      await new Promise(r => setTimeout(r, 200))
      console.log('sinkValues after push:', JSON.stringify(sinkValues))
      console.log('states after time-travel:', JSON.stringify(result.states))

      result.dispose()

      // The key question: did the state change?
      const hasCount99 = result.states.some(s => s.count === 99)
      console.log('Has count=99 in states?', hasCount99)
      expect(hasCount99).toBe(true)
    })
  })
})
