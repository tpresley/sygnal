// A small client for Kindo's Agents API (https://docs.kindo.ai/apis/agents/quickstart/):
// list agents, read one (its input labels), trigger a run, poll it, read its step evaluations,
// restart it. Runs are asynchronous: a trigger answers 202 with a runId at once, and the run is
// polled until its status leaves 'in_progress'.
//
// The key never reaches the view: the MCP server holds it. It comes from KINDO_API_KEY, or a
// file outside the repository (KINDO_ENV_FILE, default ~/.config/kindo/env, a line
// `KINDO_API_KEY=...`), the same file the AI showcase's dev server reads.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const KINDO = 'https://api.kindo.ai'

export function readKey(env = process.env) {
  if (env.KINDO_API_KEY) return env.KINDO_API_KEY
  try {
    const text = readFileSync(env.KINDO_ENV_FILE || join(homedir(), '.config', 'kindo', 'env'), 'utf8')
    return text.match(/^\s*(?:export\s+)?KINDO_API_KEY\s*=\s*["']?([^"'\s#]+)/m)?.[1] ?? null
  } catch {
    return null
  }
}

export class KindoError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** the final assistant message of a run (`result` is a JSON string of `{ role, parts }`), as text */
export function resultText(result) {
  if (!result) return ''
  let message
  try { message = typeof result === 'string' ? JSON.parse(result) : result } catch { return String(result) }
  const parts = Array.isArray(message?.parts) ? message.parts : Array.isArray(message?.content) ? message.content : []
  const text = parts.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).filter(Boolean).join('\n\n')
  return text || (typeof message?.content === 'string' ? message.content : '')
}

/**
 * The client. `key` is read once; `fetch` and `wait` are for tests.
 */
export function kindoClient({ key = readKey(), fetch = globalThis.fetch, base = KINDO, wait = sleep } = {}) {
  async function call(path, { method = 'GET', body } = {}) {
    if (!key) throw new KindoError('No Kindo API key: set KINDO_API_KEY, or put KINDO_API_KEY=... in ~/.config/kindo/env, and restart the server', 401)
    let res
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${key}`, ...(body && { 'content-type': 'application/json' }) },
        ...(body && { body: JSON.stringify(body) }),
      })
    } catch (e) {
      throw new KindoError(`Kindo is unreachable (${e?.name || 'error'})`, 502)
    }
    const text = await res.text()
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    if (!res.ok) {
      const why = data?.error?.message ?? data?.error ?? data?.message ?? (typeof data === 'string' ? data : '')
      throw new KindoError(`Kindo answered ${res.status}${why ? `: ${why}` : ''}`, res.status)
    }
    return data
  }

  const client = {
    available: !!key,
    listAgents: async () => (await call('/v1/agents/list'))?.items ?? [],
    getAgent: (agentId) => call(`/v1/agents/${encodeURIComponent(agentId)}`),
    startRun: (agentId, inputs) => call('/v1/agents/runs', { method: 'POST', body: { agentId, inputs } }),
    getRun: (runId) => call(`/v1/runs/${encodeURIComponent(runId)}`),
    restartRun: (runId) => call(`/v1/runs/${encodeURIComponent(runId)}/restart`, { method: 'POST' }),
    /** step evaluations, or null when the agent has none (or they can't be read yet) */
    getEvals: async (runId) => {
      try { return await call(`/v1/runs/${encodeURIComponent(runId)}/evals`) } catch { return null }
    },

    /**
     * A long poll: the run once something changed since `seen` (its status, or a step's result),
     * or after `maxMs`. Polls every 2 s, then backs off to 5 s, as Kindo's docs advise.
     */
    async waitForRun(runId, { seen = null, maxMs = 20000 } = {}) {
      const started = Date.now()
      for (let i = 0; ; i++) {
        const [run, evals] = await Promise.all([client.getRun(runId), client.getEvals(runId)])
        const snapshot = JSON.stringify([run.status, evals?.steps?.map((s) => s.result)])
        if (run.status !== 'in_progress' || (seen !== null && snapshot !== seen) || Date.now() - started >= maxMs) {
          return { run, evals, text: resultText(run.result), snapshot }
        }
        if (seen === null) seen = snapshot
        await wait(i < 3 ? 2000 : 5000)
      }
    },
  }
  return client
}
