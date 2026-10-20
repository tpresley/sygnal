#!/usr/bin/env node
// The template smoke checks of RELEASING.md (§4 before publishing, §7 after), as one script.
// Every template (vite, vite-pwa, vike, astro, mcp-app; js and ts) is scaffolded into a new
// folder, installed, and must pass its tests, `sygnal-check --strict` (`pages` for Vike), `tsc
// --noEmit` for TypeScript, and its production build (and has a .gitignore and no remote fonts,
// PLAN-13 T-1); both Vike templates are then checked in
// Chromium: hydration, client navigation without a reload, one nav bar, a clean console.
//
//   node scripts/release-smoke.mjs --local      pack this checkout's three packages and scaffold
//                                               from those tarballs (nothing from the registry)
//   node scripts/release-smoke.mjs --registry   scaffold with create-sygnal-app@<this checkout's
//                                               version> from npm, and require the versions of
//                                               sygnal / sygnal-check this checkout has
//   --dir <path>      the work folder (default: a new folder under the OS temp dir)
//   --only vite-js    one project (repeatable)
//
// Needs `npm ci --prefix browser-tests` and its Chromium (Playwright) for the Vike check.
// Exits non-zero when any project fails; each project's output is in <dir>/<project>.log.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const mode = args.includes('--local') ? 'local' : args.includes('--registry') ? 'registry' : null
if (!mode) {
  console.error('Usage: node scripts/release-smoke.mjs --local | --registry [--dir <path>] [--only <project>]')
  process.exit(2)
}
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const only = args.flatMap((a, i) => (a === '--only' ? [args[i + 1]] : []))
const version = (rel) => JSON.parse(fs.readFileSync(path.join(repo, rel, 'package.json'), 'utf8')).version
const V = { sygnal: version('.'), check: version('sygnal-check'), csa: version('create-sygnal-app') }
const dir = path.resolve(opt('--dir') ?? fs.mkdtempSync(path.join(os.tmpdir(), `sygnal-smoke-${mode}-${V.sygnal}-`)))
fs.mkdirSync(dir, { recursive: true })

const TEMPLATES = ['vite', 'vite-pwa', 'vike', 'astro', 'mcp-app']
const projects = TEMPLATES.flatMap((t) => ['js', 'ts'].map((lang) => ({ t, lang, name: `${t}-${lang}` })))
  .filter((p) => !only.length || only.includes(p.name))

/** run a command; its output goes to the project's log */
function run(cmd, cmdArgs, { cwd, log, env }) {
  fs.appendFileSync(log, `\n$ ${cmd} ${cmdArgs.join(' ')}\n`)
  const r = spawnSync(cmd, cmdArgs, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
  fs.appendFileSync(log, (r.stdout ?? '') + (r.stderr ?? ''))
  if (r.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(' ')} exited ${r.status}`)
  return r.stdout ?? ''
}

// ---- the scaffolder: local tarballs, or the registry ----------------------------------------
let scaffold
if (mode === 'local') {
  const packs = path.join(dir, 'packs')
  fs.mkdirSync(packs, { recursive: true })
  const log = path.join(dir, 'pack.log')
  for (const p of ['.', 'sygnal-check', 'create-sygnal-app']) {
    run('npm', ['pack', '--pack-destination', packs, ...(p === '.' ? [] : ['--prefix', p, `./${p}`])], { cwd: repo, log })
  }
  const tgz = { sygnal: path.join(packs, `sygnal-${V.sygnal}.tgz`), check: path.join(packs, `sygnal-check-${V.check}.tgz`), csa: path.join(packs, `create-sygnal-app-${V.csa}.tgz`) }
  run('npm', ['install', '--prefix', path.join(dir, 'csa'), tgz.csa], { cwd: dir, log })
  const bin = path.join(dir, 'csa/node_modules/create-sygnal-app/index.js')
  scaffold = (p, log) => {
    run('node', [bin, p.name, '--template', p.t, `--${p.lang}`, '--no-install'], { cwd: dir, log })
    // the templates' sygnal / sygnal-check: this checkout's tarballs
    const file = path.join(dir, p.name, 'package.json')
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
    pkg.dependencies.sygnal = `file:${tgz.sygnal}`
    pkg.devDependencies['sygnal-check'] = `file:${tgz.check}`
    fs.writeFileSync(file, JSON.stringify(pkg, null, 2))
    run('npm', ['install'], { cwd: path.join(dir, p.name), log })
  }
} else {
  scaffold = (p, log) => run('npx', ['--yes', `create-sygnal-app@${V.csa}`, p.name, '--template', p.t, `--${p.lang}`, '--install'], { cwd: dir, log })
}

// ---- the Vike browser check -------------------------------------------------------------------
const playwright = createRequire(path.join(repo, 'browser-tests/package.json'))('playwright')

async function vikeInBrowser(projectDir, port, log) {
  const server = spawn('npm', ['run', 'preview', '--', '--port', String(port), '--strictPort'], { cwd: projectDir, stdio: 'ignore', detached: true })
  const url = `http://localhost:${port}/`
  try {
    for (let i = 0; ; i++) {
      try { await fetch(url); break } catch { if (i > 120) throw new Error(`vike preview didn't answer at ${url}`); await new Promise((r) => setTimeout(r, 500)) }
    }
    const browser = await playwright.chromium.launch()
    try {
      const page = await browser.newPage()
      const problems = []
      page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(m.text()) })
      page.on('pageerror', (e) => problems.push(e.message))
      await page.goto(url)
      await page.waitForSelector('.counter-display')
      const plus = page.getByRole('button', { name: '+' })
      await plus.click()
      await plus.click()
      const count = (await page.textContent('.counter-display')).trim()
      await page.evaluate(() => { window.__noReload = true })
      await page.getByRole('link', { name: 'About' }).click()
      await page.waitForURL('**/about')
      const h1 = (await page.textContent('h1')).trim()
      const noReload = await page.evaluate(() => window.__noReload === true)
      await page.getByRole('link', { name: 'Home' }).click()
      await page.waitForSelector('.counter-display')
      const navs = await page.locator('nav').count()
      const result = { count, h1, noReload, navs, problems }
      fs.appendFileSync(log, `\nvike browser check: ${JSON.stringify(result)}\n`)
      const failed = [
        count !== '2' && `the counter shows ${count} after two clicks (not hydrated?)`,
        h1 !== 'About' && `About rendered "${h1}"`,
        !noReload && 'navigating to About reloaded the page',
        navs !== 1 && `${navs} nav bars`,
        problems.length && `console: ${problems.join(' | ')}`,
      ].filter(Boolean)
      if (failed.length) throw new Error(`vike browser check: ${failed.join('; ')}`)
    } finally {
      await browser.close()
    }
  } finally {
    try { process.kill(-server.pid) } catch {}
  }
}

