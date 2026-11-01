// Per-action cost of the core's dispatch path (intent stream -> model table -> STATE write ->
// one flush), headless in node, against the reducer called directly: the most a compiled
// "direct dispatch" (model table and intent resolved at build time) could remove.
//   node dev-plans/research/compile-wasm/dispatch/bench.mjs
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const { run, xs } = await import(pathToFileURL(resolve(import.meta.dirname, '../../../../dist/index.esm.js')).href)

const N = 200000
const INC = (s, d) => ({ ...s, n: s.n + d })
function measure(withContext, withCalc) {
  let push
  const in$ = xs.create({ start(l) { push = (v) => l.next(v) }, stop() {} })
  function C() { return null }
  C.initialState = { n: 0, other: 1 }
  C.intent = ({ IN }) => ({ INC: IN })
  C.model = { INC }
  if (withContext) C.context = { double: (s) => s.n * 2 }
  if (withCalc) C.calculated = { triple: (s) => s.n * 3 }
  const app = run(C, { IN: () => in$ }, { useDefaultDrivers: false })
  for (let i = 0; i < 1000; i++) push(1)
  const t = performance.now()
  for (let i = 0; i < N; i++) push(1)
  const ms = performance.now() - t
  const s = app.__runtime.getState()
  if (s.n !== N + 1000) throw new Error('state ' + s.n)
  app.dispose()
  return ms * 1e6 / N
}
let st = { n: 0, other: 1 }
for (let i = 0; i < 1000; i++) st = INC(st, 1)
const t = performance.now()
for (let i = 0; i < N; i++) st = INC(st, 1)
const direct = (performance.now() - t) * 1e6 / N
const best = (f) => Math.min(f(), f(), f())
console.log(`reducer called directly           ${direct.toFixed(0)} ns/action`)
console.log(`through the core (intent + model)  ${best(() => measure(false, false)).toFixed(0)} ns/action`)
console.log(`  + a context entry                ${best(() => measure(true, false)).toFixed(0)} ns/action`)
console.log(`  + a calculated field             ${best(() => measure(true, true)).toFixed(0)} ns/action`)
console.log('(the synchronous part: each action runs its reducer and commits; the one flush and render are a microtask after the loop)')
