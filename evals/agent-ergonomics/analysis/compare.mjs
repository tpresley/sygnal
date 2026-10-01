#!/usr/bin/env node
// Compare two friction analyses (e.g. the baseline against the Phase 4 re-run).
//
// Usage:
//   node evals/agent-ergonomics/analysis/compare.mjs --base baseline --next phase3 [--out <file.md>]
//
// Reads results/analysis/<base>.json and <next>.json (run analyze.mjs on both
// first) and prints a markdown diff: headline metrics per arm, the per-item
// Sygnal-React delta, phase means, catalog time costs, canonical-form counts.
// Comparing a run with itself gives an all-zero diff (a smoke test).
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs, EVAL_ROOT } from '../lib/common.mjs'
import { PHASE_ORDER } from './lib/aggregate.mjs'

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

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  if (!args.base || !args.next) {
    console.error('usage: compare.mjs --base <run> --next <run> [--out <file.md>]')
    process.exit(2)
  }
  const md = renderDiff(diffAnalyses(load(String(args.base)), load(String(args.next))))
  if (typeof args.out === 'string') {
    fs.writeFileSync(args.out, md)
    console.log(`wrote ${args.out}`)
  } else console.log(md)
}
