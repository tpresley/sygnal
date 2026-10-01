// PLAN-2 3-H: usage/rate-limit detection (lib/limits.mjs, summarizeRun) and the
// pool's pause / retry / stop behavior (lib/pool.mjs).
// Run: node --test evals/agent-ergonomics/tests/*.unit.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rateLimitInfo, parseResetAt, parseDuration, parseSchedule, limitWait } from '../lib/limits.mjs'
import { summarizeRun } from '../lib/headless.mjs'
import { runTrial, preflight } from '../lib/runner.mjs'
import { runPool } from '../lib/pool.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FAKE = path.join(HERE, 'fake-claude.mjs')
const init = { type: 'system', subtype: 'init', model: 'claude-opus-5-5' }
const turn = { type: 'assistant', message: { id: 'm', model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }
const retry = (status, error) => ({ type: 'system', subtype: 'api_retry', error_status: status, error })
const res = (o) => ({ type: 'result', subtype: 'success', is_error: false, duration_api_ms: 1000, result: 'done', ...o })

test('rateLimitInfo / summarizeRun: usage limit, 429, 529, rejected rate_limit_event are "rate limit" not-runs', () => {
  const usage = summarizeRun([init, retry(429, 'rate_limit'), res({ is_error: true, duration_api_ms: 0, result: 'Claude AI usage limit reached|1759327200' })])
  assert.equal(usage.agentRan, false)
  assert.equal(usage.rateLimited, true)
  assert.match(usage.notRunReason, /^rate limit: Claude AI usage limit reached/)
  assert.equal(usage.resetAt, 1759327200 * 1000)
  assert.equal(usage.authFailed, false)
  const text = summarizeRun([init, turn, res({ is_error: true, result: "You've hit your limit · resets 5pm" })])
  assert.equal(text.rateLimited, true, 'limit text even after some turns')
  assert.equal(text.resetAt, null)
  const overloaded = summarizeRun([init, retry(529, 'overloaded_error'), retry(529, 'overloaded_error')])
  assert.equal(overloaded.rateLimited, true, 'retries with no result')
  assert.equal(summarizeRun([init, { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1759327200, rateLimitType: 'five_hour' } }]).resetAt, 1759327200 * 1000)
  assert.equal(summarizeRun([init, res({ is_error: true, result: 'API Error: 429 {"type":"rate_limit_error"}' })]).rateLimited, true)
  // Not limits: a run that recovered from 429 retries, a credit error, an auth failure.
  const recovered = summarizeRun([init, retry(429, 'rate_limit'), turn, res({})])
  assert.equal(recovered.agentRan, true)
  assert.equal(recovered.rateLimited, false)
  assert.equal(rateLimitInfo([init, retry(429, 'rate_limit'), turn, res({})]).limited, false)
  assert.equal(summarizeRun([init, turn, res({ is_error: true, result: 'Credit balance is too low' })]).rateLimited, false)
  const auth = summarizeRun([init, retry(401, 'authentication_failed'), res({ is_error: true, duration_api_ms: 0, result: 'Failed to authenticate. API Error: 401' })])
  assert.equal(auth.notRunReason, 'auth')
  assert.equal(auth.rateLimited, false)
  assert.equal(summarizeRun([init, turn, res({})]).rateLimited, false)
})

test('parseResetAt / parseDuration / parseSchedule', () => {
  assert.equal(parseResetAt('Claude AI usage limit reached|1759327200'), 1759327200000)
  assert.equal(parseResetAt('usage limit reached | 1759327200.'), 1759327200000)
  assert.equal(parseResetAt('resets 5pm'), null)
  assert.equal(parseDuration('90'), 90_000)
  assert.equal(parseDuration('2s'), 2000)
  assert.equal(parseDuration('5m'), 300_000)
  assert.equal(parseDuration('1.5h'), 5_400_000)
  assert.throws(() => parseDuration('soon'))
  assert.deepEqual(parseSchedule('5m, 15m,1h'), [300_000, 900_000, 3_600_000])
  assert.throws(() => parseSchedule(''))
})

