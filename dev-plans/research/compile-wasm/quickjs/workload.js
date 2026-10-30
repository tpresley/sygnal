// The guest workload, run unchanged in V8 (node) and in QuickJS-in-WASM (quickjs-emscripten).
// Needs the global `Sygnal` (the core bundle, headless-entry.js) and `__now()` (a clock).
// Returns timings and results as JSON.
(function () {
  const { run, renderToString, xs } = Sygnal
  globalThis.queueMicrotask ||= (f) => Promise.resolve().then(f)
  const out = {}

  // 1. headless model + intent: a todo list driven by an input driver, no DOM
  let push
  const in$ = xs.create({ start(l) { push = (v) => l.next(v) }, stop() {} })
  function Todos() { return null }
  Todos.initialState = { items: [], done: 0, nextId: 1 }
  Todos.intent = ({ IN }) => ({ ADD: IN.filter(a => a.t === 'add'), TOGGLE: IN.filter(a => a.t === 'toggle') })
  Todos.model = {
    ADD: (s, a) => ({ ...s, items: s.items.length >= 200 ? s.items.slice(1).concat({ id: s.nextId, text: a.text, done: false }) : s.items.concat({ id: s.nextId, text: a.text, done: false }), nextId: s.nextId + 1 }),
    TOGGLE: (s, a) => { const items = s.items.map(i => i.id === a.id ? { ...i, done: !i.done } : i); return { ...s, items, done: items.filter(i => i.done).length } },
  }
  Todos.context = { open: (s) => s.items.length - s.done }
  let t = __now()
  const app = run(Todos, { IN: () => in$ }, { useDefaultDrivers: false })
  out.startMs = __now() - t
  const N = 10000
  t = __now()
  for (let i = 0; i < N; i++) push(i % 4 === 3 ? { t: 'toggle', id: (i >> 2) * 3 } : { t: 'add', text: 'item ' + i })
  out.actions = N
  out.dispatchMs = __now() - t // synchronous: each action's reducer ran; the flush is a microtask
  out.state = { n: app.__runtime.getState().items.length, done: app.__runtime.getState().done, nextId: app.__runtime.getState().nextId }
  app.dispose()

  // 2. SSR: the benchmark table, 1,000 rows, through renderToString (the pragma + core SSR walk)
  const h = Sygnal.createElement
  function Table({ state }) {
    return h('div', { className: 'container' },
      h('div', { className: 'table' }, state.rows.map(row => h('div', { className: row.id === state.selected ? 'row danger' : 'row', key: row.id, data: { id: row.id } },
        h('span', { className: 'col-id' }, row.id), h('a', { className: 'lbl' }, row.label), h('a', { className: 'remove' }, 'x')))))
  }
  const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, label: 'pretty red table ' + i }))
  let html
  t = __now()
  for (let i = 0; i < 10; i++) html = renderToString(Table, { state: { rows, selected: 2 } })
  out.ssrMs = (__now() - t) / 10
  out.ssrBytes = html.length
  return JSON.stringify(out)
})()
