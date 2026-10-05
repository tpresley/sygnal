// Spike 0-S (PLAN-4.6): the count-gate metrics for the current core and the prototype, side by side:
// DOM patches per update, xstream streams per Collection item, setTimeout calls to unmount 1k.
// Same injected counters as lib/instrument.mjs (snabbdom patch, xstream Stream constructor,
// page setTimeout), unminified production builds into dist-p46/{sygnal,next}.
//   node p46-counts.mjs [--no-build] [--out=results/p46-counts.json]
import { chromium } from 'playwright'
import { build } from 'vite'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import sygnal from 'sygnal/vite'
import { serve } from './lib/server.mjs'
import { HELPERS } from './lib/ops.mjs'
import { COUNT, RESET, READ } from './lib/instrument.mjs'

const root = resolve(import.meta.dirname)
const outDir = resolve(root, 'dist-p46')
const OUT = process.argv.find(a => a.startsWith('--out='))?.slice(6) ?? 'results/p46-counts.json'
const PAGES = ['table-coll', 'counters', 'counters-tags', 'deep', 'coll-calc', 'switch', 'fetch']
const HOOKS = [
  [/node_modules\/snabbdom\/build\/init\.js$/, 'return function patch(oldVnode, vnode) {', 'globalThis.__perf && globalThis.__perf.patches++;'],
  [/node_modules\/xstream\/index\.js$/, 'function Stream(producer) {', 'globalThis.__perf && globalThis.__perf.streams++;'],
]

if (!process.argv.includes('--no-build')) {
  for (const fw of ['sygnal', 'next']) {
    const applied = new Set()
    await build({
      root, configFile: false, logLevel: 'warn', mode: 'production', base: './',
      plugins: [{ name: 'counters', enforce: 'pre', transform(code, id) {
        for (const [file, find, add] of HOOKS) if (file.test(id) && code.includes(find)) { applied.add(find); return code.replace(find, find + ' ' + add) }
      } }, sygnal()],
      // PLAN-4.6 D175: the next target opts back in to the next core (sygnal/vite strips it in builds)
      define: { 'process.env.NODE_ENV': '"production"', ...(fw === 'next' && { __SYGNAL_NEXT_CORE__: 'true' }) },
      build: { outDir: resolve(outDir, fw), emptyOutDir: true, minify: false, rollupOptions: { input: Object.fromEntries(PAGES.map(p => [p, resolve(root, 'apps', fw, p + '.html')])) } },
    })
    if (applied.size !== HOOKS.length) throw new Error(`counter hooks missing in the ${fw} build`)
    console.log(`built dist-p46/${fw}`)
  }
}

const server = await serve(outDir)
const browser = await chromium.launch({ args: ['--js-flags=--expose-gc'] })
const errors = []
async function counted(fw, page, setup, act, done, trail = 500) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const p = await ctx.newPage()
  p.on('pageerror', e => errors.push(`${fw}/${page}: ${e.message}`))
  await p.addInitScript(COUNT + HELPERS)
  await p.goto(`${server.url}/${fw}/apps/${fw}/${page}.html`)
  await p.waitForFunction(() => document.querySelector('#main')?.children.length > 0)
  const run = (code) => p.evaluate(`(async () => { const h = window.__h; ${code} })()`)
  await run(setup)
  await run(`await h.settle(300); ${RESET}`)
  const r = await run(`${act}; await h.waitFor(() => ${done}); await h.settle(${trail}); ${READ}`)
  await ctx.close()
  return r
}

