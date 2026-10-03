/**
 * PLAN-4 3-E (GS-10): the DevTools action log, in the dev-only 'sygnal/devtools' entry (0 B in
 * apps: nothing in the core calls it).
 *
 * It records every action of every component instance through 2-C's recorder
 * (./diagnostics/checks/actionLog: trackActions / trackActionStreams), installed from a check
 * registered on the core's diagnostics bridge (globalThis.__SYGNAL_DIAGNOSTICS__) with
 * `always: true`, so it records with diagnostics off too. On top of 2-C's record it keeps:
 *   seq, at        a sequence number, ms since the session started
 *   parent         the parent instance id (null: a root)
 *   before, after  the instance's state around the action's STATE reducer (onReducer), when it
 *                  changed the state (`after` without calculated fields)
 *   replySink      for a reply action (and RESOURCE): the source that delivered it, and
 *   replyKind      'fetch' when that source is makeFetchDriver's (renderComponent fakes it)
 *
 * A session runs from the recorder's start (or the last clearActions()) to now. getSession()
 * turns it into a SessionRecording for one instance (./copyAsTest generates the test).
 */
import {trackActions, trackActionStreams, clockNow} from './diagnostics/checks/actionLog'
import type {ActionListener, ActionRecord, ActionCause} from './diagnostics/checks/actionLog'

export type {ActionCause}

export interface DevtoolsAction {
  seq: number
  type: string
  data: any
  component: string
  instance: string
  parent: string | null
  /** live: fills in as the action's reducers run */
  sinks: string[]
  cause: ActionCause
  /** ms since the session started */
  at: number
  before?: any
  after?: any
  replySink?: string
  replyKind?: 'fetch' | 'other'
  /** an intent action whose data is the instance's own state (an intent over STATE.stream) */
  echo?: true
}

export interface SessionAction {
  type: string
  data: any
  cause: ActionCause
  sinks: string[]
  at: number
  replySink?: string
  replyKind?: 'fetch' | 'other'
  echo?: true
}

/** One instance's session: what copyAsTest() needs (plain data, raw action data) */
export interface SessionRecording {
  version: 1
  component: string
  instance: string
  /** the state when the session started for this instance (undefined: unknown) */
  initialState?: any
  /** the component's own `initialState` (renderComponent's default) */
  definitionInitialState?: any
  finalState: any
  /** the action names the component can be sent (model keys, behavior actions); undefined: any */
  actionNames?: string[]
  /** source names beyond DOM / EVENTS / STATE / LOG / CHILD / PARENT / READY */
  drivers: string[]
  /** those of `drivers` renderComponent fakes (makeFetchDriver sources: t.respond / t.fail) */
  fakeable: string[]
  /** the instance's own actions, in order */
  actions: SessionAction[]
  /** state changes in descendant instances a root-level replay can't reproduce */
  foreign: Array<{type: string; component: string; instance: string; cause: ActionCause}>
  /** the session lost its oldest actions (more than the recorder keeps) */
  truncated?: boolean
}

export interface ActionFilter {
  component?: string
  instance?: string | number
  type?: string | RegExp
  cause?: ActionCause | ActionCause[]
}

interface Inst {
  c: any
  id: string
  name: string
  parent: string | null
  stateName: string
  /** created after the session started */
  inSession: boolean
  hasInitial: boolean
  initial?: any
  disposed: boolean
}

const MAX = 5000
const STANDARD = /^(DOM|EVENTS|LOG|CHILD|PARENT|READY|props\$|children\$|dispose\$)$/

let actions: DevtoolsAction[] = []
let seq = 0
let epoch = clockNow()
let truncated = false
let created = 0
const insts = new Map<string, Inst>()
const byRec = new WeakMap<ActionRecord, DevtoolsAction>()
/** instance -> the action whose STATE reducer just produced a value (its onReducer follows) */
const pendingState = new WeakMap<any, DevtoolsAction>()
/** instance -> the reply source delivering right now */
const replySlot = new WeakMap<any, string>()
const patched = new WeakSet<any>()
const subscribers = new Set<(a: DevtoolsAction | null, kind: 'add' | 'update' | 'reset') => void>()

