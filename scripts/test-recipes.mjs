#!/usr/bin/env node
/**
 * npm run test:recipes — the docs recipes' tested code (PLAN-5 G-441):
 * dev-plans/research/p5-recipes/, against the built sygnal (dist/; run `npm run build` first).
 *
 *   1. vitest: each recipe's own test (mock DOM) and docs-sync (every file a recipe page shows
 *      is one of the page's code blocks, so the docs show the code the tests run)
 *   2. with --browser (or TEST_RECIPES_BROWSER=chromium,firefox,webkit): the real-browser tests
 *      in each engine (Playwright 1.63.0, the browsers browser-tests already uses; never
 *      downloaded here)
 *
 * The project has its own devDependencies (chart.js, echarts, Tiptap, CodeMirror, Embla, AG
 * Grid, TanStack Table, Lucide, i18next: about 150 MB). Without node_modules it fails with a
 * message, unless installing is enabled: TEST_RECIPES_INSTALL=1 (or --install) runs
 * `npm ci` there first (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1).
 *
 * Usage: node scripts/test-recipes.mjs [--install] [--browser[=engines]]
 *   --browser            chromium, firefox and webkit
 *   --browser=chromium   only these (comma-separated)
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(repo, 'dev-plans', 'research', 'p5-recipes')
const ENGINES = ['chromium', 'firefox', 'webkit']

export function parseArgs(argv, env = process.env) {
  const yes = (v) => /^(1|true|yes)$/i.test(v || '')
  const opts = { install: yes(env.TEST_RECIPES_INSTALL), engines: [] }
  const list = (v) => (v && !yes(v) ? v.split(',').map(s => s.trim()).filter(Boolean) : ENGINES)
  if (env.TEST_RECIPES_BROWSER) opts.engines = list(env.TEST_RECIPES_BROWSER)
  for (const a of argv) {
    if (a === '--install') opts.install = true
    else if (a === '--browser') opts.engines = ENGINES
    else if (a.startsWith('--browser=')) opts.engines = list(a.slice(10))
    else throw new Error(`test:recipes: unknown argument '${a}'`)
  }
  for (const e of opts.engines) if (!ENGINES.includes(e)) throw new Error(`test:recipes: unknown engine '${e}' (${ENGINES.join(', ')})`)
  return opts
}

function npm(args, env = {}) {
  const r = spawnSync('npm', args, { cwd: dir, stdio: 'inherit', env: { ...process.env, ...env }, shell: process.platform === 'win32' })
  if (r.error) console.error(`test:recipes: could not run npm: ${r.error.message}`)
  return r.status ?? 1
}

export function main(argv = process.argv.slice(2)) {
  let opts
  try { opts = parseArgs(argv) } catch (e) { console.error(e.message); return 2 }
  const label = path.relative(process.cwd(), dir) || dir
  if (!fs.existsSync(path.join(repo, 'dist', 'index.esm.js'))) {
    console.error("test:recipes: dist/ is missing; run 'npm run build' first")
    return 1
  }
  if (!fs.existsSync(path.join(dir, 'node_modules'))) {
    if (!opts.install) {
      console.error(`test:recipes: ${label} has no node_modules; run 'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --prefix ${label}' ` +
        '(or set TEST_RECIPES_INSTALL=1 to install automatically)')
      return 1
    }
    const s = npm(['ci'], { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' })
    if (s) return s
  }
  let s = npm(['test'])
  if (s) return s
  for (const engine of opts.engines) {
    console.log(`\ntest:recipes: browser tests in ${engine}`)
    s = npm(['run', 'test:browser'], { BROWSER: engine })
    if (s) return s
  }
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main())
