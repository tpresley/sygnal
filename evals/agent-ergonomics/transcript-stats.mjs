#!/usr/bin/env node
// Derive trial metrics from an agent transcript (JSONL), and audit it for
// peeking at hidden tests.
//
// Usage:
//   node evals/agent-ergonomics/transcript-stats.mjs <transcript.jsonl> [--dir <trial dir>]
//
// Accepts Claude Code transcripts (subagent logs live at
// ~/.claude/projects/<project>/<session-id>/subagents/agent-<id>.jsonl) and
// headless `claude -p --output-format stream-json --verbose` output, as written
// by run-trial.mjs (`<dest>.transcript.jsonl`, each line stamped with a
// `timestamp`). Any JSONL whose lines contain assistant messages with
// `tool_use` content blocks works.
//
// Prints JSON: { iterations, editRounds, edits, wallSeconds, toolCalls, audit[], headless }
// - iterations: Bash calls that build/test/run the app at least once: npm/pnpm/
//   yarn test or run build|test|dev|preview (with --prefix and similar options,
//   anywhere in a `cd X && ...` chain), npx vite/vitest, vite, vitest,
//   node_modules/.bin/vite(st), node .../vitest.mjs. See lib/transcript.mjs
//   and tests/transcript.unit.mjs.
// - edits: file-modifying tool calls (Write/Edit/MultiEdit/NotebookEdit, plus
//   Bash commands that obviously write files: sed -i, perl -i, tee, > file).
// - editRounds: groups of consecutive edits not separated by an iteration.
//   "edit, edit, test, edit, test" = 2 edit rounds.
// - wallSeconds: first to last timestamp (an unstamped headless transcript
//   falls back to the result event's duration_ms).
// - audit: tool calls that mention hidden tests or the eval harness
//   (evals/agent-ergonomics, /hidden/, __hidden__, *.hidden.jsx; mentions of
//   the trial dir itself are ignored), or read files outside the trial dir
//   (other than skill files). Any hit means the
//   trial must be reviewed and probably discarded (see run.md).
// - headless: { model, completed, isError, durationMs, costUsd, tokens,
//   outputTokens, numTurns } from a headless transcript; null for subagent logs.
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from './lib/common.mjs'
import { transcriptStats } from './lib/transcript.mjs'

const args = parseArgs(process.argv.slice(2))
const file = args._[0]
if (!file) {
  console.error('usage: transcript-stats.mjs <transcript.jsonl> [--dir <trial dir>]')
  process.exit(2)
}
const trialDir = typeof args.dir === 'string' ? path.resolve(args.dir) : null
const stats = transcriptStats(fs.readFileSync(file, 'utf8'), trialDir)
console.log(JSON.stringify({ transcript: path.resolve(file), ...stats }, null, 2))
