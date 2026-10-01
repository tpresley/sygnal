#!/usr/bin/env node
// A stand-in for `claude -p ... --output-format stream-json --verbose`, for
// testing run-trial.mjs / orchestrate.mjs without paid API calls:
//   node evals/agent-ergonomics/orchestrate.mjs --run fake --claude-bin $PWD/evals/agent-ergonomics/tests/fake-claude.mjs ...
//
// It prints stream-json events shaped like the real CLI's (system/init, assistant
// tool_use, user tool_result, result), and does real work in its cwd:
//   FAKE_CLAUDE_SOLUTION=<dir>  copy <dir> over the cwd (e.g. a task's hidden/<task>/solution)
//                               and run `npm test`, so the trial can pass
//   FAKE_CLAUDE_MODE=auth401    emit only 401 api_retry events and exit 1 (no result)
//   FAKE_CLAUDE_MODE=authresult what CLI 2.1.90 does with an invalid OAuth token: 401 retries, a
//                               '<synthetic>' assistant message and a result with is_error, exit 1
//   FAKE_CLAUDE_MODELS=opus=claude-opus-4-6   how the fake resolves --model aliases (default: none)
// A call with an empty --tools value is treated as the orchestrator's preflight.
//   FAKE_CLAUDE_MODE=hang       sleep until killed (timeout handling)
//   FAKE_CLAUDE_MODE=ratelimit  a subscription usage limit: 429 api_retry events, then an is_error result
//                               "Claude AI usage limit reached|<epoch>" (FAKE_CLAUDE_RESET=<epoch s>, default now+1h), exit 1
//   FAKE_CLAUDE_MODE=overloaded 529 api_retry events and no result, exit 1
//   FAKE_CLAUDE_LIMIT_CALLS=N   with FAKE_CLAUDE_STATE=<file>: the first N trial calls (not the preflight)
//                               behave like ratelimit, later ones run normally
//   FAKE_CLAUDE_ARGV_LOG=<file> append each call's cwd and argv (JSON) to <file>
// The init event lists skills like the real CLI: ~/.claude/skills/* (from $HOME) unless
// --setting-sources leaves out "user", plus <dir>/.claude/skills/* of every --add-dir;
// and mcp_servers from --mcp-config.
// Without FAKE_CLAUDE_SOLUTION it changes nothing, so the hidden tests fail.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const argv = process.argv.slice(2)
if (argv[0] === '--version') {
  console.log(`${process.env.FAKE_CLAUDE_VERSION ?? '0.0.0'} (Fake Claude)`)
  process.exit(0)
}
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined)
const opts = (k) => argv.flatMap((a, i) => (a === k && i + 1 < argv.length ? [argv[i + 1]] : []))
if (process.env.FAKE_CLAUDE_ARGV_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_ARGV_LOG, JSON.stringify({ cwd: process.cwd(), argv }) + '\n')
const listSkills = (root) => (fs.existsSync(root) ? fs.readdirSync(root).filter((n) => fs.existsSync(path.join(root, n, 'SKILL.md'))) : [])
const sources = opt('--setting-sources')
const skills = [
  ...(sources == null || sources.split(',').includes('user') ? listSkills(path.join(process.env.HOME ?? '/nonexistent', '.claude', 'skills')) : []),
  ...opts('--add-dir').flatMap((d) => listSkills(path.join(d, '.claude', 'skills'))),
]
const mcpServers = opts('--mcp-config').flatMap((f) => {
  try {
    return Object.keys(JSON.parse(fs.readFileSync(f, 'utf8')).mcpServers ?? {}).map((name) => ({ name, status: 'connected' }))
  } catch {
    return [{ name: f, status: 'failed' }]
  }
})
const aliasMap = Object.fromEntries((process.env.FAKE_CLAUDE_MODELS ?? '').split(',').filter(Boolean).map((p) => p.split('=')))
const requested = opt('--model') ?? 'claude-fake-1'
const model = aliasMap[requested] ?? requested
const isPreflight = argv.includes('--tools') && opt('--tools') === ''
const session = 'fake-session'
const emit = (o) => process.stdout.write(JSON.stringify({ session_id: session, ...o }) + '\n')
let mode = process.env.FAKE_CLAUDE_MODE
if (process.env.FAKE_CLAUDE_LIMIT_CALLS && process.env.FAKE_CLAUDE_STATE && !isPreflight) {
  const n = fs.existsSync(process.env.FAKE_CLAUDE_STATE) ? Number(fs.readFileSync(process.env.FAKE_CLAUDE_STATE, 'utf8')) || 0 : 0
  fs.writeFileSync(process.env.FAKE_CLAUDE_STATE, String(n + 1))
  if (n < Number(process.env.FAKE_CLAUDE_LIMIT_CALLS)) mode = 'ratelimit'
}

