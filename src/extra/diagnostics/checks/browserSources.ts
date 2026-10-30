/**
 * Browser sources (PLAN-5 B-3, src/extra/browserSources.ts). Dev-entry-only codes
 * (DEV_CODE_SEVERITY), reported when the driver calls
 * `__SYGNAL_DIAGNOSTICS__.browserSource(code, name, spec, componentName, extra)`:
 *
 * SYG663 — a `browser` entry the driver can't start (no known kind, no `action`, an intersection
 *          / resize target that is neither a selector nor `true`), or a BROWSER sink command
 *          with an unknown method. It isn't started / run.
 * SYG664 — a kind the driver wasn't made with (`makeBrowserDriverWith(...)` without its source).
 * SYG665 — a source or command failed (permission denied, API missing, storage blocked) and its
 *          spec names no `error` action, so nothing else would say so.
 * SYG668 — an intersection / resize declaration with nothing to observe: no DOM source reached
 *          the driver for the instance (extra 'dom'), or, in renderComponent's fake with
 *          `dom: 'real'`, its selector matches no element of the component (extra 'none').
 *
 * A component declaring `browser` with no browser driver is SYG643 (checks/timers.ts).
 */
import {bridge, devReport, once} from './shared'

const KINDS = ['intersection', 'resize', 'media', 'storage', 'visibility', 'online', 'geolocation']
const SOURCE: Record<string, string> = {
  intersection: 'intersectionSource', resize: 'resizeSource', media: 'mediaSource', storage: 'storageSource',
  visibility: 'visibilitySource', online: 'onlineSource', geolocation: 'geolocationSource',
  copy: 'clipboardSource', paste: 'clipboardSource', setItem: 'storageSource', removeItem: 'storageSource',
}
const brief = (v: any) => { try { return JSON.stringify(v) } catch (_) { return String(v) } }

/** why a declared spec can't start ('' when it can; mirrors browserDriver's checks) */
export function browserSpecProblem(s: any): string {
  if (!s || typeof s != 'object') return `is not an object ({ ${KINDS.join(' | ')}: …, action })`
  const k = KINDS.find(k => k in s)
  if (!k) return `names no source (one of ${KINDS.join(', ')})`
  if (!s.action || typeof s.action != 'string') return 'has no action (a string)'
  if ((k == 'intersection' || k == 'resize') && s[k] !== true && (typeof s[k] != 'string' || !s[k])) return `${k} must be a selector in the component or true (its root element), got ${brief(s[k])}`
  return ''
}

function onBrowserSource(code: string, name: string, spec: any, component?: string, extra?: any, commands?: string[]) {
  if (code == 'SYG663' && extra === 0) {
    // an unknown command (extra 0; `commands`: the driver's)
    if (!once(`SYG663:${component}:cmd:${name}`)) return
    devReport('SYG663', {
      component,
      message: `BROWSER command '${name}' is unknown; it is not run`,
      fix: `Name the method as a key of the command: ${(commands || []).map(c => `{ ${c}: … }`).join(', ') || 'this driver takes no commands'}`,
      data: {name, command: spec},
    })
    return
  }
  if (code == 'SYG663') {
    if (!once(`SYG663:${component}:${name}:${brief(spec)}`)) return
    devReport('SYG663', {
      component,
      message: `browser entry '${name}' ${browserSpecProblem(spec) || 'is invalid'}; it is not started`,
      fix: `Declare ${name}: { media: '(prefers-color-scheme: dark)', action: 'DARK' }, { intersection: '.card', action: 'SEEN' }, … (falsy to stop it)`,
      data: {name, spec},
    })
  } else if (code == 'SYG664') {
    if (!once(`SYG664:${component}:${name}`)) return
    devReport('SYG664', {
      component,
      message: `browser entry '${name}' uses the ${extra} source, which this browser driver wasn't made with; it is not started`,
      fix: `Add it: makeBrowserDriverWith(${SOURCE[extra]}, …), or use makeBrowserDriver() (every source)`,
      data: {name, spec, kind: extra},
    })
  } else if (code == 'SYG668') {
    if (!once(`SYG668:${component}:${name}:${extra}`)) return
    const k = KINDS.find(k => spec && k in spec) || 'intersection', target = spec?.[k]
    devReport('SYG668', {
      component,
      message: extra == 'none'
        ? `browser entry '${name}' observes ${brief(target)}, which matches no element of the component; it reports nothing`
        : `browser entry '${name}' (${k}) has no DOM to observe: the component's DOM source didn't reach the browser driver; it reports nothing`,
      fix: extra == 'none'
        ? `Use a selector the component's own view renders (or true for its root element), and declare the entry only while that element exists`
        : `Run the app with a DOM driver (run() with a mount point) and declare intersection / resize in a component's own \`browser\` static`,
      data: {name, spec, reason: extra},
    })
  } else if (code == 'SYG665') {
    if (!once(`SYG665:${component}:${name}:${extra?.name ?? extra?.code}`)) return
    devReport('SYG665', {
      component,
      message: `browser ${spec && 'action' in spec ? `entry '${name}'` : `command '${name}'`} failed (${extra?.message || extra?.name || 'error'}) and names no error action`,
      fix: `Name one to handle it, e.g. { ..., error: 'FAILED' }, and a model entry FAILED: (state, { message }) => ...`,
      data: {name, spec, failure: extra},
    })
  }
}

/** install the hook the browser driver calls (removed by the returned function) */
export function installBrowserSourceHooks(): () => void {
  const core = bridge()
  if (!core) return () => {}
  core.browserSource = onBrowserSource
  return () => { if (core.browserSource === onBrowserSource) core.browserSource = undefined }
}