test('limitWait: schedule steps, a later reset wins, retries and maxWait stop it', () => {
  const scheduleMs = [1000, 5000]
  assert.equal(limitWait({ attempt: 0, scheduleMs, now: 0 }), 1000)
  assert.equal(limitWait({ attempt: 1, scheduleMs, now: 0 }), 5000)
  assert.equal(limitWait({ attempt: 2, scheduleMs, now: 0 }), null, 'retries default to the schedule length')
  assert.equal(limitWait({ attempt: 3, scheduleMs, retries: 5, now: 0 }), 5000, 'the last step repeats')
  assert.equal(limitWait({ attempt: 0, scheduleMs, resetAt: 100_000, now: 0, marginMs: 1000 }), 101_000)
  assert.equal(limitWait({ attempt: 0, scheduleMs, resetAt: 10, now: 0, marginMs: 0 }), 1000, 'a reset in the past does not shorten the step')
  assert.equal(limitWait({ attempt: 0, scheduleMs, resetAt: 10 * 3_600_000, now: 0, maxWaitMs: 3_600_000 }), null)
})

test('runTrial / preflight: a usage limit and an overload are not run and flagged (fake CLI)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'limits-'))
  const mk = (name) => {
    const dest = path.join(root, name)
    fs.mkdirSync(dest)
    fs.writeFileSync(path.join(dest, 'package.json'), '{}')
    fs.writeFileSync(`${dest}.prompt.txt`, 'do it')
    return dest
  }
  const env = (vars, fn) => {
    const old = { ...process.env }
    Object.assign(process.env, vars)
    return fn().finally(() => {
      for (const k of Object.keys(vars)) if (old[k] === undefined) delete process.env[k]
      else process.env[k] = old[k]
    })
  }
  const limited = await env({ FAKE_CLAUDE_MODE: 'ratelimit', FAKE_CLAUDE_RESET: '1759327200' }, () => runTrial({ dest: mk('a'), model: 'claude-opus-5-5', claudeBin: FAKE }))
  assert.equal(limited.agentRan, false)
  assert.equal(limited.rateLimited, true)
  assert.equal(limited.resetAt, 1759327200000)
  assert.equal(limited.turns, 0)
  const over = await env({ FAKE_CLAUDE_MODE: 'overloaded' }, () => runTrial({ dest: mk('b'), model: 'claude-opus-5-5', claudeBin: FAKE }))
  assert.equal(over.rateLimited, true)
  assert.equal(over.completed, false)
  const pf = await env({ FAKE_CLAUDE_MODE: 'ratelimit' }, () => preflight({ model: 'claude-opus-5-5', claudeBin: FAKE }))
  assert.equal(pf.ok, false)
  assert.equal(pf.rateLimited, true)
  assert.match(pf.reason, /usage\/rate limit/)
  // FAKE_CLAUDE_LIMIT_CALLS: the first call is limited, the next one runs.
  const state = path.join(root, 'state')
  const first = await env({ FAKE_CLAUDE_LIMIT_CALLS: '1', FAKE_CLAUDE_STATE: state }, () => runTrial({ dest: mk('c'), model: 'claude-opus-5-5', claudeBin: FAKE }))
  const second = await env({ FAKE_CLAUDE_LIMIT_CALLS: '1', FAKE_CLAUDE_STATE: state }, () => runTrial({ dest: mk('d'), model: 'claude-opus-5-5', claudeBin: FAKE }))
  assert.equal(first.rateLimited, true)
  assert.equal(second.agentRan, true)
})

/** A fake clock: sleep advances time on the next macrotask, so work already in flight sees the old time (as with a real clock). */
function clock() {
  let t = 0
  const sleeps = []
  const sleep = async (ms) => {
    sleeps.push(ms)
    await new Promise((r) => setImmediate(r))
    t += ms
  }
  return { now: () => t, sleep, sleeps }
}

