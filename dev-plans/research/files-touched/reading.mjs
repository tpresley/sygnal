#!/usr/bin/env node
// The read side of files touched: to answer "what does this feature do", how much of each framework's
// reference solution must be opened? Separates spread across files from spread inside one file.
//
//   node dev-plans/research/files-touched/reading.mjs
//
// For each reference solution, tests excluded:
//   touched      files the feature's diff touches
//   behaviour    touched, minus files that only wire or declare (entry point, type/event declarations, a route table)
//   closure      the files reachable through local imports from the touched behaviour files, i.e. everything a
//                reader may follow (always ≥ behaviour)
//   hunks        separate change regions (git diff -U0), summed over behaviour files: jumps inside files
//   sections     distinct kinds of code the change lands in, per behaviour file (Sygnal: view, intent, model,
//                context, state, a declaration static, helper; React: hooks, effect, handler, JSX, helper; a
//                Sygnal view with state in it is one section; a component's `model` is one section however
//                many actions it has)
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { armPaths, listTasks, OVERLAY_DELETE_FILE } from '../../../evals/agent-ergonomics/lib/common.mjs'
import { isTestPath } from '../../../evals/agent-ergonomics/analysis/lib/classify.mjs'
import { causeOf } from './classify.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const req = createRequire(path.resolve(here, '../../../sygnal-check/package.json'))
const { parse } = req('@babel/parser')

const isSrc = (f) => /\.(jsx?|tsx?)$/.test(f) && !isTestPath(f) && !/(^|\/)(test-utils|fixtures|setupTests)[^/]*$/.test(f)
const WIRING = new Set(['entry', 'types', 'routes'])

function hunksOf(a, b) {
  // git diff --no-index exits 1 when they differ
  const r = spawnSync('git', ['diff', '--no-index', '-U0', '--', a, b], { encoding: 'utf8', maxBuffer: 1 << 24 })
  const out = []
  for (const m of r.stdout.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1])
    const len = m[2] == null ? 1 : Number(m[2])
    out.push([start, Math.max(start, start + len - 1)])
  }
  return out
}

function parseFile(src, file) {
  try {
    return parse(src, { sourceType: 'module', plugins: ['jsx', ...(/\.tsx?$/.test(file) ? ['typescript'] : [])], errorRecovery: true })
  } catch {
    return null
  }
}

/** [startLine, endLine, section] per region of a file. */
function regions(src, file, arm) {
  const ast = parseFile(src, file)
  if (!ast) return []
  const out = []
  const mark = (node, section) => out.push([node.loc.start.line, node.loc.end.line, section])
  const functionBody = (fn) => fn.body?.type === 'BlockStatement' ? fn.body.body : null
  const hasJsx = (n) => JSON.stringify(n, (k, v) => (k === 'loc' || k === 'extra' || k === 'start' || k === 'end' ? undefined : v))?.includes('"JSXElement"')
  const isComponent = (name, fn) => /^[A-Z]/.test(name ?? '') && hasJsx(fn)
  const reactBody = (fn) => {
    for (const st of functionBody(fn) ?? []) {
      const init = st.type === 'VariableDeclaration' ? st.declarations[0]?.init : st.type === 'ExpressionStatement' ? st.expression : null
      const callee = init?.type === 'CallExpression' ? (init.callee.name ?? init.callee.property?.name) : null
      if (callee && /^use(Effect|LayoutEffect)$/.test(callee)) mark(st, 'effect')
      else if (callee && /^use[A-Z]/.test(callee)) mark(st, 'state/hooks')
      else if (st.type === 'ReturnStatement') mark(st, 'view')
      else if (init && /Function/.test(init.type)) mark(st, 'handler')
      else mark(st, 'helper')
    }
  }
  for (const st of ast.program.body) {
    if (st.type === 'ImportDeclaration') continue
    let decl = st
    if (/^Export/.test(st.type) && st.declaration) decl = st.declaration
    if (decl.type === 'TSInterfaceDeclaration' || decl.type === 'TSTypeAliasDeclaration' || decl.type === 'TSModuleDeclaration') { mark(st, 'types'); continue }
    if (decl.type === 'ExpressionStatement' && decl.expression.type === 'AssignmentExpression' && decl.expression.left.type === 'MemberExpression') {
      const p = decl.expression.left.property?.name
      if (arm === 'sygnal' && /^[A-Z]/.test(decl.expression.left.object?.name ?? '')) {
        const section = p === 'intent' ? 'intent' : p === 'model' ? 'model' : p === 'context' ? 'context' : p === 'initialState' || p === 'calculated' ? 'state' : 'declaration'
        mark(st, section)
        continue
      }
    }
    const fn = decl.type === 'FunctionDeclaration' ? decl : decl.type === 'VariableDeclaration' && /Function/.test(decl.declarations[0]?.init?.type ?? '') ? decl.declarations[0].init : null
    const name = decl.id?.name ?? decl.declarations?.[0]?.id?.name
    if (fn && isComponent(name, fn)) {
      if (arm === 'react') reactBody(fn)
      else mark(st, 'view')
      continue
    }
    mark(st, 'helper')
  }
  return out
}

