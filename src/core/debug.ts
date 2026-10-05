/**
 * PLAN-4.6 next core: the documented debug logging (integration/debugging: `Component.debug =
 * true`, `window.SYGNAL_DEBUG = 'true'` / `SYGNAL_DEBUG=true` in Node), as the current core's
 * `log()`: `[<id> | <Name>] <message>` on the console, and to a connected DevTools extension
 * (onDebugLog). `inst.debug`: the DevTools toggle for one instance. The message is built only
 * when logging is on.
 */
import type {Inst} from './instance'

declare const process: {env: Record<string, any>}
const ENV: any = (typeof window != 'undefined' && window) || (typeof process != 'undefined' && process.env) || {}

export function dbg(inst: Inst, msg: () => string) {
  if (!(inst.debug || inst.def.view.debug || ENV.SYGNAL_DEBUG === 'true' || ENV.SYGNAL_DEBUG === true)) return
  const text = `[${inst.id} | ${inst.def.name}] ${msg()}`
  console.log(text)
  const dt = typeof window != 'undefined' && (window as any).__SYGNAL_DEVTOOLS__
  if (dt?.connected) dt.onDebugLog(inst.id, text)
}
