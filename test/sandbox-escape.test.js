// @vitest-environment jsdom
// sygnal/sandbox: what a hostile or broken component can't do: reach the page, hang it, exhaust its
// memory, crash the WASM module for others, pollute its prototypes, or get markup / URLs / network
// past the page. The README's three security findings each have a test here (§Summary):
//   1. setMemoryLimit() doesn't cap ArrayBuffers → an instance per sandbox with a capped Memory
//   2. the deadline only stops accidents → the Worker's watchdog (test/sandbox-worker.test.js)
//   3. a stack over ~384 KB crashes the module → 256 KB default, larger refused, a crash poisons
//      only its own instance
import { describe, it, expect, afterEach } from 'vitest'
import { mount, settle, compile, kernel } from './fixtures/sandbox-helpers.js'
import { loadQuickJS, poisoned, createSandbox, DEFAULT_LIMITS } from '../src/sandbox.ts'
import { createEngine } from '../src/sandbox/engine.ts'
import { limitsOf } from '../src/sandbox/protocol.ts'

afterEach(() => { document.body.innerHTML = '' })
const fast = { limits: { callMs: 50, bootMs: 1000 } }

describe('sygnal/sandbox: escapes', () => {
  it('no window, document, storage, network, Node or WASM in the guest', async () => {
    const t = mount(`
      const g = Function('return this')()
      const probe = {}
      for (const k of ['window', 'document', 'fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'indexedDB', 'navigator',
        'location', 'process', 'Deno', 'Bun', 'WebAssembly', 'importScripts', 'postMessage', 'SharedArrayBuffer', 'Atomics', 'performance'])
        probe[k] = typeof g[k]
      probe.sameGlobal = g === globalThis
      probe.ctor = ({}).constructor.constructor('return typeof document')()
      export default function P() { return <pre className="out">{JSON.stringify(probe)}</pre> }
    `)
    await t.ready()
    const probe = JSON.parse(t.$('.out').textContent)
    expect(probe.sameGlobal).toBe(true)
    expect(probe.ctor).toBe('undefined')
    for (const k of ['window', 'document', 'fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'indexedDB', 'navigator', 'location', 'process', 'Deno', 'Bun', 'WebAssembly', 'importScripts', 'postMessage', 'performance'])
      expect(probe[k], k).toBe('undefined')
  })

  it('a dynamic import or require of anything but sygnal fails inside the guest', async () => {
    const t = mount(`
      let r1 = 'ok'
      try { require('fs') } catch (e) { r1 = e.message }
      export default function P() { return <p className="out">{r1}</p> }
    `)
    await t.ready()
    expect(t.$('.out').textContent).toMatch(/can't be imported/)
    expect(t.errors).toEqual([])
  })

  it('prototype pollution stays in the guest; __proto__ in a message stays data', async () => {
    const t = mount(`
      export default function P() { return <div><button className="emit">emit</button><button className="pollute">pollute</button></div> }
      P.intent = ({ DOM }) => ({ EMIT: DOM.select('.emit').events('click'), POLLUTE: DOM.select('.pollute').events('click') })
      P.model = {
        EMIT: { EVENTS: () => ({ type: 'X', data: JSON.parse('{"__proto__": {"polluted": "host"}, "constructor": {"prototype": {"polluted": "host"}}}') }) },
        POLLUTE: (s) => { Object.prototype.polluted = 'yes'; Array.prototype.map = () => 'hijacked'; return s },
      }
    `)
    await t.ready()
    t.fire('.emit', 'click')
    t.fire('.pollute', 'click')
    expect(({}).polluted).toBe(undefined)
    expect([1].map((x) => x * 2)[0]).toBe(2)
    expect(t.emits.length).toBe(1)
    const data = t.emits[0].data
    expect(Object.getPrototypeOf(data)).toBe(Object.prototype)
    expect({ ...data }.polluted).toBe(undefined)
  })

  it('an endless loop in a reducer: killed at the deadline; the dead sandbox leaves nothing behind', async () => {
    const t = mount(`
      export default function P() { return <button className="b">go</button> }
      P.intent = ({ DOM }) => ({ GO: DOM.select('.b').events('click') })
      P.model = { GO: (s) => { while (true) {} } }
    `, fast)
    await t.ready()
    const t0 = performance.now()
    t.fire('.b', 'click')
    expect(performance.now() - t0).toBeLessThan(300)
    expect(t.errors[0]?.reason).toBe('timeout')
    expect(t.sb.dead).toBe(true)
    expect(t.container.innerHTML).toBe('')
  })

  it('an endless loop at the top level, or endless promise jobs: killed at boot', async () => {
    const a = mount(`for (;;) {}`, fast)
    const b = mount(`const spin = () => Promise.resolve().then(spin); spin(); export default function P() { return <p>x</p> }`, fast)
    await expect(a.sb.ready).rejects.toMatchObject({ reason: 'timeout' })
    await b.ready()
    expect(a.errors[0]?.reason).toBe('timeout')
    expect(b.errors[0]?.reason).toBe('timeout')
  })

  it('timer flood: capped; a busy interval: killed for its CPU share', async () => {
    const flood = mount(`
      export default function P({ state }) { return <button className="out">{state.n} {state.err}</button> }
      P.initialState = { n: 0, err: '' }
      P.intent = ({ DOM }) => ({ GO: DOM.select('.out').events('click') })
      P.model = { GO: (s) => {
        let n = 0, err = ''
        try { for (let i = 0; i < 1000; i++) { setTimeout(() => {}, 1000); n++ } } catch (e) { err = e.message }
        return { n, err }
      } }
    `)
    await flood.ready()
    flood.fire('.out', 'click')
    expect(flood.$('.out').textContent).toMatch(/^64 sandbox: more than 64 timers/)
    expect(flood.errors).toEqual([])
    flood.sb.dispose()

    const busy = mount(`
      setInterval(() => { const t = Date.now(); while (Date.now() - t < 30) {} }, 5)
      export default function P() { return <p>busy</p> }
    `, { limits: { cpuShare: 0.25, callMs: 100 } })
    await busy.ready()
    await settle(1500)
    expect(busy.errors[0]?.reason).toBe('cpu')
  })

  it('a hostile render message: sanitized markup, or killed when malformed', async () => {
    const t = mount(`
      setTimeout(() => __host.render(JSON.stringify({ v: 1, types: ['click'], tree: [
        { i: 1, t: 'div', a: { onclick: 'alert(1)', class: 'ok', id: 'main', style: 'x' }, s: { background: 'url(https://evil.example/x)', color: 'red', position: 'fixed' }, c: [
          { i: 2, t: 'script', a: {}, c: [{ i: 3, x: 'alert(1)' }] },
          { i: 4, t: 'iframe', a: { srcdoc: '<script>alert(1)</script>' }, c: [] },
          { i: 5, t: 'a', a: { href: 'javascript:alert(1)' }, c: [{ i: 6, x: 'js' }] },
          { i: 7, t: 'a', a: { href: 'https://example.com/ok' }, c: [{ i: 8, x: 'ok' }] },
          { i: 9, t: 'img', a: { src: 'https://evil.example/pixel?cookie=1' }, c: [] },
          { i: 10, t: 'form', a: { action: 'https://evil.example', name: 'cookie' }, c: [{ i: 11, t: 'input', a: { type: 'password', name: 'pw', formaction: 'https://evil.example' }, c: [] }] },
          { i: 12, t: 'label', a: { for: 'main' }, c: [] },
          { i: 13, t: 'svg', a: {}, c: [] },
        ] }] })), 0)
      export default function P() { return null }
    `)
    await t.ready()
    await settle(20)
    const html = t.container.innerHTML
    expect(html).not.toMatch(/script|iframe|onclick|srcdoc|javascript:|evil|action|password|url\(|svg/i)
    expect(html).toMatch(/href="https:\/\/example.com\/ok" rel="noopener noreferrer" target="_blank"/)
    expect(html).toMatch(/id="sbx\d+-main"/)
    expect(html).toMatch(/for="sbx\d+-main"/)
    expect(html).toMatch(/style="color: red; position: fixed;?"/)
    expect(t.sb.violations.length).toBeGreaterThanOrEqual(8)
    expect(t.errors).toEqual([])

    for (const tree of [
      '[{"i":1,"t":"div","a":{},"c":[{"i":2,"t":"div","a":{},"c":[1]}]}]',
      JSON.stringify([{ i: 1, t: 'div', a: {}, c: [] }].concat(Array.from({ length: 6000 }, (_, i) => ({ i: i + 2, x: 'x' })))),
    ]) {
      const bad = mount(`setTimeout(() => __host.render(JSON.stringify({ v: 1, types: [], tree: ${tree} })), 0)\nexport default function P() { return null }`)
      await bad.ready()
      await settle(20)
      expect(bad.errors[0]?.reason, tree.slice(0, 40)).toBe('protocol')
    }
    const wrong = mount(`setTimeout(() => __host.render('{"v": 2, "tree": []}'), 0)\nexport default function P() { return null }`)
    await wrong.ready()
    await settle(20)
    expect(wrong.errors[0]?.reason).toBe('protocol')
  })

  it('a link click never navigates the page; it asks the navigate capability', async () => {
    const asked = []
    const t = mount(`export default function P() { return <a className="l" href="https://example.com/doc">doc</a> }`, { capabilities: { navigate: (h) => asked.push(h) } })
    await t.ready()
    expect(t.fire('.l', 'click').defaultPrevented).toBe(true)
    expect(asked).toEqual(['https://example.com/doc'])
  })

  it('the guest\'s elements never trigger the page\'s delegated listeners', async () => {
    let hits = 0
    document.body.addEventListener('click', (e) => { if (e.target.closest('.danger')) hits++ })
    const t = mount(`export default function P() { return <button className="danger">x</button> }`)
    await t.ready()
    t.fire('.danger', 'click')
    expect(hits).toBe(0)
  })

  it('fetch: the allowlist, GET only, credentials omitted, no redirects', async () => {
    const calls = []
    const impl = async (url, init) => { calls.push([url, init.method, init.credentials, init.redirect]); return new Response(JSON.stringify({ ok: 1 }), { headers: { 'content-type': 'application/json' } }) }
    const t = mount(`
      import { ABORT } from 'sygnal'
      const denied = ['https://user:pw@api.example.com/v1/x', 'https://api.example.com/v1/post']
      export default function F({ state }) { return <p className="out">{state.got}</p> }
      F.initialState = { got: '', n: 0 }
      F.model = {
        BOOTSTRAP: { HTTP: () => ({ url: 'https://api.example.com/v1/x', ok: 'GOT', error: 'BAD' }) },
        GOT: {
          STATE: (s, d) => ({ ...s, got: s.got + 'ok:' + JSON.stringify(d) + ' ' }),
          HTTP: () => ({ url: 'https://api.example.com.evil.example/v1/steal', error: 'BAD' }),
        },
        BAD: {
          STATE: (s) => ({ got: s.got + 'denied ', n: s.n + 1 }),
          HTTP: (s) => (s.n <= denied.length ? { url: denied[s.n - 1], method: s.n == 2 ? 'POST' : 'GET', body: { a: 1 }, error: 'BAD' } : ABORT),
        },
      }
    `, { capabilities: { fetch: { allow: ['https://api.example.com/v1/'], impl } } })
    await t.ready()
    await settle(50)
    expect(calls).toEqual([['https://api.example.com/v1/x', 'GET', 'omit', 'error']])
    expect(t.$('.out').textContent).toMatch(/^ok:\{"ok":1\} (denied ){3}$/)
  })
})

describe('sygnal/sandbox: the three security findings', () => {
  it('finding 1: a guest filling ArrayBuffers is stopped by its capped instance within milliseconds', async () => {
    // QuickJS's setMemoryLimit() doesn't count ArrayBuffer storage: on a shared module (no cap)
    // the same guest grew the host to 2-4 GB in seconds (README §5.4). The default is a fresh
    // instance whose whole WebAssembly.Memory is capped (limits.maxWasmBytes, 64 MB).
    expect(DEFAULT_LIMITS.maxWasmBytes).toBe(64 << 20)
    const t = mount(`
      export default function P() { return <button className="b">go</button> }
      P.intent = ({ DOM }) => ({ GO: DOM.select('.b').events('click') })
      P.model = { GO: (s) => { const a = []; for (;;) a.push(new Float64Array(1 << 20)) } }
    `, { limits: { memoryBytes: 16 << 20, maxWasmBytes: 48 << 20 } })
    await t.ready()
    const before = process.memoryUsage().rss
    const t0 = performance.now()
    t.fire('.b', 'click')
    const ms = performance.now() - t0
    const grew = (process.memoryUsage().rss - before) / 2 ** 20
    // the core caught the reducer's out-of-memory (SYG216): the sandbox lives on, inside its cap
    expect(t.logs.some(([, m]) => /SYG216.*out of memory/.test(m)), JSON.stringify(t.logs)).toBe(true)
    expect(ms).toBeLessThan(1000)
    expect(grew).toBeLessThan(96)
    expect(t.errors).toEqual([])
    expect(t.sb.dead).toBe(false)
  })

  it('finding 3: deep recursion is a guest stack overflow at the default 256 KB, never a host crash', async () => {
    expect(DEFAULT_LIMITS.stackBytes).toBe(256 << 10)
    const t = mount(`
      const f = (n) => f(n + 1) + 1
      export default function P() { return <button className="b">go</button> }
      P.intent = ({ DOM }) => ({ GO: DOM.select('.b').events('click') })
      P.model = { GO: (s) => f(0) }
    `)
    await t.ready()
    t.fire('.b', 'click')
    expect(t.errors).toEqual([])
    expect(t.logs.some(([, m]) => /SYG216.*stack overflow/i.test(m)), JSON.stringify(t.logs)).toBe(true)
    // a larger stack is refused: above ~384 KB the host's stack can overflow first
    expect(() => limitsOf({ stackBytes: 512 << 10 })).toThrow(RangeError)
  })

  it('finding 3: a crash poisons only its own instance; the module is refused, other sandboxes run on', async () => {
    // bypass the 384 KB guard (limitsOf) to provoke the crash it exists for: at 1 MB, V8's own
    // stack gives out in the middle of a QuickJS call (a host RangeError, not a guest error)
    const QJS = await loadQuickJS()
    const other = mount(`export default function P({ state }) { return <button className="ok">{state.n}</button> }
      P.initialState = { n: 0 }
      P.intent = ({ DOM }) => ({ GO: DOM.select('.ok').events('click') })
      P.model = { GO: (s) => ({ n: s.n + 1 }) }`)
    const container = document.body.appendChild(document.createElement('div'))
    const errors = []
    createEngine(QJS, {
      kernel, source: compile(`
        const f = (n) => f(n + 1) + 1
        let r = ''; try { f(0) } catch (e) { r = String(e) }
        export default function P() { return <p>{r}</p> }
      `), container, limits: { ...limitsOf(), stackBytes: 1 << 20 }, log: () => {}, onError: (x) => errors.push(x),
    })
    expect(errors.map((x) => x.reason)).toEqual(['crash'])
    expect(poisoned.has(QJS)).toBe(true)
    expect(container.innerHTML).toBe('')
    await expect(createSandbox({ kernel, source: '', container, isolation: 'thread', quickjs: QJS }).ready).rejects.toMatchObject({ reason: 'crash', message: expect.stringMatching(/crashed earlier/) })
    // every other sandbox has its own instance: untouched
    await other.ready()
    other.fire('.ok', 'click')
    expect(other.$('.ok').textContent).toBe('1')
    expect(other.errors).toEqual([])
  })
})
