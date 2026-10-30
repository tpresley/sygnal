// Interleaved A/B timing of one table op across pages (CV-3b): every page open in its own context,
// measured round-robin in a rotating order, so load drift on a shared machine hits them alike.
//   node dev-plans/research/compile-wasm/ab.mjs <built dist (bench.mjs CW_OUT/dist)> <op name> <rounds> page...
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const repo = resolve(import.meta.dirname, '../../..')
const [dist, opName, rounds, ...pages] = process.argv.slice(2)
const req = createRequire(resolve(repo, 'benchmarks/package.json'))
const pw = await import(pathToFileURL(req.resolve('playwright')).href), chromium = pw.chromium || pw.default.chromium
const { HELPERS, OPS } = await import(pathToFileURL(resolve(repo, 'benchmarks/audit/lib/ops.mjs')).href)
const { serve } = await import(pathToFileURL(resolve(repo, 'benchmarks/audit/lib/server.mjs')).href)
const op = OPS.table.find(o => o.name === opName)
const server = await serve(dist), b = await chromium.launch({ args: ['--js-flags=--expose-gc'] })
const open = {}
for (const page of pages) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }), p = await ctx.newPage()
  await p.addInitScript(HELPERS)
  await p.goto(server.url + (page === 'react' ? '/benchmarks/audit/apps/react/table.html' : '/dev-plans/research/compile-wasm/apps/' + page + '.html'))
  await p.waitForFunction(() => document.querySelector('#main')?.children.length > 0, null, { timeout: 120000 })
  open[page] = p
}
const lat = Object.fromEntries(pages.map(p => [p, []]))
for (let r = 0; r < +rounds + 2; r++) {
  const order = pages.map((_, i) => pages[(i + r) % pages.length])
  for (const page of order) {
    const p = open[page]
    await p.evaluate(`(async () => { const h = window.__h; ${op.setup} })()`)
    await p.evaluate('window.__h.quiet()')
    const m = await p.evaluate(`(() => { const h = window.__h; return h.measure(() => { ${op.act} }, () => (${op.done})) })()`)
    if (r >= 2) lat[page].push(m.dom)
  }
}
const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) * f)] }
console.log(`${opName}, ${rounds} interleaved rounds: median [p25 - p75] ms`)
for (const page of pages) console.log(page.padEnd(12), q(lat[page], 0.5).toFixed(2), `[${q(lat[page], 0.25).toFixed(2)} - ${q(lat[page], 0.75).toFixed(2)}]`)
await b.close(); server.close()
