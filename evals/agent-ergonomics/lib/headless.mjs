// Pure helpers for the headless trial runner (run-trial.mjs) and the
// orchestrator. Unit-tested in tests/headless.unit.mjs.
//
// A headless trial is `claude -p <prompt> --output-format stream-json --verbose`
// run from inside the prepared trial dir. stream-json lines carry no
// timestamps, so the runner stamps each line as it arrives; the stamped file is
// `<dest>.transcript.jsonl` and parses like a PLAN-1 subagent transcript.
import fs from 'node:fs'
import path from 'node:path'
import { rateLimitInfo } from './limits.mjs'

/**
 * Trial posture. PLAN-1 trials were general-purpose subagents: every built-in
 * tool, no permission prompts. The headless equivalent is these tools, all
 * pre-approved, edits auto-accepted. MCP servers are not loaded
 * (--strict-mcp-config with no config), so a trial can't reach the
 * coordinator's integrations; a run variant may add its own (mcpConfig).
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

/**
 * Variant isolation flags (PLAN-2 3-H, lib/variant.mjs), shared by trials and the preflight:
 * - settingSources: e.g. 'project,local' leaves out the user's settings and with
 *   them ~/.claude/skills, so the only skills are the built-in ones plus addDirs';
 * - addDirs: dirs whose .claude/skills/<name>/SKILL.md the CLI loads (a variant's skill);
 * - mcpConfig: an MCP config file (still with --strict-mcp-config, so nothing else loads);
 * - extraAllowedTools: pre-approved tool rules beyond the built-in set (mcp__<server>).
 */
function isolationArgs({ settingSources, addDirs = [], mcpConfig } = {}) {
  const a = ['--strict-mcp-config']
  if (mcpConfig) a.push('--mcp-config', mcpConfig)
  if (settingSources != null) a.push('--setting-sources', settingSources)
  for (const d of addDirs) a.push('--add-dir', d)
  return a
}

/**
 * Process guard (G-127). Trial agents ran machine-wide kills from their Bash
 * tool (`pkill -f vite`, `killall node`), which hit every matching process on
 * the machine: other trials' dev servers and test runs, the orchestrator, the
 * user's own node processes. Two layers, both on for every trial:
 * 1. deny rules (--disallowedTools) for pkill, killall and kill (including
 *    their absolute paths). `kill` is a shell builtin, so only the rule can
 *    block it; a trial stopping its own background job from a script is fine;
 * 2. a per-trial shim dir (writeProcessGuard) put first on the trial's PATH,
 *    and again through CLAUDE_ENV_FILE (sourced before every Bash command, so a
 *    login shell's path_helper can't reorder it), with pkill, killall and kill
 *    executables that refuse and exit 1. The `kill` shim only catches the
 *    external binary (`xargs kill`, `lsof -ti:5173 | xargs kill -9`).
 * The harness's own timeout kills the trial's process group with
 * process.kill(), which neither layer affects.
 * PROCESS_GUARD is recorded in the run meta and the run manifest; it is not
 * part of the variant hash (it changes nothing for a trial that never kills a
 * process, and keeping it out keeps recorded variants' hashes).
 */
export const PROCESS_GUARD = 1
export const GUARD_DISALLOWED_TOOLS = ['pkill', 'killall', 'kill', '/usr/bin/pkill', '/usr/bin/killall', '/bin/kill'].map((c) => `Bash(${c}:*)`)
export const GUARD_COMMANDS = ['pkill', 'killall', 'kill']
export const GUARD_MESSAGE = 'Not available in the eval: stop only processes you started, by PID (e.g. `kill %1` or the PID from `$!`)'

/** Shim dir paths of a trial: `<dest>.guard/bin` (the executables) and `<dest>.guard/env.sh` (CLAUDE_ENV_FILE). */
export function guardPaths(dest) {
  const root = `${dest}.guard`
  return { root, bin: path.join(root, 'bin'), envFile: path.join(root, 'env.sh') }
}

/** Write the shim executables and the env file for one trial; returns guardPaths(dest). Idempotent. */
export function writeProcessGuard(dest) {
  const g = guardPaths(dest)
  fs.mkdirSync(g.bin, { recursive: true })
  const msg = GUARD_MESSAGE.replace(/'/g, `'\\''`)
  for (const c of GUARD_COMMANDS) {
    const f = path.join(g.bin, c)
    fs.writeFileSync(f, `#!/bin/sh\n# Eval process guard (G-127): machine-wide process kills are not allowed in a trial.\necho '${c}: ${msg}' >&2\nexit 1\n`)
    fs.chmodSync(f, 0o755)
  }
  fs.writeFileSync(g.envFile, `# Eval process guard (G-127): sourced before every Bash command of the trial.\nexport PATH='${g.bin}':"$PATH"\n`)
  return g
}

/** The trial environment with the guard: shim dir first on PATH, CLAUDE_ENV_FILE set. */
export function guardEnv(env, g) {
  return { ...env, PATH: `${g.bin}${path.delimiter}${env.PATH ?? ''}`, CLAUDE_ENV_FILE: g.envFile }
}

