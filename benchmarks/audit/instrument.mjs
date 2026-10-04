// Instrumented counts behind the audit's root causes (findings 1, 2, 4), on an unminified build
// with counters injected at build time (see lib/instrument.mjs): DOM patches, xstream streams,
// setTimeout / setInterval calls, and retained ScopeCheckers (CDP heap snapshots before and
// after mount/unmount cycles). scripts/perf-gate.mjs gates a subset of these counts.
//   node instrument.mjs [--no-build | --build-only] [--only=patches,streams,retention] [--out=results/instrument.json]
import { chromium } from 'playwright'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildInstrumented, openSession, countObjects } from './lib/instrument.mjs'

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d
const ONLY = arg('only', 'patches,streams,retention').split(',')
const OUT = arg('out', 'results/instrument.json')
const root = resolve(import.meta.dirname)
const outDir = resolve(root, 'dist-instr')
const PAGES = ['table', 'table-coll', 'counters', 'deep', 'input']

if (!process.argv.includes('--no-build')) {
  await buildInstrumented({ pages: PAGES, outDir })
  console.log('built dist-instr/sygnal')
}
if (process.argv.includes('--build-only')) process.exit(0)

const s = await openSession({ chromium, outDir })
const { counted, open } = s
const rows1k = `h.click('#run'); await h.waitFor(() => h.n('.row') === 1000)`
const out = { date: new Date().toISOString(), chromium: s.browser.version() }

if (ONLY.includes('patches')) {
  out.patches = {
    'select row (1k Collection)': await counted('table-coll', rows1k, `h.click('.row:nth-child(2) .lbl')`, `h.q('.row:nth-child(2)').classList.contains('danger')`),
    'update every 10th (1k Collection)': await counted('table-coll', rows1k, `h.click('#update')`, `h.text('.row .lbl').endsWith('!!!')`),
    'select row (1k single component)': await counted('table', rows1k, `h.click('.row:nth-child(2) .lbl')`, `h.q('.row:nth-child(2)').classList.contains('danger')`),
    'update 1 of 1k counters': await counted('counters', `h.click('#create'); await h.waitFor(() => h.n('.counter') === 1000)`, `h.click('.counter:nth-child(500) .inc')`, `h.text('.counter:nth-child(500) .val') === '1'`),
    'leaf click, 30 deep': await counted('deep', `await h.waitFor(() => h.q('.leaf'))`, `h.click('.leaf .inc')`, `h.text('.leaf .val') === '1'`),
    'keystroke (1k list)': await counted('input', `await h.waitFor(() => h.q('.draft'))`, `h.type('.draft', 'a')`, `h.text('.echo') === h.q('.draft').value`),
  }
  for (const [k, v] of Object.entries(out.patches)) console.log(`patches  ${k.padEnd(36)} ${v.patches}  (streams ${v.streams}, setTimeout ${v.timeouts}, setInterval ${v.intervals})`)
}

if (ONLY.includes('streams')) {
  out.mount = {
    'mount 1k counters': await counted('counters', '', `h.click('#create')`, `h.n('.counter') === 1000`, 1000),
    'unmount 1k counters': await counted('counters', `h.click('#create'); await h.waitFor(() => h.n('.counter') === 1000)`, `h.click('#destroy')`, `h.n('.counter') === 0`, 1500),
    'create 1k Collection rows': await counted('table-coll', '', `h.click('#run')`, `h.n('.row') === 1000`, 1000),
    'clear 1k Collection rows': await counted('table-coll', rows1k, `h.click('#clear')`, `h.n('.row') === 0`, 1500),
  }
  for (const [k, v] of Object.entries(out.mount)) console.log(`mount    ${k.padEnd(36)} streams ${v.streams} (${(v.streams / 1000).toFixed(1)}/item), setTimeout ${v.timeouts}, setInterval ${v.intervals}, patches ${v.patches}`)
}

if (ONLY.includes('retention')) {
  out.retention = {}
  for (const [label, page, mount, unmount, sel] of [
    ['counters 5x mount/unmount 1k', 'counters', '#create', '#destroy', '.counter'],
    ['Collection table 5x create/clear 1k', 'table-coll', '#run', '#clear', '.row'],
  ]) {
    const { ctx, cdp, run } = await open(page)
    await run('await h.settle(300)')
    const before = await countObjects(cdp)
    for (let i = 0; i < 5; i++) await run(`h.click('${mount}'); await h.waitFor(() => h.n('${sel}') === 1000); h.click('${unmount}'); await h.waitFor(() => h.n('${sel}') === 0)`)
    await run('await h.settle(1500)')
    const after = await countObjects(cdp)
    const delta = Object.fromEntries(Object.keys({ ...before, ...after }).map(k => [k, (after[k] || 0) - (before[k] || 0)]))
    out.retention[label] = { before, after, delta }
    console.log(`retained ${label.padEnd(36)} ${JSON.stringify(delta)}`)
    await ctx.close()
  }
}

for (const e of s.pageErrors) console.log('pageerror', e)
await mkdir(resolve(root, 'results'), { recursive: true })
await writeFile(resolve(root, OUT), JSON.stringify(out, null, 2))
console.log(`wrote ${OUT}`)
await s.close()
