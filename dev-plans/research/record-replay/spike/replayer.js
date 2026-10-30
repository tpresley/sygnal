// Record/replay spike: the replayer. Runs a recording in renderComponent (mock DOM, no network,
// no real drivers) and compares it with the log, action by action and checkpoint by checkpoint.
//
// How (README §4):
// - The app starts from the log's `init` state. Sources the recording's app had get an inert
//   driver (./inert.js), except makeFetchDriver / makeTimerDriver sources, which renderComponent
//   fakes (their requests and timers are real, their answers come from the log).
// - Log-driven: every input action (intent, reply, next, ...) is dispatched from the log, to the
//   instance at its address, with its recorded data and cause, through the runtime API's
//   dispatch(). An input the replayed code produces by itself (a DOM intent in the mock DOM, a
//   fake timer's tick, a next() timeout, an EVENTS re-emit) is muted: the hook layer's
//   wrapHandler gives its handlers `() => ABORT`. So the order of inputs is exactly the
//   recorded one, whatever the replay's clock does, and nothing reaches a server.
// - Consequences (INITIALIZE, BOOTSTRAP, PARENT, ...) run for real: the code under test makes them.
// - The inputs are dispatched in the groups the recording flushed them in (one checkpoint each);
//   after each group the replay waits for the app to be quiet, then compares the root state and
//   the vnode with the checkpoint.
// - Each handler runs with the entropy its recorded counterpart read (./entropy.js).
// - Actions are aligned by key (address | type | occurrence), so the comparison of each action's
//   state hash and sink values survives a different number of muted actions.
//
// The result: { ok, checkpoints, actions, divergence, view, effects, extra, missing, misses,
// unhandled, final }. `divergence` is the first action whose instance state differs (with the
// root-state diff at that action's checkpoint); `view` the first checkpoint whose vnode differs
// while the state matches (a view-only change); `effects` sink values that differ.
import { renderComponent, ABORT } from 'sygnal'
import { decode, plain, diff, patch, vnodeString, fnv, stable, mask, maskAll } from './format.js'
import { withEntropy, replayFrom } from './entropy.js'
import { addresses } from './address.js'
import { CAUSE, INPUT } from './recorder.js'
import { inertDriver } from './inert.js'

const CAUSE_NAME = Object.fromEntries(Object.entries(CAUSE).map(([k, v]) => [v, k]))
const tick = () => new Promise(r => setTimeout(r, 0))

/**
 * Replay `log` on `Component`. Options:
 *   drivers   drivers to use instead of the inert ones (by source name)
 *   render    more renderComponent options
 *   stopAt    stop after this many checkpoints
 *   entropy   false: handlers read the real Date.now() / Math.random() (shows what injecting buys)
 */
