/**
 * SYG459 (7.2, N6): a behavior option (a wizard's `when` / `valid` / `key` / ..., a form's
 * `values` / `schema` / ...) read a field off its bag that the bag doesn't have but the host's
 * state does. Before 7.2 the 2nd argument of the wizard's callbacks was the host state, so
 * `(s, h) => h.route` compiled (the bag's props are untyped) and read `undefined`.
 *
 * `readBag` (src/shared.ts) calls `__SYGNAL_DIAGNOSTICS__.bag(bag, state, who)`; the bag comes
 * back as a Proxy that reports once per behavior and key.
 */
import {devReport, once} from './shared'

const wrap = (bag: any, state: any, who?: string) => {
  if (!state || typeof state != 'object') return bag
  return new Proxy(bag, {get(t, k) {
    if (typeof k == 'string' && !(k in t) && k in state && once(`SYG459:${who}:${k}`)) {
      const what = who ? `A ${who} option` : 'A behavior option'
      devReport('SYG459', {
        message: `${what} read '${k}' off its bag, which has no such prop: the bag is { ...props, state, context, uid }, so it is undefined. The host's state has a '${k}'`,
        fix: `Read the host's state: bag.state.${k} (or the first argument), e.g. (step, { state }) => state.${k}`,
        data: {key: k, behavior: who},
      })
    }
    return t[k as any]
  }})
}

/** Install the `bag` hook on the core bridge (readBag calls it). */
export function installBagHooks(): () => void {
  const c = (globalThis as any).__SYGNAL_DIAGNOSTICS__
  if (!c) return () => {}
  c.bag = wrap
  return () => { if (c.bag === wrap) c.bag = undefined }
}
