#!/usr/bin/env node
/**
 * PLAN-7 spike 0-S1 (ranges): print the text each diagnostic would underline.
 *
 *   node dev-plans/research/p7-spikes/0-S1/ranges.mjs              # fixtures + examples + PoC fixture
 *   node dev-plans/research/p7-spikes/0-S1/ranges.mjs --from-tests # also every finding the sygnal-check
 *                                                                  # test suite produces, summarised per code
 *
 * Needs the prototype on exp/p7-s1 (endLine/endColumn in makeDiagnostic, the
 * SYGNAL_RANGE_LOG hook in sygnal-check/src/run.js).
 * Range convention: 1-based line/column; endColumn exclusive (one past the last character).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../../..')
const { check } = await import(path.join(repo, 'sygnal-check/src/index.js'))

const MAX = 70
const show = (t) => {
  const one = t.replace(/\s*\n\s*/g, ' ⏎ ')
  return one.length > MAX ? one.slice(0, MAX - 1) + '…' : one
}

/** Source text from (line, column) to (endLine, endColumn), exclusive end. */
export function slice(src, d) {
  const lines = src.split('\n')
  if (d.endLine == null || !d.line) return null
  if (d.line === d.endLine) return lines[d.line - 1]?.slice(d.column - 1, d.endColumn - 1) ?? ''
  const parts = [lines[d.line - 1].slice(d.column - 1)]
  for (let l = d.line + 1; l < d.endLine; l++) parts.push(lines[l - 1])
  parts.push(lines[d.endLine - 1].slice(0, d.endColumn - 1))
  return parts.join('\n')
}

const targets = [
  ['sygnal-check/test/fixtures/bad', {}],
  ['sygnal-check/test/fixtures/good', {}],
  ['sygnal-check/test/fixtures/strict/bad', { strict: true }],
  ['sygnal-check/test/fixtures/strict/good', { strict: true }],
  ['dev-plans/research/ide-tooling-poc/fixture/src', { strict: true }],
  ['dev-plans/research/p7-spikes/0-S1/probe/src', { strict: true }],
  ...fs.readdirSync(path.join(repo, 'examples'))
    .filter(e => fs.existsSync(path.join(repo, 'examples', e, 'src')))
    .map(e => [`examples/${e}/src`, { strict: true }]),
]

let total = 0
for (const [dir, opts] of targets) {
  const diags = check([dir], { cwd: repo, ...opts })
  if (!diags.length) continue
  console.log(`\n## ${dir} (${diags.length})`)
  for (const d of diags) {
    total++
    const src = d.file && fs.existsSync(path.join(repo, d.file)) ? fs.readFileSync(path.join(repo, d.file), 'utf8') : ''
    const t = slice(src, d)
    const span = d.endLine == null ? 'no range' : `${d.line}:${d.column}-${d.endLine}:${d.endColumn}`
    console.log(`${d.code} ${path.basename(d.file || '?')}:${span}  ${t == null ? '(none)' : JSON.stringify(show(t))}`)
  }
}
console.log(`\n${total} diagnostics`)

if (process.argv.includes('--from-tests')) {
  const log = path.join(os.tmpdir(), `syg-range-${process.pid}.jsonl`)
  try {
    execFileSync('npx', ['vitest', 'run', '--reporter=dot'], {
      cwd: path.join(repo, 'sygnal-check'), env: { ...process.env, SYGNAL_RANGE_LOG: log }, stdio: 'ignore',
    })
  } catch { /* report test failures separately */ }
  const rows = fs.readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l))
  fs.rmSync(log)
  const by = new Map()
  for (const r of rows) {
    const k = `${r.code} (${r.rule})`
    if (!by.has(k)) by.set(k, { n: 0, types: new Map(), multi: 0, samples: new Set() })
    const e = by.get(k)
    e.n++
    e.types.set(r.nodeType, (e.types.get(r.nodeType) || 0) + 1)
    if (r.endLine > r.line) e.multi++
    if (e.samples.size < 3 && r.text != null) e.samples.add(show(r.text))
  }
  console.log(`\n## From the sygnal-check test suite: ${rows.length} findings, ${by.size} code/rule pairs\n`)
  console.log('| code (rule) | findings | node types | multi-line | samples |')
  console.log('|---|---|---|---|---|')
  for (const [k, e] of [...by].sort()) {
    const types = [...e.types].map(([t, n]) => `${t}×${n}`).join(', ')
    const samples = [...e.samples].map(s => '`' + s.replace(/`/g, "'").replace(/\|/g, '\\|') + '`').join('<br>')
    console.log(`| ${k} | ${e.n} | ${types} | ${e.multi} | ${samples} |`)
  }
}
