// The same guest kernel in an SES Compartment after lockdown(): does Sygnal run on frozen
// intrinsics, and what do boot and a dispatch cost? (bench.mjs runs this in a child process.)
import 'ses'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {compile} from '../src/compile.js'

const t0 = performance.now()
lockdown({errorTaming: 'unsafe', overrideTaming: 'severe', consoleTaming: 'unsafe'})
const lockMs = performance.now() - t0
const kernel = readFileSync(resolve(import.meta.dirname, '../dist/guest.js'), 'utf8')
let tree
const host = harden({render: (j) => { tree = j }, emit() {}, log() {}, timer() {}, clearTimer() {}, fetch() {}})
const t1 = performance.now()
// Compartments' Date.now() and Math.random() throw (secure mode); the core needs Date.now()
// (HostEvent timestamps, the fetch driver): a sandbox must grant the clock explicitly
const c = new Compartment({globals: {__host: host, Date, Math}, __options__: true})
let result = 'ok'
try {
  c.evaluate(kernel)
  c.evaluate(compile(`export default function C({ state }) { return <div><button className="inc">+</button><span>{state.n}</span></div> }
C.initialState = { n: 0 }
C.intent = ({ DOM }) => ({ INC: DOM.select('.inc').events('click') })
C.model = { INC: (s) => ({ n: s.n + 1 }) }`))
  c.evaluate('__sandbox.start("")')
  await new Promise(r => setTimeout(r, 0))
  c.evaluate('__sandbox.flush()')
} catch (e) { result = 'failed: ' + e.message }
const bootMs = performance.now() - t1
let rtt = null
if (result === 'ok' && tree) {
  const id = JSON.parse(tree).tree[0].c[0].i
  const dispatch = c.evaluate('__sandbox.dispatch')
  const times = []
  const flush = c.evaluate('__sandbox.flush')
  for (let i = 0; i < 1000; i++) { const t = performance.now(); dispatch(id, 'click', '{}'); for (let k = 0; k < 4; k++) await null; flush(); times.push(performance.now() - t) }
  times.sort((a, b) => a - b)
  rtt = times[500]
}
console.log(JSON.stringify({lockdownMs: +lockMs.toFixed(2), compartmentBootMs: +bootMs.toFixed(2), result, rendered: !!tree, dispatchMedianMs: rtt && +rtt.toFixed(4)}))
