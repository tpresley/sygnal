#!/usr/bin/env node
// Run one prepared trial headless (run.md step 2, G-030).
//
// Usage:
//   node evals/agent-ergonomics/run-trial.mjs --dest <trial dir>
//        [--model opus|sonnet|haiku|<full id>]   default: the CLI's default model
//        [--timeout-min 30]                      kill the run (and its children) after this
//        [--effort low|medium|high|max]
//        [--max-budget-usd N]                    claude's own spend cap for the run
//        [--permission-mode acceptEdits]         see lib/headless.mjs for the posture
//        [--tools Bash,Read,Edit,...]            tools available and pre-approved
//        [--claude-bin claude]                   another binary (tests use tests/fake-claude.mjs)
//        [--force]                               overwrite an existing transcript
//
// Runs `claude -p "$(cat <dest>.prompt.txt)" --output-format stream-json --verbose`
// with cwd = <dest>, the same prompt a PLAN-1 subagent got. Writes:
//   <dest>.transcript.jsonl   every stream-json line, stamped with `timestamp`
//   <dest>.run.json           wall time, exit status, model, cost, tokens, turns
//   <dest>.stderr.log
// and prints the run meta. Exit code 0 only if the agent finished normally.
// Score afterwards with score.mjs (orchestrate.mjs does all of it).
import { parseArgs } from './lib/common.mjs'
import { runTrial } from './lib/runner.mjs'

const args = parseArgs(process.argv.slice(2))
if (!args.dest || args.dest === true) {
  console.error('usage: run-trial.mjs --dest <trial dir> [--model M] [--timeout-min N] [--effort E] [--max-budget-usd N] [--permission-mode P] [--tools a,b] [--claude-bin bin] [--force]')
  process.exit(2)
}
const str = (k) => (typeof args[k] === 'string' ? args[k] : undefined)
const num = (k) => (str(k) === undefined ? undefined : Number(str(k)))

const meta = await runTrial({
  dest: args.dest,
  model: str('model'),
  timeoutMin: num('timeout-min'),
  effort: str('effort'),
  maxBudgetUsd: num('max-budget-usd'),
  permissionMode: str('permission-mode'),
  tools: str('tools'),
  claudeBin: str('claude-bin'),
  force: !!args.force,
})
const { finalText, ...shown } = meta
console.log(JSON.stringify(shown, null, 2))
if (meta.authFailed) console.error('\nThe trial could not authenticate (401 on every API call). Run from a shell where `claude -p "hi"` works, or set ANTHROPIC_API_KEY.')
process.exit(meta.ok ? 0 : 1)
