// sygnal/host event delegation, per event (dev-plans/research/sandbox §6.2): a Collection of N rows,
// each row's intent listening for `click` on its own button (one delegate per row, as todomvc's),
// plus the root's own delegates; a click on one row's button, through the host tree's
// dispatchEvent. Needs `npm run build`. node scripts/bench-host-delegation.mjs [rows...]
import { run, createElement as h, Collection, xs } from '../dist/index.esm.js'
import { HostDocument, HostEvent, makeHostDriver } from '../dist/host.esm.js'

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

function Row({ state }) {
  return h('li', { className: 'row' }, h('span', null, h('button', { className: 'hit' }, String(state.n))), h('input', { className: 'edit' }))
}
Row.intent = ({ DOM }) => ({ HIT: DOM.select('.hit').events('click'), EDIT: DOM.select('.edit').events('keydown'), OVER: DOM.select('.row').events('mouseover') })
Row.model = { HIT: (s) => ({ ...s, n: s.n + 1 }), EDIT: (s) => s, OVER: (s) => s }

function App() {
  return h('main', null, h('header', null, h('button', { className: 'add' }, 'add')), h('section', null, h('ul', null, h(Collection, { of: Row, from: 'rows' }))))
}
App.intent = ({ DOM }) => ({ ADD: DOM.select('.add').events('click'), KEY: DOM.select('document').events('keydown'), ANY: DOM.select('main').events('click') })
App.model = { ADD: (s) => s, KEY: (s) => s, ANY: (s) => s }

const sizes = process.argv.slice(2).map(Number).filter(Boolean)
for (const n of sizes.length ? sizes : [10, 100, 1000]) {
  App.initialState = { rows: Array.from({ length: n }, (_, i) => ({ id: i, n: 0 })) }
  const doc = new HostDocument()
  const app = run(App, { DOM: makeHostDriver(doc) })
  await tick(30)
  const buttons = doc.body.querySelectorAll('.hit')
  const target = buttons[buttons.length >> 1]
  // the delivery path only: the model's work and the render are what they are on any driver
  const runs = Math.max(200, Math.round(200000 / n))
  for (let i = 0; i < 50; i++) target.dispatchEvent(new HostEvent('click'))
  await tick(5)
  const t0 = performance.now()
  for (let i = 0; i < runs; i++) {
    target.dispatchEvent(new HostEvent('click'))
    // the loop guard defers a flush after 1,000 in one macrotask (sandbox §6.3)
    if (i % 500 === 499) await tick()
  }
  const per = (performance.now() - t0) / runs
  await tick(30)
  console.log(`${String(n).padStart(5)} rows, ${doc.delegates.size} delegates: ${(per * 1000).toFixed(1)} µs per click (dispatch + delivery + queued action)`)
  app.dispose()
}
