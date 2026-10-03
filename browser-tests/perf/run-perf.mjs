/**
 * Performance baseline (PLAN-4 GS-16 / P-3). Measure only: not part of `npm test`.
 *
 *   npm --prefix browser-tests run perf                      all apps, 10 runs, 3 warm-up runs
 *   npm --prefix browser-tests run perf -- --runs 20 --apps sygnal-collection,react
 *   npm --prefix browser-tests run perf -- --profile sygnal-collection:edit
 *   npm --prefix browser-tests run perf -- --jfb             smoke + time the js-framework-benchmark entries
 *
 * Needs `npm ci --prefix benchmarks` (React, Vue, Vite plugin-vue) and a built
 * library (`npm run build`). It builds the scenario apps first
 * (`npm --prefix benchmarks run build:perf`, production mode) unless --no-build.
 *
 * Scenario, per app and per run: clear → create 1,000 rows → edit one row (the
 * 501st row's own label button) → swap rows 2 and 999 → append 1,000 rows. Each
 * op is timed in the page by apps/harness.js (method in its header): `dom` is
 * click → DOM settled + forced layout, `paint` is click → the next frame, `busy`
 * is click → main thread idle. Each op starts once the page is quiet again.
 * Each app runs in its own browser context; warm-up runs are discarded.
 * Same browser and free-port approach as run-headless.mjs (Playwright Chromium,
 * headless unless --headed), started with --expose-gc so each op begins after a GC.
 */
import { createServer as createNetServer } from 'node:net'
import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { preview } from 'vite'
import { chromium } from 'playwright'

const HOST = '127.0.0.1'
const perfDir = fileURLToPath(new URL('.', import.meta.url))
const benchmarksDir = fileURLToPath(new URL('../../benchmarks/', import.meta.url))
const ALL_APPS = ['sygnal-collection', 'sygnal-map', 'react', 'vue']
const SCENARIO = ['clear', 'create', 'edit', 'swap', 'append']
const REPORTED = ['create', 'edit', 'swap', 'append']

function parseArgs(argv) {
  const opts = { runs: 10, warmup: 3, apps: ALL_APPS, build: true, headed: false, profile: null, jfb: false, json: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--runs') opts.runs = Number(argv[++i])
    else if (a === '--warmup') opts.warmup = Number(argv[++i])
    else if (a === '--apps') opts.apps = argv[++i].split(',')
    else if (a === '--no-build') opts.build = false
    else if (a === '--headed') opts.headed = true
    else if (a === '--profile') opts.profile = argv[++i]
    else if (a === '--jfb') opts.jfb = true
    else if (a === '--json') opts.json = argv[++i]
    else throw new Error(`unknown option ${a}`)
  }
  return opts
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createNetServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, HOST, () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

function npmBenchmarks(script) {
  if (!existsSync(benchmarksDir + 'node_modules')) {
    throw new Error(`benchmarks/ is not installed: run \`npm ci --prefix ${benchmarksDir}\` first`)
  }
  const r = spawnSync('npm', ['--prefix', benchmarksDir, 'run', script], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`npm run ${script} failed`)
}

async function serve(root) {
  const server = await preview({
    root,
    configFile: false,
    logLevel: 'silent',
    build: { outDir: '.' },
    preview: { host: HOST, port: await freePort(), strictPort: false },
  })
  const { port } = server.httpServer.address()
  return { server, url: `http://${HOST}:${port}/` }
}

const quantile = (sorted, q) => {
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos), hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}
function stats(values) {
  const s = [...values].sort((a, b) => a - b)
  return { median: quantile(s, 0.5), p25: quantile(s, 0.25), p75: quantile(s, 0.75), min: s[0], max: s[s.length - 1], n: s.length }
}
const f1 = (n) => n.toFixed(1)

async function openApp(browser, base, app) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
  page.on('pageerror', (err) => errors.push(err.message))
  await page.goto(`${base}${app}.html`)
  await page.waitForFunction(() => window.__perf && window.__perf.ready(), null, { timeout: 15000 })
  return { context, page, errors }
}

async function runApp(browser, base, app, opts) {
  const { context, page, errors } = await openApp(browser, base, app)
  const samples = Object.fromEntries(SCENARIO.map((op) => [op, { dom: [], paint: [], busy: [] }]))
  try {
    for (let i = 0; i < opts.warmup + opts.runs; i++) {
      for (const op of SCENARIO) {
        const r = await page.evaluate((name) => window.__perf.measure(name), op)
        if (i >= opts.warmup) {
          samples[op].dom.push(r.dom)
          samples[op].paint.push(r.paint)
          samples[op].busy.push(r.busy)
        }
      }
    }
    if (errors.length) throw new Error(`${app}: console errors:\n  ${errors.join('\n  ')}`)
  } finally {
    await context.close()
  }
  return samples
}

