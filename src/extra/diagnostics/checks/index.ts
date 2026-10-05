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
 * | SYG112 | reply action has no model entry                        | replies.ts     |
 * | SYG630 | cached request that isn't idempotent (POST + cache)    | fetch.ts       |
 * | SYG631 | validate is not a Standard Schema                      | fetch.ts       |
 * | SYG632 | invalidate matched nothing (info)                      | fetch.ts       |
 * | SYG633 | abort names a lane its requests don't use              | fetch.ts       |
 * | SYG635 | cache: true / staleTime / prefetch without queryCache() | fetch.ts       |
 * | SYG115 | unknown DOM event shorthand (DOM.key(...))             | shorthand.ts   |
 * | SYG124 | component where a control or selector is expected      | controls.ts    |
 * | SYG125 | control given component statics / bad spec vnode()     | controls.ts    |
 * | SYG127 | behavior key in initialState / unresolvable uses entry | behaviors.ts   |
 * | SYG116 | EVENTS value with no string type (a function)          | events.ts      |
 * | SYG130 | href() names no route / leaves out a param             | router.ts      |
 * | SYG131 | route params the pattern doesn't use                   | router.ts      |
 * | SYG132 | declaration static never sent: a root without initialState    | router.ts      |
 * | SYG133 | SPA router inside a Vike app                           | router.ts      |
 * | SYG422 | timer spec makeTimerDriver() can't run                 | timers.ts      |
 * | SYG643 | timers/connections/resources with no driver to take it | timers.ts      |
 * | SYG223 | persist pick/omit key not in initialState              | persist.ts     |
 * | SYG224 | persist on a component that isn't the root             | persist.ts     |
 * | SYG645 | viewTransitions without makeViewTransitionDOMDriver(), or not an array | viewTransitions.ts |
 * | SYG201 | STATE reducer dropped keys                             | state.ts       |
 * | SYG202 | STATE reducer returned undefined                       | state.ts       |
 * | SYG221 | set() called with a string                             | state.ts       |
 * | SYG222 | same object returned after an in-place mutation        | state.ts       |
 * | SYG301 | RxJS operator used on an xstream stream                | rxjsHints.ts   |
 * | SYG401 | Collection `from` missing or not an array              | collections.ts |
 * | SYG421 | invalid data (dataset) key in a view                   | dataset.ts     |
 * | SYG612 | a form 6.0 removed (also SYG501/504 statically)        | next.ts        |
 * | SYG502 | retired in 6.0 (never reported; GS-4)                  | —              |
 * | SYG508 | strict: select()/errors() round trip on a reply source | replies.ts    |
 * | —      | D152: shared statics frozen (initialState deep)        | statics.ts     |
 * | —      | inspect(): the runtime app graph (2B)                  | inspect.ts     |
 *
 * SYG112, SYG130-133 (PLAN-3), SYG115/116/221/421 (G-143) SYG124/125 (PLAN-4 CT-1) and SYG127 (GS-1) are dev-entry-only codes: their severities live in
 * DEV_CODE_SEVERITY (codes.ts), registered by ./shared, not in the main bundle.
 *
 * Strict checks (SYG5xx) only report after configureStrict(true) (or
 * renderComponent(C, { strict: true }), or globalThis.__SYGNAL_STRICT__).
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
import {shorthandCheck} from './shorthand'
import {controlsCheck, installControlHooks} from './controls'
import {elementCommandsCheck, installElementCommandHooks} from './elementCommands'
import {behaviorsCheck} from './behaviors'
import {datasetCheck} from './dataset'
import {strictCheck} from './strict'
import {repliesCheck} from './replies'
import {routerCheck, installRouterHooks} from './router'
import {fetchCheck} from './fetch'
import {timersCheck, installTimerHooks} from './timers'
import {persistCheck} from './persist'
import {viewTransitionsCheck} from './viewTransitions'
import {staticsCheck} from './statics'
import {installRxjsHints} from './rxjsHints'
import {inspectCheck, installInspect} from './inspect'
import {nextHooks} from './next'

export {checkEventBus} from './events'
export {configureStrict, isStrictEnabled} from './strict'
export type {EventBusSummary} from './events'
export {RXJS_HINTS} from './rxjsHints'
export {inspect} from './inspect'
export type {InspectResource, InspectCacheEntry, InspectGraph, InspectComponent, InspectAction, InspectActionTrigger, InspectChild, InspectSelector, InspectControl, InspectDiagnostic, InspectOptions, InspectRecentAction} from './public'
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
  shorthandCheck,
  controlsCheck,
  elementCommandsCheck,
  behaviorsCheck,
  datasetCheck,
  strictCheck,
  repliesCheck,
  routerCheck,
  fetchCheck,
  timersCheck,
  persistCheck,
  viewTransitionsCheck,
  staticsCheck,
  inspectCheck,
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
  const uninstallInspect = installInspect()
  const uninstallRouter = installRouterHooks()
  const uninstallControls = installControlHooks()
  const uninstallTimers = installTimerHooks()
  const uninstallElementCommands = installElementCommandHooks()
  // PLAN-4.6 R4: the core reads its hooks from the bridge once per app (checks/next.ts)
  ;(core.layers ||= new Set()).add(nextHooks)
  const uninstall = () => {
    core.layers?.delete(nextHooks)
    unregister.forEach(fn => fn())
    uninstallHints()
    uninstallInspect()
    uninstallRouter()
    uninstallControls()
    uninstallTimers()
    uninstallElementCommands()
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
