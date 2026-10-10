/**
 * PLAN-4 2-C (GS-10): the action log. Records every action a component instance runs as
 *   { type, data, component, instance, sinks, cause, time }
 * for renderComponent's t.actions / t.explain() (src/extra/testing.ts), inspect({ actions }) in
 * the 'sygnal/diagnostics' dev entry (./inspect.ts) and the DevTools action log
 * (src/extra/devtoolsActions.ts).
 *
 * 0 B in apps: nothing in the core calls this. actionHooks() is a hook layer of the core
 * (04-hooks-contract §3.3): onAction opens the record (the core passes the cause: 'intent',
 * 'next', 'reply', 'built-in', 'simulateAction', 'agent' (PLAN-6 A-1, G-597); an intent action a behavior owns is
 * 'behavior'), wrapHandler sees which sinks produced a value. (The old core's version patched
 * each instance; R5 removed it.)
 *
 * Sinks: a function reducer counts when it returns a value: not ABORT (or another symbol, which
 * the core drops), and for STATE not the state it was given (GS-4: no change); EFFECT counts when
 * the handler ran without ABORT. A constant / `true` entry always sends. A throwing reducer
 * sends nothing.
 */
import {isAbort, ORIGINAL} from '../../../shared'

export type ActionCause = 'intent' | 'next' | 'reply' | 'built-in' | 'simulateAction' | 'behavior' | 'agent'

export interface ActionRecord {
  type: string
  data: any
  /** the component's name */
  component: string
  /** the instance's id (its component number, as inspect()'s component ids) */
  instance: string
  /** sinks that produced a value for this action (live: STATE fills in when the reducer runs) */
  sinks: string[]
  cause: ActionCause
  /** clock time (fake-timer aware) when the action reached the model */
  time: number
  /** a reply: the source that delivered it */
  source?: string
}

export interface ActionListener {
  action(record: ActionRecord, component: any): void
  /** a sink produced a value for `record` (reducer: the model's function, when there is one) */
  sink?(record: ActionRecord, sink: string, reducer: any): void
}

const BUILT_IN = /^(BOOTSTRAP|INITIALIZE|DISPOSE|RESOURCE)$/

/** now on the test's fake clock when there is one (vi.useFakeTimers()), else Date.now() */
export const clockNow = (): number => {
  const c = (setTimeout as any).clock
  return c ? c.now : Date.now()
}

/**
 * PLAN-4.6 R4: the same log on the core, from its hooks (04 §3.3) instead of instance
 * patches: onAction opens the record (the core passes the cause: 'intent', 'next', 'reply',
 * 'built-in', 'simulateAction'), wrapHandler sees which sinks produced a value. Same records,
 * same cause rules: a built-in type is 'built-in' unless simulated; an intent action a behavior
 * owns is 'behavior'. `only(inst)`: the instances to record (renderComponent: its own tree).
 */
export function actionHooks(listener: ActionListener, only?: (inst: any) => boolean): any {
  const cur = new WeakMap<object, [ActionRecord, string[]]>()
  // INITIALIZE: the core writes the initial state at creation (no action, unless the model
  // has an INITIALIZE entry); today's log has an INITIALIZE record with STATE, so it is opened here
  const init = new WeakMap<object, ActionRecord>()
  return {
    onCreate(inst: any) {
      const d = inst.def
      if ((only && !only(inst)) || d.initialState === undefined || !(inst.isRoot || d.isolated)) return
      const rec: ActionRecord = {type: 'INITIALIZE', data: d.initialState, component: inst.name, instance: String(inst.id), sinks: [], cause: 'built-in', time: clockNow()}
      init.set(inst, rec)
      try { listener.action(rec, inst) } catch (_) { /* ignore */ }
      addSink(listener, rec, ['STATE'], 'STATE', undefined)
    },
    onAction(inst: any, a: any) {
      if (only && !only(inst)) return
      const type = String(a.type), owned = inst.def.behaviorActions
      const hs = inst.def.handlers.get(type) || [], order = hs.map((h: any) => h[0])
      const opened = type == 'INITIALIZE' && init.get(inst)
      if (opened) { init.delete(inst); cur.set(inst, [opened, order]); return }
      const cause: ActionCause = a.cause == 'simulateAction' ? a.cause : BUILT_IN.test(type) ? 'built-in'
        : a.cause == 'next' || a.cause == 'reply' || a.cause == 'agent' ? a.cause
        : owned && Object.prototype.hasOwnProperty.call(owned, type) ? 'behavior' : 'intent'
      const rec: ActionRecord = {type, data: a.data, component: inst.name, instance: String(inst.id), sinks: [], cause, time: clockNow(), ...(a.source !== undefined && {source: a.source})}
      cur.set(inst, [rec, order])
      try { listener.action(rec, inst) } catch (_) { /* a listener never breaks the app */ }
      // a constant / `true` entry always sends (EFFECT runs functions only)
      for (const [sink, h] of hs) if (typeof h != 'function' && sink != 'EFFECT') addSink(listener, rec, order, sink, undefined)
    },
    wrapHandler(inst: any, type: string, sink: string, fn: any) {
      const c = cur.get(inst)
      if (!c || c[0].type !== type || typeof fn != 'function') return
      const [rec, order] = c, isState = sink == 'STATE', isEffect = sink == 'EFFECT'
      return function (this: any, state: any) {
        const r = fn.apply(this, arguments)
        if (!isAbort(r) && (isEffect || typeof r != 'symbol') && !(isState && r === state)) addSink(listener, rec, order, sink, fn[ORIGINAL] || fn)
        return r
      }
    },
  }
}

function addSink(l: ActionListener, rec: ActionRecord, order: string[], sink: string, reducer: any): void {
  if (!rec.sinks.includes(sink)) {
    rec.sinks.push(sink)
    rec.sinks.sort((a, b) => order.indexOf(a) - order.indexOf(b))
  }
  try { l.sink?.(rec, sink, reducer) } catch (_) { /* ignore */ }
}
