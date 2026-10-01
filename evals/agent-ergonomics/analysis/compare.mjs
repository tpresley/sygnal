#!/usr/bin/env node
// Compare two runs, task-matched (G-119), e.g. a Phase 3 variant against the baseline.
//
// Usage:
//   node evals/agent-ergonomics/analysis/compare.mjs --base <run>[:arm] --next <run>[:arm]
//        [--arms sygnal,react]      only these arms (sides without a pinned arm)
//        [--tasks tier1|01-05|...]  only these tasks (same syntax as orchestrate.mjs --tasks)
//        [--metrics pass,wall,costUsd,iterations]   per-task columns (matched means show every metric)
//        [--source auto|analysis|results]  auto: results/analysis/<run>.json if present, else results/<run>.json
//        [--full]                   also the old whole-run aggregate diff (needs both analyses; NOT task-matched)
//        [--json] [--out <file>]
//
// Only (arm, task) cells present in both runs are compared: per cell the mean
// of its trials, then the matched mean over the shared tasks and next − base.
// `run:arm` pins an arm on one side, so `--base v2-baseline:react --next
// e1-check:sygnal` compares across arms (cells match on task; Δ = the gap).
// Comparing a run with itself gives all-zero deltas (a smoke test).
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs, EVAL_ROOT } from '../lib/common.mjs'
import { PHASE_ORDER } from './lib/aggregate.mjs'
import { loadRun, parseSide, matchedCompare, renderMatched, METRICS, DEFAULT_TASK_METRICS } from './lib/matched.mjs'
import { taskSelector } from '../lib/plan.mjs'

const f1 = (x) => (x == null ? '—' : (Math.round(x * 10) / 10).toString())
const sgn = (x) => (x == null ? '—' : `${x > 0 ? '+' : ''}${f1(x)}`)
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map((c) => String(c ?? '').replace(/(?<!\\)\|/g, '\\|')).join(' | ')} |`)].join('\n')

export function load(run) {
  const p = path.join(EVAL_ROOT, 'results', 'analysis', `${run}.json`)
  if (!fs.existsSync(p)) throw new Error(`No analysis for run "${run}" at ${p}; run analyze.mjs --run ${run} first`)
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

/** Structured diff of two analyses. */
export function diffAnalyses(a, b) {
  const metrics = ['wall', 'peakContext', 'cacheCreation', 'iterations', 'effectiveIterations', 'editRounds', 'failedRuns', 'toolCalls', 'locAdded']
  const headline = {}
  for (const arm of ['sygnal', 'react']) {
    const x = a.aggregates.overall[arm]
    const y = b.aggregates.overall[arm]
    if (!x && !y) continue
    headline[arm] = {}
    for (const m of metrics) headline[arm][m] = { base: x?.[m]?.mean ?? null, next: y?.[m]?.mean ?? null, change: x && y ? (y[m]?.mean ?? 0) - (x[m]?.mean ?? 0) : null }
    headline[arm].pass = { base: x ? `${x.pass}/${x.scored}` : null, next: y ? `${y.pass}/${y.scored}` : null }
    headline[arm].phases = {}
    for (const p of PHASE_ORDER) headline[arm].phases[p] = { base: x?.phases[p] ?? null, next: y?.phases[p] ?? null, change: x && y ? (y.phases[p] ?? 0) - (x.phases[p] ?? 0) : null }
  }
  const items = {}
  for (const it of a.aggregates.delta.items) items[it.item] = { base: it.delta, next: null }
  for (const it of b.aggregates.delta.items) (items[it.item] ??= { base: null, next: null }).next = it.delta
  for (const v of Object.values(items)) v.change = (v.next ?? 0) - (v.base ?? 0)
  const catalog = {}
  for (const c of a.aggregates.catalog) catalog[c.id] = { base: c.frictionSecondsPerSygnalTrial, baseTrials: c.sygnal, next: null, nextTrials: null }
  for (const c of b.aggregates.catalog) Object.assign((catalog[c.id] ??= { base: null, baseTrials: null }), { next: c.frictionSecondsPerSygnalTrial, nextTrials: c.sygnal })
  for (const v of Object.values(catalog)) v.change = (v.next ?? 0) - (v.base ?? 0)
  const forms = {}
  for (const [k, v] of Object.entries(a.aggregates.canonical.forms ?? {})) forms[k] = { base: v.trials, next: null }
  for (const [k, v] of Object.entries(b.aggregates.canonical.forms ?? {})) (forms[k] ??= { base: null }).next = v.trials
  return {
    base: a.meta.run,
    next: b.meta.run,
    wallDelta: { base: a.aggregates.delta.wallDelta, next: b.aggregates.delta.wallDelta },
    headline,
    items,
    catalog,
    forms,
  }
}

export function renderDiff(d) {
  const out = []
  out.push(`# Friction analysis: \`${d.base}\` → \`${d.next}\``, '')
  out.push(`Sygnal − React wall-time delta on shared tasks: ${f1(d.wallDelta.base)} s → ${f1(d.wallDelta.next)} s per trial.`, '')
  for (const [arm, h] of Object.entries(d.headline)) {
    out.push(`## ${arm}`, '')
    out.push(`Pass: ${h.pass.base ?? '—'} → ${h.pass.next ?? '—'}`, '')
    out.push(table(['Metric (mean)', d.base, d.next, 'Change'], Object.entries(h).filter(([m]) => m !== 'pass' && m !== 'phases').map(([m, v]) => [m, f1(v.base), f1(v.next), sgn(v.change)])))
    out.push('')
    out.push(table(['Phase (s/trial)', d.base, d.next, 'Change'], Object.entries(h.phases).map(([p, v]) => [p, f1(v.base), f1(v.next), sgn(v.change)])))
    out.push('')
  }
  out.push('## Sygnal − React delta by item (s/trial)', '')
  out.push(table(['Item', d.base, d.next, 'Change'], Object.entries(d.items).sort((x, y) => (y[1].base ?? 0) - (x[1].base ?? 0)).map(([k, v]) => [k, f1(v.base), f1(v.next), sgn(v.change)])))
  out.push('', '## Catalog friction (s per Sygnal trial)', '')
  out.push(table(['ID', d.base, d.next, 'Change', 'Trials affected'], Object.entries(d.catalog).map(([k, v]) => [k, f1(v.base), f1(v.next), sgn(v.change), `${v.baseTrials ?? '—'} → ${v.nextTrials ?? '—'}`])))
  out.push('', '## Canonical forms (Sygnal trials using each)', '')
  out.push(table(['Form', d.base, d.next], Object.entries(d.forms).map(([k, v]) => [k, v.base ?? '—', v.next ?? '—'])))
  out.push('')
  return out.join('\n')
}

