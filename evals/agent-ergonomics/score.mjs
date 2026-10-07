#!/usr/bin/env node
// Score one finished trial (step 4 of run.md) and append a record to
// results/<run>.json.
//
// Usage:
//   node evals/agent-ergonomics/score.mjs --dir <trial dir> --task 03 --arm sygnal|react \
//        --trial 1 --run baseline \
//        [--iterations N]      times the agent ran build/test/dev (from the transcript)
//        [--edit-rounds N]     number of edit rounds (see README "Metrics")
//        [--wall-seconds N]    wall time of the agent run, if known (default: --duration-ms / 1000)
//        [--duration-ms N]     the agent run's own duration (headless: result.duration_ms)
//        [--tokens N]          tokens billed over the run: input + output + cache read +
//                              cache creation (headless: from the result event; PLAN-1
//                              subagents: the Agent tool's total_tokens)
//        [--output-tokens N]   output tokens alone
//        [--cost-usd N]        cost of the run (headless: result.total_cost_usd)
//        [--model M]           model id the trial ran on
//        [--method M]          how the trial was run: headless | subagent
//        [--variant V] [--variant-hash H]   the run variant (orchestrate.mjs --variant) and its spec hash
//        [--starter-version N] the starter version the trial was prepared with (lib/starter.mjs); absent = 1
//        [--category C]        failure category (wiring | isolation | reducer-shape |
//                              stream-operator | other | none); defaults to "none" on pass
//        [--notes "..."]
//
// Re-scoring the same (run, task, arm, trial) replaces the earlier record.
//
// Classify-only mode (no test run, just set the category of an existing record):
//   node evals/agent-ergonomics/score.mjs --classify --run baseline --task 03 --arm sygnal --trial 1 --category wiring
import fs from 'node:fs'
import path from 'node:path'
import {
  EVAL_ROOT, FAILURE_CATEGORIES, resolveTask, parseArgs, installHidden, runHidden,
} from './lib/common.mjs'

const args = parseArgs(process.argv.slice(2))
const usage = () => {
  console.error('usage: score.mjs --dir <trial> --task <id> --arm sygnal|react --trial <n> --run <name> [--iterations N] [--edit-rounds N] [--wall-seconds N] [--duration-ms N] [--tokens N] [--output-tokens N] [--cost-usd N] [--model M] [--method M] [--variant V --variant-hash H] [--starter-version N] [--category C] [--notes "..."]')
  console.error('       score.mjs --classify --run <name> --task <id> --arm <arm> --trial <n> --category C')
  process.exit(2)
}
if (!args.task || !args.arm || !args.run || args.trial === undefined) usage()

const arm = args.arm
const task = resolveTask(arm, args.task)
const trial = Number(args.trial)
const num = (v) => (v === undefined || v === true ? null : Number(v))

if (args.category !== undefined && !FAILURE_CATEGORIES.includes(args.category)) {
  console.error(`--category must be one of: ${FAILURE_CATEGORIES.join(', ')}`)
  process.exit(2)
}
if (!/^[\w.-]+$/.test(args.run)) {
  console.error('--run must be a simple name like "baseline" or "phase3"')
  process.exit(2)
}

const resultsDir = path.join(EVAL_ROOT, 'results')
const resultsFile = path.join(resultsDir, `${args.run}.json`)
fs.mkdirSync(resultsDir, { recursive: true })
const sameKey = (r) => r.task === task && r.arm === arm && r.trial === trial
const load = () => (fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, 'utf8')) : [])

/**
 * Read-modify-write results/<run>.json under a lock, so concurrent scorers
 * (orchestrate.mjs runs several trials at once) don't drop each other's records.
 */
