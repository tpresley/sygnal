// G-069: a reply that resolved before any select() listener had subscribed hit a null
// sendFn and logged "sendFn is not a function"; the reply was lost. Replies are now
// buffered until the first select() listener subscribes, then delivered in order.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { driverFromAsync, run, xs } from '../src/index.ts'

afterEach(() => vi.restoreAllMocks())

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))
const sendFnErrors = spy => spy.mock.calls.map(c => String(c[0])).filter(m => /sendFn/.test(m))

describe('driverFromAsync replies before a select() listener (G-069)', () => {
  it('BOOTSTRAP-triggered request to an instantly-resolving promise reaches the model under run()', async () => {
    const error = vi.spyOn(console, 'error')
    function App() { return null }
    App.initialState = { got: 'none' }
    App.intent = ({ API }) => ({ GOT: API.select('boot') })
    App.model = {
      BOOTSTRAP: { API: () => ({ category: 'boot', value: 'hi' }) },
      GOT: (s, d) => ({ ...s, got: d.value }),
    }
    const states = []
    const { sources, dispose } = run(App, { API: driverFromAsync(async v => v) }, { useDefaultDrivers: false })
    sources.STATE.stream.addListener({ next: s => states.push(s) })
    await tick(30)
    dispose()
    expect(sendFnErrors(error)).toEqual([])
    expect(states.at(-1)?.got).toBe('hi')
  })

  it('buffers replies that resolve before the first select() listener and delivers them in order', async () => {
    const error = vi.spyOn(console, 'error')
    const source = driverFromAsync(async v => v)(xs.of({ category: 'a', value: 1 }, { category: 'b', value: 2 }))
    await tick()
    const got = []
    source.select().addListener({ next: v => got.push(v) })
    await tick()
    expect(got).toEqual([{ category: 'a', value: 1 }, { category: 'b', value: 2 }])
    expect(sendFnErrors(error)).toEqual([])
  })

  it('every select() subscribed in the same pass receives the buffered replies', async () => {
    const source = driverFromAsync(async v => v)(xs.of({ category: 'a', value: 1 }, { category: 'b', value: 2 }))
    await tick()
    const a = [], b = []
    source.select('a').addListener({ next: v => a.push(v.value) })
    source.select('b').addListener({ next: v => b.push(v.value) })
    await tick()
    expect(a).toEqual([1])
    expect(b).toEqual([2])
  })

  it('keeps at most 100 early replies, dropping the oldest', async () => {
    const values = Array.from({ length: 105 }, (_, i) => ({ category: 'a', value: i }))
    const source = driverFromAsync(async v => v)(xs.fromArray(values))
    await tick()
    const got = []
    source.select('a').addListener({ next: v => got.push(v.value) })
    await tick()
    expect(got.length).toBe(100)
    expect(got[0]).toBe(5)
    expect(got.at(-1)).toBe(104)
  })

  it('delivers later replies normally once a listener is attached', async () => {
    const sink = xs.create()
    const source = driverFromAsync(async v => v)(sink)
    const got = []
    source.select('a').addListener({ next: v => got.push(v.value) })
    sink.shamefullySendNext({ category: 'a', value: 1 })
    sink.shamefullySendNext({ category: 'b', value: 2 })
    sink.shamefullySendNext({ category: 'a', value: 3 })
    await tick()
    expect(got).toEqual([1, 3])
  })
})

// G-092: an error from a request that rejects before any errors() listener exists (a
// BOOTSTRAP request to an instantly-rejecting promise) used to be logged and lost.
describe('driverFromAsync errors before an errors() listener (G-092)', () => {
  const flushMicrotasks = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
  const driverLogs = spy => spy.mock.calls.map(c => String(c[0])).filter(m => /driverFromAsync/.test(m))

  it('BOOTSTRAP-triggered request to an instantly-rejecting promise reaches errors() under run()', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    function App() { return null }
    App.initialState = { failed: 'no' }
    App.intent = ({ API }) => ({ GOT: API.select('boot'), FAILED: API.errors('boot') })
    App.model = {
      BOOTSTRAP: { API: () => ({ category: 'boot', value: 'hi' }) },
      GOT: (s) => ({ ...s, failed: 'resolved?' }),
      FAILED: (s, d) => ({ ...s, failed: String(d.error.message) }),
    }
    const states = []
    const { sources, dispose } = run(App, { API: driverFromAsync(async () => { throw new Error('boom') }) }, { useDefaultDrivers: false })
    sources.STATE.stream.addListener({ next: s => states.push(s) })
    await tick(30)
    dispose()
    expect(states.at(-1)?.failed).toBe('boom')
    expect(driverLogs(error)).toEqual([])
  })

  it('buffers early errors until the first errors() listener, then delivers them in order', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const source = driverFromAsync(async v => { throw new Error(v) })(xs.of({ category: 'a', value: 'x' }, { category: 'b', value: 'y' }))
    await flushMicrotasks()
    const got = []
    source.errors().addListener({ next: v => got.push(v.error.message) })
    await tick()
    expect(got).toEqual(['x', 'y'])
    expect(driverLogs(error)).toEqual([])
  })

  it('an early error no errors() selector matches is still logged', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const source = driverFromAsync(async () => { throw new Error('nope') })(xs.of({ category: 'a' }))
    await flushMicrotasks()
    source.errors('other').addListener({ next: () => {} })
    await tick()
    expect(driverLogs(error)).toEqual([expect.stringMatching(/nope/)])
  })

  it('early errors are still logged when nothing ever subscribes to errors()', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    driverFromAsync(async () => { throw new Error('lost') })(xs.of({ category: 'a' }))
    await tick(10)
    expect(driverLogs(error)).toEqual([expect.stringMatching(/lost/)])
  })
})
