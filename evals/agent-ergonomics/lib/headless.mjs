// Pure helpers for the headless trial runner (run-trial.mjs) and the
// orchestrator. Unit-tested in tests/headless.unit.mjs.
//
// A headless trial is `claude -p <prompt> --output-format stream-json --verbose`
// run from inside the prepared trial dir. stream-json lines carry no
// timestamps, so the runner stamps each line as it arrives; the stamped file is
// `<dest>.transcript.jsonl` and parses like a PLAN-1 subagent transcript.

/**
 * Trial posture. PLAN-1 trials were general-purpose subagents: every built-in
 * tool, no permission prompts. The headless equivalent is these tools, all
 * pre-approved, edits auto-accepted. MCP servers are not loaded
 * (--strict-mcp-config with no config), so a trial can't reach the
 * coordinator's integrations.
 */
export const DEFAULT_TOOLS = ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Skill', 'TodoWrite', 'WebFetch', 'WebSearch']
export const DEFAULT_PERMISSION_MODE = 'acceptEdits'
export const DEFAULT_TIMEOUT_MIN = 30

/**
 * Trials run on a full model id by default. CLI aliases are resolved by the
 * installed CLI, and an older CLI maps them to older models (CLI 2.1.90:
 * `opus` -> claude-opus-4-6), so the orchestrator checks the model a run
 * actually used against what was meant (resolveModel / checkModel).
 */
export const DEFAULT_MODEL = 'claude-opus-5-5'
export const MODEL_ALIASES = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-4-5', fable: 'claude-fable-5-1' }

/** The model id a --model value means: aliases map to the current model of that family; full ids map to themselves. */
export function resolveModel(requested) {
  if (!requested) return DEFAULT_MODEL
  const r = String(requested).trim()
  return MODEL_ALIASES[r.toLowerCase()] ?? r
}

/**
 * Does the model a run used match the one requested? Accepts a dated variant
 * of the expected id (claude-x-1-20260101) and a [1m]-style suffix.
 */
export function checkModel(requested, actual) {
  const expected = resolveModel(requested)
  const base = (m) => String(m ?? '').replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '')
  const ok = !!actual && base(actual) === base(expected)
  return { requested: requested ?? null, expected, actual: actual ?? null, ok }
}

/** A run's auth failure, as the CLI reports it in api_retry events or the result text. */
export const AUTH_FAIL_RE = /authentication_failed|authentication_error|Failed to authenticate|OAuth access token is invalid|Invalid API key|\b401\b/i

/** argv for `claude` (without the binary). */
export function buildClaudeArgs({ prompt, model, permissionMode = DEFAULT_PERMISSION_MODE, tools = DEFAULT_TOOLS, effort, maxBudgetUsd } = {}) {
  if (!prompt) throw new Error('buildClaudeArgs: prompt is required')
  const toolList = Array.isArray(tools) ? tools : String(tools).split(/[,\s]+/).filter(Boolean)
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', permissionMode]
  args.push('--tools', toolList.join(','), '--allowedTools', toolList.join(','))
  args.push('--strict-mcp-config', '--no-session-persistence')
  if (model) args.push('--model', model)
  if (effort) args.push('--effort', effort)
  if (maxBudgetUsd != null) args.push('--max-budget-usd', String(maxBudgetUsd))
  return args
}

/** argv for the preflight: one tiny no-tool call on the trial model, same output format. */
export function buildPreflightArgs({ model, effort } = {}) {
  const args = ['-p', 'Reply with the single word: ok', '--output-format', 'stream-json', '--verbose', '--tools', '', '--strict-mcp-config', '--no-session-persistence']
  if (model) args.push('--model', model)
  if (effort) args.push('--effort', effort)
  return args
}

/**
 * Environment for the trial process: the caller's environment minus the
 * variables that tie a process to a host Claude Code session (nested-session
 * markers, SDK host-auth plumbing, the host's effort level). Credentials such
 * as ANTHROPIC_API_KEY are kept.
 */
const HOST_SESSION_VAR = /^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_AGENT_SDK_.*|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_PREVIEW_.*|AI_AGENT|BAGGAGE)$/
export function trialEnv(env = process.env) {
  const out = {}
  for (const [k, v] of Object.entries(env)) if (!HOST_SESSION_VAR.test(k)) out[k] = v
  return out
}

