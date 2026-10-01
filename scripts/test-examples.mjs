#!/usr/bin/env node
/**
 * npm run test:examples — run each example's own test suite (its own
 * Vite/Vitest config and toolchain), cross-platform.
 *
 * For every examples/<name>/ directory that contains a *.test.* or *.spec.*
 * file (node_modules and dist are not searched), runs `npm test` in it, in
 * name order, and stops at the first failure (non-zero exit). An example
 * without node_modules fails with a message, unless installing is enabled:
 *
 *   TEST_EXAMPLES_INSTALL=1 npm run test:examples   (or --install)
 *
 * runs `npm install` in it first.
 *
 * Usage: node scripts/test-examples.mjs [--install] [--dir <examples dir>] [name...]
 *   name...  only these examples (default: all)
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TEST_FILE = /\.(test|spec)\./
const SKIP_DIRS = new Set(['node_modules', 'dist'])

function parseArgs(argv) {
  const opts = { install: /^(1|true|yes)$/i.test(process.env.TEST_EXAMPLES_INSTALL || ''), dir: path.join(repo, 'examples'), only: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--install') opts.install = true
    else if (a === '--dir') opts.dir = path.resolve(argv[++i])
    else if (a.startsWith('--dir=')) opts.dir = path.resolve(a.slice(6))
    else opts.only.push(a.replace(/[\\/]+$/, '').split(/[\\/]/).pop())
  }
  return opts
}

/** Does `dir` contain a test file (node_modules and dist not searched)? */
function hasTests(dir) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return false }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && hasTests(path.join(dir, e.name))) return true
    } else if (e.isFile() && TEST_FILE.test(e.name)) {
      return true
    }
  }
  return false
}

function npm(args, cwd) {
  const r = spawnSync('npm', args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.error) console.error(`test:examples: could not run npm: ${r.error.message}`)
  return r.status ?? 1
}

export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv)
  let names
  try {
    names = fs.readdirSync(opts.dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort()
  } catch (err) {
    console.error(`test:examples: cannot read ${opts.dir}: ${err.message}`)
    return 1
  }
  for (const n of opts.only) {
    if (!names.includes(n)) { console.error(`test:examples: no example named '${n}' in ${opts.dir}`); return 1 }
  }
  if (opts.only.length) names = names.filter(n => opts.only.includes(n))

  for (const name of names) {
    const dir = path.join(opts.dir, name)
    const label = path.relative(process.cwd(), dir) || dir
    if (!hasTests(dir)) continue
    if (!fs.existsSync(path.join(dir, 'node_modules'))) {
      if (!opts.install) {
        console.error(`test:examples: ${label} has no node_modules; run 'npm install' in ${label} first ` +
          `(or set TEST_EXAMPLES_INSTALL=1 to install automatically)`)
        return 1
      }
      console.log(`test:examples: installing ${label}`)
      if (npm(['install', '--no-audit', '--no-fund'], dir) !== 0) {
        console.error(`test:examples: npm install failed in ${label}`)
        return 1
      }
    }
    console.log(`test:examples: ${label}`)
    const status = npm(['test'], dir)
    if (status !== 0) {
      console.error(`test:examples: ${label} failed (exit ${status})`)
      return status
    }
  }
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
