/**
 * The language server's check worker (PLAN-7 L-1, G-657): a `worker_thread` that owns the
 * per-folder parse caches (core.js) and runs every check, fix-all and controls computation, so
 * the main thread stays free to answer hover and code-action requests while a check runs.
 *
 * Messages in:  { id, type: 'check' | 'fixAll' | 'controls' | 'drop', payload }
 * Messages out: { id, result } or { id, error: { message, stack } }
 * Calls run one at a time in arrival order (a check is synchronous here), so builds never
 * interleave on a cache; the main thread (checker.js) sends one call at a time anyway.
 */
import { parentPort } from 'node:worker_threads'
import { createCore } from './core.js'

const core = createCore()

parentPort.on('message', ({ id, type, payload }) => {
  let reply
  try {
    if (typeof core[type] !== 'function') throw new Error(`unknown call: ${type}`)
    reply = { id, result: core[type](payload) }
  } catch (err) {
    reply = { id, error: { message: err?.message || String(err), stack: err?.stack } }
  }
  parentPort.postMessage(reply)
})