function closure(root, seeds) {
  const seen = new Set()
  const visit = (rel) => {
    if (seen.has(rel)) return
    seen.add(rel)
    const src = fs.readFileSync(path.join(root, rel), 'utf8')
    for (const m of src.matchAll(/(?:from\s+|import\s+)['"](\.[^'"]+)['"]/g)) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]))
      for (const c of [base, `${base}.js`, `${base}.jsx`, `${base}.ts`, `${base}.tsx`, `${base}/index.js`, `${base}/index.jsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
        if (fs.existsSync(path.join(root, c)) && fs.statSync(path.join(root, c)).isFile()) {
          if (isSrc(c)) visit(c)
          break
        }
      }
    }
  }
  seeds.forEach(visit)
  return seen
}

function overlayRoot(arm, task) {
  // a temp copy of starter + solution, so closure() can walk the finished app
  const { tasks, hidden } = armPaths(arm)
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'ft-read-'))
  fs.cpSync(path.join(tasks, task, 'starter'), dir, { recursive: true, filter: (s) => !/node_modules/.test(s) })
  const sol = path.join(hidden, task, 'solution')
  fs.cpSync(sol, dir, { recursive: true })
  const del = path.join(sol, OVERLAY_DELETE_FILE)
  if (fs.existsSync(del)) for (const r of fs.readFileSync(del, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean)) fs.rmSync(path.join(dir, r), { force: true, recursive: true })
  return dir
}

function measure(arm, task) {
  const { tasks, hidden } = armPaths(arm)
  const sol = path.join(hidden, task, 'solution')
  const start = path.join(tasks, task, 'starter')
  const root = overlayRoot(arm, task)
  const m = { touched: 0, behaviour: 0, closure: 0, hunks: 0, sections: 0 }
  const beh = []
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = path.posix.join(rel, e.name)
      if (e.isDirectory()) { walk(path.join(d, e.name), r); continue }
      if (e.name === OVERLAY_DELETE_FILE || !isSrc(r)) continue
      const a = path.join(start, r)
      const b = path.join(d, e.name)
      const old = fs.existsSync(a) ? fs.readFileSync(a, 'utf8') : ''
      const nw = fs.readFileSync(b, 'utf8')
      if (old === nw) continue
      m.touched++
      if (WIRING.has(causeOf(r, old ? 'modified' : 'new'))) continue
      m.behaviour++
      beh.push(r)
      const hs = hunksOf(old ? a : '/dev/null', b)
      m.hunks += hs.length
      const reg = regions(nw, r, arm)
      const secs = new Set()
      for (const [s, e] of hs) for (const [x, y, sec] of reg) if (s <= y && e >= x) secs.add(sec)
      m.sections += secs.size
    }
  }
  walk(sol, '')
  // deleted source files count as touched: a reader of the diff opens them too
  const del = path.join(sol, OVERLAY_DELETE_FILE)
  if (fs.existsSync(del)) for (const r of fs.readFileSync(del, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean)) {
    if (!isSrc(r) || !fs.existsSync(path.join(start, r)) || fs.statSync(path.join(start, r)).isDirectory()) continue
    m.touched++
    if (!WIRING.has(causeOf(r, 'deleted'))) m.behaviour++
  }
  if (beh.length) m.closure = closure(root, beh).size
  fs.rmSync(root, { recursive: true, force: true })
  return m
}

const rows = []
for (const task of listTasks('sygnal')) {
  if (!fs.existsSync(path.join(armPaths('react').hidden, task, 'solution')) || !fs.existsSync(path.join(armPaths('sygnal').hidden, task, 'solution'))) continue
  rows.push({ task, s: measure('sygnal', task), r: measure('react', task) })
}
const gm = (xs) => Math.exp(xs.reduce((a, x) => a + Math.log(x), 0) / xs.length)
const mean = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length
const lines = ['# Reading a feature: files and regions', '', 'Generated by `reading.mjs` from the reference solutions (45 paired tasks, tests excluded).', '', '| Measure | Sygnal | React | S/R (geometric) |', '|---|---|---|---|']
for (const [k, label] of [['touched', 'files the diff touches'], ['behaviour', 'files with behaviour (no entry point, type declarations, route table)'], ['closure', 'local-import closure of those files'], ['hunks', 'change regions across them'], ['sections', 'kinds of code changed per task']]) {
  const ps = rows.filter((x) => x.s[k] > 0 && x.r[k] > 0)
  lines.push(`| ${label} | ${mean(rows.map((x) => x.s[k])).toFixed(2)} | ${mean(rows.map((x) => x.r[k])).toFixed(2)} | ${gm(ps.map((x) => x.s[k] / x.r[k])).toFixed(2)}× |`)
}
lines.push('', '| Task | touched S/R | behaviour S/R | closure S/R | hunks S/R | sections S/R |', '|---|---|---|---|---|---|')
for (const { task, s, r } of rows) lines.push(`| ${task} | ${s.touched} / ${r.touched} | ${s.behaviour} / ${r.behaviour} | ${s.closure} / ${r.closure} | ${s.hunks} / ${r.hunks} | ${s.sections} / ${r.sections} |`)
fs.writeFileSync(path.join(here, 'reading-table.md'), lines.join('\n') + '\n')
console.log(lines.join('\n'))