/** Add an ISO `timestamp` to one stream-json line (kept if present). Non-JSON lines are returned as null. */
export function stampLine(line, now = new Date()) {
  const s = String(line).trim()
  if (!s) return null
  let obj
  try {
    obj = JSON.parse(s)
  } catch {
    return null
  }
  if (obj && typeof obj === 'object' && !obj.timestamp) obj = { timestamp: now.toISOString(), ...obj }
  return JSON.stringify(obj)
}

/**
 * Summary of a headless run from its stream-json events: the `system/init`
 * line (model, tools) and the final `result` line (cost, usage, duration).
 * `tokens` is every token billed over the run: input + output + cache read +
 * cache creation, summed over turns (as the result event reports them).
 */
export function summarizeRun(events) {
  const init = events.find((e) => e?.type === 'system' && e.subtype === 'init') ?? null
  const result = [...events].reverse().find((e) => e?.type === 'result') ?? null
  const retries = events.filter((e) => e?.type === 'system' && e.subtype === 'api_retry')
  const authErrors = retries.filter((e) => e.error_status === 401 || AUTH_FAIL_RE.test(String(e.error ?? '')))
  // Real model turns: the CLI also writes a '<synthetic>' assistant message for errors it reports itself.
  const turns = events.filter((e) => e?.type === 'assistant' && e.message && e.message.model !== '<synthetic>')
  const turnModel = turns.map((e) => e.message.model).find(Boolean) ?? null
  const resultText = typeof result?.result === 'string' ? result.result : ''
  const authInResult = !!result && !!result.is_error && AUTH_FAIL_RE.test(resultText)
  const apiMs = result?.duration_api_ms
  const u = result?.usage ?? {}
  const usage = {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheCreation: u.cache_creation_input_tokens ?? 0,
  }
  usage.total = usage.input + usage.output + usage.cacheRead + usage.cacheCreation
  const models = result?.modelUsage ? Object.keys(result.modelUsage) : []
  // Did the agent actually run? A result with is_error, no API time, or no real
  // model turn means the CLI never got the model working (auth, quota, crash):
  // the trial is 'not run' and must not be scored.
  let notRunReason = null
  if (!result) notRunReason = authErrors.length ? 'auth' : 'no result'
  else if (authInResult || (result.is_error && authErrors.length)) notRunReason = 'auth'
  else if (result.is_error) notRunReason = `error: ${resultText.slice(0, 200) || result.subtype}`
  else if (apiMs === 0) notRunReason = 'no API time (duration_api_ms 0)'
  else if (!turns.length) notRunReason = 'no assistant turns'
  return {
    model: turnModel ?? init?.model ?? models[0] ?? null,
    initModel: init?.model ?? null,
    turns: turns.length,
    agentRan: notRunReason === null,
    notRunReason,
    models,
    sessionId: init?.session_id ?? result?.session_id ?? null,
    claudeVersion: init?.claude_code_version ?? null,
    completed: !!result,
    isError: result ? !!result.is_error : null,
    subtype: result?.subtype ?? null,
    durationMs: result?.duration_ms ?? null,
    durationApiMs: result?.duration_api_ms ?? null,
    numTurns: result?.num_turns ?? null,
    costUsd: result?.total_cost_usd ?? null,
    usage: result ? usage : null,
    tokens: result ? usage.total : null,
    outputTokens: result ? usage.output : null,
    finalText: typeof result?.result === 'string' ? result.result : null,
    apiRetries: retries.length,
    authFailed: notRunReason === 'auth',
  }
}

/** Parse JSONL text into objects (bad lines skipped). */
export function parseJsonl(text) {
  const out = []
  for (const l of String(text).split('\n')) {
    if (!l.trim()) continue
    try {
      out.push(JSON.parse(l))
    } catch {}
  }
  return out
}

/** Sidecar paths of a trial dir: prompt, transcript, run meta, stderr. */
export function trialFiles(dest) {
  return {
    prompt: `${dest}.prompt.txt`,
    transcript: `${dest}.transcript.jsonl`,
    meta: `${dest}.run.json`,
    stderr: `${dest}.stderr.log`,
  }
}
