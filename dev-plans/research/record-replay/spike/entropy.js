// Record/replay spike: the nondeterminism a reducer can reach while it runs.
//
// A model handler is synchronous, so for the duration of one call the recorder swaps
// Date.now(), new Date() (no arguments), Math.random(), performance.now() and
// crypto.randomUUID() for versions that log what they returned ([kind, value] pairs, in call
// order); the replayer swaps them for versions that return the logged values in the same order.
// Anything after an `await` in an async EFFECT escapes (the real functions are back by then).

const g = globalThis
const RealDate = Date
const real = { now: RealDate.now.bind(RealDate), random: Math.random, perf: g.performance?.now?.bind(g.performance), uuid: g.crypto?.randomUUID?.bind(g.crypto) }
let take = null   // the current handler's `take`, while one runs

// the fakes, made once: they read `take`
const now = () => take('now', real.now)
function FakeDate(...args) {
  if (!new.target) return new RealDate(now()).toString()
  return args.length ? new RealDate(...args) : new RealDate(now())
}
FakeDate.prototype = RealDate.prototype
FakeDate.now = now
FakeDate.parse = RealDate.parse
FakeDate.UTC = RealDate.UTC
const fakeRandom = () => take('random', real.random)
const fakePerf = () => take('perf', real.perf)
const fakeUuid = () => take('uuid', real.uuid)

/**
 * Run `fn` with the entropy sources replaced by `t(kind, real)`: `real()` gives the real
 * value; `t` returns the value the code sees. Nested calls (a handler running another's code)
 * keep the outer `t`.
 */
export function withEntropy(t, fn) {
  if (take) return fn()
  const saved = { Date: g.Date, random: Math.random, perf: g.performance?.now, uuid: g.crypto?.randomUUID }
  take = t
  g.Date = FakeDate
  Math.random = fakeRandom
  if (saved.perf) g.performance.now = fakePerf
  if (saved.uuid) try { g.crypto.randomUUID = fakeUuid } catch (_) { /* read-only crypto */ }
  try {
    return fn()
  } finally {
    take = null
    g.Date = saved.Date
    Math.random = saved.random
    if (saved.perf) g.performance.now = saved.perf
    if (saved.uuid) try { if (g.crypto.randomUUID !== saved.uuid) { delete g.crypto.randomUUID; if (g.crypto.randomUUID !== saved.uuid) g.crypto.randomUUID = saved.uuid } } catch (_) { /* read-only */ }
  }
}

/** a recording `take`: logs into `out` (an array of [kind, value]) */
export const recordInto = out => (kind, real) => {
  const v = real()
  out.push([kind, v])
  return v
}

/**
 * A replaying `take` over a logged list: the next logged value of the same kind; when the code
 * asks for more than was logged (or another kind), the real value, noted in `misses`.
 */
export const replayFrom = (list, misses, label) => {
  let i = 0
  return (kind, real) => {
    if (list && i < list.length && list[i][0] === kind) return list[i++][1]
    misses.push(label ? `${label}: ${kind}` : kind)
    return real()
  }
}