async function profileOp(browser, base, app, op, opts) {
  const { context, page, errors } = await openApp(browser, base, app)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 50 })
  const self = new Map()
  let total = 0
  const times = []
  const profiles = []
  cdp.on('Profiler.consoleProfileFinished', (e) => profiles.push(e.profile))
  for (let i = 0; i < opts.warmup + opts.runs; i++) {
    for (const step of SCENARIO) {
      const record = step === op && i >= opts.warmup
      const r = await page.evaluate(([name, profile]) => window.__perf.measure(name, profile), [step, record])
      if (record) times.push(r.dom)
    }
  }
  for (const profile of profiles) {
    const byId = new Map(profile.nodes.map((n) => [n.id, n]))
    profile.samples.forEach((id, k) => {
      // the first sample's delta covers the profiler's own start-up
      const dt = k === 0 ? 0 : (profile.timeDeltas[k] || 0) / 1000
      const { functionName, url, lineNumber } = byId.get(id).callFrame
      if (functionName === '(idle)') return
      const key = `${functionName || '(anonymous)'}  ${url ? url.split('/').pop() : ''}${url ? ':' + (lineNumber + 1) : ''}`
      self.set(key, (self.get(key) || 0) + dt)
      total += dt
    })
  }
  await context.close()
  if (errors.length) throw new Error(`${app}: console errors:\n  ${errors.join('\n  ')}`)
  const runs = times.length
  console.log(`\nCPU profile: ${app} / ${op}, ${runs} runs, median dom ${f1(stats(times).median)} ms (unminified build, profiler on)`)
  console.log('Window: click → main thread idle. (program) is renderer work outside JS: style, layout, paint, DOM bindings.')
  console.log(`Self time per run, non-idle total ${f1(total / runs)} ms:\n`)
  console.log('| ms/run | % | function  file:line |\n|---:|---:|---|')
  for (const [key, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
    console.log(`| ${f1(ms / runs)} | ${f1((100 * ms) / total)} | \`${key}\` |`)
  }
}

// --jfb: build both js-framework-benchmark entries, check every op does what the
// benchmark expects, and time each op once per run with the same method.
const JFB_OPS = [
  ['run', '#run', 'n => n === 1000'],
  ['replace', '#run', '(n, d) => n === 1000 && d.firstId !== d.startFirstId'],
  ['update', '#update', '(n, d) => d.rows.filter((r, i) => i % 10 === 0).every(r => r.label.endsWith(" !!!"))'],
  ['select', 'tbody>tr:nth-of-type(2)>td:nth-of-type(2)>a', '(n, d) => d.dangerIndex === 1'],
  ['swap', '#swaprows', '(n, d) => d.rows[1].id === d.startRows[998].id && d.rows[998].id === d.startRows[1].id'],
  ['remove', 'tbody>tr:nth-of-type(4)>td:nth-of-type(3)>a>span:nth-of-type(1)', '(n, d) => n === 999 && d.rows[3].id === d.startRows[4].id'],
  ['runlots', '#runlots', 'n => n === 10000'],
  ['clear-10k', '#clear', 'n => n === 0'],
  ['run', '#run', 'n => n === 1000'],
  ['append', '#add', 'n => n === 2000'],
  ['clear', '#clear', 'n => n === 0'],
]

async function jfbMeasure(page, selector, predicate) {
  return page.evaluate(async ({ selector, predicate }) => {
    const done = new Function(`return (${predicate})`)()
    const snapshot = () => {
      const trs = [...document.querySelectorAll('tbody>tr')]
      return {
        rows: trs.map((tr) => ({ id: tr.children[0].textContent, label: tr.children[1].textContent })),
        dangerIndex: trs.findIndex((tr) => tr.className === 'danger'),
        firstId: trs[0]?.children[0].textContent,
      }
    }
    const start = snapshot()
    const check = () => {
      const d = snapshot()
      return done(d.rows.length, { ...d, startRows: start.rows, startFirstId: start.firstId })
    }
    if (typeof globalThis.gc === 'function') globalThis.gc()
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const target = document.querySelector(selector)
    if (!target) throw new Error(`no element for ${selector}`)
    return new Promise((resolve, reject) => {
      let finished = false
      const t0 = performance.now()
      const observer = new MutationObserver(() => finish())
      const finish = () => {
        if (finished || !check()) return
        finished = true
        observer.disconnect()
        clearTimeout(timer)
        void document.body.offsetHeight
        resolve(performance.now() - t0)
      }
      const timer = setTimeout(() => { observer.disconnect(); reject(new Error(`${selector}: never reached the expected DOM`)) }, 20000)
      observer.observe(document.querySelector('#main'), { childList: true, characterData: true, attributes: true, subtree: true })
      target.click()
      finish()
    })
  }, { selector, predicate })
}