/**
 * Built-in skill block (D234, PLAN-5 4-E2). Claude Code ships skills of its own
 * (`run`, `dataviz`, `verify`, `debug`, ...) that a trial could call instead of
 * working with the framework: Haiku used `run` in 19/25 React and 4/25 Sygnal
 * trials of the D228 runs. Trials test the framework, so from 4-E2 on every
 * trial (and the preflight) runs with a settings file (`<dest>.settings.json`,
 * passed with `--settings`, which `--setting-sources` does not filter) holding:
 * 1. `disableBundledSkills: true`: removes the skills and workflows that ship
 *    with the CLI (same as CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1). Skills from
 *    `.claude/skills/` (a variant's skill, via --add-dir) and plugins stay;
 * 2. `skillOverrides: { <name>: 'off' }` for BUILTIN_SKILLS: CLI 2.1.287 still
 *    lists `design`, `doctor` and `plugin-authoring` after (1); 'off' hides a
 *    skill from the model and from /name;
 * 3. `permissions.deny: ['Skill(<name>)', ...]` for the same names, so a call is
 *    refused even if a later CLI lists one again.
 * Checked offline on CLI 2.1.287 (init event only; the API base URL pointed at
 * a closed local port): no settings → 18 built-in skills; (1) → design, doctor,
 * plugin-authoring; (1)+(2) with the variant's skill dir → sygnal-dev only.
 * A variant's own skill is never blocked (trialSettings' allowSkills). The
 * React arm keeps every tool (the Skill tool too; it just lists no skills).
 * SKILL_GUARD is in the run meta and the manifest (`skillGuard`,
 * `skillGuards`; absent = 0, built-in skills available), not in the variant hash.
 */
export const SKILL_GUARD = 1
/** The built-in skills a D228 trial's init event listed (CLI 2.1.287, user settings not loaded). */
export const BUILTIN_SKILLS = ['batch', 'claude-api', 'code-review', 'dataviz', 'debug', 'deep-research', 'design', 'design-sync', 'doctor', 'fewer-permission-prompts', 'loop', 'plugin-authoring', 'run', 'run-skill-generator', 'schedule', 'simplify', 'update-config', 'verify', 'workflow-authoring']

/** The settings a trial runs with when the skill guard is on: built-in skills removed, off and denied; `allowSkills` untouched. */
export function trialSettings({ allowSkills = [], builtinSkills = BUILTIN_SKILLS } = {}) {
  const names = builtinSkills.filter((n) => !allowSkills.includes(n))
  return {
    disableBundledSkills: true,
    skillOverrides: Object.fromEntries(names.map((n) => [n, 'off'])),
    permissions: { deny: names.map((n) => `Skill(${n})`) },
  }
}

/** With the guard on: a problem string if the init skill list still has a built-in skill, else null. */
export function checkSkillGuard(skills, allowSkills = []) {
  if (!Array.isArray(skills)) return null
  const left = skills.filter((n) => BUILTIN_SKILLS.includes(n) && !allowSkills.includes(n))
  return left.length ? `built-in skill(s) ${left.join(', ')} still loaded with the skill guard on (D234)` : null
}

/** Write a trial's settings file (`<dest>.settings.json`); returns its path. */
export function writeTrialSettings(dest, settings) {
  const file = `${dest}.settings.json`
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n')
  return file
}

/**
 * argv for `claude` (without the binary). `settings`: a file path or JSON string for --settings
 * (the skill guard's trialSettings()).
 */
export function buildClaudeArgs({ prompt, model, permissionMode = DEFAULT_PERMISSION_MODE, tools = DEFAULT_TOOLS, effort, maxBudgetUsd, settingSources, addDirs, mcpConfig, extraAllowedTools = [], processGuard = true, settings } = {}) {
  if (!prompt) throw new Error('buildClaudeArgs: prompt is required')
  const toolList = Array.isArray(tools) ? tools : String(tools).split(/[,\s]+/).filter(Boolean)
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', permissionMode]
  args.push('--tools', toolList.join(','), '--allowedTools', [...toolList, ...extraAllowedTools].join(','))
  if (processGuard) args.push('--disallowedTools', GUARD_DISALLOWED_TOOLS.join(','))
  if (settings) args.push('--settings', settings)
  args.push(...isolationArgs({ settingSources, addDirs, mcpConfig }), '--no-session-persistence')
  if (model) args.push('--model', model)
  if (effort) args.push('--effort', effort)
  if (maxBudgetUsd != null) args.push('--max-budget-usd', String(maxBudgetUsd))
  return args
}

/** argv for the preflight: one tiny no-tool call on the trial model, same output format. */
// It carries the guard's deny rules too, so a CLI that rejects them fails the preflight, not the first trial.
// With `settings` (the skill guard's), its `skills` list shows what a trial will see.
export function buildPreflightArgs({ model, effort, settingSources, addDirs, processGuard = true, settings } = {}) {
  const args = ['-p', 'Reply with the single word: ok', '--output-format', 'stream-json', '--verbose', '--tools', '']
  if (processGuard) args.push('--disallowedTools', GUARD_DISALLOWED_TOOLS.join(','))
  if (settings) args.push('--settings', settings)
  args.push(...isolationArgs({ settingSources, addDirs }), '--no-session-persistence')
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
  const limit = rateLimitInfo(events)
  let notRunReason = null
  if (!result) notRunReason = authErrors.length ? 'auth' : limit.limited ? `rate limit: ${limit.message}` : 'no result'
  else if (authInResult || (result.is_error && authErrors.length)) notRunReason = 'auth'
  else if (limit.limited) notRunReason = `rate limit: ${limit.message}`
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
    // A usage / rate limit or overload kept the agent from running (lib/limits.mjs): retry later.
    rateLimited: !!notRunReason?.startsWith('rate limit'),
    resetAt: notRunReason?.startsWith('rate limit') ? limit.resetAt : null,
    // What the CLI loaded (init event): skills and MCP servers, to check a variant's posture.
    skills: Array.isArray(init?.skills) ? init.skills : null,
    mcpServers: Array.isArray(init?.mcp_servers) ? init.mcp_servers.map((m) => ({ name: m.name, status: m.status })) : null,
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