function update(fn) {
  const lock = resultsFile + '.lock'
  const deadline = Date.now() + 120_000
  for (;;) {
    try {
      fs.mkdirSync(lock)
      break
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      // A lock older than two minutes is left over from a crashed scorer.
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 120_000) fs.rmSync(lock, { recursive: true, force: true })
      } catch {}
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${lock}`)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
    }
  }
  try {
    const records = load()
    const out = fn(records)
    fs.writeFileSync(resultsFile, JSON.stringify(records, null, 2) + '\n')
    return out
  } finally {
    fs.rmSync(lock, { recursive: true, force: true })
  }
}

if (args.classify) {
  if (!args.category) usage()
  const rec = update((records) => {
    const r = records.find(sameKey)
    if (r) r.failureCategory = args.category
    return r
  })
  if (!rec) {
    console.error(`No record for ${task}/${arm}/trial ${trial} in ${resultsFile}`)
    process.exit(1)
  }
  console.log(JSON.stringify(rec, null, 2))
  process.exit(0)
}

if (!args.dir) usage()
const dir = path.resolve(args.dir)
if (!fs.existsSync(path.join(dir, 'package.json'))) {
  console.error(`${dir} does not look like a trial dir (no package.json)`)
  process.exit(2)
}

// A headless run whose agent never ran (auth failure, is_error, no API time) is not a trial.
const runMetaFile = `${dir}.run.json`
if (fs.existsSync(runMetaFile) && !args.force) {
  const meta = JSON.parse(fs.readFileSync(runMetaFile, 'utf8'))
  if (meta.agentRan === false) {
    console.error(`${dir}: the agent never ran (${meta.notRunReason}); not scoring it. Re-run the trial (or pass --force).`)
    process.exit(3)
  }
}

installHidden(dir, arm, task)
const r = runHidden(dir)

// TODO(auto-classify): derive failureCategory from r.failures plus a static
// scan of the trial's src/ (e.g. intent selector absent from view classNames
// -> wiring; DOM.select of a class rendered only by a Collection item ->
// isolation; reducer result missing keys -> reducer-shape; RxJS-only operator
// names such as switchMap/pipe -> stream-operator). Until then it is set by a
// human or the coordinator with --category (or later with --classify).
const failureCategory = args.category ?? (r.pass ? 'none' : null)

const record = {
  task,
  arm,
  trial,
  pass: r.pass,
  testsPassed: r.testsPassed,
  testsTotal: r.testsTotal,
  iterations: num(args.iterations),
  editRounds: num(args['edit-rounds']),
  wallSeconds: num(args['wall-seconds']) ?? (num(args['duration-ms']) != null ? Math.round(num(args['duration-ms']) / 1000) : null),
  durationMs: num(args['duration-ms']),
  tokens: num(args.tokens),
  outputTokens: num(args['output-tokens']),
  costUsd: num(args['cost-usd']),
  model: typeof args.model === 'string' ? args.model : null,
  method: typeof args.method === 'string' ? args.method : null,
  ...(typeof args.variant === 'string' ? { variant: args.variant, variantHash: typeof args['variant-hash'] === 'string' ? args['variant-hash'] : null } : {}),
  ...(num(args['starter-version']) != null ? { starterVersion: num(args['starter-version']) } : {}),
  failureCategory,
  // mod tier (35-43): behavior tests alone, and the audit / project-suite groups (lib/common.mjs TEST_GROUPS)
  ...(r.groups.audit || r.groups.project
    ? { behaviorPass: !!r.groups.behavior && r.groups.behavior.passed === r.groups.behavior.total, groups: r.groups }
    : {}),
  failures: r.failures,
  notes: typeof args.notes === 'string' ? args.notes : undefined,
  scoredAt: new Date().toISOString(),
}

update((records) => {
  const idx = records.findIndex(sameKey)
  if (idx >= 0) records[idx] = record
  else records.push(record)
})

console.log(JSON.stringify(record, null, 2))
if (!r.pass && r.testsTotal === 0) {
  console.error('\nHidden suite did not run any tests. Tail of vitest output:\n' + r.output.split('\n').slice(-30).join('\n'))
}
if (failureCategory === null) {
  console.error(`\nFAILED and unclassified. Classify with:\n  node ${path.relative(process.cwd(), path.join(EVAL_ROOT, 'score.mjs'))} --classify --run ${args.run} --task ${task} --arm ${arm} --trial ${trial} --category <${FAILURE_CATEGORIES.join('|')}>`)
}
