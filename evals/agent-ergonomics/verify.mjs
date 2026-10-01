#!/usr/bin/env node
// Self-check for the harness: every hidden suite must FAIL on its unmodified
// starter and PASS once the reference solution is overlaid. Also checks that a
// copied starter does not leak hidden tests. Tasks may ship mutants
// (hidden/<task>/mutants/<name>/, an overlay applied on top of the solution:
// a plausible but wrong solution); the hidden suite must FAIL on each.
//
// Usage:
//   node evals/agent-ergonomics/verify.mjs [--arm sygnal|react|both] [--task 03]
//        [--work <dir>] [--tarball <sygnal.tgz>] [--build] [--reruns <n>] [--verbose]
//
// --work     scratch dir for installs/copies (default: $TMPDIR/sygnal-evals-verify)
// --tarball  use an existing `npm pack` tarball instead of packing this repo
// --build    force `npm run build` in the repo before packing
// --reruns   run every suite n times (default 1); any run with an unexpected result fails (flakiness)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ARMS, EVAL_ROOT, REPO_ROOT, armPaths, listTasks, resolveTask, parseArgs, copyDir, npm,
  packSygnal, installHidden, applySolution, runHidden, leakCheck, readJson,
} from './lib/common.mjs'

const args = parseArgs(process.argv.slice(2))
const arms = !args.arm || args.arm === 'both' ? ARMS : [args.arm]
const work = path.resolve(args.work || path.join(os.tmpdir(), 'sygnal-evals-verify'))
const verbose = !!args.verbose
const reruns = Math.max(1, Number(args.reruns) || 1)

/** Names of a task's mutants (hidden/<task>/mutants/<name>/), if any. */
function listMutants(arm, task) {
  const dir = path.join(armPaths(arm).hidden, task, 'mutants')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
}

if ((work + path.sep).startsWith(REPO_ROOT + path.sep) || (work + path.sep).startsWith(EVAL_ROOT + path.sep)) {
  console.error('--work must be outside the repository (root vitest would otherwise crawl it)')
  process.exit(2)
}

function sameDeps(a, b) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {})
}

/** Install one shared node_modules per arm at <work>/<arm>; task copies live beneath it. */
function prepareArm(arm) {
  const armDir = path.join(work, arm)
  fs.mkdirSync(armDir, { recursive: true })
  const tasks = listTasks(arm)
  const starterPkgs = tasks.map((t) => readJson(path.join(armPaths(arm).tasks, t, 'starter', 'package.json')))
  let pkg
  if (arm === 'sygnal') {
    const tarball = args.tarball ? path.resolve(args.tarball) : packSygnal(path.join(work, 'pack'), { build: !!args.build })
    for (const [i, p] of starterPkgs.entries()) {
      if (!sameDeps(p.devDependencies, starterPkgs[0].devDependencies) || !sameDeps(p.dependencies, starterPkgs[0].dependencies)) {
        throw new Error(`Starter deps differ between ${tasks[0]} and ${tasks[i]}; keep them identical`)
      }
    }
    pkg = {
      name: 'verify-sygnal', private: true, type: 'module',
      dependencies: { ...starterPkgs[0].dependencies, sygnal: `file:${tarball}` },
      devDependencies: starterPkgs[0].devDependencies,
    }
    console.log(`sygnal tarball: ${tarball}`)
  } else {
    const canonical = readJson(path.join(EVAL_ROOT, 'react', 'package.json'))
    for (const [i, p] of starterPkgs.entries()) {
      if (!sameDeps(p.dependencies, canonical.dependencies) || !sameDeps(p.devDependencies, canonical.devDependencies)) {
        throw new Error(`react/tasks/${tasks[i]}/starter/package.json deps differ from react/package.json`)
      }
    }
    pkg = { name: 'verify-react', private: true, type: 'module', dependencies: canonical.dependencies, devDependencies: canonical.devDependencies }
  }
  fs.writeFileSync(path.join(armDir, 'package.json'), JSON.stringify(pkg, null, 2))
  console.log(`installing ${arm} deps in ${armDir} ...`)
  npm(['install', '--no-audit', '--no-fund', '--loglevel=error'], armDir)
  return armDir
}

