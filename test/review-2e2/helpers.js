// Shared setup for the 2E-2 regression tests (PLAN-1 Phase 2 close-review fixes).
import { beforeEach, afterEach, vi } from 'vitest'
import { setupChecks } from '../diagnostics/helpers.js'
import { registerCheck, _resetDiagnostics } from '../../src/extra/diagnostics/index.js'
import { configureStrict } from '../../src/extra/diagnostics/checks/index.js'

export const wait = (ms = 30) => new Promise(r => setTimeout(r, ms))

const offs = []
/** registerCheck() for the current test (unregistered after it) */
export const track = check => { const off = registerCheck({ id: 'test-' + offs.length, ...check }); offs.push(off); return off }

/** fresh diagnostics core + checks (mode off, as in a plain test file); console.warn muted */
export function useFreshDiagnostics() {
  beforeEach(() => {
    setupChecks('off')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    offs.splice(0).forEach(off => off())
    configureStrict(false)
    _resetDiagnostics()
    vi.restoreAllMocks()
  })
}
