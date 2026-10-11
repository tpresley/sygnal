/**
 * The main thread's handle on the check core (PLAN-7 L-1, G-657).
 *
 *   createChecker({ worker = true, onLog }) → {
 *     call(type, payload, { onPart? }) → Promise<result>
 *                                             ('check' | 'index' | 'fixAll' | 'controls' | 'drop'; see core.js)
 *     wantIndex()                             a request waits for the check in flight's index
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
 * Parts (P4 perf; a check, core.js "Parts"): `onPart(part)` gets the check's index and
 * completion index apart from its result: the index early (before the call resolves, as soon as
 * the worker posts it) when wantIndex() was called since the last check decided, else late with
 * the completion index (after the call resolved: the diagnostics don't wait for them).
 * In-thread, an early part comes just before the result and a late one on the next turn. A
 * worker that dies before its late part retries the check in-thread for it (a part may then come
 * twice, from builds of the same documents). An exception in `onPart` is logged, never fails the
 * call. wantIndex() sets a flag the worker reads and clears when a check decides (a
 * SharedArrayBuffer, so it reaches a check already running).
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
  const pending = new Map() // id → { type, payload, onPart, resolve, reject, resolved }
  let disposed = false
  const want = new Int32Array(new SharedArrayBuffer(4)) // [0]: 1 when an index is wanted

  const deliver = (onPart, part) => {
    try {
      onPart(part)
    } catch (err) {
      onLog('error', `check part handler failed: ${err?.stack || err}`)
    }
  }

  const inThread = (type, payload, onPart) => new Promise((resolve, reject) => {
    setImmediate(() => {
      const later = []
      let early = false
      try {
        core ??= createCore()
        if (typeof core[type] !== 'function') throw new Error(`unknown call: ${type}`)
        const opts = onPart ? {
          part: (part) => { early = true; deliver(onPart, part) },
          wanted: () => Atomics.exchange(want, 0, 0) === 1,
          defer: (fn) => later.push(fn),
        } : undefined
        const result = core[type](payload, opts)
        // after an early part, the result on the next turn: what the part released (requests
        // waiting on it) goes first, as with the worker's separate messages
        if (early) setImmediate(() => resolve(result))
        else resolve(result)
      } catch (err) {
        later.length = 0
        reject(err)
      }
      if (later.length) {
        setImmediate(() => {
          for (const fn of later) {
            try {
              fn()
            } catch (err) {
              deliver(onPart, { index: null, completion: null, error: err?.stack || String(err) })
            }
          }
        })
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
      // (a call that resolved and waits for its late part: the retry's result goes nowhere)
      inThread(p.type, p.payload, p.onPart).then(p.resolve, p.reject)
    }
  }

  function start() {
    if (!worker) return
    try {
      w = new Worker(new URL('./worker.js', import.meta.url), { workerData: { want } })
      w.unref() // never keep the process alive on its own; the server terminates it on exit
      w.on('message', (msg) => {
        const { id, result, error } = msg
        const p = pending.get(id)
        if (!p) return
        if ('part' in msg) { if (p.onPart) deliver(p.onPart, msg.part); return }
        if (msg.end) { pending.delete(id); return }
        if (error) {
          pending.delete(id)
          const err = new Error(error.message)
          err.stack = error.stack
          p.reject(err)
          return
        }
        if (result?.late) p.resolved = true // its late part and `end` follow
        else pending.delete(id)
        p.resolve(result)
      })
      w.on('error', (err) => fallBack(err?.message || String(err)))
      w.on('exit', (code) => { if (!disposed) fallBack(`exit code ${code}`) })
    } catch (err) {
      w = null
      onLog('warn', `no check worker (${err?.message || err}); checking on the main thread`)
    }
  }
  start()

  async function call(type, payload, { onPart } = {}) {
    if (disposed) throw new Error('the checker is disposed')
    if (!w) return inThread(type, payload, onPart)
    return new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { type, payload, onPart, resolve, reject })
      try {
        w.postMessage(onPart ? { id, type, payload, parts: true } : { id, type, payload })
      } catch (err) {
        pending.delete(id)
        reject(err)
      }
    })
  }

  const wantIndex = () => { Atomics.store(want, 0, 1) }

  function dispose() {
    disposed = true
    if (w) {
      w.removeAllListeners()
      w.terminate().catch(() => {})
      w = null
    }
    for (const [, p] of pending) if (!p.resolved) p.reject(new Error('the checker is disposed'))
    pending.clear()
  }

  return { call, wantIndex, dispose, get usingWorker() { return !!w } }
}
