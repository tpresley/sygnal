// sygnal/replay: replay(). Runs a recording in renderComponent (mock DOM, no network, no real
// drivers) and compares it with the log, action by action and checkpoint by checkpoint.
//
// - The app starts from the log's `init` state. Sources the recording's app had get an inert
//   driver (./inert.ts), except makeFetchDriver / makeTimerDriver sources, which renderComponent
//   fakes (their requests and timers are real, their answers come from the log).
// - Log-driven: every input action (intent, reply, next, setState, ...) is dispatched from the
//   log to the instance at its address, with its recorded data and cause, through the runtime
//   API. An input the replayed code produces by itself (a fake timer's tick, a next() timeout, an
//   EVENTS re-emit) is dropped (the hook layer's onAction returns false, 7.2). So the order of
//   inputs is exactly the recorded one, whatever the replay's clock does, and nothing reaches a
//   server. Consequences (INITIALIZE, BOOTSTRAP, PARENT, ...) run for real.
// - The inputs are dispatched in the groups the recording flushed them in (one checkpoint each);
//   after each group the replay waits for the app to be quiet, then compares the root state and
//   the vnode with the checkpoint.
// - Each handler gets the clock and randomness its recorded counterpart read: its now() /
//   random() / uuid(), and the globals for code that still reads them (./entropy.ts).
// - Actions are aligned by key (address | type | occurrence), so the comparison of each action's
//   state hash and sink values survives a different number of dropped actions.
// - Q8: a recording made with another Sygnal version, or naming components / actions the code
//   doesn't have, warns (result.warnings, and console.warn unless `warn: false`) and still replays.
import {renderComponent} from '../testing'
import {decode, plain, diff, patch, vnodeString, fnv, stable, mask, maskAll, clone} from './format'
import {withEntropy, replayFrom, props as entropyProps} from './entropy'
import {addresses} from './address'
import {CAUSE, CAUSE_NAME, INPUT} from './recorder'
import {inertDriver} from './inert'
import {VERSION} from './version'

const tick = () => new Promise(r => setTimeout(r, 0))

export interface ReplayOptions {
  /** drivers to use instead of the inert ones (by source name) */
  drivers?: Record<string, any>
  /** more renderComponent options */
  render?: Record<string, any>
  /** stop after this many checkpoints */
  stopAt?: number
  /** false: handlers read the real clock and randomness (shows what the recorded values buy) */
  entropy?: boolean
  /** false: no console.warn for version / name mismatches (they are in result.warnings) */
  warn?: boolean
}

