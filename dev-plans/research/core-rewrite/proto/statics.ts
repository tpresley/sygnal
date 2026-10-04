/**
 * Generic declaration statics (spike 0-S, ../03-proposal.md §5): a driver source marked
 * `__sygnalStatic: 'timers'` (makeTimerDriver), 'resources' (makeFetchDriver), 'connections'
 * (makeSocketDriver), 'route' ... takes that static of every component that declares it.
 *
 * On each commit where the instance's (calculated) state or its shown flag changed, the
 * declaration is recomputed, dropRepeats'd structurally, filtered to its `background: true`
 * entries while a Switchable page hides it, and sent (stamped, scoped) like any sink value.
 * Called from the flush for every instance that declares one, and synchronously after an
 * action of that instance (before its own values on that sink: G-158).
 */
import type {Inst} from './instance'

export function deepEq(a: any, b: any): boolean {
  if (a === b) return true
  if (!a || !b || typeof a != 'object' || typeof b != 'object' || Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) if (!deepEq(a[k], b[k])) return false
  return true
}

export function checkStatics(inst: Inst) {
  if (inst.disposed) return
  const s = inst.cell.get(), shown = inst.shown()
  if (s === inst.sS && shown === inst.sH) return
  inst.sS = s; inst.sH = shown
  const view = inst.def.view
  for (const [n, k] of inst.st!) {
    const f = view[k]
    let v: any
    try {
      if (typeof f == 'function') v = f(s)
      else if (f && typeof f == 'object') { v = {}; for (const r in f) v[r] = f[r](s) }
      else v = f
    } catch (e) { inst.app.error(inst, e, 'declaration'); continue }
    if (!shown && v && typeof v == 'object') { const w = v; v = {}; for (const r in w) if (w[r]?.background) v[r] = w[r] }
    const out = {[k]: v}
    if (deepEq(out, inst.sv[n])) continue
    inst.sv[n] = out
    inst.send(n, out)
  }
}
