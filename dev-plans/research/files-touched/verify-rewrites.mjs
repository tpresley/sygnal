#!/usr/bin/env node
// Runs each rewritten reference solution (rewrite.mjs) against the task's unchanged hidden suite, and
// tsc over the TypeScript rewrites, against this repo's built package. No model runs. Needs `npm run build`.
//
//   node dev-plans/research/files-touched/rewrite.mjs <out>
//   node dev-plans/research/files-touched/verify-rewrites.mjs <out> <work>
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { armPaths, copyDir, packSygnal, vendorTarball, installHidden, runHidden, npm, readJson, listTasks, isTsStarter, TS_EXTRA_DEV_DEPENDENCIES, TASK_EXTRA_DEPENDENCIES } from '../../../evals/agent-ergonomics/lib/common.mjs'
import { F1_TASKS, F2_TASKS } from './rewrite.mjs'

const out = path.resolve(process.argv[2] ?? 'out')
const work = path.resolve(process.argv[3] ?? 'work')
fs.mkdirSync(work, { recursive: true })
const arm = 'sygnal'
const tasks = listTasks(arm)
const starterDir = (t) => path.join(armPaths(arm).tasks, t, 'starter')
const firstJs = tasks.find((t) => !isTsStarter(starterDir(t)))
const base = readJson(path.join(starterDir(firstJs), 'package.json'))
const allExtra = Object.assign({}, ...Object.values(TASK_EXTRA_DEPENDENCIES[arm] ?? {}))
const tarball = packSygnal(path.join(work, 'pack'))
const armDir = path.join(work, arm)
fs.mkdirSync(armDir, { recursive: true })
const tsExtra = TS_EXTRA_DEV_DEPENDENCIES[arm]
fs.writeFileSync(path.join(armDir, 'package.json'), JSON.stringify({ name: 'verify-sygnal', private: true, type: 'module', dependencies: { ...base.dependencies, ...allExtra, sygnal: vendorTarball(tarball, armDir, 'sygnal') }, devDependencies: { ...base.devDependencies, ...tsExtra } }, null, 2))
console.log('installing...')
npm(['install', '--no-audit', '--no-fund', '--loglevel=error'], armDir)

let ok = true
const tsc = path.join(armDir, 'node_modules/typescript/bin/tsc')
for (const [fix, list] of [['root-drivers', F1_TASKS], ['ts-colocate', F2_TASKS]]) {
  for (const task of list) {
    const dir = path.join(armDir, `${fix}--${task}`)
    fs.rmSync(dir, { recursive: true, force: true })
    copyDir(path.join(out, fix, task, 'solution'), dir)
    installHidden(dir, arm, task)
    const r = runHidden(dir)
    let tscOk = ''
    if (fix === 'ts-colocate') {
      const c = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.json', '--noEmit'], { cwd: dir, encoding: 'utf8' })
      tscOk = c.status === 0 ? ' tsc ok' : ` tsc FAILED:\n${c.stdout.slice(0, 1500)}`
      if (c.status !== 0) ok = false
    }
    if (!r.pass || r.testsTotal === 0) ok = false
    console.log(`${fix} ${task}: ${r.testsPassed}/${r.testsTotal} ${r.pass ? 'pass' : 'FAIL'}${tscOk}`)
    if (!r.pass) for (const f of r.failures.slice(0, 6)) console.log(`   x ${f.test}: ${f.message?.slice(0, 200)}`)
  }
}
process.exit(ok ? 0 : 1)
