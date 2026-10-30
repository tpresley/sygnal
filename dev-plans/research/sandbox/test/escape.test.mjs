// What a hostile or broken component can't do: reach the page, hang it, exhaust its memory,
// pollute its prototypes, or get markup / URLs / network past the host.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mount, settle} from './helpers.mjs'
import {loadQuickJS} from '../src/sandbox.js'

const fast = {limits: {callMs: 50, bootMs: 1000}}

test('no window, document, storage, network, Node or WASM in the guest', () => {
  const t = mount(`
    const g = Function('return this')()
    const probe = {}
    for (const k of ['window', 'document', 'fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'indexedDB', 'navigator',
      'location', 'process', 'Deno', 'Bun', 'WebAssembly', 'importScripts', 'postMessage', 'SharedArrayBuffer', 'Atomics', 'eval'])
      probe[k] = typeof g[k]
    probe.sameGlobal = g === globalThis
    probe.ctor = typeof ({}).constructor.constructor('return typeof document')()
    probe.dynImport = typeof import.meta
    export default function P() { return <pre className="out">{JSON.stringify(probe)}</pre> }
  `.replace('probe.dynImport = typeof import.meta', ''))
  const probe = JSON.parse(t.$('.out').textContent)
  assert.equal(probe.sameGlobal, true, 'the Function constructor reaches only the guest global')
  for (const k of ['window', 'document', 'fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'indexedDB', 'navigator', 'location', 'process', 'Deno', 'Bun', 'WebAssembly', 'importScripts', 'postMessage'])
    assert.equal(probe[k], 'undefined', k)
  // eval exists, but evaluates in the guest; that's fine (the guest is all untrusted anyway)
  assert.equal(probe.eval, 'function')
})

test('a dynamic import or require of anything but sygnal fails inside the guest', async () => {
  const t = mount(`
    let r1 = 'ok', r2 = 'ok'
    try { require('fs') } catch (e) { r1 = e.message }
    import('node:fs').then(() => { r2 = 'imported' }, (e) => { r2 = 'rejected' })
    export default function P() { return <p className="out">{r1}</p> }
  `)
  assert.match(t.$('.out').textContent, /can't be imported/)
  assert.deepEqual(t.errors, [])
})

test('prototype pollution stays in the guest, and __proto__ in a message stays data', () => {
  const t = mount(`
    export default function P() { return <div><button className="emit">emit</button><button className="pollute">pollute</button></div> }
    P.intent = ({ DOM }) => ({ EMIT: DOM.select('.emit').events('click'), POLLUTE: DOM.select('.pollute').events('click') })
    P.model = {
      EMIT: { EVENTS: () => ({ type: 'X', data: JSON.parse('{"__proto__": {"polluted": "host"}, "constructor": {"prototype": {"polluted": "host"}}}') }) },
      POLLUTE: (s) => { Object.prototype.polluted = 'yes'; Array.prototype.map = () => 'hijacked'; String.prototype.trim = () => 'hijacked'; return s },
    }
  `)
  t.fire('.emit', 'click')
  t.fire('.pollute', 'click')
  assert.equal(({}).polluted, undefined)
  assert.equal([1].map(x => x * 2)[0], 2)
  assert.equal(' a '.trim(), 'a')
  assert.equal(t.emits.length, 1)
  // JSON.parse makes __proto__ an own data property; a spread copies it as data, never as a prototype
  const copy = {...t.emits[0].data}
  assert.equal(copy.polluted, undefined)
  assert.equal(({}).polluted, undefined)
  // (Object.assign({}, data) WOULD set the copy's prototype: hosts spread or structuredClone)
})

test('an endless loop in a reducer: killed at the deadline, the page carries on', () => {
  const t = mount(`
    export default function P() { return <button className="b">go</button> }
    P.intent = ({ DOM }) => ({ GO: DOM.select('.b').events('click') })
    P.model = { GO: (s) => { while (true) {} } }
  `, fast)
  const t0 = performance.now()
  t.fire('.b', 'click')
  const ms = performance.now() - t0
  assert.equal(t.errors[0]?.reason, 'timeout')
  assert.ok(ms < 200, `returned after ${ms.toFixed(0)} ms`)
  assert.equal(t.sb.dead, true)
  assert.equal(t.container.innerHTML, '', 'the dead sandbox leaves nothing behind')
})

test('an endless loop at the top level: killed at boot', () => {
  const t = mount(`for (;;) {}`, fast)
  assert.equal(t.errors[0]?.reason, 'timeout')
})

test('endless promise jobs: killed', () => {
  const t = mount(`
    const spin = () => Promise.resolve().then(spin); spin()
    export default function P() { return <p>x</p> }
  `, fast)
  assert.equal(t.errors[0]?.reason, 'timeout')
})

test('a huge allocation: setMemoryLimit misses ArrayBuffers; a capped instance stops it', async () => {
  const code = `
    export default function P() { return <button className="b">go</button> }
    P.intent = ({ DOM }) => ({ GO: DOM.select('.b').events('click') })
    P.model = { GO: (s) => { const a = []; for (;;) a.push(new Float64Array(1 << 20)) } }
  `
  // the whole linear memory capped at 48 MB (loadQuickJS({maxWasmBytes})): out of memory at once
  const QJS = await loadQuickJS({maxWasmBytes: 48 << 20})
  const t = mount(code, {QJS, limits: {memoryBytes: 16 << 20}})
  const before = process.memoryUsage().rss
  const t0 = performance.now()
  t.fire('.b', 'click')
  const ms = performance.now() - t0
  const grew = (process.memoryUsage().rss - before) / 2 ** 20
  // the core caught the reducer's out-of-memory (SYG216): the sandbox lives on, inside its 48 MB
  assert.ok(t.logs.some(([, m]) => /SYG216.*out of memory/.test(m)), JSON.stringify(t.logs))
  assert.ok(ms < 500, `${ms.toFixed(0)} ms`)
  assert.ok(grew < 64, `rss grew ${grew.toFixed(0)} MB`)
  assert.deepEqual(t.errors, [])
})

test('a string doubling bomb caught by the guest still can\'t grow past the limit', () => {
  const t = mount(`
    let s = 'x', n = 0
    try { for (;;) { s = s + s; n++ } } catch (e) { s = String(e) }
    export default function P() { return <p className="out">{n}:{s.slice(0, 40)}</p> }
  `, {limits: {memoryBytes: 16 << 20}})
  // the guest caught the error (QuickJS's string length cap or out-of-memory): it lives on, at most 16 MB
  assert.match(t.$('.out').textContent, /out of memory|string too long/)
  assert.ok(t.sb.memory().memory_used_size <= 16 << 20)
})

test('deep recursion: a stack overflow, not a host crash', () => {
  const t = mount(`
    const f = (n) => f(n + 1) + 1
    export default function P() { return <button className="b">go</button> }
    P.intent = ({ DOM }) => ({ GO: DOM.select('.b').events('click') })
    P.model = { GO: (s) => f(0) }
  `)
  t.fire('.b', 'click')
  // the core reports a throwing reducer and keeps the state; the sandbox lives on
  assert.deepEqual(t.errors, [])
  assert.ok(t.logs.some(([, m]) => /SYG216.*stack overflow/i.test(m)), JSON.stringify(t.logs))
})

test('timer flood: capped; a busy interval: killed for its CPU share', async () => {
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
  flood.fire('.out', 'click')
  assert.match(flood.$('.out').textContent, /^64 sandbox: more than 64 timers/)
  assert.deepEqual(flood.errors, [], 'the core\'s own hop (setImmediate) has its own channel')
  flood.sb.dispose()

  const busy = mount(`
    setInterval(() => { const t = Date.now(); while (Date.now() - t < 30) {} }, 5)
    export default function P() { return <p>busy</p> }
  `, {limits: {cpuShare: 0.25, callMs: 100}})
  await settle(1500)
  assert.equal(busy.errors[0]?.reason, 'cpu')
})

test('a hostile render message: sanitized markup, or killed when malformed', async () => {
  const t = mount(`
    setTimeout(() => __host.render(JSON.stringify({ types: ['click'], tree: [
      { i: 1, t: 'div', a: { onclick: 'alert(1)', class: 'ok', id: 'main', style: 'x' }, s: { background: 'url(https://evil.example/x)', color: 'red', 'position': 'fixed' }, c: [
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
  await settle(20)
  const html = t.container.innerHTML
  assert.doesNotMatch(html, /script|iframe|onclick|srcdoc|javascript:|evil|action|password|url\(|svg/i, html)
  assert.match(html, /href="https:\/\/example.com\/ok" rel="noopener noreferrer" target="_blank"/)
  assert.match(html, /id="sbx\d+-main"/)
  assert.match(html, /for="sbx\d+-main"/)
  assert.match(html, /style="color: red; position: fixed"/)
  assert.ok(t.sb.violations.length >= 8, JSON.stringify(t.sb.violations))
  assert.deepEqual(t.errors, [])

  for (const tree of [
    '[{"i":1,"t":"div","a":{},"c":[{"i":2,"t":"div","a":{},"c":[1]}]}]',          // a node inside itself
    JSON.stringify([JSON.parse('{"i":1,"t":"div","a":{},"c":[]}')].concat(Array.from({length: 6000}, (_, i) => ({i: i + 2, x: 'x'})))),
    '"not a tree"x',
  ]) {
    const bad = mount(`setTimeout(() => __host.render(${JSON.stringify(JSON.stringify({tree: '@'}))}.replace('"@"', ${JSON.stringify(tree)})), 0)\nexport default function P() { return null }`)
    await settle(20)
    assert.equal(bad.errors[0]?.reason, 'protocol', tree.slice(0, 40))
  }
})

test('a link click never navigates the page; it asks the navigate capability', () => {
  const asked = []
  const t = mount(`export default function P() { return <a className="l" href="https://example.com/doc">doc</a> }`, {capabilities: {navigate: (h) => asked.push(h)}})
  const e = t.fire('.l', 'click')
  assert.equal(e.defaultPrevented, true)
  assert.deepEqual(asked, ['https://example.com/doc'])

  // a link the guest handles itself (preventDefault in its intent): no navigate
  const u = mount(`
    export default function P({ state }) { return <a className="l" href="https://example.com/x">{state.n}</a> }
    P.initialState = { n: 0 }
    P.intent = ({ DOM }) => ({ GO: DOM.select('.l').events('click').map(e => e.preventDefault()) })
    P.model = { GO: (s) => ({ n: s.n + 1 }) }
  `, {capabilities: {navigate: (h) => asked.push(h)}})
  assert.equal(u.fire('.l', 'click').defaultPrevented, true)
  assert.equal(u.$('.l').textContent, '1')
  assert.equal(asked.length, 1)
})
