/**
 * Coded console output for Sygnal's pre-existing warnings and errors
 * (PLAN-1 workstream 1E).
 *
 *   warn(code, component, message, fix?, extra?)
 *   error(code, component, message, fix?, extra?)
 *   fail(code, component, message, fix?): never
 *
 * `component` is a component instance (anything with `.name`), a name string,
 * or undefined. `extra` (an Error, the offending value, ...) is passed to the
 * console after the formatted text, as the old messages did.
 *
 * Unlike report(), warn()/error() keep printing when diagnostics are 'off',
 * so production apps see the same messages as before (now with a code):
 *   - 'off'     → console.warn/error(formatDiagnostic(...), extra?)
 *   - 'collect' → report(): collected; error severity is also printed with
 *                 console.error (so exceptions stay visible in tests), warn isn't
 *   - 'warn'    → report(): collected and printed once by report(); `extra`
 *                 (e.g. the caught Error with its stack) printed after it
 *   - 'error'   → report() throws a DiagnosticError; it is rethrown
 *                 asynchronously so the stream pipeline that hit the problem
 *                 keeps running (same contract as the hooks in ./index)
 *   - code in the ignore list → nothing printed
 *
 * fail() always throws an Error whose message is the formatted text and whose
 * `.code` is the diagnostic code. It does not go through report(): the throw
 * itself is the signal, in every mode.
 *
 * (This comment is attached to the type-only import below so the TypeScript
 * emit drops it.)
 */
import type { DiagnosticSeverity } from './codes'
import { report, formatDiagnostic, getDiagnosticsMode } from './index'

const emit = (severity: Extract<DiagnosticSeverity, 'warn' | 'error'>) =>
  (code: string, component: any, message: string, fix?: string, ...extra: any[]): void => {
    const details = { component, message, fix, severity, data: extra[0] }
    const mode = getDiagnosticsMode()
    if (mode === 'off') {
      console[severity](formatDiagnostic(code, details), ...extra)
      return
    }
    try {
      const d = report(code, details)
      if (d && mode === 'collect' && severity === 'error') console.error(d.text, ...extra)
      else if (d && mode === 'warn' && extra.length) console[severity](...extra)
    } catch (err) {
      setTimeout(() => { throw err })
    }
  }

export const warn = emit('warn')
export const error = emit('error')

export function fail(code: string, component: any, message: string, fix?: string): never {
  const err: any = new Error(formatDiagnostic(code, { component, message, fix }))
  err.code = code
  throw err
}
