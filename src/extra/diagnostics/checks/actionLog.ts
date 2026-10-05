/**
 * PLAN-4 2-C (GS-10): the action log. Records every action a component instance runs as
 *   { type, data, component, instance, sinks, cause, time }
 * for renderComponent's t.actions / t.explain() (src/extra/testing.ts) and for
 * inspect({ actions }) in the 'sygnal/diagnostics' dev entry (./inspect.ts).
 *
 * 0 B in apps: nothing in the core calls this. It is installed per instance from the existing
 * diagnostics hooks, by patching that instance only (never a prototype):
 *   trackActions(c, listener)   from onIntent (before initAction$ / initModel$ run): wraps the
 *                               instance's makeOnAction / makeEffectHandler, so each reducer the
 *                               model wires is wrapped to see whether it produced a value
 *   trackActionStreams(c)       from onModel (action$ exists, nothing subscribed yet): patches the
 *                               instance's action$._n (every action that reaches the model),
 *                               action$.shamefullySendNext (next(), DISPOSE) and the reply
 *                               streams' _n (c._replies)
 * The install state lives on the instance (`__sygnalActionLog`), so the copy of this module in
 * the main bundle (testing.ts) and the one in the dev entry (inspect.ts) share it: whichever runs
 * first patches, the other only adds its listener.
 *
 * Cause, decided when the action reaches action$ (causeOf):
 *   'simulateAction'  set by renderComponent around its injection (withCause on the root)
 *   'built-in'        BOOTSTRAP / INITIALIZE / DISPOSE / RESOURCE (INITIALIZE never passes
 *                     action$: its STATE reducer opens the record)
 *   'next'            sent with action$.shamefullySendNext: a reducer's or EFFECT's next()
 *   'reply'           arrived on one of the instance's reply streams (src/extra/replies.ts)
 *   'behavior'        GS-1: a namespaced `<key>.<ACTION>` a behavior owns (the instance's
 *                     `_behaviorActions`, see isBehaviorAction below)
 *   'intent'          anything else on action$ (the intent streams)
 * The cause slot is synchronous: a setter sets it around the emission and the first action$._n
 * that follows consumes it, so actions an action triggers synchronously (EVENTS to another
 * component's intent) get their own cause.
 *
 * Sinks: a function reducer counts when it returns a value: not ABORT (or another symbol, which
 * the core drops), and for STATE not the state it was given (GS-4: no change); EFFECT counts when
 * the handler ran without ABORT. A constant / `true` entry always sends. A throwing reducer
 * sends nothing. Evaluations are matched to records FIFO per action + sink (the core applies
 * them in action order; STATE reducers later, in withState's microtask).
 */
import {isAbort, ORIGINAL} from '../../../shared'

export type ActionCause = 'intent' | 'next' | 'reply' | 'built-in' | 'simulateAction' | 'behavior'

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

interface Log {
  cause?: ActionCause
  listeners: ActionListener[]
  /** action -> its sinks: fn = evaluated (queued), else always sends */
  entries: Map<string, Array<{sink: string; fn: boolean}>>
  pend: Map<string, ActionRecord[]>
  streams?: boolean
}

const KEY = '__sygnalActionLog'
const BUILT_IN = /^(BOOTSTRAP|INITIALIZE|DISPOSE|RESOURCE)$/
/** a record waiting for a sink that never runs (no driver subscribed it) is dropped after this */
const MAX_PENDING = 50

/** now on the test's fake clock when there is one (vi.useFakeTimers()), else Date.now() */
export const clockNow = (): number => {
  const c = (setTimeout as any).clock
  return c ? c.now : Date.now()
}

const logOf = (c: any): Log | undefined => c && c[KEY]

/**
 * GS-1: an action is a behavior's when the instance's `_behaviorActions` (2-B's merge, behaviors.ts)
 * maps its namespaced type to a `uses` key ('pager.NEXT' → 'pager'). A host intent action of the
 * same name, or a host-only action named under a behavior key, is the host's ('intent').
 */
const isBehaviorAction = (c: any, type: string): boolean => {
  const owned = c._behaviorActions
  return !!owned && Object.prototype.hasOwnProperty.call(owned, type)
}

function causeOf(c: any, log: Log, type: string): ActionCause {
  if (log.cause == 'simulateAction') return log.cause
  if (BUILT_IN.test(type)) return 'built-in'
  if (log.cause) return log.cause
  if (isBehaviorAction(c, type)) return 'behavior'
  return 'intent'
}

function open(c: any, log: Log, action: any, cause: ActionCause): ActionRecord {
  const type = String(action.type)
  const rec: ActionRecord = {
    type,
    data: action.data,
    component: c.name,
    instance: String(c._componentNumber),
    sinks: [],
    cause,
    time: clockNow(),
  }
  for (const {sink, fn} of log.entries.get(type) || []) {
    if (!fn) { add(log, rec, sink, undefined); continue }
    const k = type + '::' + sink
    const q = log.pend.get(k) || []
    if (q.push(rec) > MAX_PENDING) q.shift()
    log.pend.set(k, q)
  }
  for (const l of log.listeners) try { l.action(rec, c) } catch (_) { /* a listener never breaks the app */ }
  return rec
}

