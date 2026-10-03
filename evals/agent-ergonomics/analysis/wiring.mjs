#!/usr/bin/env node
// Wiring-class failures per trial (PLAN-4 1-E, lib/wiring.mjs), from an analyzed run.
//
// Usage:
//   node evals/agent-ergonomics/analysis/wiring.mjs --run <run> [--run <run2> ...] [--tasks spec] [--json]
//
// Reads results/analysis/<run>.json (run analyze.mjs first; after classifying failures with
// `score.mjs --classify`, re-run analyze.mjs so the categories are picked up). Prints, per run:
// the Sygnal trials with a SYG104/110/124 hit while working, such a finding in the final code,
// or a failed hidden suite; a summary (the numbers compare.mjs shows as wiringHits, wiringFinal
// and wiringFailure); and, for failed trials without a category, a `score.mjs --classify`
// command to review (`wiring` when the final code still has a wiring finding, else `?`).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EVAL_ROOT } from '../lib/common.mjs'
import { taskSelector } from '../lib/plan.mjs'

const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '—')

/** Summary + rows for one analysis JSON. */
export function wiringReport(analysis, { tasks = () => true } = {}) {
  const trials = (analysis.trials ?? []).filter((t) => t.arm === 'sygnal' && t.wiring && tasks(Number(String(t.task).slice(0, 2))))
  const scored = trials.filter((t) => t.wiring.failure != null)
  const failed = scored.filter((t) => t.scored && !t.scored.pass)
  const summary = {
    trials: trials.length,
    scored: scored.length,
    withHits: trials.filter((t) => t.wiring.hitCalls > 0).length,
    hitCalls: trials.reduce((a, t) => a + t.wiring.hitCalls, 0),
    hitsByCode: trials.reduce((a, t) => {
      for (const [k, v] of Object.entries(t.wiring.hitsByCode ?? {})) a[k] = (a[k] ?? 0) + v
      return a
    }, {}),
    finalChecked: trials.filter((t) => t.wiring.finalChecked).length,
    finalWithCodes: trials.filter((t) => t.wiring.finalCodes.length).length,
    failed: failed.length,
    wiringFailures: scored.filter((t) => t.wiring.failure).length,
    bySource: { category: scored.filter((t) => t.wiring.failure && t.wiring.failureSource === 'category').length, 'final-code': scored.filter((t) => t.wiring.failure && t.wiring.failureSource === 'final-code').length },
    unclassified: failed.filter((t) => !t.scored.failureCategory || t.scored.failureCategory === 'none').length,
  }
  const rows = trials
    .filter((t) => t.wiring.hitCalls || t.wiring.finalCodes.length || (t.scored && !t.scored.pass))
    .map((t) => ({ trial: t.trial, task: t.task, trialNo: t.trialNo, pass: t.scored?.pass ?? null, category: t.scored?.failureCategory ?? null, hits: t.wiring.hitCalls, hitsByCode: t.wiring.hitsByCode, finalCodes: t.wiring.finalCodes, failure: t.wiring.failure, source: t.wiring.failureSource }))
  return { run: analysis.meta?.run ?? null, summary, rows }
}

export function renderWiring(r) {
  const s = r.summary
  const out = [`## \`${r.run}\` (Sygnal arm)`, '']
  if (!s.trials) return [...out, '_No analyzed Sygnal trials with wiring data (re-run analyze.mjs on this build of the harness)._', ''].join('\n')
  out.push(`- Trials: ${s.trials} (${s.scored} scored, ${s.failed} failed).`)
  out.push(`- SYG104/110/124 hits while working: ${s.hitCalls} tool result(s) in ${s.withHits} trial(s) (${pct(s.withHits, s.trials)}); by code ${Object.entries(s.hitsByCode).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.`)
  out.push(`- In the final code: ${s.finalWithCodes}/${s.finalChecked} checked trial(s)${s.finalChecked < s.trials ? ` (${s.trials - s.finalChecked} not checked: analyze without --no-check, sygnal-check installed)` : ''}.`)
  out.push(`- Wiring failures: ${s.wiringFailures}/${s.scored} (${pct(s.wiringFailures, s.scored)}): ${s.bySource.category} by category (wiring/isolation), ${s.bySource['final-code']} by a final-code finding on an unclassified failure. Unclassified failures: ${s.unclassified}.`)
  out.push('')
  if (r.rows.length) {
    out.push(table(['Trial', 'pass', 'category', 'hits', 'final code', 'wiring failure'], r.rows.map((x) => [x.trial, x.pass == null ? '—' : x.pass ? 'yes' : 'no', x.category ?? '—', x.hits ? `${x.hits} (${Object.entries(x.hitsByCode).filter(([, v]) => v).map(([k, v]) => `${k}×${v}`).join(' ')})` : '0', x.finalCodes.join(' ') || '—', x.failure == null ? '—' : x.failure ? `yes (${x.source})` : 'no'])))
    out.push('')
  }
  const todo = r.rows.filter((x) => x.pass === false && (!x.category || x.category === 'none'))
  if (todo.length) {
    out.push('Classify (review each; run.md step 5), then re-run analyze.mjs:', '', '```bash')
    for (const x of todo) out.push(`node evals/agent-ergonomics/score.mjs --classify --run ${r.run} --task ${x.task.slice(0, 2)} --arm sygnal --trial ${x.trialNo} --category ${x.finalCodes.length ? 'wiring' : '?'}`)
    out.push('```', '')
  }
  return out.join('\n')
}

function main() {
  const argv = process.argv.slice(2)
  const runs = []
  let tasksSpec = 'all'
  let json = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--run') runs.push(argv[++i])
    else if (argv[i] === '--tasks') tasksSpec = argv[++i]
    else if (argv[i] === '--json') json = true
    else {
      console.error(`unknown argument ${argv[i]}`)
      process.exit(2)
    }
  }
  if (!runs.length || runs.some((r) => !r)) {
    console.error('usage: wiring.mjs --run <run> [--run <run2> ...] [--tasks spec] [--json]')
    process.exit(2)
  }
  const reports = runs.map((run) => {
    const p = path.join(EVAL_ROOT, 'results', 'analysis', `${run}.json`)
    if (!fs.existsSync(p)) {
      console.error(`No analysis for run "${run}" at ${p}; run analyze.mjs --run ${run} first`)
      process.exit(2)
    }
    return wiringReport(JSON.parse(fs.readFileSync(p, 'utf8')), { tasks: taskSelector(tasksSpec) })
  })
  console.log(json ? JSON.stringify(reports, null, 2) : `# Wiring-class failures\n\n${reports.map(renderWiring).join('\n')}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
