// 2E-2 regression test (PLAN-1 Phase 2 close-review fixes).
// B-022: SYG406 for a view error that .onError handled is a warning with an accurate message.
import { describe, it, expect, vi } from 'vitest'
import { renderComponent } from '../../src/extra/testing.js'
import { createElement as h } from '../../src/pragma/index.js'
import { wait, useFreshDiagnostics } from './helpers.js'

useFreshDiagnostics()

const boom = new Error('view boom')
const syg406 = t => t.diagnostics.filter(d => d.code === 'SYG406').map(({ severity, message, fix }) => ({ severity, message, fix }))

describe('B-022: SYG406 severity and text', () => {
  it('with .onError: warn, "rendered the onError fallback", no "add .onError" fix', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Handled() { throw boom }
    Handled.initialState = {}
    Handled.onError = () => h('p', { className: 'fallback' }, 'sorry')
    const t = renderComponent(Handled)
    await t.ready()
    await wait(20)
    expect(t.html()).toContain('sorry')
    expect(syg406(t)).toEqual([{ severity: 'warn', message: 'View threw; rendered the onError fallback', fix: undefined }])
    // collect mode prints error severity only
    expect(err.mock.calls.filter(c => String(c[0]).includes('SYG406'))).toEqual([])
    t.dispose()
  })

  it('without .onError: unchanged (error, with the hint)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Unhandled() { throw boom }
    Unhandled.initialState = {}
    const t = renderComponent(Unhandled)
    await t.ready()
    await wait(20)
    expect(syg406(t)).toEqual([{ severity: 'error', message: 'View threw; rendering the error fallback', fix: 'Add .onError for a custom fallback' }])
    t.dispose()
  })

  it('when .onError throws too: error SYG406 without the hint, then SYG407', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Worse() { throw boom }
    Worse.initialState = {}
    Worse.onError = () => { throw new Error('fallback boom') }
    const t = renderComponent(Worse)
    await t.ready()
    await wait(20)
    expect(syg406(t)).toEqual([{ severity: 'error', message: 'View threw; rendering the error fallback', fix: undefined }])
    expect(t.diagnostics.map(d => d.code)).toContain('SYG407')
    expect(t.html()).toContain('data-sygnal-error')
    t.dispose()
  })

  it("in 'off' mode the handled case prints a console.warn", async () => {
    const warnSpy = console.warn
    function Handled2() { throw boom }
    Handled2.initialState = {}
    Handled2.onError = () => h('p', null, 'sorry')
    const t = renderComponent(Handled2, { diagnostics: 'off' })
    await t.ready()
    await wait(20)
    const call = warnSpy.mock.calls.find(c => String(c[0]).includes('SYG406'))
    expect(call[0]).toMatch(/^\[Sygnal SYG406\] Handled2: View threw; rendered the onError fallback\./)
    expect(call[1]).toBe(boom)
    t.dispose()
  })
})