export async function replay(Component, log, { drivers = {}, render = {}, stopAt = Infinity, entropy = true } = {}) {
  const norm = log.redacted ? v => maskAll(plain(v)) : plain
  const h = v => fnv(stable(norm(v)))
  const text = log.redacted ? mask : undefined

  // the log's actions by alignment key
  const occ = new Map()
  const keyOf = (path, type) => {
    const base = path + '|' + type
    const n = occ.get(base) || 0
    occ.set(base, n + 1)
    return base + '|' + n
  }
  const logged = new Map()
  for (const a of log.a) logged.set(keyOf(log.p[a.p], a.y), a)
  occ.clear()

  const seen = new Map()  // key -> the replay's record { h, f, muted }
  const extra = []        // actions the replay ran that the log doesn't have
  const misses = []       // entropy the replay's handlers asked for that wasn't logged
  const unhandled = new Set()
  let api, addr, cur = null, lastVnode = null
  const expected = []     // [iv id, type, data] the replayer dispatched, not yet seen

  const D = (globalThis.__SYGNAL_DIAGNOSTICS__ ||= {})
  const L = (D.layers ||= new Set())
  let started = false
  const factory = a => {
    if (started) return {}
    started = true
    api = a
    addr = addresses(log.app)
    return {
      onCreate(iv) { addr.create(iv) },
      onDispose(iv) { addr.dispose(iv) },
      onAction(iv, action) {
        const c = CAUSE[action.cause] || action.cause
        const e = expected[0]
        const ours = e && e[0] === iv.id && e[1] === action.type && e[2] === action.data
        if (ours) expected.shift()
        if (INPUT.has(c) && !ours) { cur = { muted: true }; return }
        const key = keyOf(addr.of(iv), action.type)
        const rec = { key, s: logged.get(key)?.s, y: action.type, path: addr.of(iv), c }
        if (!iv.def.handlers.has(action.type) && logged.has(key) && (logged.get(key).h || logged.get(key).f)) unhandled.add(action.type)
        seen.set(key, rec)
        if (!logged.has(key)) extra.push({ key, type: action.type, path: rec.path, cause: action.cause })
        cur = rec
      },
      wrapHandler(iv, type, sink, fn) {
        const rec = cur
        if (rec && rec.muted) return () => ABORT
        if (typeof fn != 'function' || !rec || !entropy) return fn
        const list = logged.get(rec.key)?.e
        // one cursor per action, shared by its handlers (they read entropy in log order)
        const take = rec.take ||= replayFrom(list, misses, `${rec.path} ${rec.y}`)
        return (...args) => withEntropy(take, () => fn(...args))
      },
      onReducer(iv, type, prev, next) { if (cur && !cur.muted) cur.h = h(next) },
      onSink(iv, type, sink, value) {
        if (type === null || !cur || cur.muted) return
        ;(cur.f ||= []).push([sink, h(value)])
        ;(cur.fv ||= []).push([sink, plain(value)])
      },
      onPatch(v) { lastVnode = v },
    }
  }

  // inert drivers for the recording's other sources; renderComponent fakes HTTP / TIMER
  const inert = {}
  for (const [n, kind] of Object.entries(log.sources || {})) if (kind == 'other') inert[n] = inertDriver()
  L.add(factory)
  let t
  try {
    t = renderComponent(Component, { initialState: structuredClone(log.init), drivers: { ...inert, ...drivers }, ...render })
  } finally { L.delete(factory) }
  await t.ready()

  const quiet = async () => {
    // a flush can queue another (BOOTSTRAP, a driver answering in sink delivery): wait until two
    // turns in a row patch nothing
    for (let i = 0, stable = 0; i < 50 && stable < 2; i++) {
      const before = lastVnode
      await api.flushed()
      await tick()
      stable = lastVnode === before ? stable + 1 : 0
    }
  }

  const dispatch = a => {
    const path = log.p[a.p]
    const iv = addr.find(path)
    if (!iv) return false
    let data = a.d === undefined ? undefined : a.d && a.d.$echo ? iv.state : decode(a.d)
    expected.push([iv.id, a.y, data])
    api.dispatch(iv, a.y, data, CAUSE_NAME[a.c] || 'intent')
    return true
  }

  const result = { ok: true, checkpoints: 0, actions: 0, divergence: null, view: null, effects: [], extra, missing: [], misses, unhandled: [], unresolved: [], final: undefined }
  await quiet()
  let state = norm(log.init)
  let ai = 0
  const pending = []
  const firstStateDiff = []
  for (const cp of log.k) {
    if (result.checkpoints >= stopAt) break
    if (cp.o) state = patch(state, cp.o)
    const group = []
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
    for (const a of pending.splice(0)) if (dispatch(a)) { result.actions++; await quiet() } else result.unresolved.push({ s: a.s, type: a.y, path: log.p[a.p] })
    result.checkpoints++
    const now = norm(api.getState())
    const vh = fnv(vnodeString(lastVnode, text))
    const ops = diff(state, now)
    if (ops.length && !firstStateDiff.length) firstStateDiff.push({ checkpoint: result.checkpoints - 1, s: cp.s, ops, expected: state, actual: now })
    if (!ops.length && vh !== cp.v && !result.view) {
      result.view = { checkpoint: result.checkpoints - 1, s: cp.s, expected: cp.v, actual: vh, html: vnodeString(lastVnode, text), ...(cp.html ? { expectedHtml: cp.html } : {}) }
    }
  }
  // the inputs after the last checkpoint
  if (result.checkpoints < stopAt) {
    while (ai < log.a.length) { const a = log.a[ai++]; if (INPUT.has(a.c) && dispatch(a)) result.actions++ }
    await quiet()
    if (log.end?.o) state = patch(state, log.end.o)
    const now = norm(api.getState())
    const ops = diff(state, now)
    if (ops.length && !firstStateDiff.length) firstStateDiff.push({ checkpoint: 'end', s: log.end?.s, ops, expected: state, actual: now })
  }

  // action by action: the first logged action whose state hash or sink values differ
  const upTo = result.checkpoints >= log.k.length ? Infinity : log.k[result.checkpoints - 1]?.s ?? 0
  occ.clear()
  for (const a of log.a) {
    if (a.s > upTo) break
    const key = keyOf(log.p[a.p], a.y)
    const r = seen.get(key)
    const at = { s: a.s, type: a.y, path: log.p[a.p], cause: CAUSE_NAME[a.c] || a.c, ...(a.d !== undefined ? { data: a.d } : {}) }
    if (!r) { result.missing.push(at); if (!result.divergence && (a.h || a.f)) result.divergence = { ...at, reason: 'the action did not run in the replay' }; continue }
    if ((a.h || null) !== (r.h || null) && !result.divergence) {
      result.divergence = { ...at, reason: !r.h ? 'the action no longer changes the state' : !a.h ? 'the action now changes the state' : 'the action produced a different state' }
    }
    if (stable(a.f || []) !== stable(r.f || [])) result.effects.push({ ...at, expected: a.f || [], actual: r.f || [], values: r.fv || [] })
  }
  if (firstStateDiff.length) {
    const d = firstStateDiff[0]
    if (!result.divergence) result.divergence = { s: d.s, reason: 'the root state differs at a checkpoint (no single action explains it)' }
    result.divergence.checkpoint = d.checkpoint
    result.divergence.diff = d.ops.map(([p, ...v]) => ({ path: p.join('.'), ...(v.length ? { actual: v[0] } : { deleted: true }), expected: get(d.expected, p) }))
  }
  result.unhandled = [...unhandled]
  result.final = api.getState()
  result.ok = !result.divergence && !result.view && !result.effects.length && !result.unresolved.length && !result.unhandled.length
  result.t = t
  return result
}

const get = (o, path) => path.reduce((x, k) => (x == null ? undefined : x[k]), o)
