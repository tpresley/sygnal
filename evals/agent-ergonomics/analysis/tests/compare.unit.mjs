// G-119: task-matched run comparison (analysis/lib/matched.mjs, compare.mjs).
// Run: node --test evals/agent-ergonomics/analysis/tests/*.unit.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { matchedCompare, renderMatched, rowsFromResults, rowsFromAnalysis, parseSide, loadRun } from '../lib/matched.mjs'
import { compareRuns } from '../compare.mjs'
import { taskSelector } from '../../lib/plan.mjs'

const rec = (arm, task, trial, wall, o = {}) => ({ arm, task, trial, pass: true, wallSeconds: wall, costUsd: wall / 100, iterations: 2, editRounds: 1, ...o })

// A baseline over three tasks per arm, and a subset run over one Sygnal task, the G-119 case:
// the subset's task is the baseline's slowest, so whole-run means say "slower" while it got faster.
const BASE = [
  rec('sygnal', '01-a', 1, 20), rec('sygnal', '01-a', 2, 30),
  rec('sygnal', '02-b', 1, 40),
  rec('sygnal', '13-c', 1, 100), rec('sygnal', '13-c', 2, 120, { pass: false }),
  rec('react', '01-a', 1, 10), rec('react', '02-b', 1, 30), rec('react', '13-c', 1, 60),
]
const NEXT = [rec('sygnal', '13-c', 1, 90), rec('sygnal', '13-c', 2, 100), rec('sygnal', '99-new', 1, 5)]
const side = (run, recs) => ({ run, source: 'results', rows: rowsFromResults(recs) })

