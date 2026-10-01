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
//   FAKE_CLAUDE_MODE=hang       sleep until killed (timeout handling)
// Without FAKE_CLAUDE_SOLUTION it changes nothing, so the hidden tests fail.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const argv = process.argv.slice(2)
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined)
const model = opt('--model') ?? 'claude-fake-1'
const session = 'fake-session'
const emit = (o) => process.stdout.write(JSON.stringify({ session_id: session, ...o }) + '\n')
const mode = process.env.FAKE_CLAUDE_MODE

emit({ type: 'system', subtype: 'init', cwd: process.cwd(), tools: (opt('--tools') ?? '').split(','), mcp_servers: [], model, permissionMode: opt('--permission-mode'), claude_code_version: 'fake' })

if (mode === 'auth401') {
  for (let i = 1; i <= 3; i++) emit({ type: 'system', subtype: 'api_retry', attempt: i, error_status: 401, error: 'authentication_failed' })
  process.exit(1)
}
if (mode === 'hang') {
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
