/**
 * The language server's check worker (PLAN-7 L-1, G-657): a `worker_thread` that owns the
 * per-folder parse caches (core.js) and runs every check, fix-all and controls computation, so
 * the main thread stays free to answer hover and code-action requests while a check runs.
 *
 * Messages in:  { id, type: 'check' | 'index' | 'fixAll' | 'controls' | 'drop', payload, parts? }
 * Messages out: { id, result } or { id, error: { message, stack } }. With `parts` (a check,
 *               core.js "Parts"): { id, part } before the result (the early index, when the
 *               main thread asked for it), and after a result with `late: true` the late
 *               { id, part }, then { id, end: true }.
 * `workerData.want` (an Int32Array on a SharedArrayBuffer): set to 1 by the main thread when a
 * request waits on the check in flight (checker.js wantIndex); read and cleared when the check
 * decides whether its index goes early (core.js `wanted`).
 * Calls run one at a time in arrival order (a check is synchronous here, its late part included),
 * so builds never interleave on a cache; the main thread (checker.js) sends one call at a time.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { createCore } from './core.js'

const core = createCore()
const want = workerData?.want || null

parentPort.on('message', ({ id, type, payload, parts }) => {
  let reply
  const later = []
  try {
    if (typeof core[type] !== 'function') throw new Error(`unknown call: ${type}`)
    const opts = parts ? {
      part: (part) => parentPort.postMessage({ id, part }),
      wanted: () => !want || Atomics.exchange(want, 0, 0) === 1,
      defer: (fn) => later.push(fn),
    } : undefined
    reply = { id, result: core[type](payload, opts) }
  } catch (err) {
    later.length = 0
    reply = { id, error: { message: err?.message || String(err), stack: err?.stack } }
  }
  parentPort.postMessage(reply)
  if (!later.length) return
  for (const fn of later) {
    try {
      fn()
    } catch (err) {
      // (core's late work catches its own errors; a part that can't be posted still ends the wait)
      parentPort.postMessage({ id, part: { index: null, completion: null, error: err?.stack || String(err) } })
    }
  }
  parentPort.postMessage({ id, end: true })
})
