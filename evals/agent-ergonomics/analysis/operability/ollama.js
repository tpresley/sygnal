// The operability check's model client (PLAN-6 4-E): a local model on Ollama's OpenAI-compatible
// chat endpoint. Copied into <dir>/__operability__/ with the task's *.op.jsx; never part of scoring.
// The real fetch is captured at load, before a test replaces it with the app's fake server.
const realFetch = globalThis.fetch.bind(globalThis)

export const MODEL = process.env.OP_MODEL || 'qwen3:8b'
export const OLLAMA = (process.env.OP_OLLAMA || 'http://localhost:11434').replace(/\/$/, '')
export const RUNS = Math.max(1, Number(process.env.OP_RUNS) || 3)
export const MAX_STEPS = Math.max(1, Number(process.env.OP_MAX_STEPS) || 12)
export const OUT = process.env.OP_OUT || ''
/** qwen3 thinks unless told not to: `/no_think` in the system prompt */
export const NO_THINK = /qwen3/i.test(MODEL) ? ' /no_think' : ''

/** One chat completion with tools: `{ message: { role, content, tool_calls? } }`, or `{ error }` */
export async function complete(messages, tools) {
  try {
    const res = await realFetch(`${OLLAMA}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages, ...(tools?.length && { tools }), temperature: 0.2 }),
      signal: AbortSignal.timeout(240000),
    })
    if (!res.ok) return { error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` }
    const json = await res.json()
    const message = json.choices?.[0]?.message
    if (!message) return { error: 'no message in the reply' }
    // a thinking model's leftovers
    if (typeof message.content === 'string') message.content = message.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    return { message }
  } catch (e) {
    return { error: String(e?.message ?? e) }
  }
}

/** parse a tool call's arguments (a JSON string, or already an object) */
export function argsOf(call) {
  const a = call.function?.arguments
  if (a && typeof a === 'object') return a
  try { return JSON.parse(a || '{}') } catch { return a }
}

/** Collect one task's runs: { task, runs, success, steps: [...], traces: [...] } */
export function summarize(task, episodes) {
  return {
    task,
    runs: episodes.length,
    success: episodes.filter((e) => e.ok).length,
    toolCalls: episodes.reduce((n, e) => n + e.calls, 0),
    seconds: Math.round(episodes.reduce((n, e) => n + e.ms, 0) / 100) / 10,
    episodes: episodes.map((e) => ({ ok: e.ok, calls: e.calls, ms: Math.round(e.ms), trace: e.trace, end: e.end, error: e.error })),
  }
}

export async function writeOut(result) {
  if (!OUT) return
  const fs = await import('node:fs')
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2))
}
