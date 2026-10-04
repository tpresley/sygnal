// P45-R G-267: teardown stops the streams left without listeners in one timer per level; a stop
// that throws aborted the loop, so the streams after it in that level never stopped (their
// producers ran forever). Each stop is now isolated; the error is rethrown asynchronously.
import { it, expect, vi } from 'vitest'
import xs from 'xstream'
import { tearDown } from '../src/cycle/run/scheduler.ts'

it('a throwing producer stop does not keep the other queued streams running', async () => {
  const errors = [], real = globalThis.setTimeout
  // record the asynchronous rethrow instead of letting it reach the test runner
  vi.stubGlobal('setTimeout', (f, ms) => real(() => { try { f() } catch (e) { errors.push(e.message) } }, ms))
  try {
    let stoppedB = 0
    const a = xs.create({ start() {}, stop() { throw new Error('boom') } })
    const b = xs.create({ start() {}, stop() { stoppedB++ } })
    const la = { next() {} }, lb = { next() {} }
    a.addListener(la); b.addListener(lb)
    tearDown(() => { a.removeListener(la); b.removeListener(lb) })
    await new Promise(r => real(r, 30))
    expect(stoppedB).toBe(1)
    expect(errors).toEqual(['boom'])
  } finally { vi.unstubAllGlobals() }
})
