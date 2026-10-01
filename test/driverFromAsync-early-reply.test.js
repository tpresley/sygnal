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
