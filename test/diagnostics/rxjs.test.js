// SYG301 — RxJS operator used on an xstream stream
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import xs, { Stream } from 'xstream'
import { setupChecks, diagnostics, settle } from './helpers.js'
import { RXJS_HINTS } from '../../src/extra/diagnostics/checks/index.js'
import { DiagnosticError } from '../../src/extra/diagnostics/index.js'
import { renderComponent } from '../../src/extra/testing.js'
import { createElement } from '../../src/pragma/index.js'

let t
beforeEach(() => setupChecks())
afterEach(() => { if (t) t.dispose(); t = null })

function App() { return createElement('div', null, 'x') }
App.initialState = { q: '' }
App.model = { SEARCH: (s, q) => ({ ...s, q }) }

describe('SYG301 — RxJS operators on xstream streams', () => {
  it('throws an enriched error from intent construction and reports it', () => {
    const Bad = Object.assign(function Bad() { return App() }, App, {
      intent: ({ DOM }) => ({
        SEARCH: DOM.select('.q').events('input').switchMap(e => xs.of(e.target.value)),
      }),
    })
    expect(() => renderComponent(Bad)).toThrow(/stream\.switchMap is not a function.*\.map\(x => inner\$\)\.flatten\(\)/)
    const found = diagnostics('SYG301')
    expect(found).toHaveLength(1)
    expect(found[0].severity).toBe('error')
    expect(found[0].data.operator).toBe('switchMap')
  })

  it('gives the xstream equivalent for the common operators', () => {
    const s = xs.never()
    expect(() => s.pipe()).toThrow(/compose/)
    expect(() => s.debounceTime(10)).toThrow(/compose\(debounce\(ms\)\)/)
    expect(() => s.distinctUntilChanged()).toThrow(/dropRepeats/)
    expect(() => s.withLatestFrom(s)).toThrow(/sampleCombine/)
    expect(() => s.mergeMap(x => x)).toThrow(/flattenConcurrently/)
    expect(() => s.tap(() => {})).toThrow(/\.debug\(fn\)/)
    expect(() => s.scan((a, b) => a, 0)).toThrow(/\.fold/)
    expect(() => s.skip(1)).toThrow(/\.drop\(n\)/)
    expect(diagnostics('SYG301').length).toBeGreaterThanOrEqual(8)
  })

  it("throws the DiagnosticError itself in 'error' mode", () => {
    setupChecks('error')
    expect(() => xs.never().switchMap(() => 1)).toThrow(DiagnosticError)
  })

  it('does not shadow real xstream operators, and valid intents are unaffected', async () => {
    for (const op of ['map', 'filter', 'take', 'startWith', 'fold', 'flatten', 'compose', 'debug', 'remember', 'last']) {
      expect(Object.getOwnPropertyDescriptor(Stream.prototype, op)?.value?.name).not.toBe('rxjsOperatorHint')
    }
    expect(Object.keys(RXJS_HINTS)).toContain('switchMap')
    expect(Object.keys(Stream.prototype)).not.toContain('switchMap') // non-enumerable

    const Good = Object.assign(function Good() { return App() }, App, {
      intent: ({ DOM }) => ({
        SEARCH: DOM.select('.q').events('input').map(e => e.target.value).filter(Boolean),
      }),
    })
    t = renderComponent(Good)
    await settle(50)
    expect(diagnostics('SYG301')).toEqual([])
  })
})
