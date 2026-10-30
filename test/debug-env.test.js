// Debug logging switches (src/core/debug.ts). In Node, SYGNAL_DEBUG is read once, when the core
// loads (a process.env read on every action was most of the headless dispatch cost); a
// component's own `debug` flag is read on each call.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { run, xs } from '../dist/index.esm.js'

afterEach(() => { delete process.env.SYGNAL_DEBUG; vi.restoreAllMocks() })

function app(debug) {
  let push
  const in$ = xs.create({ start(l) { push = (v) => l.next(v) }, stop() {} })
  function C() { return null }
  C.initialState = { n: 0 }
  C.intent = ({ IN }) => ({ INC: IN })
  C.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }
  if (debug) C.debug = true
  const a = run(C, { IN: () => in$ }, { useDefaultDrivers: false })
  return { push: (v) => push(v), a }
}
const logged = (log) => log.mock.calls.map(c => String(c[0])).filter(l => l.includes('Action triggered'))

describe('debug logging', () => {
  it('SYGNAL_DEBUG set after the core loaded does not turn logging on (Node reads it at load)', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    process.env.SYGNAL_DEBUG = 'true'
    const { push, a } = app(false)
    push(1)
    expect(logged(log)).toEqual([])
    a.dispose()
  })

  it('a component\'s debug flag logs its actions', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { push, a } = app(true)
    push(1)
    expect(logged(log).length).toBe(1)
    expect(logged(log)[0]).toMatch(/\[\d+ \| C\] <INC> Action triggered/)
    a.dispose()
  })
})
