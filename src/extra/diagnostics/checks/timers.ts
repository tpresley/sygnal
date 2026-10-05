/**
 * Timers and declaration statics without a driver (PLAN-4 GS-7). Dev-entry-only codes
 * (DEV_CODE_SEVERITY):
 *
 * SYG643 — a component declares a static that only a registered driver acts on (`timers`:
 *          makeTimerDriver(), `connections`: makeSocketDriver(), `resources`: makeFetchDriver(),
 *          `browser`: makeBrowserDriver())
 *          and no source of the app takes it (no `__sygnalStatic` marker for it), so nothing
 *          happens and nothing else says so. Also closes PLAN-3's "connections without a driver
 *          report nothing" gap. (`route` and `head` are left out: renderComponent asks for the
 *          router itself, and `head` is also collected by renderToString without a driver.)
 * SYG422 — a timer spec makeTimerDriver() can't run (non-positive `every`, negative `after`,
 *          `every` with `after`, no action, `frame` that isn't an action name): it isn't started.
 *          The driver calls `__SYGNAL_DIAGNOSTICS__.timerSpec(name, spec, componentName)`, which
 *          installTimerHooks() sets.
 */
import type {DiagnosticCheck} from '../index'
import {bridge, devReport, once, nameOf} from './shared'

const NEEDS: Record<string, string> = {
  timers: 'makeTimerDriver()',
  connections: 'makeSocketDriver()',
  resources: 'makeFetchDriver()',
  browser: 'makeBrowserDriver()',
}
const KEY: Record<string, string> = {timers: 'TIMER', connections: 'WS', resources: 'HTTP', browser: 'BROWSER'}

const brief = (v: any) => { try { return JSON.stringify(v) } catch (_) { return String(v) } }

/** why a timer spec can't run ('' when it can; mirrors timers.ts's valid()) */
export function timerSpecProblem(s: any): string {
  if (!s || typeof s != 'object') return 'is not an object ({ every, action }, { after, action } or { frame: action })'
  if ('frame' in s && s.frame) return typeof s.frame == 'string' ? '' : 'frame must be the action name (a string)'
  if (!s.action || typeof s.action != 'string') return 'has no action (a string)'
  if (s.every == null && s.after == null) return 'has neither every nor after'
  if (s.every != null && s.after != null) return 'has both every and after'
  if (s.every != null) return s.every > 0 && s.every < 1 / 0 ? '' : `every must be a positive number of ms (got ${brief(s.every)})`
  return s.after >= 0 && s.after < 1 / 0 ? '' : `after must be a number of ms, 0 or more (got ${brief(s.after)})`
}

function checkSpec(name: string, spec: any, component?: string) {
  const problem = timerSpecProblem(spec) || 'is invalid'
  if (!once(`SYG422:${component}:${name}:${brief(spec)}`)) return
  devReport('SYG422', {
    component,
    message: `Timer '${name}' ${problem}; it is not started`,
    fix: `Declare ${name}: { every: 100, action: 'TICK' }, { after: 5000, action: 'EXPIRE' } or { frame: 'FRAME' } (falsy to stop it)`,
    data: {name, spec},
  })
}

/** install the hook makeTimerDriver() calls for an invalid spec (removed by the returned function) */
export function installTimerHooks(): () => void {
  const core = bridge()
  if (!core) return () => {}
  core.timerSpec = checkSpec
  return () => { if (core.timerSpec === checkSpec) core.timerSpec = undefined }
}

export const timersCheck: DiagnosticCheck = {
  id: 'timers',

  onModel(component) {
    const sources = component?.sources, view = component?.view
    if (!sources || typeof sources != 'object' || !view) return
    const names = component.sourceNames || Object.keys(sources)
    for (const k in NEEDS) {
      if (view[k] == null) continue
      if (names.some((n: string) => sources[n]?.__sygnalStatic === k)) continue
      const name = nameOf(component)
      if (!once(`SYG643:${name}:${k}`)) continue
      devReport('SYG643', {
        component,
        message: `${name} declares ${name}.${k}, but no ${NEEDS[k]} driver is registered, so ${k == 'timers' ? 'its timers never run' : k == 'connections' ? 'its connections never open' : k == 'browser' ? 'its browser sources never start' : 'its resources are never fetched'}`,
        fix: `Register the driver: run(App, { ${KEY[k]}: ${NEEDS[k]} })`,
        data: {static: k, driver: NEEDS[k]},
      })
    }
  },
}