const notify = (a: DevtoolsAction | null, kind: 'add' | 'update' | 'reset') => {
  for (const s of subscribers) try { s(a, kind) } catch (_) { /* a subscriber never breaks the app */ }
}

const idOf = (c: any) => String(c && c._componentNumber)

function ensure(c: any): Inst {
  const id = idOf(c)
  let i = insts.get(id)
  if (!i || i.c !== c) {
    const p = c && c.sources && c.sources.__parentComponentNumber
    i = {c, id, name: c && c.name, parent: typeof p == 'number' ? String(p) : null, stateName: (c && c.stateSourceName) || 'STATE',
      inSession: true, hasInitial: false, disposed: false}
    ;(i as any).order = ++created
    insts.set(id, i)
  }
  return i
}

function clean(c: any, s: any): any {
  try { return typeof c.cleanupCalculated == 'function' ? c.cleanupCalculated(s) : s } catch (_) { return s }
}

const listener: ActionListener = {
  action(r, c) {
    const info = ensure(c)
    // the instance's state when its session started: INITIALIZE's data (its initial state), else
    // the state it had at its first action
    if (r.type == 'INITIALIZE' && info.inSession) { info.initial = r.data; info.hasInitial = true }
    else if (!info.hasInitial) { info.initial = c.currentState; info.hasInitial = true }
    const a: DevtoolsAction = {seq: ++seq, type: r.type, data: r.data, component: r.component, instance: r.instance,
      parent: info.parent, sinks: r.sinks, cause: r.cause, at: r.time - epoch}
    const slot = replySlot.get(c)
    if (slot !== undefined && (r.cause == 'reply' || r.type == 'RESOURCE')) {
      a.replySink = slot
      a.replyKind = c.sources && c.sources[slot] && c.sources[slot].__sygnalStatic === 'resources' ? 'fetch' : 'other'
    }
    if (r.cause == 'intent' && isStateEcho(r.data, c.currentState)) a.echo = true
    byRec.set(r, a)
    actions.push(a)
    if (actions.length > MAX) { actions.shift(); truncated = true }
    notify(a, 'add')
  },
  sink(r, sink) {
    const a = byRec.get(r)
    if (!a) return
    const info = insts.get(r.instance)
    if (info && info.c && sink == info.stateName) pendingState.set(info.c, a)
    notify(a, 'update')
  },
}

/** the reply streams' source names (the order of c._replies, see src/component.ts) */
function patchReplies(c: any): void {
  if (patched.has(c)) return
  patched.add(c)
  const names = (c.sourceNames || []).filter((n: string) => c.sources && c.sources[n] && c.sources[n].__sygnalReplies === true)
  ;(c._replies || []).forEach((r$: any, i: number) => {
    const n = r$ && r$._n
    if (typeof n != 'function' || names[i] === undefined) return
    r$._n = function (this: any) {
      const prev = replySlot.get(c)
      replySlot.set(c, names[i])
      try { return n.apply(this, arguments as any) } finally { prev === undefined ? replySlot.delete(c) : replySlot.set(c, prev) }
    }
  })
}

const check = {
  id: 'devtools-actions',
  // dev-only entry: record with diagnostics 'off' too
  always: true,
  onIntent(c: any) {
    ensure(c)
    trackActions(c, listener)
  },
  onModel(c: any) {
    trackActionStreams(c)
    patchReplies(c)
  },
  onReducer(c: any, name: string, prev: any, next: any, sink: string) {
    const a = pendingState.get(c)
    if (!a || a.type !== name || sink !== (c.stateSourceName || 'STATE') || 'after' in a) return
    pendingState.delete(c)
    a.before = prev
    a.after = clean(c, next)
    notify(a, 'update')
  },
  onDispose(c: any) {
    const i = insts.get(idOf(c))
    if (i && i.c === c) { i.disposed = true; i.c = undefined }
  },
}

let unregister: (() => void) | undefined

