/*
 * PLAN-9 X-1: the compose modules' runtime diagnostics. Reported through report() with the
 * severity passed (the codes are in DEV_CODE_SEVERITY, so the main bundle's table doesn't grow):
 * a no-op with diagnostics off, so they are dev-only, as the agent layer's are. 'error' mode
 * rethrows outside the caller, so a check never breaks the composition.
 *
 *   SYG161 error  a container's `render` is a component with a model (its children would stop
 *                 being the host's)
 *   SYG162 error  a part with neither `component` nor `render`
 *   SYG250 warn   a layout names an unknown part or slot: the node is dropped
 *   SYG251 warn   an invalid param value in a layout: the default is used (a record param: the
 *                 node is dropped)
 *   SYG252 warn   a record param's `from` doesn't return an array of `{ value }` (or threw)
 *   SYG450 warn   `in` names an unknown container or slot
 *   SYG452 warn   a node key listed twice in a layout (only the first place is kept)
 *   SYG681 error  a backend option problem (B / C: no `model`; A: no backend)
 */
import {report} from '../../diagnostics/index'

const said = /*#__PURE__*/ new WeakMap<object, Set<string>>()

/** report `code` (once per `owner` and `what` when an owner is given) */
export const dev = (code: string, component: string, message: string, severity: 'error' | 'warn' | 'info' = 'warn', owner?: object, what?: string): void => {
  if (owner) {
    let s = said.get(owner)
    if (!s) said.set(owner, s = new Set())
    const k = code + (what ?? message)
    if (s.has(k)) return
    s.add(k)
  }
  try { report(code, {component, message, severity}) } catch (e) { queueMicrotask(() => { throw e }) }
}
