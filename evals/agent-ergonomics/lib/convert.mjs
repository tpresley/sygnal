// The controls conversion (PLAN-4 1-E): `sygnal-check --fix --controls --keep-classes src`
// on a copy of a project dir. Used by variants/p4-ct1-b/gen-starters.mjs (the converted task
// starters of variant p4-ct1-b) and verify.mjs --task-overlay/--convert (hidden suites on
// converted starters and solutions). Unit-tested in tests/ct1.unit.mjs.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO_ROOT } from './common.mjs'

export const CHECKER = path.join(REPO_ROOT, 'sygnal-check', 'bin', 'sygnal-check.js')
export const FIX_ARGS = ['--fix', '--controls', '--keep-classes']

/** Whether this checkout's sygnal-check can run (its dependencies are installed). */
export function checkerAvailable(checker = CHECKER) {
  return fs.existsSync(path.join(path.dirname(path.dirname(checker)), 'node_modules', '@babel', 'parser'))
}

/** Relative paths of every file under dir (posix separators), skipping node_modules and .git. */
export function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name === '.git') return []
    const p = path.join(dir, e.name)
    return e.isDirectory() ? listFiles(p, base) : [path.relative(base, p).split(path.sep).join('/')]
  })
}

/**
 * Convert a copy of `srcDir` (it must have a `src/`) and return the files the conversion
 * changed or added, as { rel: text }. With `inPlace`, convert `srcDir` itself instead.
 * Throws on a checker usage error or a crash; findings (exit 1) are expected.
 */
export function convertDir(srcDir, { checker = CHECKER, inPlace = false } = {}) {
  const work = inPlace ? srcDir : fs.mkdtempSync(path.join(os.tmpdir(), 'ct1-conv-'))
  const before = Object.fromEntries(listFiles(srcDir).map((rel) => [rel, fs.readFileSync(path.join(srcDir, rel), 'utf8')]))
  if (!inPlace) fs.cpSync(srcDir, work, { recursive: true, filter: (p) => !['node_modules', '.git'].includes(path.basename(p)) })
  try {
    const r = spawnSync(process.execPath, [checker, ...FIX_ARGS, 'src'], { cwd: work, encoding: 'utf8' })
    if (r.error || r.status === 2 || r.status === null) throw new Error(`sygnal-check ${FIX_ARGS.join(' ')} failed in ${srcDir}: ${r.error?.message ?? r.stderr}`)
    const files = {}
    for (const rel of listFiles(work)) {
      const now = fs.readFileSync(path.join(work, rel), 'utf8')
      if (before[rel] !== now) files[rel] = now
    }
    const removed = Object.keys(before).filter((rel) => !fs.existsSync(path.join(work, rel)))
    if (removed.length) throw new Error(`the conversion removed files in ${srcDir}: ${removed.join(', ')}`)
    return { files, output: r.stdout }
  } finally {
    if (!inPlace) fs.rmSync(work, { recursive: true, force: true })
  }
}
