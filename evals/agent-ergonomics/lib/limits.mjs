// Usage-limit / rate-limit handling for headless trials (PLAN-2 3-H).
// Unit-tested in tests/limits.unit.mjs.
//
// Trials run on a Claude subscription, so a long run can hit the plan's usage
// limit (or API rate limits / overload). Such a run never reached the model the
// way a trial must, so like an auth failure it is "not run": not scored, and
// the orchestrator pauses, retries with backoff, and stops cleanly with a
// resume hint if the limit persists.

/** Text the CLI uses for a rate / usage limit or overload, in api_retry errors or the result text. */
export const RATE_LIMIT_RE = /usage limit|rate[ _-]?limit|hit your limit|limit reached|limit will reset|out of (extra )?usage|overloaded|too many requests|\b(429|529)\b/i

/** HTTP statuses of api_retry events that mean "limited / overloaded". */
export const RATE_LIMIT_STATUS = new Set([429, 529])

/**
 * When the limit resets, if the CLI said so: "…usage limit reached|1759327200"
 * (epoch seconds after a pipe, older CLIs) or a rate_limit_event's resetsAt.
 * Returns epoch ms or null.
 */
export function parseResetAt(text) {
  const m = String(text ?? '').match(/\|\s*(\d{10})(?:\D|$)/)
  return m ? Number(m[1]) * 1000 : null
}

/**
 * Rate-limit facts of one run's stream-json events.
 * @returns {{ limited: boolean, statuses: number[], resetAt: number|null, message: string|null }}
 *   limited: the run shows a rate/usage limit or overload (api_retry 429/529, a
 *   rejected rate_limit_event, or limit text in an is_error result / error).
 *   Only meaningful for a run that did not otherwise succeed.
 */
export function rateLimitInfo(events) {
  const statuses = []
  let resetAt = null
  let message = null
  for (const e of events) {
    if (e?.type === 'system' && e.subtype === 'api_retry') {
      const st = Number(e.error_status)
      if (RATE_LIMIT_STATUS.has(st) || (!st && RATE_LIMIT_RE.test(String(e.error ?? '')))) {
        statuses.push(st || 0)
        message ??= String(e.error ?? `HTTP ${st}`)
      }
    }
    if (e?.type === 'rate_limit_event') {
      const info = e.rate_limit_info ?? {}
      if (info.resetsAt) resetAt = Number(info.resetsAt) * (Number(info.resetsAt) < 1e12 ? 1000 : 1)
      if (info.status === 'rejected') {
        statuses.push(429)
        message ??= `rate limit (${info.rateLimitType ?? 'rejected'})`
      }
    }
  }
  const result = [...events].reverse().find((e) => e?.type === 'result')
  const resultText = typeof result?.result === 'string' ? result.result : ''
  const textLimited = !!result?.is_error && RATE_LIMIT_RE.test(resultText)
  if (textLimited) {
    message = resultText.slice(0, 200)
    resetAt = parseResetAt(resultText) ?? resetAt
  }
  // A run whose only problem was limits: retries with 429/529 and no clean result, or limit text in an error result.
  const limited = textLimited || (statuses.length > 0 && (!result || !!result.is_error))
  return { limited, statuses, resetAt: limited ? resetAt : null, message: limited ? message : null }
}

/** "90", "90s", "5m", "1.5h" → ms. A bare number is seconds. */
export function parseDuration(s) {
  const m = String(s).trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i)
  if (!m) throw new Error(`Bad duration "${s}" (use 30s, 5m, 1h or seconds)`)
  const mult = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[(m[2] ?? 's').toLowerCase()]
  return Math.round(Number(m[1]) * mult)
}

/** "5m,15m,30m,60m" → [ms, ...] */
export function parseSchedule(s) {
  const out = String(s).split(',').map((x) => x.trim()).filter(Boolean).map(parseDuration)
  if (!out.length) throw new Error('empty backoff schedule')
  return out
}

export const DEFAULT_LIMIT_SCHEDULE = '5m,15m,30m,60m'
export const DEFAULT_LIMIT_MAX_WAIT = '5h'

/**
 * How long to pause before retry number `attempt` (0-based) after a limit hit,
 * or null to stop: retries exhausted, or the limit resets later than maxWaitMs.
 * A known reset time wins over a shorter backoff step (plus a 60 s margin).
 */
export function limitWait({ attempt, scheduleMs, retries = scheduleMs.length, resetAt = null, now = Date.now(), maxWaitMs = Infinity, marginMs = 60_000 }) {
  if (attempt >= retries) return null
  let wait = scheduleMs[Math.min(attempt, scheduleMs.length - 1)]
  if (resetAt != null && resetAt + marginMs - now > wait) wait = resetAt + marginMs - now
  if (wait > maxWaitMs) return null
  return Math.max(0, Math.round(wait))
}

export const fmtWait = (ms) => (ms >= 3_600_000 ? `${(ms / 3_600_000).toFixed(1)} h` : ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`)