// ---- each project -----------------------------------------------------------------------------
console.log(`release smoke (${mode}): sygnal ${V.sygnal}, sygnal-check ${V.check}, create-sygnal-app ${V.csa}; in ${dir}`)
let failures = 0
let port = 4700
for (const p of projects) {
  const log = path.join(dir, `${p.name}.log`)
  const cwd = path.join(dir, p.name)
  fs.rmSync(cwd, { recursive: true, force: true })
  fs.writeFileSync(log, '')
  try {
    scaffold(p, log)
    const ls = run('npm', ['ls', 'sygnal', 'sygnal-check'], { cwd, log })
    for (const [name, v] of [['sygnal', V.sygnal], ['sygnal-check', V.check]]) {
      if (!ls.includes(`${name}@${v}`)) throw new Error(`${name}@${v} isn't the installed version`)
    }
    // PLAN-13 T-1: the scaffold has its .gitignore (stored as `gitignore`: npm drops dotfiles) and
    // loads no remote fonts
    if (!/^node_modules$/m.test(fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8'))) throw new Error('.gitignore does not ignore node_modules')
    const remote = fs.readdirSync(cwd, { recursive: true }).filter((f) => !String(f).startsWith('node_modules') && /\.(html|astro|css|jsx?|tsx?)$/.test(f))
      .filter((f) => /fonts\.(googleapis|gstatic)\.com/.test(fs.readFileSync(path.join(cwd, f), 'utf8')))
    if (remote.length) throw new Error(`remote fonts in ${remote.join(', ')}`)
    run('npm', ['test'], { cwd, log })
    run('npx', ['--no-install', 'sygnal-check', ...(p.t === 'vike' ? ['pages'] : []), '--strict'], { cwd, log })
    if (p.lang === 'ts') run('npx', ['--no-install', 'tsc', '--noEmit', '-p', '.'], { cwd, log })
    run('npm', ['run', 'build'], { cwd, log })
    if (p.t === 'vike') await vikeInBrowser(cwd, port++, log)
    if (p.name === 'vite-js' && !fs.existsSync(path.join(cwd, 'node_modules/sygnal/llms.txt'))) throw new Error('node_modules/sygnal/llms.txt is missing')
    console.log(`OK      ${p.name}`)
  } catch (e) {
    failures++
    console.log(`FAILED  ${p.name}: ${e.message} (log: ${log})`)
  }
}
console.log(failures ? `${failures} of ${projects.length} failed` : `all ${projects.length} passed`)
process.exit(failures ? 1 : 0)
