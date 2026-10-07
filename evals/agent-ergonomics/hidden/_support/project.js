// Project-level checks for the mod tier (tasks 35-43: modify existing code), shared by both arms.
// hidden/_support/project.js and react/hidden/_support/project.js must stay byte-identical
// (verify.mjs checks), so both arms are judged the same way.
//
// - runProjectTests(): runs the project's OWN test suite (its own vite/vitest config, the files the
//   agent kept or updated) in a child process. Test titles starting with "project:" form the
//   "project" group in score.mjs.
// - sourceFiles() / leftovers(): static scans of src/ with comments removed, for "audit:" tests
//   (a removed feature left no state, actions, handlers, components or tests behind).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { stripComments } from './queries.js'

/** The project (trial) root: the parent of __hidden__/. */
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Run the project's own tests (`vitest run` with the project's config) and report
 * { total, passed, failed, failures: [title], output }.
 */
export function runProjectTests({ timeoutMs = 240000 } = {}) {
  const require = createRequire(path.join(projectRoot, 'package.json'))
  const vitestBin = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs')
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mod-project-tests-')), 'result.json')
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(VITEST|TEST$|NODE_ENV$)/.test(k)))
  const res = spawnSync(process.execPath, [vitestBin, 'run', '--reporter=json', `--outputFile=${out}`], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...env, CI: '1', FORCE_COLOR: '0' },
  })
  const result = { total: 0, passed: 0, failed: 0, failures: [], output: `${res.stdout || ''}\n${res.stderr || ''}`.trim(), exitCode: res.status }
  if (fs.existsSync(out)) {
    const json = JSON.parse(fs.readFileSync(out, 'utf8'))
    result.total = json.numTotalTests ?? 0
    result.passed = json.numPassedTests ?? 0
    result.failed = (json.numFailedTests ?? 0) + (json.numFailedTestSuites ?? 0)
    for (const file of json.testResults || []) {
      if (file.status === 'failed' && !(file.assertionResults || []).length) result.failures.push(`${path.basename(file.name)}: ${String(file.message).split('\n')[0]}`)
      for (const a of file.assertionResults || []) if (a.status === 'failed') result.failures.push(a.fullName || a.title)
    }
  } else result.failed = 1
  return result
}

const SOURCE = /\.(jsx?|tsx?|mjs|cjs)$/

/** Every source file under src/ (tests too unless `tests: false`), as { file, code } with comments removed. */
export function sourceFiles({ tests = true } = {}) {
  const files = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (SOURCE.test(e.name) && (tests || !/\.(test|spec)\./.test(e.name))) {
        files.push({ file: path.relative(projectRoot, p), code: stripComments(fs.readFileSync(p, 'utf8')) })
      }
    }
  }
  walk(path.join(projectRoot, 'src'))
  return files
}

/** "file: match" for every match of each pattern (RegExp) in the source files; [] = nothing left. */
export function leftovers(patterns, opts) {
  const hits = []
  for (const { file, code } of sourceFiles(opts)) {
    for (const re of patterns) {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
      for (const m of code.matchAll(g)) hits.push(`${file}: ${m[0]}`)
    }
  }
  return hits
}

/** Whether a file exists under the project root (e.g. a component file that should be gone). */
export function projectFileExists(rel) {
  return fs.existsSync(path.join(projectRoot, rel))
}