function add(log: Log, rec: ActionRecord, sink: string, reducer: any): void {
  if (!rec.sinks.includes(sink)) {
    rec.sinks.push(sink)
    // in model order (STATE is applied after the other sinks ran), sorted in place: the array is live
    const order = (log.entries.get(rec.type) || []).map(e => e.sink)
    rec.sinks.sort((a, b) => order.indexOf(a) - order.indexOf(b))
  }
  for (const l of log.listeners) try { l.sink?.(rec, sink, reducer) } catch (_) { /* ignore */ }
}

/** the sink `reducer` is the model's function for (object form or 'ACTION | SINK' shorthand) */
function sinkOf(c: any, name: string, reducer: any, claimed: Set<string>): string | undefined {
  const model = c.model
  if (!model || typeof model != 'object') return
  for (const key of Object.keys(model)) {
    const v = model[key]
    const bar = key.indexOf('|')
    let found: string | undefined
    if (bar >= 0) {
      if (key.slice(0, bar).trim() == name && v === reducer) found = key.slice(bar + 1).trim()
    } else if (key == name && v && typeof v == 'object') {
      found = Object.keys(v).find(s => v[s] === reducer && s != c.stateSourceName && s != 'EFFECT' && !claimed.has(s))
    }
    if (found && !claimed.has(found)) { claimed.add(found); return found }
  }
}

function wrap(c: any, log: Log, name: string, sink: string | undefined, reducer: any): any {
  if (sink === undefined) return reducer
  const fn = typeof reducer == 'function'
  const list = log.entries.get(name) || []
  list.push({sink, fn})
  log.entries.set(name, list)
  if (!fn) return reducer
  const k = name + '::' + sink, isState = sink == c.stateSourceName, isEffect = sink == 'EFFECT'
  return function (this: any, state: any) {
    let rec = log.pend.get(k)?.shift()
    // an action that never passed action$ (INITIALIZE is merged in initModel$) opens here
    if (!rec) { open(c, log, {type: name, data: arguments[1]}, causeOf(c, log, name)); rec = log.pend.get(k)?.shift() }
    const r = reducer.apply(this, arguments)
    if (rec && !isAbort(r) && (isEffect || typeof r != 'symbol') && !(isState && r === state)) add(log, rec, sink, reducer[ORIGINAL] || reducer)
    return r
  }
}

/**
 * Start recording `c`'s actions (call from onIntent, before its action$ and model are built).
 * `listener.action` gets each record as the action reaches the model; `listener.sink` each sink
 * that produced a value for it.
 */
export function trackActions(c: any, listener: ActionListener): void {
  if (!c || typeof c != 'object') return
  let log = logOf(c)
  if (!log) {
    log = {listeners: [], entries: new Map(), pend: new Map()}
    const L = log
    Object.defineProperty(c, KEY, {value: log, configurable: true})
    const onAction = c.makeOnAction, onEffect = c.makeEffectHandler
    if (typeof onAction == 'function') {
      c.makeOnAction = function (this: any, _action$: any, isStateSink: boolean = true) {
        const on = onAction.apply(this, arguments as any)
        const claimed = new Set<string>()
        return function (this: any, name: string, reducer: any) {
          const sink = isStateSink ? c.stateSourceName : sinkOf(c, name, reducer, claimed)
          const args = [...arguments]
          args[1] = wrap(c, L, name, sink, reducer)
          return on.apply(this, args)
        }
      }
    }
    if (typeof onEffect == 'function') {
      c.makeEffectHandler = function (this: any, _action$: any, name: string, reducer: any) {
        const args = [...arguments]
        args[2] = wrap(c, L, name, 'EFFECT', reducer)
        return onEffect.apply(this, args)
      }
    }
  }
  if (!log.listeners.includes(listener)) log.listeners.push(listener)
}

/** Patch `c`'s action stream and reply streams (call from onModel, after trackActions). */
export function trackActionStreams(c: any): void {
  const log = logOf(c)
  const a$ = c && c.action$
  if (!log || log.streams || !a$ || typeof a$._n != 'function') return
  log.streams = true
  const n = a$._n, send = a$.shamefullySendNext
  a$._n = function (this: any, v: any) {
    if (v && typeof v == 'object' && v.type !== undefined) {
      const cause = causeOf(c, log, String(v.type))
      log.cause = undefined
      open(c, log, v, cause)
    }
    return n.apply(this, arguments as any)
  }
  a$.shamefullySendNext = function (this: any) {
    return withCause(c, 'next', () => send.apply(this, arguments as any))
  }
  for (const r$ of c._replies || []) {
    const rn = r$ && r$._n
    if (typeof rn != 'function') continue
    r$._n = function (this: any) { return withCause(c, 'reply', () => rn.apply(this, arguments as any)) }
  }
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
        : a.cause == 'next' || a.cause == 'reply' ? a.cause
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

/** Run `fn` with `cause` as the cause of the next action `c` runs (synchronously). */
export function withCause<T>(c: any, cause: ActionCause, fn: () => T): T {
  const log = logOf(c)
  if (!log) return fn()
  const prev = log.cause
  log.cause = cause
  try { return fn() } finally { log.cause = prev }
}