/** Replay a recording (the log object, or its JSON) on `Component`; see ReplayResult in replay.d.ts */
export async function replay(Component: any, recording: any, options: ReplayOptions = {}): Promise<any> {
  const {drivers = {}, render = {}, stopAt = Infinity, entropy = true, warn = true} = options
  const log = typeof recording == 'string' ? JSON.parse(recording) : recording
  if (!log || log.kind !== 'sygnal-recording' || typeof log.version != 'number') throw new Error('[sygnal/replay] replay(): not a Sygnal recording (kind: "sygnal-recording")')
  if (log.version > 1) throw new Error(`[sygnal/replay] replay(): recording format version ${log.version} is newer than this Sygnal reads (1)`)
  const warnings: string[] = []
  if (log.sygnal && log.sygnal !== VERSION) warnings.push(`recorded with Sygnal ${log.sygnal}, replayed with ${VERSION}`)
  const norm = log.redacted ? (v: any) => maskAll(plain(v)) : plain
  const h = (v: any) => fnv(stable(norm(v)))
  const text = log.redacted ? mask : undefined

  // the log's actions by alignment key
  const occ = new Map<string, number>()
  const keyOf = (path: string, type: string) => {
    const base = path + '|' + type
    const n = occ.get(base) || 0
    occ.set(base, n + 1)
    return base + '|' + n
  }
  const logged = new Map<string, any>()
  for (const a of log.a) logged.set(keyOf(log.p[a.p], a.y), a)
  occ.clear()

  const seen = new Map<string, any>()  // key -> the replay's record { h, f }
  const extra: any[] = []              // actions the replay ran that the log doesn't have
  const misses: string[] = []          // clock / randomness the replay's handlers read that wasn't logged
  const unhandled = new Set<string>()
  const created = new Set<string>()
  let api: any, addr: any, cur: any = null, lastVnode: any = null
  const expected: any[] = []           // [iv id, type, data] the replayer dispatched, not yet seen

  const D = (globalThis as any).__SYGNAL_DIAGNOSTICS__ ||= {}
  const L = (D.layers ||= new Set())
  let started = false
  const factory = (a: any) => {
    if (started) return {}
    started = true
    api = a
    addr = addresses(log.app)
    return {
      onCreate(iv: any) {
        addr.create(iv)
        if (created.has(iv.name)) return
        created.add(iv.name)
        const was = iv.isRoot ? log.components?.[log.app] : log.components?.[iv.name]
        const gone = was?.filter((t: string) => !iv.def.handlers.has(t))
        if (gone?.length) warnings.push(`${iv.name} no longer handles ${gone.join(', ')}`)
      },
      onDispose(iv: any) { addr.dispose(iv) },
      onAction(iv: any, action: any) {
        cur = null
        const c = CAUSE[action.cause] || action.cause
        const i = expected.findIndex(e => e[0] === iv.id && e[1] === action.type && e[2] === action.data)
        if (i >= 0) expected.splice(i, 1)
        // an input the replayed code made itself: its recorded twin is dispatched instead
        else if (INPUT.has(c)) return false
        const path = addr.of(iv)
        const key = keyOf(path, action.type)
        const rec: any = {key, y: action.type, path, c}
        const l = logged.get(key)
        if (c != 'S' && !iv.def.handlers.has(action.type) && l && (l.h || l.f)) unhandled.add(action.type)
        if (c == 'S') rec.h = h(action.data)
        seen.set(key, rec)
        if (!l) extra.push({key, type: action.type, path, cause: action.cause})
        if (c != 'S') cur = rec
      },
      wrapHandler(_iv: any, _type: string, _sink: string, fn: any) {
        const rec = cur
        if (typeof fn != 'function' || !rec || !entropy) return
        // one cursor per action, shared by its handlers (they read in log order)
        const take = rec.take ||= replayFrom(logged.get(rec.key)?.e, misses, `${rec.path} ${rec.y}`)
        return (s: any, d: any, n: any, p: any, ...rest: any[]) => withEntropy(take, () => fn(s, d, n, entropyProps(p, take), ...rest))
      },
      onReducer(_iv: any, _type: string, _prev: any, next: any) { if (cur) cur.h = h(next) },
      onSink(_iv: any, type: string | null, sink: string, value: any) {
        if (type === null || !cur) return
        ;(cur.f ||= []).push([sink, h(value)])
        ;(cur.fv ||= []).push([sink, plain(value)])
      },
      onPatch(v: any) { lastVnode = v },
    }
  }

  // inert drivers for the recording's other sources; renderComponent fakes HTTP / TIMER
  const inert: Record<string, any> = {}
  for (const [n, kind] of Object.entries(log.sources || {})) if (kind == 'other') inert[n] = inertDriver()
  L.add(factory)
  let t: any
  try {
    t = renderComponent(Component, {initialState: clone(log.init), drivers: {...inert, ...drivers}, ...render} as any)
  } finally { L.delete(factory) }
  await t.ready()

  const quiet = async () => {
    // a flush can queue another (BOOTSTRAP, a driver answering in sink delivery): wait until two
    // turns in a row patch nothing
    for (let i = 0, still = 0; i < 50 && still < 2; i++) {
      const before = lastVnode
      await api.flushed()
      await tick()
      still = lastVnode === before ? still + 1 : 0
    }
  }

  const dispatch = (a: any) => {
    const iv = addr.find(log.p[a.p])
    if (!iv) return false
    const data = a.d === undefined ? undefined : a.d && a.d.$echo ? iv.state : decode(a.d)
    expected.push([iv.id, a.c == 'S' ? 'setState' : a.y, data])
    if (a.c == 'S') api.setState(iv, data)
    else api.dispatch(iv, a.y, data, CAUSE_NAME[a.c] || 'intent')
    return true
  }

  const result: any = {ok: true, checkpoints: 0, actions: 0, divergence: null, view: null, effects: [], extra, missing: [], misses, unhandled: [], unresolved: [], warnings, final: undefined}
  await quiet()
  let state = norm(log.init)
  let ai = 0
  const pending: any[] = []
  const firstStateDiff: any[] = []
  for (const cp of log.k) {
    if (result.checkpoints >= stopAt) break
    if (cp.o) state = patch(state, cp.o)
    const group: any[] = []
    while (ai < log.a.length && log.a[ai].s <= cp.s) {
      const a = log.a[ai++]
      if (INPUT.has(a.c)) group.push(a)
    }
    // inputs whose target didn't exist yet are retried after the next quiet
    for (const a of [...pending.splice(0), ...group]) {
      if (dispatch(a)) result.actions++
      else pending.push(a)
    }
    await quiet()
    for (const a of pending.splice(0)) if (dispatch(a)) { result.actions++; await quiet() } else result.unresolved.push({s: a.s, type: a.y, path: log.p[a.p]})
    result.checkpoints++
    const now = norm(api.getState())
    const vh = fnv(vnodeString(lastVnode, text))
    const ops = diff(state, now)
    if (ops.length && !firstStateDiff.length) firstStateDiff.push({checkpoint: result.checkpoints - 1, s: cp.s, ops, expected: state, actual: now})
    if (!ops.length && vh !== cp.v && !result.view) {
      result.view = {checkpoint: result.checkpoints - 1, s: cp.s, expected: cp.v, actual: vh, html: vnodeString(lastVnode, text), ...(cp.html ? {expectedHtml: cp.html} : {})}
    }
  }
  // the inputs after the last checkpoint
  if (result.checkpoints < stopAt) {
    while (ai < log.a.length) { const a = log.a[ai++]; if (INPUT.has(a.c) && dispatch(a)) result.actions++ }
    await quiet()
    if (log.end?.o) state = patch(state, log.end.o)
    const now = norm(api.getState())
    const ops = diff(state, now)
    if (ops.length && !firstStateDiff.length) firstStateDiff.push({checkpoint: 'end', s: log.end?.s, ops, expected: state, actual: now})
  }

  // action by action: the first logged action whose state hash or sink values differ
  const upTo = result.checkpoints >= log.k.length ? Infinity : log.k[result.checkpoints - 1]?.s ?? 0
  occ.clear()
  for (const a of log.a) {
    if (a.s > upTo) break
    const key = keyOf(log.p[a.p], a.y)
    const r = seen.get(key)
    const at = {s: a.s, type: a.y, path: log.p[a.p], cause: CAUSE_NAME[a.c] || a.c, ...(a.d !== undefined ? {data: a.d} : {})}
    if (!r) { result.missing.push(at); if (!result.divergence && (a.h || a.f)) result.divergence = {...at, reason: 'the action did not run in the replay'}; continue }
    if ((a.h || null) !== (r.h || null) && !result.divergence) {
      result.divergence = {...at, reason: !r.h ? 'the action no longer changes the state' : !a.h ? 'the action now changes the state' : 'the action produced a different state'}
    }
    if (stable(a.f || []) !== stable(r.f || [])) result.effects.push({...at, expected: a.f || [], actual: r.f || [], values: r.fv || []})
  }
  if (firstStateDiff.length) {
    const d = firstStateDiff[0]
    if (!result.divergence) result.divergence = {s: d.s, reason: 'the root state differs at a checkpoint (no single action explains it)'}
    result.divergence.checkpoint = d.checkpoint
    result.divergence.diff = d.ops.map(([p, ...v]: any[]) => ({path: p.join('.'), ...(v.length ? {actual: v[0]} : {deleted: true}), expected: get(d.expected, p)}))
  }
  for (const n of Object.keys(log.components || {})) if (n !== log.app && !created.has(n) && log.a.some((a: any) => log.p[a.p].split('/').pop()!.replace(/[[:~].*$/, '') === n)) warnings.push(`${n} was not created in the replay`)
  if (warn && warnings.length) console.warn(`[sygnal/replay] ${log.app}: ${warnings.join('; ')} (the recording was still replayed)`)
  result.unhandled = [...unhandled]
  result.final = api.getState()
  result.ok = !result.divergence && !result.view && !result.effects.length && !result.unresolved.length && !result.unhandled.length
  result.t = t
  return result
}

const get = (o: any, path: any[]) => path.reduce((x, k) => (x == null ? undefined : x[k]), o)
