// Retained heap and DOM nodes after create/clear cycles on the Collection table, sampled at
// several delays after the last clear (does the trailing teardown finish, or is it a leak?).
// bench.mjs samples 200 ms after the last cycle; this separates slow teardown from retention.
//   node retained.mjs [--page=table-coll] [--cycles=5] [--gap=0] [--dist=dist]
import { chromium } from 'playwright'
import { resolve } from 'node:path'
import { serve } from './lib/server.mjs'
import { HELPERS } from './lib/ops.mjs'

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d
const PAGE = arg('page', 'table-coll'), CYCLES = +arg('cycles', 5), GAP = +arg('gap', 0)
const server = await serve(resolve(import.meta.dirname, arg('dist', 'dist')))
const browser = await chromium.launch({ args: ['--js-flags=--expose-gc'] })
const ctx = await browser.newContext()
const p = await ctx.newPage()
await p.addInitScript(HELPERS)
await p.goto(`${server.url}/sygnal/apps/sygnal/${PAGE}.html`)
await p.waitForFunction(() => document.querySelector('#main')?.children.length > 0)
const cdp = await ctx.newCDPSession(p)
const heap = async () => {
  for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage')
  const { usedSize } = await cdp.send('Runtime.getHeapUsage')
  const { nodes } = await cdp.send('Memory.getDOMCounters')
  return `${(usedSize / 1048576).toFixed(2)} MB / ${nodes} nodes`
}
const run = (c) => p.evaluate(`(async () => { const h = window.__h; ${c} })()`)
console.log('ready', await heap())
// same sequence as bench.mjs memoryRuns: run, wait, clear, wait (gap ms between steps)
for (let i = 0; i < CYCLES; i++) await run(`h.click('#run'); await h.waitFor(() => h.n('.row') === 1000); await h.settle(${GAP}); h.click('#clear'); await h.waitFor(() => h.n('.row') === 0); await h.settle(${GAP})`)
for (const ms of [200, 1000, 3000]) {
  await run(`await h.settle(${ms})`)
  console.log(`${CYCLES} cycles (gap ${GAP} ms), +${ms} ms`, await heap())
}
await browser.close()
server.close()
