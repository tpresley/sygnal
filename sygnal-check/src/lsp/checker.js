/**
 * The main thread's handle on the check core (PLAN-7 L-1, G-657).
 *
 *   createChecker({ worker = true, onLog }) → {
 *     call(type, payload) → Promise<result>   ('check' | 'fixAll' | 'controls' | 'drop'; see core.js)
 *     usingWorker: boolean
 *     dispose()
 *   }
 *
 * With `worker` (the default) the core runs in a `worker_thread` (worker.js) that owns the parse
 * caches: a check doesn't block the main thread, which keeps the documents and answers requests
 * from the last results. Payloads and results are structured-cloned (plain data: overlays as a
 * Map of path → text, diagnostics already in LSP form).
 *
 * Fallback to in-thread checks: `worker: false` (tests, environments without workers), a
 * Worker that can't be created, or a worker that dies (its pending calls are retried in-thread
 * and the caches start cold). In-thread calls still resolve asynchronously, on a later turn of
 * the event loop, so the server behaves the same either way.
 *
 * Calls are not queued here: the server sends one check at a time (it coalesces newer changes
 * into a single pending check per folder rather than queueing stale work).
 */
import { Worker } from 'node:worker_threads'
import { createCore } from './core.js'

export function createChecker({ worker = true, onLog = () => {} } = {}) {
  let core = null
  let w = null
  let nextId = 1
  const pending = new Map() // id → { type, payload, resolve, reject }
  let disposed = false

  const inThread = (type, payload) => new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        core ??= createCore()
        if (typeof core[type] !== 'function') throw new Error(`unknown call: ${type}`)
        resolve(core[type](payload))
      } catch (err) {
        reject(err)
      }
    })
  })

  function fallBack(reason) {
    if (!w) return
    const dead = w
    w = null
    onLog('warn', `the check worker stopped (${reason}); checking on the main thread from now on`)
    dead.removeAllListeners()
    dead.terminate().catch(() => {})
    for (const [id, p] of pending) {
      pending.delete(id)
      inThread(p.type, p.payload).then(p.resolve, p.reject)
    }
  }

  function start() {
    if (!worker) return
    try {
      w = new Worker(new URL('./worker.js', import.meta.url))
      w.unref() // never keep the process alive on its own; the server terminates it on exit
      w.on('message', ({ id, result, error }) => {
        const p = pending.get(id)
        if (!p) return
        pending.delete(id)
        if (error) {
          const err = new Error(error.message)
          err.stack = error.stack
          p.reject(err)
        } else p.resolve(result)
      })
      w.on('error', (err) => fallBack(err?.message || String(err)))
      w.on('exit', (code) => { if (!disposed) fallBack(`exit code ${code}`) })
    } catch (err) {
      w = null
      onLog('warn', `no check worker (${err?.message || err}); checking on the main thread`)
    }
  }
  start()

  async function call(type, payload) {
    if (disposed) throw new Error('the checker is disposed')
    if (!w) return inThread(type, payload)
    return new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { type, payload, resolve, reject })
      try {
        w.postMessage({ id, type, payload })
      } catch (err) {
        pending.delete(id)
        reject(err)
      }
    })
  }

  function dispose() {
    disposed = true
    if (w) {
      w.removeAllListeners()
      w.terminate().catch(() => {})
      w = null
    }
    for (const [, p] of pending) p.reject(new Error('the checker is disposed'))
    pending.clear()
  }

  return { call, dispose, get usingWorker() { return !!w } }
}
