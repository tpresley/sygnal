/**
 * The 7.0 timing audit (SYG257, info): since 7.0 a model entry's STATE runs first and every other
 * sink gets the state it committed (6.x gave them the state from before the action). For code
 * written for 6.x, this reports each output sink that reads a top-level state field its action's
 * STATE changed: it gets the new value now. Fix: read `props.previousState.<field>` where the old
 * value is meant; a read meant to see the new value needs nothing. Opt-in, because in 7.0-native
 * code reading the new value is the intent. Turn it on with any of:
 *   - configureTimingAudit(true)                 (this entry)
 *   - renderComponent(C, { timingAudit: true })  (tests)
 *   - sygnal({ diagnostics: { timingAudit: true } })  (sygnal/vite, dev)
 *   - globalThis.__SYGNAL_TIMING_AUDIT__ = true
 * The flag lives on the core bridge (shared by every copy of this entry and renderComponent).
 * Mechanism: the dev hook layer's wrapHandler (checks/next.ts) wraps each non-STATE handler and
 * gives it the state through a Proxy that notes reads of changed top-level fields. Top-level
 * fields only (a nested change shows as its top-level field changing); once per component name,
 * action, sink and field. Nothing in production builds.
 */
import {bridge, devReport, once} from './shared'

/** Turn the timing audit on (true), off (false), or back to the default (globalThis.__SYGNAL_TIMING_AUDIT__). */
export function configureTimingAudit(on?: boolean): void {
  const core = bridge()
  if (core) core.timingAudit = on
}

/** Whether the timing audit is on. */
export function isTimingAuditEnabled(): boolean {
  const flag = bridge()?.timingAudit
  return flag === undefined ? (globalThis as any).__SYGNAL_TIMING_AUDIT__ === true : flag === true
}

/** handler `h` of `f`'s action `type`, sink `sink`, audited (f: the checks' instance facade) */
export const audited = (f: any, type: string, sink: string, h: any) => (s: any, d: any, nx: any, p: any, ...r: any[]) => {
  const was = p?.previousState
  if (!isTimingAuditEnabled() || !was || was === s || !s || typeof s != 'object' || typeof was != 'object' || Array.isArray(s)) return h(s, d, nx, p, ...r)
  const view = new Proxy(s, {get(t: any, k: any, rcv: any) {
    if (typeof k == 'string' && k in was && was[k] !== t[k] && once(`SYG257:${f.name}:${type}:${sink}:${k}`))
      devReport('SYG257', {
        component: f,
        message: `${f.name}'s '${type}' ${sink} read state.${k}, which the same action's STATE changed: since 7.0 it gets the new value (6.x gave it the old one)`,
        fix: `If it meant the value from before the action, read props.previousState.${k} (the 4th argument); if it meant the new value, nothing to change`,
        data: {action: type, sink, field: k},
      })
    return Reflect.get(t, k, rcv)
  }})
  return h(view, d, nx, p, ...r)
}
