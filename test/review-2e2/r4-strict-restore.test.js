// 2E-2 regression test (PLAN-1 Phase 2 close-review fixes).
import { describe, it, expect } from 'vitest'
import { renderComponent } from '../../src/extra/testing.js'
import { createElement as h } from '../../src/pragma/index.js'
import { isStrictEnabled, configureStrict } from '../../src/extra/diagnostics/checks/index.js'
import { wait, track, useFreshDiagnostics } from './helpers.js'

useFreshDiagnostics()

// ─── R4: strict is restored with the outermost instance ──────────────────────

describe('R4: renderComponent({ strict }) restores strict when the last instance is disposed', () => {
  it('FIFO disposal of overlapping instances does not leak strict mode', async () => {
    function A({ state }) { return h('div', null, String(state.n)) }
    A.initialState = { n: 0 }
    A.model = { NOOP: s => s }
    expect(isStrictEnabled()).toBe(false)
    const a = renderComponent(A, { strict: true })
    const b = renderComponent(A, { strict: false })
    a.dispose()
    b.dispose()
    expect(isStrictEnabled()).toBe(false)
    const c = renderComponent(A)
    await c.ready()
    c.simulateAction('NOOP')
    await wait(30)
    expect(c.diagnostics.map(d => d.code)).not.toContain('SYG502')
    c.dispose()
  })

  it('LIFO disposal still restores', () => {
    function A() { return h('div', null, 'a') }
    configureStrict(true)
    const a = renderComponent(A, { strict: false })
    const b = renderComponent(A)
    expect(isStrictEnabled()).toBe(false)
    b.dispose()
    a.dispose()
    expect(isStrictEnabled()).toBe(true)
  })
})

