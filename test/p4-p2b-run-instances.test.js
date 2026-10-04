// @vitest-environment jsdom
// PLAN-4 P-2b G-212: run() is per instance. Two apps on one page (or a host app plus
// 'sygnal/element' custom elements, each a run()) must not interfere through page-wide state:
//   1. HMR: an app's hmr() keeps its own state, never the state another app persisted;
//      an app started while another one is hot-swapping doesn't start from that app's state
//   2. DevTools: the first live app stays registered (window.__SYGNAL_DEVTOOLS_APP__) when a
//      second one starts, follows its own hot swaps, and is unregistered when disposed
//   3. Diagnostics: run() without the `diagnostics` option keeps the mode another live app
//      set (with no live app it still resets to the defaults: diagnostics-core tests)
import { describe, it, expect, afterEach } from 'vitest'
import run from '../src/extra/run.js'
import { createElement as h } from '../src/pragma/index.js'
import { configureDiagnostics, getDiagnosticsMode, _resetDiagnostics } from '../src/extra/diagnostics/index.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (cond, what, ms = 2000) => {
  for (const end = Date.now() + ms; !cond(); await sleep(5)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
  }
}
const text = sel => document.querySelector(sel)?.textContent

function Counter({ state }) {
  return h('div', null, h('span', { className: 'label' }, state.label), h('b', null, String(state.count)))
}
Counter.initialState = { label: 'A', count: 1 }

function CounterV2({ state }) {
  return h('div', null, h('i', null, 'v2 ' + state.label), h('b', null, String(state.count)))
}

function Other({ state }) {
  return h('p', null, state.name + ':' + state.n)
}
Other.initialState = { name: 'B', n: 100 }

const apps = []
const start = (App, mountPoint, options = {}) => {
  const app = run(App, {}, { mountPoint, ...options })
  apps.push(app)
  return app
}

afterEach(async () => {
  for (const a of apps.splice(0)) { try { a.dispose() } catch (_) {} }
  document.body.innerHTML = ''
  delete window.__SYGNAL_HMR_UPDATING
  delete window.__SYGNAL_HMR_STATE
  delete window.__SYGNAL_HMR_PERSISTED_STATE
  delete window.__SYGNAL_DEVTOOLS_APP__
  _resetDiagnostics()
  await sleep(150)   // let a swap's HMR window (100 ms) close
})

describe('G-212: HMR state is per app', () => {
  it("hmr() keeps the app's own state, not the state another app persisted later", async () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>'
    const a = start(Counter, '#a', { diagnostics: 'off' })
    await until(() => text('#a b') === '1', 'app A')
    a.sinks.STATE.shamefullySendNext(s => ({ ...s, count: 7 }))
    await until(() => text('#a b') === '7', 'app A count 7')

    // a second app starts and changes its state after A's last change
    const b = start(Other, '#b')
    await until(() => text('#b p') === 'B:100', 'app B')
    b.sinks.STATE.shamefullySendNext(s => ({ ...s, n: 101 }))
    await until(() => text('#b p') === 'B:101', 'app B 101')

    a.hmr(CounterV2)
    await until(() => !!document.querySelector('#a i'), 'A swapped')
    await sleep(40)
    expect(text('#a i')).toBe('v2 A')
    expect(text('#a b')).toBe('7')
    expect(text('#b p')).toBe('B:101')
  })

  it("an app started while another app is hot-swapping doesn't start from that app's state", async () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>'
    const a = start(Counter, '#a', { diagnostics: 'off' })
    await until(() => text('#a b') === '1', 'app A')
    a.sinks.STATE.shamefullySendNext(s => ({ ...s, count: 5 }))
    await until(() => text('#a b') === '5', 'app A count 5')

    // B starts inside A's swap window (G-216: the swap is A's own __hmr source)
    a.hmr(Counter)
    const b = start(Other, '#b')
    await sleep(40)
    const bState = b.sources.STATE.stream._v
    expect(bState?.label).toBeUndefined()
    expect(bState?.count).toBeUndefined()
  })
})

describe('G-212: DevTools registration with several apps', () => {
  it('the first app stays registered when a second one starts', async () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>'
    const a = start(Counter, '#a', { diagnostics: 'off' })
    start(Other, '#b')
    expect(window.__SYGNAL_DEVTOOLS_APP__).toBe(a)
  })

  it("the registered app's STATE sink follows its own hot swaps; dispose unregisters it", async () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>'
    const a = start(Counter, '#a', { diagnostics: 'off' })
    await until(() => text('#a b') === '1', 'app A')
    const b = start(Other, '#b')
    await until(() => text('#b p') === 'B:100', 'app B')

    a.hmr(CounterV2)
    await until(() => !!document.querySelector('#a i'), 'A swapped')
    await sleep(40)
    // time travel through the registered app reaches A (the fallback the bridge uses)
    window.__SYGNAL_DEVTOOLS_APP__.sinks.STATE.shamefullySendNext(() => ({ label: 'A', count: 42 }))
    await until(() => text('#a b') === '42', 'A time-travelled')
    expect(text('#b p')).toBe('B:100')

    // B's swap leaves A registered
    b.hmr(Other)
    await sleep(40)
    window.__SYGNAL_DEVTOOLS_APP__.sinks.STATE.shamefullySendNext(() => ({ label: 'A', count: 43 }))
    await until(() => text('#a b') === '43', 'A still registered')

    a.dispose()
    apps.splice(apps.indexOf(a), 1)
    expect(window.__SYGNAL_DEVTOOLS_APP__ === a).toBe(false)
    expect(window.__SYGNAL_DEVTOOLS_APP__?.sinks?.STATE).not.toBe(a.sinks.STATE)
  })
})

describe('G-212: diagnostics config with several apps', () => {
  it("run() without the option keeps the mode a live app set", () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>'
    start(Counter, '#a', { diagnostics: 'collect' })
    expect(getDiagnosticsMode()).toBe('collect')
    start(Other, '#b')
    expect(getDiagnosticsMode()).toBe('collect')
  })

  it('keeps a configureDiagnostics() mode while an app is live, and the ignore list', () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>'
    start(Counter, '#a', { diagnostics: { mode: 'error', ignore: ['SYG101'] } })
    start(Other, '#b')
    expect(getDiagnosticsMode()).toBe('error')
  })

  it('with no live app, run() without the option still resets to the defaults', () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>'
    const a = start(Counter, '#a', { diagnostics: 'collect' })
    a.dispose()
    apps.splice(0)
    configureDiagnostics({ mode: 'error' })
    start(Other, '#b')
    expect(getDiagnosticsMode()).toBe('off')
  })

  it("a hot swap of an app without the option keeps another live app's mode", async () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>'
    start(Counter, '#a', { diagnostics: 'collect' })
    const b = start(Other, '#b')
    await until(() => text('#b p') === 'B:100', 'app B')
    b.hmr(Other)
    expect(getDiagnosticsMode()).toBe('collect')
  })
})
