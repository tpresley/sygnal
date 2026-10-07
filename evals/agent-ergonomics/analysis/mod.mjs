#!/usr/bin/env node
// The mod tier's report (tasks 35-43: modify existing code; dev-plans/research/p5-mod-tier.md):
// per level (S/M/L) × operation (add/change/remove) × arm, the pass rate split into its parts —
// behavior tests alone, the project's own suite ("project:" tests: did the agent keep/update the
// existing tests?) and the dead-code audit ("audit:" tests, remove tasks: was anything left behind?) —
// plus mean cost, time, iterations and edit rounds. Reads results/<run>.json (score.mjs records
// `behaviorPass` and `groups` for these tasks).
//
// Usage:
//   node evals/agent-ergonomics/analysis/mod.mjs --run p5-mod-sonnet [--json] [--out <file>]
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs, EVAL_ROOT } from '../lib/common.mjs'

/** Level and operation of a mod task (35-43), else null. */
export function modTask(task) {
  const n = Number(String(task).slice(0, 2))
  if (!(n >= 35 && n <= 43)) return null
  return { level: ['S', 'M', 'L'][Math.floor((n - 35) / 3)], op: ['add', 'change', 'remove'][(n - 35) % 3] }
}

const groupOk = (r, g) => (r.groups?.[g] ? r.groups[g].passed === r.groups[g].total : null)
const mean = (xs) => {
  const v = xs.filter((x) => typeof x === 'number' && !Number.isNaN(x))
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}
const count = (rs, f) => {
  const v = rs.map(f).filter((x) => x !== null && x !== undefined)
  return v.length ? { ok: v.filter(Boolean).length, of: v.length } : null
}

/** Rows per (task, arm), in task order then sygnal before react. */
export function modSummary(records) {
  const cells = new Map()
  for (const r of records) {
    const m = modTask(r.task)
    if (!m) continue
    const key = `${r.task}|${r.arm}`
    if (!cells.has(key)) cells.set(key, { task: r.task, arm: r.arm, ...m, records: [] })
    cells.get(key).records.push(r)
  }
  const armOrder = { sygnal: 0, react: 1 }
  return [...cells.values()]
    .sort((a, b) => a.task.localeCompare(b.task) || (armOrder[a.arm] ?? 9) - (armOrder[b.arm] ?? 9))
    .map(({ records: rs, ...c }) => ({
      ...c,
      trials: rs.length,
      pass: count(rs, (r) => r.pass),
      behavior: count(rs, (r) => r.behaviorPass ?? null),
      project: count(rs, (r) => groupOk(r, 'project')),
      audit: count(rs, (r) => groupOk(r, 'audit')),
      costUsd: mean(rs.map((r) => r.costUsd)),
      minutes: mean(rs.map((r) => (r.durationMs != null ? r.durationMs / 60000 : null))),
      iterations: mean(rs.map((r) => r.iterations)),
      editRounds: mean(rs.map((r) => r.editRounds)),
    }))
}

/** Totals per arm (and per arm × op) over the rows. */
export function modTotals(rows) {
  const out = {}
  const add = (key, row) => {
    const t = (out[key] ??= { trials: 0, pass: { ok: 0, of: 0 }, behavior: { ok: 0, of: 0 }, project: { ok: 0, of: 0 }, audit: { ok: 0, of: 0 } })
    t.trials += row.trials
    for (const g of ['pass', 'behavior', 'project', 'audit']) if (row[g]) (t[g].ok += row[g].ok), (t[g].of += row[g].of)
  }
  for (const r of rows) {
    add(r.arm, r)
    add(`${r.arm} ${r.op}`, r)
  }
  return out
}

const frac = (c) => (c && c.of ? `${c.ok}/${c.of}` : '—')
const num = (x, d = 2) => (x == null ? '—' : x.toFixed(d))

export function renderMod(run, rows) {
  const lines = [`# Mod tier: ${run}`, '', '| task | level | op | arm | pass | behavior | project tests | audit | cost $ | min | iter | edit rounds |', '|---|---|---|---|---|---|---|---|---|---|---|---|']
  for (const r of rows) {
    lines.push(`| ${r.task} | ${r.level} | ${r.op} | ${r.arm} | ${frac(r.pass)} | ${frac(r.behavior)} | ${frac(r.project)} | ${frac(r.audit)} | ${num(r.costUsd)} | ${num(r.minutes, 1)} | ${num(r.iterations, 1)} | ${num(r.editRounds, 1)} |`)
  }
  const totals = modTotals(rows)
  lines.push('', '| arm (op) | trials | pass | behavior | project tests | audit |', '|---|---|---|---|---|---|')
  for (const [k, t] of Object.entries(totals).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`| ${k} | ${t.trials} | ${frac(t.pass)} | ${frac(t.behavior)} | ${frac(t.project)} | ${frac(t.audit)} |`)
  }
  lines.push('', '`behavior`: the hidden behavior tests alone; `project tests`: the project\'s own suite passed (kept/updated); `audit`: no leftover code of a removed feature (remove tasks). `pass` needs all three.')
  return lines.join('\n') + '\n'
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = parseArgs(process.argv.slice(2))
  if (typeof args.run !== 'string') {
    console.error('usage: mod.mjs --run <name> [--json] [--out <file>]')
    process.exit(2)
  }
  const file = path.join(EVAL_ROOT, 'results', `${args.run}.json`)
  const rows = modSummary(JSON.parse(fs.readFileSync(file, 'utf8')))
  const text = args.json ? JSON.stringify({ run: args.run, rows, totals: modTotals(rows) }, null, 2) + '\n' : renderMod(args.run, rows)
  if (typeof args.out === 'string') fs.writeFileSync(args.out, text)
  else process.stdout.write(text)
}
