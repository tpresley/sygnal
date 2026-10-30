// The compiled variants render the same DOM as their baseline after each step of a sequence of
// table ops (run, select, update every 10th, swap, remove, append, update last, clear, run), and
// how many DOM mutation records each step makes (a count, not a timing).
//   node dev-plans/research/compile-wasm/check-dom.mjs   (after bench.mjs has built the pages)
import { createRequire } from 'node:module'
import { resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

const here = import.meta.dirname, repo = resolve(here, '../../..')
const req = createRequire(resolve(repo, 'benchmarks/package.json'))
const pw = await import(pathToFileURL(req.resolve('playwright')).href), chromium = pw.chromium || pw.default.chromium
const { HELPERS } = await import(pathToFileURL(resolve(repo, 'benchmarks/audit/lib/ops.mjs')).href)
const { serve } = await import(pathToFileURL(resolve(repo, 'benchmarks/audit/lib/server.mjs')).href)
const out = resolve(process.env.CW_OUT || resolve(here, 'results'), 'dist')
const server = await serve(out), browser = await chromium.launch()

const STEPS = [
  [`h.click('#run')`, `h.n('.row') === 1000`],
  [`h.click('.row:nth-child(2) .lbl')`, `h.q('.row:nth-child(2)').classList.contains('danger')`],
  [`h.click('#update')`, `h.text('.row .lbl').endsWith('!!!')`],
  [`h.click('#swaprows')`, `true`],
  [`h.click('.row:nth-child(3) .remove')`, `h.n('.row') === 999`],
  [`h.click('.row:nth-child(5) .lbl')`, `h.q('.row:nth-child(5)').classList.contains('danger')`],
  [`h.click('#add')`, `h.n('.row') === 1999`],
  [`h.q('#updatelast') && h.click('#updatelast')`, `true`],
  [`h.click('#clear')`, `h.n('.row') === 0`],
  [`h.click('#run')`, `h.n('.row') === 1000`],
]
async function trace(page) {
  const ctx = await browser.newContext(), p = await ctx.newPage(), errors = []
  p.on('pageerror', e => errors.push(e.message))
  await p.addInitScript(HELPERS)
  await p.goto(`${server.url}/${relative(repo, resolve(here, 'apps', page + '.html'))}`)
  await p.waitForFunction(() => document.querySelector('#main')?.children.length > 0, null, { timeout: 120000 })
  const snaps = [], counts = []
  for (const [act, done] of STEPS) {
    // a row's identity: id, class, data-id, texts (attribute order and the isolation attributes left out)
    const [snap, muts] = await p.evaluate(`(async () => { const h = window.__h; const rec = []; const mo = new MutationObserver(r => rec.push(...r)); mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      ${act}; await h.waitFor(() => ${done}); await h.settle(100); mo.disconnect();
      return [[...document.querySelectorAll('.table > *')].map(r => [r.className, r.dataset.id ?? '', r.children.length, ...[...r.children].map(c => c.className + ':' + c.textContent)].join('|')).join('\\n'), rec.length] })()`)
    snaps.push(snap); counts.push(muts)
  }
  await ctx.close()
  return { snaps, counts, errors }
}
let bad = 0
const COUNTS = []
for (const [base, variants] of [['table-base', ['table-cva', 'table-cv', 'table-a', 'table-b']], ['coll-base', ['coll-cva', 'coll-cv', 'coll-a', 'coll-b']]]) {
  const want = await trace(base)
  COUNTS.push([base, want.counts])
  for (const v of variants) {
    const got = await trace(v)
    COUNTS.push([v, got.counts])
    const diff = got.snaps.findIndex((s, i) => s !== want.snaps[i])
    if (diff >= 0 || got.errors.length) bad++
    console.log(`${v} vs ${base}: ${diff < 0 ? 'same DOM at every step' : `differs at step ${diff + 1} (${STEPS[diff][0]})`}${got.errors.length ? ' errors: ' + got.errors.join(' | ') : ''}`)
  }
}
console.log('\nDOM mutation records per step: ' + STEPS.map(s => s[0].replace(/h\.click\('|'\)|h\.q.*&& /g, '')).join(' | '))
for (const [p, c] of COUNTS) console.log(p.padEnd(12), c.join(' | '))
await browser.close(); server.close()
process.exit(bad ? 1 : 0)
