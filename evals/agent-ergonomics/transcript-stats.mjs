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
// - iterations: Bash calls that build/test/run the app (npm run build|test|dev,
//   npm test, npx vite/vitest, vite, vitest).
// - edits: file-modifying tool calls (Write/Edit/MultiEdit/NotebookEdit, plus
//   Bash commands that obviously write files: sed -i, perl -i, tee, > file).
// - editRounds: groups of consecutive edits not separated by an iteration.
//   "edit, edit, test, edit, test" = 2 edit rounds.
// - audit: tool calls that mention hidden tests or the eval harness, or read
//   files outside the trial dir (other than skill files). Any hit means the
//   trial must be reviewed and probably discarded (see run.md).
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from './lib/common.mjs'

const args = parseArgs(process.argv.slice(2))
const file = args._[0]
if (!file) {
  console.error('usage: transcript-stats.mjs <transcript.jsonl> [--dir <trial dir>]')
  process.exit(2)
}
const trialDir = typeof args.dir === 'string' ? path.resolve(args.dir) : null

const RUN_RE = /\b(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:build|test|dev|preview)\b|\bnpx\s+(?:vite|vitest)\b|(?:^|[\s;&|(])(?:vite|vitest)(?:\s|$)|vite\/bin\/vite\.js|vitest\/vitest\.mjs|node_modules\/\.bin\/vite/
const BASH_EDIT_RE = /\bsed\s+-i\b|\bperl\s+-[a-z]*i|\btee\b|(?:^|[^2&])>{1,2}\s*[^\s&|]+\.(?:jsx?|tsx?|css|html|json)\b/
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const PEEK_RE = /__hidden__|\.hidden\.[jt]sx?|agent-ergonomics|\bevals\b|\/hidden\//

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
      if (RUN_RE.test(cmd)) kind = 'run'
      else if (BASH_EDIT_RE.test(cmd)) kind = 'edit'
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
  if (PEEK_RE.test(text)) audit.push({ tool: e.name, reason: 'mentions hidden tests / eval harness', input: text.slice(0, 300) })
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
