// Retained objects per Collection item (a count metric: exact, no timing noise). Builds the audit's
// table-coll page unminified against each dist, creates 1,000 rows, and diffs two Chromium heap
// snapshots (1k rows vs 0 rows): objects and self bytes per item, by kind (constructor name, or
// V8's node type for closures, arrays, strings). DOM nodes are counted apart (the same for any core).
//   node dev-plans/research/collection-cost/objects.mjs --dists=base:<dir>,new:dist [--top=25] [--page=table-coll]
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const here = import.meta.dirname, repo = resolve(here, '../../..')
const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d
const req = createRequire(resolve(repo, 'benchmarks/package.json'))
const imp = (m) => import(pathToFileURL(req.resolve(m)).href)
const { HELPERS } = await import(pathToFileURL(resolve(repo, 'benchmarks/audit/lib/ops.mjs')).href)
const { serve } = await import(pathToFileURL(resolve(repo, 'benchmarks/audit/lib/server.mjs')).href)
const DISTS = arg('dists', 'new:dist').split(',').map(s => { const [n, d] = s.split(':'); return { n, d: resolve(repo, d) } })
const PAGE = arg('page', 'table-coll'), TOP = +arg('top', 25), N = 1000
const out = resolve(process.env.CC_OUT || resolve(here, 'results'), 'pages-objects')
const { build } = await imp('vite')
const sygnal = (await imp('sygnal/vite')).default
for (const { n, d } of DISTS) {
  await build({
    root: repo, configFile: false, logLevel: 'warn', mode: 'production', base: `/${n}/`,
    plugins: [sygnal({ devtools: false, check: false, diagnostics: 'off' })],
    resolve: { alias: [
      { find: /^sygnal\/jsx-(dev-)?runtime$/, replacement: resolve(d, 'jsx-runtime.esm.js') },
      { find: /^sygnal$/, replacement: resolve(d, 'index.esm.js') },
    ] },
    define: { 'process.env.NODE_ENV': '"production"' },
    build: { outDir: resolve(out, n), emptyOutDir: true, minify: false, rollupOptions: { input: { [PAGE]: resolve(repo, `benchmarks/audit/apps/sygnal/${PAGE}.html`) } } },
  })
}

async function snapshot(cdp) {
  for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage')
  const chunks = []
  const on = (e) => chunks.push(e.chunk)
  cdp.on('HeapProfiler.addHeapSnapshotChunk', on)
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
  cdp.off('HeapProfiler.addHeapSnapshotChunk', on)
  const s = JSON.parse(chunks.join('')), m = s.snapshot.meta, F = m.node_fields.length
  const iType = m.node_fields.indexOf('type'), iName = m.node_fields.indexOf('name'), iSize = m.node_fields.indexOf('self_size')
  const types = m.node_types[iType], count = new Map()
  // --shapes: plain Objects keyed by their property names (which object it is)
  const EF = m.edge_fields.length, iEC = m.node_fields.indexOf('edge_count'), eT = m.edge_fields.indexOf('type'), eN = m.edge_fields.indexOf('name_or_index'), eTypes = m.edge_types[eT]
  const shapes = process.argv.includes('--shapes')
  let e = 0
  for (let i = 0; i < s.nodes.length; i += F) {
    const ec = s.nodes[i + iEC], e0 = e
    e += ec * EF
    const t = types[s.nodes[i + iType]]
    if (t === 'synthetic') continue
    const name = s.strings[s.nodes[i + iName]]
    let key = t === 'native' ? 'DOM: native' : name.startsWith('system / Context') ? '(closure scope)' : t === 'object' ? (/^(HTML|Text|Comment|DOMTokenList|CSSStyle|NamedNodeMap|Attr|Detached)/.test(name) ? 'DOM: ' + name.split(' ')[0] : name) : t === 'closure' ? 'closure ' + (name || '(anon)') : t === 'array' ? '(array ' + name + ')' : t === 'string' || t === 'concatenated string' || t === 'sliced string' ? '(string)' : t === 'number' ? '(number)' : t === 'code' ? '(code)' : `(${t})`
    if (shapes && (key === 'Object' || key === 'Plain' || key === '(closure scope)')) {
      const ps = []
      for (let x = e0; x < e0 + ec * EF; x += EF) { const et = eTypes[s.edges[x + eT]]; if (et === 'property' || et === 'context') ps.push(s.strings[s.edges[x + eN]]) }
      key += ' {' + ps.filter(p => p !== '__proto__' && p !== 'map').slice(0, 10).join(',') + '}'
    }
    const c = count.get(key) || count.set(key, { n: 0, b: 0 }).get(key)
    c.n++; c.b += s.nodes[i + iSize]
  }
  return count
}

const pw = await imp('playwright'), chromium = pw.chromium || pw.default.chromium
const server = await serve(out), browser = await chromium.launch({ args: ['--js-flags=--expose-gc'] })
const res = {}
for (const { n } of DISTS) {
  const ctx = await browser.newContext(), p = await ctx.newPage()
  await p.addInitScript(HELPERS)
  await p.goto(`${server.url}/${n}/benchmarks/audit/apps/sygnal/${PAGE}.html`)
  await p.waitForFunction(() => document.querySelector('#main')?.children.length > 0)
  const cdp = await ctx.newCDPSession(p)
  const ev = (c) => p.evaluate(`(async () => { const h = window.__h; ${c} })()`)
  // warm: one create/clear cycle, so lazily made shared objects exist in both snapshots
  await ev(`h.click('#run'); await h.waitFor(() => h.n('.row') === ${N}); await h.settle(300); h.click('#clear'); await h.waitFor(() => h.n('.row') === 0); await h.settle(300)`)
  const a = await snapshot(cdp)
  await ev(`h.click('#run'); await h.waitFor(() => h.n('.row') === ${N}); await h.settle(300)`)
  const b = await snapshot(cdp)
  const diff = []
  for (const [k, v] of b) { const o = a.get(k) || { n: 0, b: 0 }; if (v.n !== o.n) diff.push([k, (v.n - o.n) / N, (v.b - o.b) / N]) }
  const js = diff.filter(d => !d[0].startsWith('DOM: ') && d[0] !== '(code)')
  res[n] = { objects: js.reduce((s, d) => s + d[1], 0), bytes: js.reduce((s, d) => s + d[2], 0), dom: diff.filter(d => d[0].startsWith('DOM: ')).reduce((s, d) => s + d[2], 0), by: Object.fromEntries(js.map(d => [d[0], [+d[1].toFixed(2), +d[2].toFixed(1)]])) }
  console.log(`\n${n}: ${res[n].objects.toFixed(1)} JS objects / item, ${res[n].bytes.toFixed(0)} B / item (DOM: ${res[n].dom.toFixed(0)} B / item, apart)`)
  for (const [k, c, by] of js.sort((x, y) => y[2] - x[2]).slice(0, TOP)) console.log(`  ${c.toFixed(2).padStart(7)} obj ${by.toFixed(0).padStart(6)} B  ${k}`)
  await ctx.close()
}
await browser.close(); server.close()
if (arg('json')) (await import('node:fs')).writeFileSync(arg('json'), JSON.stringify(res, null, 1))
