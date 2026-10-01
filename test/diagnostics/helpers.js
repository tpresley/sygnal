import xs from 'xstream'
import {
  configureDiagnostics,
  getDiagnostics,
  _resetDiagnostics,
} from '../../src/extra/diagnostics/index.js'
import { installChecks, resetChecks, configureChecks } from '../../src/extra/diagnostics/checks/index.js'

if (typeof globalThis.window === 'undefined') {
  globalThis.window = undefined
}

/** Fresh diagnostics core + checks, mode 'collect'. Call in beforeEach. */
export function setupChecks(mode = 'collect') {
  delete globalThis.__SYGNAL_DEV__
  _resetDiagnostics()
  installChecks()
  resetChecks()
  configureChecks({ settleMs: 50, idleMs: 2000, minRenders: 3 })
  configureDiagnostics({ mode })
}

export const diagnostics = (code) => getDiagnostics().filter(d => !code || d.code === code)

export const settle = (ms = 120) => new Promise(r => setTimeout(r, ms))

/** A mock DOM event stream that fires once, after the component is wired up. */
export const later = (value = {}, ms = 30) =>
  xs.periodic(ms).take(1).mapTo(value)

/** Fires `count` times, `ms` apart. */
export const times = (count, value = {}, ms = 30) =>
  xs.periodic(ms).take(count).mapTo(value)
