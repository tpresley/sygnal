#!/usr/bin/env node
// Derive trial metrics from an agent transcript (JSONL), and audit it for
// peeking at hidden tests.
//
// Usage:
//   node evals/agent-ergonomics/transcript-stats.mjs <transcript.jsonl> [--dir <trial dir>]
//   node evals/agent-ergonomics/transcript-stats.mjs --kills <run dir | transcript>... [--json]
//        lists the trials whose agent ran process kills (G-127; lib/transcript.mjs processKills)
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
//   Bash commands that write project files: cat > f <<EOF, > / >> / tee into a
//   source file, sed -i, perl -i, python/node scripts that open a file for
//   writing, patch / git apply / apply_patch; lib/transcript.mjs bashEdits).
//   A Bash call that edits and then runs the tests counts as an edit and an iteration.
// - editRounds: groups of consecutive edits not separated by an iteration.
//   "edit, edit, test, edit, test" = 2 edit rounds.
// - wallSeconds: first to last timestamp (an unstamped headless transcript
//   falls back to the result event's duration_ms).
// - audit: tool calls that mention hidden tests or the eval harness
//   (evals/agent-ergonomics, /hidden/, __hidden__, *.hidden.jsx; mentions of
//   the trial dir itself are ignored), or read files outside the trial dir
//   (other than skill files). Any hit means the
//   trial must be reviewed and probably discarded (see run.md).
// - processKills / machineWideKills: Bash process kills (pkill, killall,
//   `xargs kill`, kill $(pgrep ...), fuser -k are machine-wide; kill -9 <pid>
//   is listed but not machine-wide). See lib/headless.mjs PROCESS_GUARD.
// - headless: { model, completed, isError, durationMs, costUsd, tokens,
//   outputTokens, numTurns } from a headless transcript; null for subagent logs.
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from './lib/common.mjs'
import { transcriptStats } from './lib/transcript.mjs'

const args = parseArgs(process.argv.slice(2))
if (args.kills) {
  // Scan mode (G-127): process kills per trial over transcripts or dirs of them, e.g.
  //   transcript-stats.mjs --kills /private/tmp/sygnal-evals/trials/*/   [--json]
  const inputs = [...(typeof args.kills === 'string' ? [args.kills] : []), ...args._]
  const files = inputs.flatMap((p) => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).filter((f) => f.endsWith('.transcript.jsonl')).map((f) => path.join(p, f)) : [p]))
  const rows = []
  for (const f of files.sort()) {
    const s = transcriptStats(fs.readFileSync(f, 'utf8'))
    if (!s.processKills.length) continue
    const runJson = f.replace(/\.transcript\.jsonl$/, '.run.json')
    let processGuard = 0
    try {
      processGuard = JSON.parse(fs.readFileSync(runJson, 'utf8')).processGuard ?? 0
    } catch {}
    rows.push({ run: path.basename(path.dirname(f)), trial: path.basename(f).replace(/\.transcript\.jsonl$/, ''), processGuard, machineWide: s.machineWideKills, kills: s.processKills })
  }
  if (args.json) console.log(JSON.stringify({ scanned: files.length, trials: rows }, null, 2))
  else {
    console.log(`${files.length} transcripts scanned; ${rows.filter((r) => r.machineWide).length} with machine-wide process kills, ${rows.filter((r) => !r.machineWide).length} with only kill -9 by PID`)
    for (const r of rows) console.log(`${r.run}/${r.trial}\t${r.machineWide} machine-wide${r.processGuard ? ' (guarded: refused)' : ''}\t${r.kills.map((k) => k.command).join(' | ')}`)
  }
  process.exit(0)
}
const file = args._[0]
if (!file) {
  console.error('usage: transcript-stats.mjs <transcript.jsonl> [--dir <trial dir>]')
  process.exit(2)
}
const trialDir = typeof args.dir === 'string' ? path.resolve(args.dir) : null
const stats = transcriptStats(fs.readFileSync(file, 'utf8'), trialDir)
console.log(JSON.stringify({ transcript: path.resolve(file), ...stats }, null, 2))
