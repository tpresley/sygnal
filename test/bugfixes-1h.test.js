// Regression tests for PLAN-1 workstream 1H (Phase 1 close-review fixes).
import { describe, it, expect, afterEach, vi } from 'vitest'
import xs from 'xstream'

if (typeof globalThis.window === 'undefined') {
  globalThis.window = undefined
}

import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

const settle = (ms = 40) => new Promise(r => setTimeout(r, ms))
const last = t => t.states[t.states.length - 1]

let t
afterEach(() => {
  if (t) t.dispose()
  t = null
  _resetDiagnostics()
  vi.restoreAllMocks()
})

// ─── 1H-1: non-STATE sinks are synchronous when no STATE reducer is pending ──

describe('1H-1: non-STATE sinks run synchronously when nothing is pending', () => {
  const manual = () => {
    const p = { l: null }
    p.$ = xs.create({ start(l) { p.l = l }, stop() { p.l = null } })
    return p
  }

  for (const asChild of [false, true]) {
    it(`EFFECT and EVENTS run before the emitting call returns (${asChild ? 'sub-component without initialState' : 'root with initialState'})`, async () => {
      const log = []
      const src = manual()
      function C() { return h('div', null, 'x') }
      C.intent = () => ({ GO: src.$ })
      C.model = { GO: { EFFECT: (_s, e) => { log.push('effect:' + e) }, EVENTS: (_s, e) => ({ type: 'GOT', data: e }) } }
      let Root = C
      if (asChild) {
        Root = function Parent() { return h('div', null, h(C)) }
        Root.initialState = { n: 0 }
      } else {
        C.initialState = { n: 0 }
      }
      t = renderComponent(Root)
      await t.ready()
      await settle(20)
      src.l.next('evt')
      log.push('after-next')
      expect(log).toEqual(['effect:evt', 'after-next'])
      expect(t.emitted).toEqual([{ type: 'GOT', data: 'evt' }])
    })
  }

  it('a sink is deferred behind a same-tick STATE reducer and then sees its result (B-003)', async () => {
    const seen = []
    const src = manual()
    function C() { return h('div', null) }
    C.initialState = { n: 0 }
    C.intent = () => ({ INC: src.$.filter(e => e === 'inc'), LOOK: src.$.filter(e => e === 'look') })
    C.model = { INC: s => ({ ...s, n: s.n + 1 }), LOOK: { EFFECT: s => { seen.push(s.n) } } }
    t = renderComponent(C)
    await t.ready()
    await settle(20)
    src.l.next('inc')
    src.l.next('look')
    expect(seen).toEqual([])
    await settle(20)
    expect(seen).toEqual([1])
    // and synchronous again once nothing is pending
    src.l.next('look')
    expect(seen).toEqual([1, 1])
  })
})

// ─── 1H-2: renderComponent ('collect') still prints error-severity messages ───

describe("1H-2: exceptions are visible under renderComponent's default 'collect' mode", () => {
  it('a throwing reducer prints SYG216 with the error and is also collected; warnings stay silent', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    function C({ state }) { return h('div', null, String(state.n)) }
    C.initialState = { n: 0 }
    C.model = { BOOM: () => { throw new Error('kaboom') }, NOTHING: { SPY: () => undefined } }
    t = renderComponent(C)
    await t.ready()
    t.simulateAction('BOOM')
    t.simulateAction('NOTHING') // SYG217 (warn)
    await settle(30)
    const printed = err.mock.calls.filter(c => String(c[0]).includes('SYG216'))
    expect(printed.length).toBe(1)
    expect(printed[0][1].message).toBe('kaboom')
    expect(t.diagnostics.map(d => d.code)).toEqual(['SYG216', 'SYG217'])
    expect(warn).not.toHaveBeenCalled()
  })
})