/**
 * Start recording actions (idempotent; 'sygnal/devtools' does it on import in a browser). Only
 * components created afterwards are recorded. Returns a function that stops recording.
 */
export function recordActions(): () => void {
  if (!unregister) {
    const core = (globalThis as any).__SYGNAL_DIAGNOSTICS__
    if (!core || typeof core.registerCheck != 'function') return () => {}
    unregister = core.registerCheck(check)
  }
  return stopRecording
}

function stopRecording(): void {
  if (unregister) { unregister(); unregister = undefined }
}

export const isRecording = (): boolean => !!unregister

/** Start a new session: forget the recorded actions; each live instance's state is its new initial state. */
export function clearActions(): void {
  actions = []
  epoch = clockNow()
  truncated = false
  for (const [id, i] of insts) {
    if (i.disposed) { insts.delete(id); continue }
    i.inSession = false
    i.initial = i.c && i.c.currentState
    i.hasInitial = true
  }
  notify(null, 'reset')
}

const matches = (a: DevtoolsAction, f: ActionFilter) =>
  (f.component === undefined || a.component === f.component) &&
  (f.instance === undefined || a.instance === String(f.instance)) &&
  (f.type === undefined || (typeof f.type == 'string' ? a.type === f.type : f.type.test(a.type))) &&
  (f.cause === undefined || ([] as ActionCause[]).concat(f.cause).includes(a.cause))

/** The session's actions (oldest first), optionally filtered by component, instance, type or cause. */
export function getActions(filter?: ActionFilter): DevtoolsAction[] {
  return filter ? actions.filter(a => matches(a, filter)) : actions.slice()
}

/** Subscribe to the log: (action, 'add' | 'update') and (null, 'reset'). Returns unsubscribe. */
export function onAction(fn: (a: DevtoolsAction | null, kind: 'add' | 'update' | 'reset') => void): () => void {
  subscribers.add(fn)
  return () => { subscribers.delete(fn) }
}

/** the live instances, newest first */
const live = () => [...insts.values()].filter(i => !i.disposed && i.c).sort((a, b) => (b as any).order - (a as any).order)

/**
 * The instance a session target names: undefined (the newest live root), an instance id, a
 * component function (its newest live instance) or run()'s result (its root, by DOM source).
 */
export function resolveInstance(target?: any): Inst | undefined {
  const all = live()
  if (target === undefined || target === null) return all.find(i => i.parent === null)
  if (typeof target == 'string' || typeof target == 'number') return insts.get(String(target))
  if (typeof target == 'function') return all.find(i => i.c.view === target)
  if (typeof target == 'object') {
    const s = target.sources
    if (s && typeof s == 'object') {
      return all.find(i => i.parent === null && Object.keys(s).some(k => k != 'STATE' && s[k] && i.c.sources && i.c.sources[k] === s[k])) ||
        all.find(i => i.parent === null)
    }
  }
  return undefined
}

function descendants(id: string): Set<string> {
  const out = new Set<string>()
  let grew = true
  while (grew) {
    grew = false
    for (const i of insts.values()) if (i.parent !== null && (i.parent === id || out.has(i.parent)) && !out.has(i.id)) { out.add(i.id); grew = true }
  }
  // instances already pruned: their actions still name their parent
  for (const a of actions) if (a.parent !== null && (a.parent === id || out.has(a.parent))) out.add(a.instance)
  return out
}

const REPLAYED = new Set<ActionCause>(['intent', 'simulateAction', 'behavior', 'reply'])

/**
 * The session of one instance (see resolveInstance for `target`) as plain data: its initial
 * and final state, its own actions, and the state changes of its descendants (a replay at this
 * instance can't reproduce them).
 */
