// The orchestrator's trial pool: N workers over a queue, with usage-limit
// pauses (PLAN-2 3-H). Unit-tested in tests/limits.unit.mjs.
//
// runItem(item, ctl) resolves a summary { name, status, ... }. A summary with
// `rateLimited: true` means the agent never ran because of a usage/rate limit:
// the item goes back to the front of the queue (with `retryAction`, if given),
// every worker pauses for limitWait(), and the next attempt waits longer. A
// trial that runs ends the limit episode (the backoff starts over). When the
// retries are used up, or the limit resets later than maxWait, the pool stops:
// ctl.aborted is set and the remaining items are reported as not run.
import { limitWait, fmtWait } from './limits.mjs'

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * @param o.items        queue items ({ name, ... })
 * @param o.concurrency
 * @param o.runItem      async (item, ctl) => summary
 * @param o.onDone       (summary) => void, for every finished item (not for re-queued ones)
 * @param o.onLimit      ({ item, waitMs, attempt, resetAt, reason }) => void, when a pause starts
 * @param o.limits       { scheduleMs: number[], retries?: number, maxWaitMs?: number }
 * @param o.sleep, o.now injectable clock (tests)
 * @returns {Promise<{ summary: object[], aborted: string|null, limitStop: boolean }>}
 */
export async function runPool({ items, concurrency = 1, runItem, onDone = () => {}, onLimit = () => {}, limits = { scheduleMs: [300_000] }, sleep = realSleep, now = Date.now }) {
  const queue = [...items]
  const summary = []
  const st = { aborted: null, limitStop: false, pauseUntil: 0, attempt: 0 }
  const ctl = {
    abort(reason) {
      if (!st.aborted) st.aborted = reason
    },
    get aborted() {
      return st.aborted
    },
  }
  const finish = (r) => {
    summary.push(r)
    onDone(r)
  }
  async function waitPause() {
    while (!st.aborted && now() < st.pauseUntil) await sleep(Math.min(st.pauseUntil - now(), 5000))
  }
  async function worker() {
    for (;;) {
      await waitPause()
      const item = queue.shift()
      if (!item) return
      if (st.aborted) {
        finish({ name: item.name, status: 'not run', reason: st.aborted })
        continue
      }
      let r
      try {
        r = await runItem(item, ctl)
      } catch (e) {
        r = { name: item.name, status: 'error', reason: String(e?.message ?? e).split('\n')[0] }
      }
      if (r?.rateLimited && !st.aborted) {
        const retry = { ...item, ...(r.retryAction ? { action: r.retryAction } : {}), limitRetries: (item.limitRetries ?? 0) + 1 }
        if (now() < st.pauseUntil) {
          // Another worker already started a pause for this limit: just wait it out.
          queue.unshift(retry)
          continue
        }
        const waitMs = limitWait({ attempt: st.attempt, scheduleMs: limits.scheduleMs, retries: limits.retries, maxWaitMs: limits.maxWaitMs, resetAt: r.resetAt ?? null, now: now() })
        if (waitMs == null) {
          st.limitStop = true
          const when = r.resetAt ? `; the limit resets at ${new Date(r.resetAt).toISOString()}` : ''
          ctl.abort(`the usage/rate limit persists after ${st.attempt} pause(s) (${r.reason ?? 'rate limit'})${when}`)
          finish({ ...r, status: 'not run' })
          continue
        }
        st.attempt++
        st.pauseUntil = now() + waitMs
        onLimit({ item, waitMs, attempt: st.attempt, resetAt: r.resetAt ?? null, reason: r.reason, wait: fmtWait(waitMs) })
        queue.unshift(retry)
        continue
      }
      if (r && (r.status === 'pass' || r.status === 'FAIL')) st.attempt = 0
      finish(r)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker))
  return { summary, aborted: st.aborted, limitStop: st.limitStop }
}
