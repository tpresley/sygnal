/**
 * PLAN-4.6 core: teardown without timers (D165 / Q18). xstream stops a stream left without
 * listeners in a setTimeout of its own (1-2k timers to unmount 1k components). While an instance
 * unsubscribes (tearDown), Stream.prototype._remove queues such a stream instead (_stopID 0: an
 * _add before the stop cancels it, as xstream's clearTimeout would), and stopQueued() stops the
 * queue at the first macrotask after the drain / flush (G-302: xstream's timing; the runtime's
 * setImmediate / MessageChannel ping, no setTimeout). The swap is scoped to the call (PLAN-4.5's
 * tearDown, narrowed; R5 deleted the 5.x core's permanent one).
 */
import xs from '../extra/xstreamCompat'

// G-315: probed on first use (a top-level probe would survive the D175 strip of production builds)
let SP: any, NO: any, down: any[] | null = null, outer: any, owner: any
// G-342/G-267: the instance a queued stream was left by (its stop() error is reported for it)
const owners = new WeakMap<object, any>()
const probe = () => { if (!SP) { const s: any = xs.create(); SP = Object.getPrototypeOf(s); NO = s._prod } }

function removeQueued(this: any, il: any) {
  if (this._target) return this._target._remove(il)
  const a = this._ils, i = a.indexOf(il)
  if (i < 0) return
  a.splice(i, 1)
  if (this._prod !== NO && !a.length) { this._err = NO; this._stopID = 0; down!.push(this); if (owner) owners.set(this, owner) }
  else if (a.length == 1) this._pruneCycles()
}

/** run f with _remove queuing into q (nested calls share the outermost swap); `by`: the instance */
export function tearDown(f: () => void, q: any[], by?: any) {
  probe()
  const prev = down, prevBy = owner
  if (!prev) { outer = SP._remove; SP._remove = removeQueued }
  down = q
  if (by) owner = by
  try { f() } finally { down = prev; owner = prevBy; if (!prev) SP._remove = outer }
}

/**
 * stop the queued streams; a stop that leaves its upstream without listeners queues it here too.
 * A throwing stop() (a producer's) stops nothing else from stopping; G-342/G-267: it is reported
 * through `err` (with the instance that left the stream), not swallowed
 */
export function stopQueued(q: any[], err?: (e: any, by: any) => void) {
  probe()
  for (let i = 0; i < q.length; i++) {
    const s = q[i]
    if (s._stopID === 0 && !s._ils.length) {
      s._stopID = NO
      const by = owners.get(s)
      tearDown(() => { if (s._prod !== NO) try { s._stopNow() } catch (e) { err?.(e, by) } }, q, by)
    }
  }
  q.length = 0
}

/** the instance behind an intent's sources object (the source getters read it) */
export const INST = /*#__PURE__*/ Symbol('sygnal.inst')
/** the queue's action type for a state write (runtime setState, a child's seeded slice) */
export const SET = /*#__PURE__*/ Symbol('setState')
/** a child's seeded slice (D174), written even when it reads its initialState as the default */
export const SEED = /*#__PURE__*/ Symbol('seed')
