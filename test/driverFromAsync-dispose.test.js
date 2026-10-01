// 3E/R11: driverFromAsync warned "Unexpected completion of sink stream..." on every normal
// teardown (t.dispose() / run().dispose()). Teardown is not unexpected: no warning then.
// A sink stream that completes while the driver is live still warns.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { driverFromAsync, renderComponent, run, xs } from '../src/index.ts'

const UNEXPECTED = /Unexpected completion of sink stream/

function App() { return null }
App.initialState = { n: 0 }
App.intent = ({ API }) => ({ GOT: API.select('q') })
App.model = {
  ASK: { API: () => ({ category: 'q', x: 1 }) },
  GOT: (s) => ({ ...s, n: s.n + 1 }),
}

const warnCalls = spy => spy.mock.calls.filter(c => UNEXPECTED.test(String(c[0])))

afterEach(() => vi.restoreAllMocks())

describe('driverFromAsync teardown (3E/R11)', () => {
  it('renderComponent dispose() does not warn about an unexpected completion', async () => {
    const warn = vi.spyOn(console, 'warn')
    const t = renderComponent(App, { drivers: { API: driverFromAsync(async x => x, { args: 'x', selector: 'category' }) } })
    t.simulateAction('ASK')
    await t.waitForState(s => s.n === 1)
    t.dispose()
    await new Promise(r => setTimeout(r, 10))
    expect(warnCalls(warn)).toEqual([])
  })

  it('run() dispose() does not warn about an unexpected completion', async () => {
    const warn = vi.spyOn(console, 'warn')
    const { dispose } = run(App, { API: driverFromAsync(async x => x, { args: 'x', selector: 'category' }) }, { useDefaultDrivers: false })
    await new Promise(r => setTimeout(r, 30))
    dispose()
    await new Promise(r => setTimeout(r, 10))
    expect(warnCalls(warn)).toEqual([])
  })

  it('still warns when the sink stream completes while the driver is live', () => {
    const warn = vi.spyOn(console, 'warn')
    driverFromAsync(() => new Promise(() => {}))(xs.of({ value: 1 }))
    expect(warnCalls(warn).length).toBe(1)
  })
})