emit({ type: 'system', subtype: 'init', cwd: process.cwd(), tools: (opt('--tools') ?? '').split(','), mcp_servers: mcpServers, skills, model, permissionMode: opt('--permission-mode'), claude_code_version: 'fake' })

if (mode === 'auth401') {
  for (let i = 1; i <= 3; i++) emit({ type: 'system', subtype: 'api_retry', attempt: i, error_status: 401, error: 'authentication_failed' })
  process.exit(1)
}
if (mode === 'authresult') {
  for (let i = 1; i <= 3; i++) emit({ type: 'system', subtype: 'api_retry', attempt: i, error_status: 401, error: 'authentication_failed' })
  const text = 'Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth access token is invalid."}}'
  emit({ type: 'assistant', message: { id: 'synthetic-1', model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text }], usage: { input_tokens: 0, output_tokens: 0 } } })
  emit({ type: 'result', subtype: 'success', is_error: true, duration_ms: 1500, duration_api_ms: 0, num_turns: 1, result: text, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
  process.exit(1)
}
if (mode === 'ratelimit') {
  for (let i = 1; i <= 2; i++) emit({ type: 'system', subtype: 'api_retry', attempt: i, error_status: 429, error: 'rate_limit' })
  const reset = Number(process.env.FAKE_CLAUDE_RESET ?? Math.floor(Date.now() / 1000) + 3600)
  const text = `Claude AI usage limit reached|${reset}`
  emit({ type: 'assistant', message: { id: 'synthetic-1', model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text }], usage: { input_tokens: 0, output_tokens: 0 } } })
  emit({ type: 'result', subtype: 'success', is_error: true, duration_ms: 900, duration_api_ms: 0, num_turns: 1, result: text, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
  process.exit(1)
}
if (mode === 'overloaded') {
  for (let i = 1; i <= 3; i++) emit({ type: 'system', subtype: 'api_retry', attempt: i, error_status: 529, error: 'overloaded_error' })
  process.exit(1)
}
if (isPreflight) {
  emit({ type: 'assistant', message: { id: 'msg_pf', role: 'assistant', model, content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 5, output_tokens: 1 } } })
  emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 900, duration_api_ms: 800, num_turns: 1, result: 'ok', total_cost_usd: 0.001, usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
} else if (mode === 'hang') {
  setInterval(() => {}, 1000)
} else {
  const usage = { input_tokens: 10, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 }
  let n = 0
  const tool = (name, input, run) => {
    const id = `toolu_fake_${++n}`
    emit({ type: 'assistant', message: { id: `msg_fake_${n}`, role: 'assistant', model, content: [{ type: 'tool_use', id, name, input }], usage }, parent_tool_use_id: null })
    const { text, isError, stdout = '', stderr = '' } = run()
    emit({ type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: text, is_error: isError }] }, parent_tool_use_id: null, tool_use_result: { stdout, stderr } })
  }
  tool('Read', { file_path: path.join(process.cwd(), 'package.json') }, () => ({ text: fs.readFileSync('package.json', 'utf8'), isError: false }))
  const sol = process.env.FAKE_CLAUDE_SOLUTION
  if (sol) {
    for (const f of listFiles(sol)) {
      const rel = path.relative(sol, f)
      tool('Write', { file_path: path.join(process.cwd(), rel), content: fs.readFileSync(f, 'utf8') }, () => {
        fs.mkdirSync(path.dirname(rel), { recursive: true })
        fs.copyFileSync(f, rel)
        return { text: `File created successfully at: ${rel}`, isError: false }
      })
    }
  }
  tool('Bash', { command: 'npm test', description: 'Run tests' }, () => {
    const r = spawnSync('npm', ['test', '--silent'], { encoding: 'utf8', env: { ...process.env, CI: '1' } })
    const out = `${r.stdout}\n${r.stderr}`.trim().slice(-2000)
    return { text: r.status === 0 ? out : `Exit code ${r.status}\n${out}`, isError: r.status !== 0, stdout: r.stdout, stderr: r.stderr }
  })
  const text = sol ? 'Done: applied the change and the tests pass.' : 'Done (no change made).'
  emit({ type: 'assistant', message: { id: `msg_fake_${++n}`, role: 'assistant', model, content: [{ type: 'text', text }], usage }, parent_tool_use_id: null })
  emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 4321, duration_api_ms: 2000, num_turns: n, result: text, total_cost_usd: 0.0123, usage: { input_tokens: 30, output_tokens: 150, cache_read_input_tokens: 3000, cache_creation_input_tokens: 600 }, modelUsage: { [model]: {} } })
}

function listFiles(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(path.join(d, e.name)) : [path.join(d, e.name)]))
}
