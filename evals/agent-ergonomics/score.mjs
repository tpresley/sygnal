#!/usr/bin/env node
// Score one finished trial (step 4 of run.md) and append a record to
// results/<run>.json.
//
// Usage:
//   node evals/agent-ergonomics/score.mjs --dir <trial dir> --task 03 --arm sygnal|react \
//        --trial 1 --run baseline \
//        [--iterations N]      times the agent ran build/test/dev (from the transcript)
//        [--edit-rounds N]     number of edit rounds (see README "Metrics")
//        [--wall-seconds N]    wall time of the agent run, if known
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
  console.error('usage: score.mjs --dir <trial> --task <id> --arm sygnal|react --trial <n> --run <name> [--iterations N] [--edit-rounds N] [--wall-seconds N] [--category C] [--notes "..."]')
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
const records = fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, 'utf8')) : []
const sameKey = (r) => r.task === task && r.arm === arm && r.trial === trial

function save() {
  fs.writeFileSync(resultsFile, JSON.stringify(records, null, 2) + '\n')
}

if (args.classify) {
  const rec = records.find(sameKey)
  if (!rec) {
    console.error(`No record for ${task}/${arm}/trial ${trial} in ${resultsFile}`)
    process.exit(1)
  }
  if (!args.category) usage()
  rec.failureCategory = args.category
  save()
  console.log(JSON.stringify(rec, null, 2))
  process.exit(0)
}

if (!args.dir) usage()
const dir = path.resolve(args.dir)
if (!fs.existsSync(path.join(dir, 'package.json'))) {
  console.error(`${dir} does not look like a trial dir (no package.json)`)
  process.exit(2)
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
  wallSeconds: num(args['wall-seconds']),
  failureCategory,
  failures: r.failures,
  notes: typeof args.notes === 'string' ? args.notes : undefined,
  scoredAt: new Date().toISOString(),
}

const idx = records.findIndex(sameKey)
if (idx >= 0) records[idx] = record
else records.push(record)
save()

console.log(JSON.stringify(record, null, 2))
if (!r.pass && r.testsTotal === 0) {
  console.error('\nHidden suite did not run any tests. Tail of vitest output:\n' + r.output.split('\n').slice(-30).join('\n'))
}
if (failureCategory === null) {
  console.error(`\nFAILED and unclassified. Classify with:\n  node ${path.relative(process.cwd(), path.join(EVAL_ROOT, 'score.mjs'))} --classify --run ${args.run} --task ${task} --arm ${arm} --trial ${trial} --category <${FAILURE_CATEGORIES.join('|')}>`)
}
