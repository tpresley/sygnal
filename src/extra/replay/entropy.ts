// sygnal/replay: the clock and randomness a handler reads.
//
// The canonical form (7.2) is explicit: a handler's 4th argument has now(), random() and uuid(),
// and the recorder / replayer wrap them (props(), below), which also covers an async EFFECT after
// an `await`. For code that still reads the globals, the fallback of the research spike stays:
// for the duration of one synchronous handler call, Date.now(), new Date() (no arguments),
// Math.random(), performance.now() and crypto.randomUUID() are swapped for versions that log what
// they returned ([kind, value] pairs, in call order), or that return the logged values in the same
// order. Kinds: 'now', 'random', 'uuid' (shared by both paths), 'perf' (performance.now()).

export type Take = (kind: string, real: () => any) => any

const g: any = globalThis
let take: Take | null = null   // the current handler's `take`, while one runs
let F: any                     // the real functions and the fakes, made on first use (no import side effects)

function fakes() {
  if (F) return F
  const RealDate = g.Date
  const real = {now: RealDate.now.bind(RealDate), random: Math.random, perf: g.performance?.now?.bind(g.performance), uuid: g.crypto?.randomUUID?.bind(g.crypto)}
  // the fakes read `take`
  const now = () => take!('now', real.now)
  function FakeDate(this: any, ...args: any[]): any {
    if (!new.target) return new RealDate(now()).toString()
    return args.length ? new RealDate(...args) : new RealDate(now())
  }
  FakeDate.prototype = RealDate.prototype
  FakeDate.now = now
  FakeDate.parse = RealDate.parse
  FakeDate.UTC = RealDate.UTC
  return (F = {Date: FakeDate, random: () => take!('random', real.random), perf: () => take!('perf', real.perf), uuid: () => take!('uuid', real.uuid)})
}

/**
 * Run `fn` with the global entropy sources replaced by `t(kind, real)`: `real()` gives the real
 * value; `t` returns the value the code sees. Nested calls keep the outer `t`.
 */
export function withEntropy<T>(t: Take, fn: () => T): T {
  if (take) return fn()
  const saved = {Date: g.Date, random: Math.random, perf: g.performance?.now, uuid: g.crypto?.randomUUID}
  const f = fakes()
  take = t
  g.Date = f.Date
  Math.random = f.random
  if (saved.perf) g.performance.now = f.perf
  if (saved.uuid) try { g.crypto.randomUUID = f.uuid } catch (_) { /* read-only crypto */ }
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

/** run `fn` with the globals' fakes passing through (a props function's own source, not logged twice) */
function passThrough<T>(fn: () => T): T {
  if (!take) return fn()
  const t = take
  take = (_k, r) => r()
  try { return fn() } finally { take = t }
}

/**
 * A handler's 4th argument with now() / random() / uuid() going through `t` (the values the app
 * supplies — renderComponent's fixed clock, the real ones — are `real`). A prop of the same name
 * that isn't a function (it shadows the core's) is left alone.
 */
export function props(p: any, t: Take): any {
  if (!p || typeof p != 'object') return p
  const out = {...p}
  for (const k of ['now', 'random', 'uuid']) {
    const f = p[k]
    if (typeof f == 'function') out[k] = () => t(k, () => passThrough(f))
  }
  return out
}

/** a recording `take`: hands each read to `add` as [kind, value] */
export const recordInto = (add: (pair: [string, any]) => void): Take => (kind, r) => {
  const v = r()
  add([kind, v])
  return v
}

/**
 * A replaying `take` over a logged list: the next logged value of the same kind; when the code
 * asks for more than was logged (or another kind), the real value, noted in `misses`.
 */
export const replayFrom = (list: any[] | undefined, misses: string[], label?: string): Take => {
  let i = 0
  return (kind, r) => {
    if (list && i < list.length && list[i][0] === kind) return list[i++][1]
    misses.push(label ? `${label}: ${kind}` : kind)
    return r()
  }
}
