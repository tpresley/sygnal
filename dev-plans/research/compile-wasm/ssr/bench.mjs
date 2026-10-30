// Compiled SSR: the benchmark table's view (table.jsx) built as server code with sygnal({ compile })
// off and on (the real compiler, CV-1, through renderToString), and as a hand-written string template (what a server-side compile of
// the JSX would emit: static markup as string constants, escaped holes) vs renderToString (the
// pragma's vnodes, then the core's SSR walk). Same output, checked.
//   node dev-plans/research/compile-wasm/ssr/bench.mjs
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
const repo = resolve(import.meta.dirname, '../../../..')
const { renderToString, createElement: h } = await import(pathToFileURL(resolve(repo, 'dist/index.esm.js')).href)
const vite = await import(pathToFileURL(createRequire(resolve(repo, 'examples/kanban/package.json')).resolve('vite')).href)
const sygnal = (await import(pathToFileURL(resolve(repo, 'dist/vite/plugin.mjs')).href)).default
const dir = mkdtempSync(resolve(repo, 'dev-plans/research/compile-wasm/ssr/.tmp-'))
async function built(compile) {
  const r = await vite.build({ root: import.meta.dirname, configFile: false, logLevel: 'silent', plugins: [sygnal({ compile, devtools: false, check: false, diagnostics: 'off' })],
    build: { write: false, minify: false, ssr: resolve(import.meta.dirname, 'table.jsx'), rollupOptions: { external: (id) => /^(sygnal|snabbdom|xstream)(\/|$)/.test(id) } } })
  const f = resolve(dir, `t-${compile}.mjs`)
  writeFileSync(f, (Array.isArray(r) ? r[0] : r).output[0].code)
  return (await import(pathToFileURL(f).href)).Table
}
const JsxTable = await built(false), CompiledTable = await built(true)
rmSync(dir, { recursive: true, force: true })

function Table({ state }) {
  return h('div', { className: 'container' }, h('div', { className: 'table' }, state.rows.map(row => h('div', { className: row.id === state.selected ? 'row danger' : 'row', key: row.id, data: { id: row.id } },
    h('span', { className: 'col-id' }, row.id), h('a', { className: 'lbl' }, row.label), h('a', { className: 'remove' }, 'x')))))
}
// --- compiler output (hand-written) ---
const E = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (v) => { const s = '' + v; return /[&<>"']/.test(s) ? s.replace(/[&<>"']/g, c => E[c]) : s }
function TableSSR(state) {
  let o = '<div class="container" data-sygnal-ssr=""><div class="table">'
  const sel = state.selected
  for (const row of state.rows) o += '<div class="' + (row.id === sel ? 'row danger' : 'row') + '" data-id="' + esc(row.id) + '"><span class="col-id">' + esc(row.id) + '</span><a class="lbl">' + esc(row.label) + '</a><a class="remove">x</a></div>'
  return o + '</div></div>'
}
// ---
const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, label: (i % 7 ? 'pretty red table ' : 'a <b> & "c" ') + i }))
// node bench.mjs --profile-compiled: only the compiled view, for a CPU profile
if (process.argv.includes('--profile-compiled')) { const st = { rows: rows(10000), selected: 2 }; for (let i = 0; i < 300; i++) renderToString(CompiledTable, { state: st }); process.exit(0) }
for (const n of [1000, 10000]) {
  const state = { rows: rows(n), selected: 2 }
  const a = renderToString(Table, { state }), b = TableSSR(state)
  if (a !== b) { console.log(a.slice(0, 400)); console.log(b.slice(0, 400)); throw new Error('outputs differ') }
  if (renderToString(JsxTable, { state }) !== a || renderToString(CompiledTable, { state }) !== a) throw new Error('the built views render other HTML')
  const t = (f) => { for (let i = 0; i < 5; i++) f(); let best = Infinity; for (let r = 0; r < 7; r++) { const t0 = performance.now(); for (let i = 0; i < 5; i++) f(); best = Math.min(best, (performance.now() - t0) / 5) } return best }
  const ta = t(() => renderToString(Table, { state })), tb = t(() => TableSSR(state))
  const tj = t(() => renderToString(JsxTable, { state })), tc = t(() => renderToString(CompiledTable, { state }))
  console.log(`${n} rows, ${(a.length / 1024).toFixed(0)} KB: renderToString ${ta.toFixed(2)} ms (JSX build ${tj.toFixed(2)}), compiled (CV-1) ${tc.toFixed(2)} ms (${(tj / tc).toFixed(1)}x), hand-written template ${tb.toFixed(2)} ms (${(ta / tb).toFixed(1)}x)`)
}
