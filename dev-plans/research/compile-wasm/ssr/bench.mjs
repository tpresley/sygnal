// Compiled SSR: the benchmark table's view as a string template (what a server-side compile of
// the JSX would emit: static markup as string constants, escaped holes) vs renderToString (the
// pragma's vnodes, then the core's SSR walk). Same output, checked.
//   node dev-plans/research/compile-wasm/ssr/bench.mjs
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const { renderToString, createElement: h } = await import(pathToFileURL(resolve(import.meta.dirname, '../../../../dist/index.esm.js')).href)

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
for (const n of [1000, 10000]) {
  const state = { rows: rows(n), selected: 2 }
  const a = renderToString(Table, { state }), b = TableSSR(state)
  if (a !== b) { console.log(a.slice(0, 400)); console.log(b.slice(0, 400)); throw new Error('outputs differ') }
  const t = (f) => { for (let i = 0; i < 5; i++) f(); let best = Infinity; for (let r = 0; r < 7; r++) { const t0 = performance.now(); for (let i = 0; i < 5; i++) f(); best = Math.min(best, (performance.now() - t0) / 5) } return best }
  const ta = t(() => renderToString(Table, { state })), tb = t(() => TableSSR(state))
  console.log(`${n} rows, ${(a.length / 1024).toFixed(0)} KB: renderToString ${ta.toFixed(2)} ms, compiled template ${tb.toFixed(2)} ms (${(ta / tb).toFixed(1)}x)`)
}
