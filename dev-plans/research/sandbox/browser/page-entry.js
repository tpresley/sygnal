// The browser benchmark page (bench-browser.mjs bundles it): a real DOM, real events.
import {loadQuickJS, createSandbox} from '../src/sandbox.js'
import {createWorkerSandbox, webWorkerSpawner} from '../src/worker-sandbox.js'

const med = (a) => { const s = [...a].sort((x, y) => x - y); return +s[s.length >> 1].toFixed(3) }
const p95 = (a) => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length * 0.95)].toFixed(3) }
const now = () => performance.now()
const tick = () => new Promise(r => setTimeout(r, 0))
const box = () => document.body.appendChild(document.createElement('div'))

window.__api = {loadQuickJS, createSandbox}
async function main() {
  if (location.hash === '#debug') return
  const R = {userAgent: navigator.userAgent, shadowRealm: typeof globalThis.ShadowRealm}
  const [kernel, comps] = await Promise.all([fetch('guest.js').then(r => r.text()), fetch('components.json').then(r => r.json())])

  // cold: fetch + compile the .wasm, instantiate with a capped memory, boot a counter
  let t = now()
  const bytes = await fetch('quickjs.wasm').then(r => r.arrayBuffer())
  R.fetchWasmMs = now() - t
  t = now()
  const mod = await WebAssembly.compile(bytes)
  R.compileMs = now() - t
  t = now()
  const QJS = await loadQuickJS({wasm: mod, maxWasmBytes: 64 << 20})
  R.instantiateMs = now() - t
  const boots = []
  for (let i = 0; i < 10; i++) { const sb = createSandbox(QJS, {kernel, source: comps.counter, container: box()}); boots.push(sb.stats.bootMs); sb.dispose() }
  R.bootCounterMs = med(boots)
  const rb = []
  for (let i = 0; i < 5; i++) { const sb = createSandbox(QJS, {kernel, source: comps.rows, container: box()}); rb.push(sb.stats.bootMs); sb.dispose() }
  R.bootRowsMs = med(rb)

  // per event, in-thread: el.click() → listener → guest → render applied, synchronously
  for (const [name, src, sel] of [['counter', comps.counter, '.inc'], ['rows', comps.rows, '.t']]) {
    const c = box()
    const sb = createSandbox(QJS, {kernel, source: src, container: c, limits: {cpuShare: 1e9}})
    const els = [...c.querySelectorAll(sel)], times = []
    // a macrotask every 100 clicks: the core's loop guard defers a flush after ~1000 in one task
    for (let i = 0; i < 1000; i++) { if (i % 100 == 99) await tick(); const el = els[i % els.length]; const t0 = now(); el.click(); times.push(now() - t0) }
    await tick()
    R['inThread_' + name] = {median: med(times.slice(100)), p95: p95(times.slice(100)), after: c.querySelector('.n').textContent}
    sb.dispose(); c.remove()
  }

  // worker sandbox: create → first paint; click → render applied
  const spawn = webWorkerSpawner('worker.js')
  for (const [name, src, sel] of [['counter', comps.counter, '.inc'], ['rows', comps.rows, '.t']]) {
    const c = box()
    let rendered, ready
    const readyP = new Promise(r => { ready = r })
    const t0 = now()
    const sb = createWorkerSandbox({spawn, kernel, source: src, container: c, wasm: bytes, onReady: ready, onRender: () => rendered?.(), limits: {cpuShare: 1e9}})
    const st = await readyP
    while (!c.querySelector(sel)) await tick()
    const first = now() - t0
    const times = []
    for (let i = 0; i < 300; i++) {
      const els = [...c.querySelectorAll(sel)]
      const p = new Promise(r => { rendered = r })
      const t1 = now(); els[i % els.length].click(); await p; times.push(now() - t1)
    }
    R['worker_' + name] = {firstPaintMs: first, workerReadyMs: st.readyMs, workerInstantiateMs: st.wasmMs, workerBootMs: st.bootMs, median: med(times.slice(30)), p95: p95(times.slice(30)), after: c.querySelector('.n').textContent}
    sb.dispose(); c.remove()
  }

  // baselines: a bare Worker echo, a sandboxed iframe echo (creation and round trip)
  {
    const url = URL.createObjectURL(new Blob(['onmessage = (e) => postMessage(e.data)'], {type: 'text/javascript'}))
    let t1 = now(); const w = new Worker(url)
    await new Promise(r => { w.onmessage = r; w.postMessage(0) }); R.workerEchoFirstMs = now() - t1
    const times = []
    for (let i = 0; i < 500; i++) { const t2 = now(); await new Promise(r => { w.onmessage = r; w.postMessage(i) }); times.push(now() - t2) }
    R.workerEcho = {median: med(times.slice(50)), p95: p95(times.slice(50))}
    w.terminate()
  }
  {
    const f = document.createElement('iframe')
    f.setAttribute('sandbox', 'allow-scripts')
    f.srcdoc = '<script>onmessage = (e) => parent.postMessage(e.data, "*")<\/script>'
    let t1 = now()
    const loaded = new Promise(r => { f.onload = r })
    document.body.appendChild(f)
    await loaded
    R.iframeLoadMs = now() - t1
    const times = []
    for (let i = 0; i < 500; i++) {
      const t2 = now()
      await new Promise(r => { window.onmessage = (e) => e.source === f.contentWindow && r(); f.contentWindow.postMessage(i, '*') })
      times.push(now() - t2)
    }
    R.iframeEcho = {median: med(times.slice(50)), p95: p95(times.slice(50))}
    f.remove()
  }
  // a hostile loop in the in-thread sandbox, in the browser: how long the page is frozen
  {
    const c = box()
    const sb = createSandbox(QJS, {kernel, source: comps.looper, container: c, limits: {callMs: 100}})
    const t1 = now(); c.querySelector('.spin').click(); R.inThreadLoopKilledMs = now() - t1
    R.inThreadLoopDead = sb.dead
  }
  window.__results = R
}
main().catch((e) => { window.__results = {error: String(e && e.stack || e)} })