async function runJfb(browser, opts) {
  if (opts.build) npmBenchmarks('build:jfb')
  const { server, url } = await serve(benchmarksDir + 'js-framework-benchmark')
  try {
    for (const kind of ['keyed', 'non-keyed']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
      const page = await context.newPage()
      const errors = []
      // The benchmark's shared stylesheet (/css/currentStyle.css) lives in its own repo.
      await page.route('**/css/currentStyle.css', (route) => route.fulfill({ contentType: 'text/css', body: '' }))
      page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
      page.on('pageerror', (err) => errors.push(err.message))
      await page.goto(`${url}${kind}/sygnal/index.html`)
      await page.waitForSelector('#run')
      const samples = Object.fromEntries(JFB_OPS.map(([name]) => [name, []]))
      const runs = Math.max(1, Math.min(opts.runs, 5))
      for (let i = 0; i < runs + 1; i++) {
        for (const [name, selector, predicate] of JFB_OPS) {
          const ms = await jfbMeasure(page, selector, predicate)
          if (i > 0) samples[name].push(ms)
        }
      }
      await context.close()
      if (errors.length) throw new Error(`jfb ${kind}: console errors:\n  ${errors.join('\n  ')}`)
      console.log(`\njs-framework-benchmark Sygnal ${kind}: all ops OK (${runs} runs + 1 warm-up), median ms click → DOM settled + layout`)
      console.log('| op | median | min–max |\n|---|---:|---:|')
      for (const [name, values] of Object.entries(samples)) {
        const s = stats(values)
        console.log(`| ${name} | ${f1(s.median)} | ${f1(s.min)}–${f1(s.max)} |`)
      }
    }
  } finally {
    await server.close()
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const browser = await chromium.launch({ headless: !opts.headed, args: ['--js-flags=--expose-gc'] })
  const env = {
    date: new Date().toISOString(),
    cpu: `${os.cpus()[0].model} (${os.cpus().length} cores)`,
    memory: `${Math.round(os.totalmem() / 2 ** 30)} GB`,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    node: process.version,
    browser: `Chromium ${browser.version()} (Playwright, ${opts.headed ? 'headed' : 'headless'})`,
  }
  console.log(Object.entries(env).map(([k, v]) => `${k}: ${v}`).join('\n'))
  try {
    if (opts.jfb) return await runJfb(browser, opts)

    if (opts.profile) {
      const [app, op] = opts.profile.split(':')
      if (opts.build) npmBenchmarks('build:perf:profile')
      const { server, url } = await serve(perfDir + 'dist-profile')
      try { await profileOp(browser, url, app, op, opts) } finally { await server.close() }
      return
    }

    if (opts.build) npmBenchmarks('build:perf')
    const { server, url } = await serve(perfDir + 'dist')
    const results = {}
    try {
      for (const app of opts.apps) {
        process.stdout.write(`running ${app} (${opts.warmup} warm-up + ${opts.runs} runs)... `)
        results[app] = await runApp(browser, url, app, opts)
        console.log('done')
      }
    } finally {
      await server.close()
    }

    const summary = {}
    for (const [app, ops] of Object.entries(results)) {
      summary[app] = Object.fromEntries(Object.entries(ops).map(([op, s]) => [op, { dom: stats(s.dom), paint: stats(s.paint), busy: stats(s.busy) }]))
    }
    console.log(`\nMedian ms over ${opts.runs} runs: click → DOM settled + layout [p25–p75] (click → next frame)\n`)
    console.log(`| op | ${opts.apps.join(' | ')} |\n|---|${opts.apps.map(() => '---:').join('|')}|`)
    for (const op of [...REPORTED, 'clear']) {
      const cells = opts.apps.map((app) => {
        const { dom, paint } = summary[app][op]
        return `${f1(dom.median)} [${f1(dom.p25)}–${f1(dom.p75)}] (${f1(paint.median)})`
      })
      console.log(`| ${op} | ${cells.join(' | ')} |`)
    }
    console.log(`\nmin–max, dom:\n`)
    console.log(`| op | ${opts.apps.join(' | ')} |\n|---|${opts.apps.map(() => '---:').join('|')}|`)
    for (const op of [...REPORTED, 'clear']) {
      console.log(`| ${op} | ${opts.apps.map((app) => `${f1(summary[app][op].dom.min)}–${f1(summary[app][op].dom.max)}`).join(' | ')} |`)
    }
    console.log(`\nMedian ms, click → main thread idle (busy; includes trailing work after the DOM is right):\n`)
    console.log(`| op | ${opts.apps.join(' | ')} |\n|---|${opts.apps.map(() => '---:').join('|')}|`)
    for (const op of [...REPORTED, 'clear']) {
      console.log(`| ${op} | ${opts.apps.map((app) => f1(summary[app][op].busy.median)).join(' | ')} |`)
    }
    if (opts.json) {
      writeFileSync(opts.json, JSON.stringify({ env, opts, summary, results }, null, 2))
      console.log(`\nwrote ${opts.json}`)
    }
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error('perf run failed:', err.message)
  process.exit(1)
})
