#!/usr/bin/env node
// PLAN-4 1-E variant B (p4-ct1-b): the controls-converted task starters.
//
// Each 1-E task's Sygnal starter is copied to a temp dir and converted with this
// checkout's checker, as PLAN-4 §7 states (lib/convert.mjs):
//
//   node sygnal-check/bin/sygnal-check.js --fix --controls --keep-classes src
//
// The files the conversion changed are written to starters/<NN-slug>/, the
// variant's `taskDir` overlay (prepare.mjs copies starters/<task>/ over that
// task's starter). They are committed rather than generated at run time, so a
// run doesn't depend on the checker's behavior on the day it runs, the variant
// hash pins their content, and the diff is reviewable. `--check` regenerates
// them in memory and fails on drift (tests/ct1.unit.mjs runs it).
//
// Usage:
//   node evals/agent-ergonomics/variants/p4-ct1-b/gen-starters.mjs            # (re)write starters/
//   node evals/agent-ergonomics/variants/p4-ct1-b/gen-starters.mjs --check    # exit 1 if starters/ is stale
//
// Needs sygnal-check's dependencies (npm install --prefix sygnal-check).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EVAL_ROOT, REPO_ROOT, resolveTask } from '../../lib/common.mjs'
import { convertDir, listFiles } from '../../lib/convert.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** PLAN-4 §7 1-E: 01, 02, 06, 07, 08, 09, 12, 16 plus TS 18-21. */
export const CT1_TASKS = ['01', '02', '06', '07', '08', '09', '12', '16', '18', '19', '20', '21']
export const STARTERS_DIR = path.join(HERE, 'starters')

/** What starters/ should contain: { "<task>/<rel>": text }. */
export function expectedOverlay(tasks = CT1_TASKS) {
  const out = {}
  for (const id of tasks) {
    const task = resolveTask('sygnal', id)
    const { files } = convertDir(path.join(EVAL_ROOT, 'tasks', task, 'starter'))
    for (const [rel, text] of Object.entries(files)) out[`${task}/${rel}`] = text
  }
  return out
}

/** Paths under starters/ that differ from a fresh conversion (missing, extra or changed). */
export function staleFiles(want = expectedOverlay()) {
  const have = fs.existsSync(STARTERS_DIR) ? Object.fromEntries(listFiles(STARTERS_DIR).map((rel) => [rel, fs.readFileSync(path.join(STARTERS_DIR, rel), 'utf8')])) : {}
  return [...new Set([...Object.keys(want), ...Object.keys(have)])].filter((k) => want[k] !== have[k]).sort()
}

function main() {
  const want = expectedOverlay()
  for (const id of CT1_TASKS) {
    const task = resolveTask('sygnal', id)
    const n = Object.keys(want).filter((k) => k.startsWith(`${task}/`))
    console.log(`${task}: ${n.length ? n.map((k) => k.slice(task.length + 1)).join(', ') : 'nothing to convert'}`)
  }
  if (process.argv.includes('--check')) {
    const stale = staleFiles(want)
    if (stale.length) {
      console.error(`starters/ is stale (${stale.length}): ${stale.join(', ')}\nRegenerate: node ${path.relative(REPO_ROOT, fileURLToPath(import.meta.url))}`)
      process.exit(1)
    }
    console.log('starters/ is up to date')
    return
  }
  fs.rmSync(STARTERS_DIR, { recursive: true, force: true })
  for (const [k, text] of Object.entries(want)) {
    const p = path.join(STARTERS_DIR, k)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, text)
  }
  console.log(`wrote ${Object.keys(want).length} file(s) to ${path.relative(REPO_ROOT, STARTERS_DIR)}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
