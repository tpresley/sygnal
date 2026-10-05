/**
 * PLAN-4.6 next core: declaration statics and reply actions (04-hooks-contract §2.1 "statics",
 * §3.7; spike 0-S proto/statics.ts). The core names no static: a driver source marked
 * `__sygnalStatic: 'timers'` (makeTimerDriver; 'resources' makeFetchDriver, 'connections'
 * makeSocketDriver, 'route' the router, 'head' makeHeadDriver, a testing fake) takes that static
 * of every component that declares it.
 *
 * - A declaring instance's value of `view[static]` (a function of the calculated state, an object
 *   of such functions, or a constant such as a `route` string) is recomputed when its state or its
 *   shown flag changed: in the flush (after each render pass, so a new instance and a parent's
 *   write are covered) and synchronously after each of its own actions (G-158: before that
 *   action's own values on any driver sink; D170/Q21).
 * - Sent as `{ [static]: value }`, without deep-equal repeats (objIsEqual); while the instance is
 *   on a hidden Switchable page, an object value keeps only its `background: true` entries.
 *   Stamped and scoped like any sink value (actions.ts send()). A throwing declaration is SYG216
 *   ('declaration'; nothing sent).
 * - Reply actions: an instance listens to `replies(id)` of each reply-capable source
 *   (`__sygnalReplies: true`) it sends to or declares a static to, from its creation; a reply is
 *   dispatched to it with cause 'reply'. Disposing completes them at once, so the driver stops the
 *   instance's timers / aborts its requests (G-144), after DISPOSE and dispose$ ran.
 */
import type {Inst} from './instance'
import type {App} from './runtime'
import type {CoreDef} from './define'
import {objIsEqual} from '../cycle/state/objIsEqual'
import {send} from './actions'

/** the drivers' statics and reply-capable sources (once per app, at start) */
export function scanSources(app: App) {
  for (const n in app.sources) {
    const s = app.sources[n]
    if (!s || typeof s != 'object') continue
    if (typeof s.__sygnalStatic == 'string') app.stat.push([n, s.__sygnalStatic])
    if (s.__sygnalReplies === true && typeof s.replies == 'function') app.rep.push(n)
  }
  if (app.stat.length) app.afterRender = () => { for (const i of app.statics) checkStatics(i) }
}

/** the [sink, static] pairs this definition declares (null: none), cached per app */
export function staticsOf(app: App, def: CoreDef): Array<[string, string]> | null {
  let s = app.stc.get(def)
  if (s === undefined) {
    const v = def.view, l = app.stat.filter(([, k]) => v[k] != null)
    app.stc.set(def, (s = l.length ? l : null))
  }
  return s
}

/** at creation (before the intent): the statics it declares and the replies it listens to */
export function attach(inst: Inst) {
  const app = inst.app, def = inst.def
  const st = inst.st = app.stat.length ? staticsOf(app, def) : null
  if (st) { inst.sv = {}; app.statics.add(inst); app.commit() }
  for (const n of app.rep) {
    if (!def.sinks.has(n) && !st?.some(s => s[0] == n)) continue
    const src = inst.src(n), r$ = (typeof src?.replies == 'function' ? src : app.sources[n]).replies(inst.id)
    ;(inst.rep ||= []).push(r$)
    r$.subscribe({next: (a: any) => a && app.dispatch(inst, a.type, a.data, 'reply')})
  }
}

/** on dispose: no more declarations; the replies end now (the drivers drop the instance) */
export function detach(inst: Inst) {
  if (inst.st) inst.app.statics.delete(inst)
  const r = inst.rep
  if (r) { inst.rep = null; for (const r$ of r) try { r$.shamefullySendComplete() } catch (_) {} }
}

const shownOf = (inst: Inst) => {
  for (let i: Inst | null = inst; i; i = i.parent) if (!i.shown) return false
  return true
}

/** recompute the instance's declarations when its state or shown flag changed; send the changed ones */
export function checkStatics(inst: Inst) {
  if (inst.disposed) return
  const s = inst.cell.get(), shown = shownOf(inst)
  // no state yet: nothing declared (as the state stream, which skips undefined)
  if (s === undefined || (s === inst.sS && shown === inst.sH)) return
  inst.sS = s; inst.sH = shown
  const view = inst.def.view, sv = inst.sv!
  for (const [n, k] of inst.st!) {
    const f = view[k]
    let v: any = f
    try {
      if (typeof f == 'function') v = f(s)
      else if (f && typeof f == 'object') { v = {}; for (const r in f) v[r] = f[r](s) }
    } catch (e) {
      // as today: nothing sent; the next value is sent even when equal to the last one
      inst.app.caught(inst, 'SYG216', `${k} threw; nothing sent`, e, 'declaration')
      sv[n] = undefined
      continue
    }
    // D85: a hidden page keeps only its background entries (an object value)
    if (!shown && v && typeof v == 'object') { const w = v; v = {}; for (const r in w) if (w[r]?.background) v[r] = w[r] }
    const out = {[k]: v}
    if (n in sv && objIsEqual(out, sv[n])) continue
    sv[n] = out
    send(inst, n, out)
  }
}
