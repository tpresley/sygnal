#!/usr/bin/env node
// Derive trial metrics from an agent transcript (JSONL), and audit it for
// peeking at hidden tests.
//
// Usage:
//   node evals/agent-ergonomics/transcript-stats.mjs <transcript.jsonl> [--dir <trial dir>]
//
// Accepts Claude Code transcripts (subagent logs live at
// ~/.claude/projects/<project>/<session-id>/subagents/agent-<id>.jsonl) and
// `claude -p --output-format stream-json --verbose` output. Any JSONL whose
// lines contain assistant messages with `tool_use` content blocks works.
//
// Prints JSON: { iterations, editRounds, edits, wallSeconds, toolCalls, audit[] }
// - iterations: Bash calls that build/test/run the app at least once: npm/pnpm/
//   yarn test or run build|test|dev|preview (with --prefix and similar options,
//   anywhere in a `cd X && ...` chain), npx vite/vitest, vite, vitest,
//   node_modules/.bin/vite(st), node .../vitest.mjs. See lib/transcript.mjs
//   and tests/transcript.unit.mjs.
// - edits: file-modifying tool calls (Write/Edit/MultiEdit/NotebookEdit, plus
//   Bash commands that obviously write files: sed -i, perl -i, tee, > file).
// - editRounds: groups of consecutive edits not separated by an iteration.
//   "edit, edit, test, edit, test" = 2 edit rounds.
// - audit: tool calls that mention hidden tests or the eval harness
//   (evals/agent-ergonomics, /hidden/, __hidden__, *.hidden.jsx; mentions of
//   the trial dir itself are ignored), or read files outside the trial dir
//   (other than skill files). Any hit means the
//   trial must be reviewed and probably discarded (see run.md).
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from './lib/common.mjs'
import { isRunCommand, isEditCommand, mentionsHidden } from './lib/transcript.mjs'

const args = parseArgs(process.argv.slice(2))
const file = args._[0]
if (!file) {
  console.error('usage: transcript-stats.mjs <transcript.jsonl> [--dir <trial dir>]')
  process.exit(2)
}
const trialDir = typeof args.dir === 'string' ? path.resolve(args.dir) : null

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
const events = [] // { kind: 'run'|'edit'|'other', name, input, ts }
let firstTs = null
let lastTs = null
const seen = new Set()

for (const line of lines) {
  let obj
  try {
    obj = JSON.parse(line)
  } catch {
    continue
  }
  const ts = obj.timestamp ? Date.parse(obj.timestamp) : null
  if (ts) {
    firstTs ??= ts
    lastTs = ts
  }
  const msg = obj.message ?? obj
  if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.content)) continue
  for (const block of msg.content) {
    if (block?.type !== 'tool_use' || seen.has(block.id)) continue
    seen.add(block.id)
    const name = block.name
    const input = block.input ?? {}
    let kind = 'other'
    if (EDIT_TOOLS.has(name)) kind = 'edit'
    else if (name === 'Bash') {
      const cmd = String(input.command ?? '')
      if (isRunCommand(cmd)) kind = 'run'
      else if (isEditCommand(cmd)) kind = 'edit'
    }
    events.push({ kind, name, input, ts })
  }
}

let iterations = 0
let edits = 0
let editRounds = 0
let inEditRound = false
const audit = []

for (const e of events) {
  if (e.kind === 'run') {
    iterations++
    inEditRound = false
  } else if (e.kind === 'edit') {
    edits++
    if (!inEditRound) {
      editRounds++
      inEditRound = true
    }
  }
  const text = JSON.stringify(e.input)
  if (mentionsHidden(text, trialDir)) audit.push({ tool: e.name, reason: 'mentions hidden tests / eval harness', input: text.slice(0, 300) })
  if (trialDir && ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'MultiEdit'].includes(e.name)) {
    const p = e.input.file_path ?? e.input.path
    if (typeof p === 'string' && path.isAbsolute(p) && !p.startsWith(trialDir) && !/[/\\]skills?[/\\]/.test(p)) {
      audit.push({ tool: e.name, reason: 'touches a path outside the trial dir', input: p })
    }
  }
}

console.log(
  JSON.stringify(
    {
      transcript: path.resolve(file),
      iterations,
      editRounds,
      edits,
      wallSeconds: firstTs && lastTs ? Math.round((lastTs - firstTs) / 1000) : null,
      toolCalls: events.length,
      audit,
    },
    null,
    2
  )
)