const rows1k = `h.click('#run'); await h.waitFor(() => h.n('.row') === 1000)`
const counters1k = `h.click('#create'); await h.waitFor(() => h.n('.counter') === 1000)`
// R2 added Collection and Switchable; fetch (replies, statics) is R3
const NEXT_PAGES = new Set(['deep', 'counters-tags', 'table-coll', 'counters', 'coll-calc', 'switch'])
const CASES = [
  ['patches: select row, 1k Collection', 'table-coll', rows1k, `h.click('.row:nth-child(2) .lbl')`, `h.q('.row:nth-child(2)').classList.contains('danger')`],
  ['patches: update every 10th, 1k Collection', 'table-coll', rows1k, `h.click('#update')`, `h.text('.row .lbl').endsWith('!!!')`],
  ['patches: remove row, 1k Collection', 'table-coll', rows1k, `h.click('.row:nth-child(2) .remove')`, `h.n('.row') === 999`],
  ['patches: leaf click, 30 deep', 'deep', `await h.waitFor(() => h.q('.leaf'))`, `h.click('.leaf .inc')`, `h.text('.leaf .val') === '1'`],
  ['patches: update 1 of 1k counters', 'counters', counters1k, `h.click('.counter:nth-child(500) .inc')`, `h.text('.counter:nth-child(500) .val') === '1'`],
  ['patches: calc toggle filter', 'coll-calc', rows1k, `h.click('#filter')`, `h.n('.row') === 500`],
  ['patches: calc bump one row', 'coll-calc', rows1k, `h.click('.row:nth-child(2) .bump')`, `h.text('.row:nth-child(2) .len') !== ''`],
  ['patches: switch show other page', 'switch', `h.click('#create'); await h.waitFor(() => h.n('.pa .counter') === 500)`, `h.click('#show-b')`, `h.n('.pb .counter') === 500`],
  ['patches: fetch create 1k (all replied)', 'fetch', '', `h.click('#run')`, `h.text('.loaded') === '1000'`],
  ['mount 1k counters', 'counters', '', `h.click('#create')`, `h.n('.counter') === 1000`, 1000],
  ['patches: update 1 of 1k counters (tags)', 'counters-tags', counters1k, `h.click('.counter:nth-child(500) .inc')`, `h.text('.counter:nth-child(500) .val') === '1'`],
  ['mount 1k counters (tags)', 'counters-tags', '', `h.click('#create')`, `h.n('.counter') === 1000`, 1000],
  ['unmount 1k counters (tags)', 'counters-tags', counters1k, `h.click('#destroy')`, `h.n('.counter') === 0`, 1500],
  ['unmount 1k counters', 'counters', counters1k, `h.click('#destroy')`, `h.n('.counter') === 0`, 1500],
  ['create 1k Collection rows', 'table-coll', '', `h.click('#run')`, `h.n('.row') === 1000`, 1000],
  ['clear 1k Collection rows', 'table-coll', rows1k, `h.click('#clear')`, `h.n('.row') === 0`, 1500],
  ['create 1k calc rows (filter+sort)', 'coll-calc', '', `h.click('#run')`, `h.n('.row') === 1000`, 1000],
  ['create 1k fetch rows', 'fetch', '', `h.click('#run')`, `h.text('.loaded') === '1000'`, 1000],
]
const out = { date: new Date().toISOString(), chromium: browser.version(), counts: {} }
for (const [label, page, setup, act, done, trail] of CASES) {
  out.counts[label] = {}
  const line = [label.padEnd(42)]
  for (const fw of ['sygnal', 'next']) {
    // PLAN-4.6: a page whose features the next core lacks yet (R3: fetch) is skipped for it
    if (fw === 'next' && !NEXT_PAGES.has(page)) { line.push('next: (needs R3)'); continue }
    const r = await counted(fw, page, setup, act, done, trail)
    out.counts[label][fw] = r
    line.push(`${fw}: patches ${r.patches}, streams ${r.streams}${label.includes('1k') && !label.startsWith('patches') ? ` (${(r.streams / 1000).toFixed(1)}/item)` : ''}, setTimeout ${r.timeouts}`)
  }
  console.log(line.join(' | '))
}
for (const e of errors) console.log('pageerror', e)
await mkdir(resolve(root, 'results'), { recursive: true })
await writeFile(resolve(root, OUT), JSON.stringify(out, null, 2))
console.log(`wrote ${OUT}`)
await browser.close()
server.close()