test('matchedCompare: only (arm, task) cells in both runs; per-task deltas; unmatched listed', () => {
  const c = matchedCompare(side('base', BASE), side('next', NEXT))
  assert.deepEqual(c.groups.map((g) => g.label), ['react', 'sygnal'])
  const syg = c.groups.find((g) => g.label === 'sygnal')
  assert.deepEqual(syg.cells.map((x) => x.task), ['13-c'])
  assert.equal(syg.cells[0].base.wall, 110)
  assert.equal(syg.cells[0].next.wall, 95)
  assert.equal(syg.cells[0].delta.wall, -15)
  assert.equal(syg.cells[0].delta.pass, 0.5)
  assert.deepEqual(syg.matched.wall, { base: 110, next: 95, delta: -15, ratio: 95 / 110, cells: 1 })
  assert.deepEqual(syg.baseOnly, ['01-a', '02-b'])
  assert.deepEqual(syg.nextOnly, ['99-new'])
  assert.deepEqual(syg.trials, { base: 2, next: 2 })
  const react = c.groups.find((g) => g.label === 'react')
  assert.equal(react.cells.length, 0)
  assert.deepEqual(react.rows, { base: 3, next: 0 })
  // Whole-run Sygnal means (base 62 s over 5 trials, next 65 s over 3) would read +3 s; matched, it is −15 s.
  const md = renderMatched(c)
  assert.match(md, /## sygnal: `base:sygnal` → `next:sygnal` \(task-matched\)/)
  assert.match(md, /1 task\(s\) in both \(2 → 2 trials\)\. Only in base:sygnal: 01-a, 02-b\. Only in next:sygnal: 99-new\./)
  assert.match(md, /\| wall \(s\) \| 110 \| 95 \| -15 \| 0\.86× \| 1 \|/)
  assert.match(md, /\| 13-c \| 2 → 2 \| 50% → 100% \| \+50% \| 110 → 95 \| -15 \|/)
  assert.match(md, /_No shared tasks: next:react has no trials here\._/)
})

test('matchedCompare: the matched mean weighs every task the same, whatever its trial count', () => {
  const base = [rec('sygnal', '01-a', 1, 10), rec('sygnal', '02-b', 1, 100)]
  const next = [rec('sygnal', '01-a', 1, 20), rec('sygnal', '01-a', 2, 20), rec('sygnal', '01-a', 3, 20), rec('sygnal', '02-b', 1, 100)]
  const g = matchedCompare(side('b', base), side('n', next)).groups[0]
  assert.equal(g.matched.wall.base, 55)
  assert.equal(g.matched.wall.next, 60, 'not (60 + 100) / 4 = 40')
  assert.equal(g.matched.wall.delta, 5)
  // A metric one side lacks for a task is averaged over the tasks both have.
  const n2 = [rec('sygnal', '01-a', 1, 20, { costUsd: null }), rec('sygnal', '02-b', 1, 100)]
  const g2 = matchedCompare(side('b', base), side('n', n2)).groups[0]
  assert.equal(g2.matched.costUsd.cells, 1)
  assert.equal(g2.matched.costUsd.base, 1)
})

test('matchedCompare: pinned arms compare across arms and runs (the gap); --arms and --tasks filter', () => {
  const gap = matchedCompare(side('v2', BASE), side('e1', NEXT), { baseArm: 'react', nextArm: 'sygnal' })
  assert.equal(gap.groups.length, 1)
  const g = gap.groups[0]
  assert.equal(g.label, 'react → sygnal')
  assert.deepEqual(g.cells.map((x) => x.task), ['13-c'])
  assert.equal(g.cells[0].delta.wall, 95 - 60)
  // Same run, both arms pinned: the within-run Sygnal − React gap on shared tasks.
  const within = matchedCompare(side('v2', BASE), side('v2', BASE), { baseArm: 'react', nextArm: 'sygnal' }).groups[0]
  assert.deepEqual(within.cells.map((x) => x.task), ['01-a', '02-b', '13-c'])
  assert.equal(within.matched.wall.base, (10 + 30 + 60) / 3)
  assert.equal(within.matched.wall.next, (25 + 40 + 110) / 3)
  // One pinned side pins the other to the same arm.
  assert.equal(matchedCompare(side('b', BASE), side('n', NEXT), { nextArm: 'sygnal' }).groups[0].baseArm, 'sygnal')
  const onlySyg = matchedCompare(side('b', BASE), side('b', BASE), { arms: ['sygnal'] })
  assert.deepEqual(onlySyg.groups.map((x) => x.label), ['sygnal'])
  const tier1 = matchedCompare(side('b', BASE), side('b', BASE), { tasks: taskSelector('tier1') })
  assert.deepEqual(tier1.groups[0].cells.map((x) => x.task), ['01-a', '02-b'])
})

test('self-comparison is all zeros', () => {
  const c = matchedCompare(side('b', BASE), side('b', BASE))
  for (const g of c.groups) for (const [m, v] of Object.entries(g.matched)) if (v.cells) assert.equal(v.delta, 0, `${g.label} ${m}`)
})

test('rows from an analysis record and a results record; parseSide', () => {
  const [a] = rowsFromAnalysis({ trials: [{ arm: 'sygnal', task: '08-x', trialNo: 1, scored: { pass: true }, wallSeconds: 24.6, usage: { costUsd: 0.29, tokens: 1000, outputTokens: 50 }, iterations: 2, editRounds: 2, toolCalls: { total: 6 }, tokens: { peakContext: 34195 }, failures: [{ kind: 'verify', cause: 'agent' }, { kind: 'verify', cause: 'harness' }], diff: { added: 40 }, wroteTest: true, phases: { orient: 1 } }] })
  assert.deepEqual({ ...a, phases: undefined }, { arm: 'sygnal', task: '08-x', trial: 1, pass: 1, wall: 24.6, costUsd: 0.29, tokens: 1000, outputTokens: 50, iterations: 2, editRounds: 2, toolCalls: 6, peakContext: 34195, failedRuns: 1, locAdded: 40, wroteTest: 1, phases: undefined })
  const [r] = rowsFromResults([{ arm: 'react', task: '01-a', trial: 2, pass: false, durationMs: 5000, variant: 'e1' }])
  assert.equal(r.pass, 0)
  assert.equal(r.wall, 5)
  assert.equal(r.variant, 'e1')
  assert.deepEqual(parseSide('v2-baseline'), { run: 'v2-baseline', arm: null })
  assert.deepEqual(parseSide('e1.check:sygnal'), { run: 'e1.check', arm: 'sygnal' })
  assert.throws(() => parseSide('x:vue'))
})

test('compareRuns (the CLI): loads results or analyses from an eval root, filters, --json data, --full needs analyses', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-'))
  fs.mkdirSync(path.join(root, 'results', 'analysis'), { recursive: true })
  fs.writeFileSync(path.join(root, 'results', 'base.json'), JSON.stringify(BASE))
  fs.writeFileSync(path.join(root, 'results', 'next.json'), JSON.stringify(NEXT))
  const r = compareRuns(['--base', 'base', '--next', 'next', '--arms', 'sygnal'], { evalRoot: root })
  assert.match(r.text, /^# `base` → `next`\n\nSource: results · arms sygnal\./)
  assert.equal(r.data.groups.length, 1)
  assert.equal(r.data.groups[0].matched.wall.delta, -15)
  const gap = compareRuns(['--base', 'base:react', '--next', 'base:sygnal', '--tasks', '13', '--metrics', 'wall'], { evalRoot: root })
  assert.equal(gap.data.groups[0].cells[0].delta.wall, 50)
  assert.match(gap.text, /\| Task \| trials \| wall \(s\) \| Δ \|/)
  assert.throws(() => compareRuns(['--base', 'base', '--next', 'next', '--full'], { evalRoot: root }), /--full needs/)
  assert.throws(() => compareRuns(['--base', 'base', '--next', 'missing'], { evalRoot: root }), /No results for run "missing"/)
  assert.throws(() => compareRuns(['--base', 'base', '--next', 'next', '--metrics', 'speed'], { evalRoot: root }), /Unknown metric/)
  // An analysis for only one side: both sides fall back to results, so the metric sets match.
  fs.writeFileSync(path.join(root, 'results', 'analysis', 'base.json'), JSON.stringify({ meta: { run: 'base' }, trials: [] }))
  assert.equal(loadRun('base', { evalRoot: root }).source, 'analysis')
  assert.match(compareRuns(['--base', 'base', '--next', 'next'], { evalRoot: root }).text, /Source: results\./)
})
