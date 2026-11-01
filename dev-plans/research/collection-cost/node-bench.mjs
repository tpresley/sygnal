// Per-item cost of Collection items in the core, in Node (jsdom). The benchmark's Collection table
// (benchmarks/audit/apps/sygnal/table-coll.jsx: one Row component per row, each reading
// context.selected, with its own intent) on the built dist/, driven by clicks. Per op: `render` =
// the core's render pass (the root's render(): instances, views, the same-output check), `total` =
// click to flushed (render + the patch in jsdom, whose DOM costs much more than a browser's).
//   node --expose-gc dev-plans/research/collection-cost/node-bench.mjs [--rounds=30] [--ops=select,create1k,...] [--dist=dist]
// The counts it prints (objects / streams per item, heap per item) are exact; the times are medians.
import { JSDOM } from 'jsdom'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const repo = resolve(import.meta.dirname, '../../..')
const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d
const ROUNDS = +arg('rounds', 30)
const dom = new JSDOM('<!doctype html><html><body><div id="main"></div></body></html>', { pretendToBeVisual: true })
for (const k of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Text', 'Comment', 'DocumentFragment', 'Event', 'MouseEvent', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'CustomEvent', 'KeyboardEvent'])
  if (dom.window[k] !== undefined) globalThis[k] = dom.window[k]
const dist = resolve(repo, arg('dist', 'dist'))
const { run, Collection } = await import(pathToFileURL(resolve(dist, 'index.esm.js')).href)
const { jsx } = await import(pathToFileURL(resolve(dist, 'jsx-runtime.esm.js')).href)
const { buildData } = await import(pathToFileURL(resolve(repo, 'benchmarks/audit/lib/data.js')).href)

function Row({ state, context }) {
  return jsx('div', { className: context.selected === state.id ? 'row danger' : 'row', children: [
    jsx('span', { className: 'col-id', children: state.id }),
    jsx('a', { className: 'lbl', children: state.label }),
    jsx('a', { className: 'remove', children: 'x' }),
  ] })
}
Row.intent = ({ DOM }) => ({ SELECT: DOM.click('.lbl'), REMOVE: DOM.click('.remove') })
Row.model = { SELECT: { PARENT: (state) => state.id }, REMOVE: () => undefined }
const btn = (id) => jsx('button', { id, children: id })
function App() {
  return jsx('div', { className: 'container', children: [
    jsx('div', { className: 'controls', children: ['run', 'runlots', 'add', 'update', 'clear', 'swaprows'].map(btn) }),
    jsx('div', { className: 'table', children: jsx(Collection, { of: Row, from: 'rows' }) }),
  ] })
}
App.initialState = { rows: [], selected: 0 }
App.context = { selected: (state) => state.selected }
App.intent = ({ DOM, CHILD }) => ({
  RUN: DOM.click('#run'), RUNLOTS: DOM.click('#runlots'), ADD: DOM.click('#add'), UPDATE: DOM.click('#update'),
  CLEAR: DOM.click('#clear'), SWAP: DOM.click('#swaprows'), SELECTED: CHILD.select(Row),
})
App.model = {
  RUN: (state) => ({ ...state, rows: buildData(1000), selected: 0 }),
  RUNLOTS: (state) => ({ ...state, rows: buildData(10000), selected: 0 }),
  ADD: (state) => ({ ...state, rows: state.rows.concat(buildData(1000)) }),
  UPDATE: (state) => ({ ...state, rows: state.rows.map((r, i) => (i % 10 === 0 ? { ...r, label: r.label + ' !!!' } : r)) }),
  CLEAR: (state) => ({ ...state, rows: [], selected: 0 }),
  SWAP: (state) => {
    if (state.rows.length < 999) return state
    const rows = state.rows.slice(); const t = rows[1]; rows[1] = rows[998]; rows[998] = t
    return { ...state, rows }
  },
  SELECTED: (state, id) => ({ ...state, selected: id }),
}

// onPatch runs after the render pass, before the DOM driver patches: click -> onPatch is the core's
// part (the action, the reducer, the render), onPatch -> flushed the patch
let tPatch = 0
const r = run(App, {}, { mountPoint: '#main', __hooks: { onPatch: () => { tPatch = performance.now() } } })
const api = r.__runtime
const $ = (s) => document.querySelector(s), n = (s) => document.querySelectorAll(s).length
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
const settle = async () => { await api.flushed(); await new Promise(r => setTimeout(r, 0)); await api.flushed() }
await settle()
const GC = globalThis.gc

const OPS = {
  select: { setup: async () => { if (n('.row') !== 1000) { click($('#run')); await settle() } }, act: () => click(document.querySelectorAll('.row')[1 + (Math.random() * 900 | 0)].querySelector('.lbl')) },
  create1k: { setup: async () => { click($('#clear')); await settle() }, act: () => click($('#run')) },
  replace1k: { setup: async () => { click($('#run')); await settle() }, act: () => click($('#run')) },
  update10th: { setup: async () => { click($('#run')); await settle() }, act: () => click($('#update')) },
  clear1k: { setup: async () => { click($('#run')); await settle() }, act: () => click($('#clear')) },
  create10k: { setup: async () => { click($('#clear')); await settle() }, act: () => click($('#runlots')), rounds: 6 },
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1] }
const want = arg('ops', Object.keys(OPS).join(',')).split(',')
const out = {}
for (const name of want) {
  const op = OPS[name], tot = [], ren = []
  const R = op.rounds ?? ROUNDS
  for (let i = 0; i < R + 3; i++) {
    await op.setup(); GC()
    const t = performance.now()
    op.act(); await api.flushed()
    const dt = performance.now() - t
    if (i >= 3) { tot.push(dt); ren.push(tPatch - t) }
  }
  out[name] = { render: +med(ren).toFixed(3), total: +med(tot).toFixed(3) }
  console.log(name.padEnd(11), 'render', med(ren).toFixed(3).padStart(8), 'ms   total', med(tot).toFixed(3).padStart(8), 'ms')
}
// heap per item: 1k rows retained, minus none
click($('#clear')); await settle(); GC(); GC()
const h0 = process.memoryUsage().heapUsed
click($('#run')); await settle(); GC(); GC()
const h1 = process.memoryUsage().heapUsed
console.log('heap/item  ', ((h1 - h0) / 1000).toFixed(0), 'B (1k rows, includes jsdom nodes)')
out.heapPerItem = Math.round((h1 - h0) / 1000)
if (process.env.CC_JSON) (await import('node:fs')).writeFileSync(process.env.CC_JSON, JSON.stringify(out, null, 1))
r.dispose()