test('runPool: a limit pauses the pool, retries the item with its retry action, and the backoff resets after a trial runs', async () => {
  const c = clock()
  const calls = []
  let limitedLeft = 2
  const pauses = []
  const done = []
  const out = await runPool({
    items: [{ name: 'a', action: 'new' }, { name: 'b', action: 'new' }, { name: 'c', action: 'new' }],
    concurrency: 1,
    limits: { scheduleMs: [1000, 5000] },
    now: c.now,
    sleep: c.sleep,
    onLimit: (p) => pauses.push([p.item.name, p.waitMs, p.attempt]),
    onDone: (r) => done.push(r.name),
    runItem: async (item) => {
      calls.push(`${item.name}:${item.action}`)
      if (item.name === 'a' && limitedLeft-- > 0) return { name: item.name, status: 'not run', rateLimited: true, retryAction: 'run', reason: 'rate limit: x' }
      if (item.name === 'c' && calls.filter((x) => x.startsWith('c')).length === 1) return { name: 'c', status: 'not run', rateLimited: true, retryAction: 'redo' }
      return { name: item.name, status: 'pass' }
    },
  })
  assert.deepEqual(calls, ['a:new', 'a:run', 'a:run', 'b:new', 'c:new', 'c:redo'])
  assert.deepEqual(pauses, [['a', 1000, 1], ['a', 5000, 2], ['c', 1000, 1]], 'c starts the schedule over: a ran in between')
  assert.deepEqual(done, ['a', 'b', 'c'])
  assert.equal(out.aborted, null)
  assert.equal(out.limitStop, false)
  assert.equal(c.sleeps.reduce((x, y) => x + y, 0), 7000)
})

test('runPool: a persisting limit stops the pool cleanly; the rest is not run', async () => {
  const c = clock()
  const out = await runPool({
    items: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
    concurrency: 1,
    limits: { scheduleMs: [1000], retries: 2 },
    now: c.now,
    sleep: c.sleep,
    runItem: async (item) => ({ name: item.name, status: 'not run', rateLimited: true, reason: 'rate limit: usage limit reached' }),
  })
  assert.equal(out.limitStop, true)
  assert.match(out.aborted, /persists after 2 pause/)
  assert.deepEqual(out.summary.map((s) => [s.name, s.status]), [['a', 'not run'], ['b', 'not run'], ['c', 'not run']])
  assert.equal(c.sleeps.reduce((x, y) => x + y, 0), 2000)
})

test('runPool: a reset beyond maxWait stops at once; concurrent hits share one pause', async () => {
  const c = clock()
  const out = await runPool({
    items: [{ name: 'a' }],
    limits: { scheduleMs: [1000], maxWaitMs: 60_000 },
    now: c.now,
    sleep: c.sleep,
    runItem: async (item) => ({ name: item.name, status: 'not run', rateLimited: true, resetAt: 3_600_000 }),
  })
  assert.equal(out.limitStop, true)
  assert.match(out.aborted, /resets at/)
  assert.deepEqual(c.sleeps, [])

  // Two workers hit the limit together: one pause, no extra backoff step.
  const c2 = clock()
  const pauses = []
  let n = 0
  const gate = []
  const out2 = await runPool({
    items: [{ name: 'a' }, { name: 'b' }],
    concurrency: 2,
    limits: { scheduleMs: [1000, 9000] },
    now: c2.now,
    sleep: c2.sleep,
    onLimit: (p) => pauses.push(p.waitMs),
    runItem: async (item) => {
      if (n++ < 2) {
        // Both first attempts are in flight before either returns.
        await new Promise((r) => {
          gate.push(r)
          if (gate.length === 2) gate.forEach((g) => g())
        })
        return { name: item.name, status: 'not run', rateLimited: true }
      }
      return { name: item.name, status: 'pass' }
    },
  })
  assert.deepEqual(pauses, [1000])
  assert.deepEqual(out2.summary.map((s) => s.status).sort(), ['pass', 'pass'])
})

test('runPool: an abort from runItem (auth) marks the rest not run; thrown errors become error summaries', async () => {
  const out = await runPool({
    items: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
    runItem: async (item, ctl) => {
      if (item.name === 'a') throw new Error('prepare failed: boom\nmore')
      ctl.abort('auth')
      return { name: item.name, status: 'not run', reason: 'auth' }
    },
  })
  assert.deepEqual(out.summary.map((s) => [s.name, s.status, s.reason]), [['a', 'error', 'prepare failed: boom'], ['b', 'not run', 'auth'], ['c', 'not run', 'auth']])
  assert.equal(out.limitStop, false)
})
