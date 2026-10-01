/**
 * 'sygnal/diagnostics' — runtime consistency checks (PLAN-1 workstream 1A).
 *
 *   import 'sygnal/diagnostics'
 *
 * Importing this entry registers every check with the diagnostics core of the
 * 'sygnal' package (a side-effect import) and installs the RxJS-operator hints.
 * Checks only run while diagnostics are on (run(App, drivers, { diagnostics }),
 * or globalThis.__SYGNAL_DEV__ from the Vite plugin in dev). None of this code
 * is in the main 'sygnal' bundle.
 *
 * | Code   | Check                                                  | Module         |
 * |--------|--------------------------------------------------------|----------------|
 * | SYG101 | intent action has no model entry                       | wiring.ts      |
 * | SYG102 | model entry has no intent trigger (info)               | wiring.ts      |
 * | SYG103 | intent selector never matched (info -> warn)           | dom.ts         |
 * | SYG104 | intent selector only matches inside a child component  | dom.ts         |
 * | SYG105 | EVENTS type emitted-not-selected / selected-not-emitted| events.ts      |
 * | SYG106 | parent prop overwritten by a reserved view argument    | props.ts       |
 * | SYG201 | STATE reducer dropped keys                             | state.ts       |
 * | SYG202 | STATE reducer returned undefined                       | state.ts       |
 * | SYG301 | RxJS operator used on an xstream stream                | rxjsHints.ts   |
 * | SYG401 | Collection `from` missing or not an array              | collections.ts |
 */
import type {DiagnosticCheck} from '../index'
import {Stream} from '../../xstreamCompat'
import {bridge, resetCheckState, timing} from './shared'
import {wiringCheck} from './wiring'
import {stateCheck} from './state'
import {eventsCheck} from './events'
import {propsCheck} from './props'
import {collectionsCheck} from './collections'
import {domCheck} from './dom'
import {installRxjsHints} from './rxjsHints'

export {checkEventBus} from './events'
export type {EventBusSummary} from './events'
export {RXJS_HINTS} from './rxjsHints'
export {listCodes, getCodeInfo} from '../codes'
export type {DiagnosticCodeInfo} from '../codes'

/** Every runtime check in this entry. */
export const checks: DiagnosticCheck[] = [
  wiringCheck,
  stateCheck,
  eventsCheck,
  propsCheck,
  collectionsCheck,
  domCheck,
]

/**
 * (Re-)register all checks with the core and install the RxJS hints. Called
 * on import. Idempotent across duplicate copies of this entry: the previous
 * installation (stored on the core bridge) is removed first.
 */
export function installChecks(): () => void {
  const core = bridge()
  if (!core) throw new Error(`[Sygnal] 'sygnal/diagnostics' could not find the Sygnal diagnostics core`)
  if (typeof core.__uninstallChecks === 'function') core.__uninstallChecks()
  const unregister = checks.map(check => core.registerCheck(check))
  const uninstallHints = installRxjsHints(Stream && Stream.prototype)
  const uninstall = () => {
    unregister.forEach(fn => fn())
    uninstallHints()
    if (core.__uninstallChecks === uninstall) core.__uninstallChecks = undefined
  }
  core.__uninstallChecks = uninstall
  return uninstall
}

export interface ChecksOptions {
  /** delay after a render before the DOM checks (SYG103/104) run; default 50 ms */
  settleMs?: number
  /** render-idle time before SYG103 escalates to warn; default 2000 ms */
  idleMs?: number
  /** renders required before SYG103 escalates to warn; default 3 */
  minRenders?: number
}

/** Tune the timing of the DOM checks (mostly for tests). */
export function configureChecks(options: ChecksOptions = {}): void {
  for (const key of Object.keys(timing) as Array<keyof typeof timing>) {
    if (typeof options[key] === 'number') timing[key] = options[key] as number
  }
}

/** Forget what the checks have seen and reported (dedupe state, registries). For tests. */
export function resetChecks(): void {
  resetCheckState()
}

installChecks()