const rows = []
let ok = true

// Both arms must be judged by the same queries and (for shared tasks) the same test files.
{
  const read = (p) => fs.readFileSync(p, 'utf8')
  const sy = armPaths('sygnal')
  const re = armPaths('react')
  if (read(path.join(sy.support, 'queries.js')) !== read(path.join(re.support, 'queries.js'))) {
    console.log('MISMATCH: hidden/_support/queries.js differs from react/hidden/_support/queries.js')
    ok = false
  }
  for (const task of listTasks('react')) {
    for (const f of fs.readdirSync(path.join(re.hidden, task)).filter((n) => n.includes('.hidden.'))) {
      const twin = path.join(sy.hidden, task, f)
      if (!fs.existsSync(twin) || read(twin) !== read(path.join(re.hidden, task, f))) {
        console.log(`MISMATCH: react/hidden/${task}/${f} differs from hidden/${task}/${f}`)
        ok = false
      }
    }
  }
}

for (const arm of arms) {
  const armDir = prepareArm(arm)
  const tasks = args.task ? [resolveTask(arm, args.task)] : listTasks(arm)
  for (const task of tasks) {
    const starterSrc = path.join(armPaths(arm).tasks, task, 'starter')
    const mutants = listMutants(arm, task)
    for (const variant of ['starter', 'solution', ...mutants.map((m) => `mutant:${m}`)]) {
      const mutant = variant.startsWith('mutant:') ? variant.slice('mutant:'.length) : null
      const dir = path.join(armDir, `${task}--${variant.replace(':', '-')}`)
      fs.rmSync(dir, { recursive: true, force: true })
      copyDir(starterSrc, dir)
      const leaks = variant === 'starter' ? leakCheck(dir) : []
      if (variant !== 'starter') applySolution(dir, arm, task)
      if (mutant) fs.cpSync(path.join(armPaths(arm).hidden, task, 'mutants', mutant), dir, { recursive: true })
      installHidden(dir, arm, task)
      const expectedPass = variant === 'solution'
      for (let run = 1; run <= reruns; run++) {
        const r = runHidden(dir)
        const good = r.pass === expectedPass && r.testsTotal > 0 && leaks.length === 0
        if (!good) ok = false
        const label = reruns > 1 ? `${variant} #${run}` : variant
        rows.push({ arm, task, variant: label, expect: expectedPass ? 'pass' : 'fail', got: r.pass ? 'pass' : 'fail', tests: `${r.testsPassed}/${r.testsTotal}`, ok: good })
        if (leaks.length && run === 1) console.log(`  LEAK ${arm}/${task}: ${leaks.join('; ')}`)
        if (!good || verbose) {
          console.log(`--- ${arm}/${task} (${label}) exit=${r.exitCode} ${r.testsPassed}/${r.testsTotal}`)
          for (const f of r.failures) console.log(`    x ${f.test}: ${f.message}`)
          if (r.testsTotal === 0) console.log(r.output.split('\n').slice(-40).join('\n'))
        }
      }
    }
  }
}

const variantWidth = Math.max(9, ...rows.map((r) => r.variant.length))
console.log(`\narm     task                       ${'variant'.padEnd(variantWidth)} expect  got   tests  ok`)
for (const r of rows) {
  console.log(
    `${r.arm.padEnd(7)} ${r.task.padEnd(26)} ${r.variant.padEnd(variantWidth)} ${r.expect.padEnd(7)} ${r.got.padEnd(5)} ${r.tests.padEnd(6)} ${r.ok ? 'OK' : 'FAIL'}`
  )
}
const nTasks = new Set(rows.map((r) => `${r.arm}/${r.task}`)).size
console.log(`\n${ok ? 'ALL OK' : 'PROBLEMS FOUND'}: ${nTasks} task(s), ${rows.filter((r) => r.ok).length}/${rows.length} checks as expected`)
process.exit(ok ? 0 : 1)