/** The CLI as a function (tests call it): returns { text, data }. */
export function compareRuns(argv, { evalRoot = EVAL_ROOT } = {}) {
  const args = parseArgs(argv)
  if (typeof args.base !== 'string' || typeof args.next !== 'string') throw new Error('usage: compare.mjs --base <run>[:arm] --next <run>[:arm] [--arms a,b] [--tasks spec] [--metrics m,...] [--source auto|analysis|results] [--full] [--json] [--out file]')
  const b = parseSide(args.base)
  const n = parseSide(args.next)
  const source = typeof args.source === 'string' ? args.source : 'auto'
  if (!['auto', 'analysis', 'results'].includes(source)) throw new Error('--source must be auto, analysis or results')
  const base = loadRun(b.run, { evalRoot, source })
  const next = loadRun(n.run, { evalRoot, source })
  // Both sides must use the same source, or the metric sets differ.
  let [bs, ns] = [base, next]
  if (source === 'auto' && base.source !== next.source) {
    bs = loadRun(b.run, { evalRoot, source: 'results' })
    ns = loadRun(n.run, { evalRoot, source: 'results' })
  }
  const arms = typeof args.arms === 'string' ? args.arms.split(',').map((s) => s.trim()).filter(Boolean) : null
  const taskMetrics = typeof args.metrics === 'string' ? args.metrics.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_TASK_METRICS
  for (const m of taskMetrics) if (!METRICS[m]) throw new Error(`Unknown metric "${m}" (${Object.keys(METRICS).join(', ')})`)
  const data = matchedCompare(bs, ns, { baseArm: b.arm, nextArm: n.arm, arms, tasks: taskSelector(typeof args.tasks === 'string' ? args.tasks : 'all') })
  const filters = [arms ? `arms ${arms.join(', ')}` : null, typeof args.tasks === 'string' ? `tasks ${args.tasks}` : null].filter(Boolean)
  const head = [`# \`${args.base}\` → \`${args.next}\``, '', `Source: ${bs.source === ns.source ? bs.source : `${bs.source} / ${ns.source}`}${filters.length ? ` · ${filters.join(' · ')}` : ''}.`, '', '']
  let text = head.join('\n') + renderMatched(data, { taskMetrics })
  if (args.full) {
    if (!base.analysis || !next.analysis) throw new Error('--full needs results/analysis/<run>.json for both runs')
    text += '\n---\n\n**Unmatched whole-run aggregates** (every trial of each run, whatever its task set; context only, not a comparison):\n\n' + renderDiff(diffAnalyses(base.analysis, next.analysis)).replace(/^# /, '## ')
  }
  return { text, data }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  let r
  try {
    r = compareRuns(process.argv.slice(2))
  } catch (e) {
    console.error(e.message)
    process.exit(2)
  }
  const out = args.json ? JSON.stringify(r.data, null, 2) + '\n' : r.text
  if (typeof args.out === 'string') {
    fs.writeFileSync(args.out, out)
    console.log(`wrote ${args.out}`)
  } else console.log(out)
}