export function getSession(target?: any): SessionRecording {
  const info = resolveInstance(target)
  if (!info) throw new Error('[Sygnal DevTools] getSession: no live component instance matches' + (target === undefined ? ' (no root recorded: import sygnal/devtools before run())' : ''))
  const c = info.c
  const desc = descendants(info.id)
  const stateNameOf = (id: string) => insts.get(id)?.stateName || 'STATE'
  const model = c.model && typeof c.model == 'object' ? Object.keys(c.model).map(k => k.split('|')[0].trim()) : undefined
  const behaviors = c._behaviorActions && typeof c._behaviorActions == 'object' ? Object.keys(c._behaviorActions) : []
  const sources = c.sources || {}
  const drivers = (c.sourceNames || Object.keys(sources)).filter((n: string) =>
    !STANDARD.test(n) && n !== info.stateName && n != 'STATE' && n != 'state' && !n.startsWith('__'))
  return {
    version: 1,
    component: info.name,
    instance: info.id,
    initialState: info.hasInitial ? info.initial : undefined,
    definitionInitialState: c.view ? c.view.initialState : undefined,
    finalState: c.currentState,
    actionNames: model ? [...model, ...behaviors] : undefined,
    drivers,
    fakeable: drivers.filter((n: string) => sources[n] && sources[n].__sygnalStatic === 'resources'),
    actions: actions.filter(a => a.instance === info.id).map(a => ({
      type: a.type, data: a.data, cause: a.cause, sinks: [...a.sinks], at: a.at,
      ...(a.replySink !== undefined ? {replySink: a.replySink, replyKind: a.replyKind} : {}),
      ...(a.echo ? {echo: true as const} : {}),
    })),
    foreign: actions.filter(a => desc.has(a.instance) && REPLAYED.has(a.cause) && a.sinks.includes(stateNameOf(a.instance)))
      .map(a => ({type: a.type, component: a.component, instance: a.instance, cause: a.cause})),
    ...(truncated ? {truncated: true} : {}),
  }
}

/** A JSON-safe copy for the panel: DOM elements and events become short descriptions. */
export function preview(v: any): any {
  if (v === undefined) return undefined
  const seen = new WeakSet<object>()
  try {
    return JSON.parse(JSON.stringify(v, (_k, x) => {
      if (typeof x == 'function') return `[Function ${x.name || 'anonymous'}]`
      if (typeof x == 'symbol') return String(x)
      if (typeof x == 'bigint') return `${x}n`
      if (x && typeof x == 'object') {
        if (isElement(x)) return describeElement(x)
        if (isEvent(x)) return `[${x.constructor && x.constructor.name || 'Event'} ${x.type}]`
        if (x instanceof Map) return {'[Map]': [...x.entries()]}
        if (x instanceof Set) return {'[Set]': [...x.values()]}
        if (seen.has(x)) return '[Circular]'
        seen.add(x)
      }
      return x
    }))
  } catch (_) {
    return '[unserializable]'
  }
}

const isPlain = (x: any) => !!x && typeof x == 'object' && (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null)

export function deepEqual(a: any, b: any): boolean {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a != 'object' || typeof b != 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a).filter(k => a[k] !== undefined), kb = Object.keys(b).filter(k => b[k] !== undefined)
  return ka.length == kb.length && ka.every(k => deepEqual(a[k], b[k]))
}

/**
 * The data is the state itself (STATE.stream in the intent; calculated fields may be added): the
 * replay sends it again by itself, so it isn't replayed.
 */
function isStateEcho(data: any, state: any): boolean {
  if (!isPlain(data) || !isPlain(state)) return false
  const keys = Object.keys(state)
  return keys.length > 0 && (data === state || keys.every(k => deepEqual(data[k], state[k])))
}

export const isElement = (x: any): boolean => !!x && typeof x == 'object' && x.nodeType === 1 && typeof x.tagName == 'string'
export const isEvent = (x: any): boolean => !!x && typeof x == 'object' && typeof x.type == 'string' && typeof x.preventDefault == 'function' && 'target' in x

const describeElement = (el: any) => {
  const cls = typeof el.className == 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : ''
  return `<${String(el.tagName).toLowerCase()}${el.id ? '#' + el.id : ''}${cls}>`
}

/** test seam: forget everything (sessions, instances); recording stays as it is */
export function _resetActionLog(): void {
  actions = []
  seq = 0
  epoch = clockNow()
  truncated = false
  insts.clear()
}
