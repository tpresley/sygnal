/**
 * js-framework-benchmark entries: build both (keyed, non-keyed), check in headless Chromium
 * that every op does what the benchmark expects, and time each op (smoke timings only: the
 * check reads every row after each mutation batch, so they overstate the real cost; use them
 * to compare keyed with non-keyed). Moved from the retired browser-tests/perf (`--jfb`).
 *
 *   npm --prefix benchmarks run jfb [-- --runs 5] [-- --no-build] [-- --headed]
 *
 * Needs `npm run build` and `npm ci --prefix benchmarks`: the entries have no node_modules of
 * their own here and resolve `sygnal` (this checkout) and `vite` from benchmarks/node_modules.
 */
import { createServer as createNetServer } from 'node:net'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { preview } from 'vite'
import { chromium } from 'playwright'

const HOST = '127.0.0.1'
const benchmarksDir = fileURLToPath(new URL('.', import.meta.url))

const argv = process.argv.slice(2)
const runsArg = argv.indexOf('--runs')
const opts = { runs: runsArg >= 0 ? Number(argv[runsArg + 1]) : 5, build: !argv.includes('--no-build'), headed: argv.includes('--headed') }

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createNetServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, HOST, () => { const { port } = srv.address(); srv.close(() => resolve(port)) })
  })
}

async function serve(root) {
  const server = await preview({ root, configFile: false, logLevel: 'silent', build: { outDir: '.' }, preview: { host: HOST, port: await freePort(), strictPort: false } })
  const { port } = server.httpServer.address()
  return { server, url: `http://${HOST}:${port}/` }
}

const quantile = (sorted, q) => { const pos = (sorted.length - 1) * q; const lo = Math.floor(pos), hi = Math.ceil(pos); return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo) }
const stats = (values) => { const s = [...values].sort((a, b) => a - b); return { median: quantile(s, 0.5), min: s[0], max: s[s.length - 1] } }
const f1 = (n) => n.toFixed(1)

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
    const check = () => { const d = snapshot(); return done(d.rows.length, { ...d, startRows: start.rows, startFirstId: start.firstId }) }
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

async function main() {
  if (opts.build) {
    const r = spawnSync('npm', ['--prefix', benchmarksDir, 'run', 'build:jfb'], { stdio: 'inherit' })
    if (r.status !== 0) throw new Error('npm run build:jfb failed (is benchmarks/ installed? see the header)')
  }
  const browser = await chromium.launch({ headless: !opts.headed, args: ['--js-flags=--expose-gc'] })
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
    await browser.close()
  }
}

main().catch((err) => { console.error('jfb smoke failed:', err.message); process.exit(1) })
