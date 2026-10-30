// The worker sandbox: the same guest, with QuickJS in a worker_thread and a watchdog that
// terminates it. Here a loop over a slow builtin, which outruns the in-thread deadline, is stopped.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import {createWorkerSandbox, nodeWorkerSpawner} from '../src/worker-sandbox.js'
import {compile} from '../src/compile.js'
import {kernel, settle} from './helpers.mjs'

const spawn = await nodeWorkerSpawner(new URL('../src/worker-entry.js', import.meta.url))
const until = async (f, ms = 3000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await settle(2) } }

function mountW(code, opts = {}) {
  const {window} = new JSDOM('<!doctype html><div id="app"></div>')
  const container = window.document.getElementById('app')
  const errors = [], emits = []
  let ready = false
  const sb = createWorkerSandbox({spawn, kernel, source: compile(code), container, ...opts,
    capabilities: {...opts.capabilities, onEmit: (e) => emits.push(e)},
    onReady: () => { ready = true }, onError: (e) => errors.push(e)})
  const $ = (s) => container.querySelector(s)
  const click = (s) => $(s).dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true}))
  return {sb, $, click, errors, emits, container, window, ready: () => until(() => ready && $('*'))}
}

test('renders and round-trips events through the worker', async () => {
  const t = mountW(`
    export default function C({ state }) { return <div><button className="inc">+</button><span className="n">{state.n}</span></div> }
    C.initialState = { n: 0 }
    C.intent = ({ DOM }) => ({ INC: DOM.select('.inc').events('click') })
    C.model = { INC: { STATE: (s) => ({ n: s.n + 1 }), EVENTS: (s) => ({ type: 'COUNT', data: s.n }) } }
  `)
  await t.ready()
  t.click('.inc'); t.click('.inc')
  await until(() => t.$('.n')?.textContent === '2')
  assert.deepEqual(t.emits.map(e => e.data), [1, 2])
  t.sb.dispose()
})

test('a loop over a slow builtin: the watchdog terminates the worker; the page never stalls', async () => {
  const t = mountW(`
    const o = []; for (let i = 0; i < 1e4; i++) o.push({ i, s: 'x'.repeat(50) })
    export default function P() { return <button className="b">go</button> }
    P.intent = ({ DOM }) => ({ GO: DOM.select('.b').events('click') })
    P.model = { GO: (s) => { for (;;) JSON.parse(JSON.stringify(o)) } }
  `, {limits: {hardMs: 300}})
  await t.ready()
  const t0 = performance.now()
  let ticks = 0
  const iv = setInterval(() => ticks++, 10)
  t.click('.b')
  await until(() => t.errors.length, 5000)
  clearInterval(iv)
  const ms = performance.now() - t0
  assert.equal(t.errors[0].reason, 'timeout')
  assert.ok(ms < 1000, `stopped after ${ms.toFixed(0)} ms`)
  assert.ok(ticks > ms / 10 / 3, `the page's own timers kept running (${ticks} ticks in ${ms.toFixed(0)} ms)`)
  assert.equal(t.container.innerHTML, '')
})

test('fetch goes through the page: allowlisted, credentials omitted', async () => {
  const calls = []
  const impl = async (url, init) => { calls.push([url, init.credentials]); return new Response(JSON.stringify({ok: 1}), {headers: {'content-type': 'application/json'}}) }
  const t = mountW(`
    export default function F({ state }) { return <p className="out">{state.got}</p> }
    F.initialState = { got: '' }
    F.model = {
      BOOTSTRAP: { HTTP: () => ({ url: 'https://api.example.com/v1/x', ok: 'GOT', error: 'BAD' }) },
      GOT: {
        STATE: (s, d) => ({ got: s.got + 'ok:' + JSON.stringify(d) + ' ' }),
        HTTP: () => ({ url: 'https://api.example.com.evil.example/v1/steal', error: 'BAD' }),
      },
      BAD: (s, e) => ({ got: s.got + 'denied:' + e.error.message + ' ' }),
    }
  `, {capabilities: {fetch: {allow: ['https://api.example.com/v1/'], impl}}})
  await t.ready()
  await until(() => /ok:.*denied:/.test(t.$('.out')?.textContent || ''))
  assert.deepEqual(calls, [['https://api.example.com/v1/x', 'omit']])
  t.sb.dispose()
})
