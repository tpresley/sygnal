// PLAN-2 workstream 1-B regression tests: B-016, G-027 / G-044 (codes surface under their own
// code), G-036 (run() strict option), G-007 part 2 (SYG106 is an error in strict mode).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import xs from 'xstream'

if (typeof globalThis.window === 'undefined') {
  globalThis.window = undefined
}

import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import run from '../src/extra/run.js'
import {
  _resetDiagnostics,
  configureDiagnostics,
  getDiagnostics,
  getDiagnosticsMode,
} from '../src/extra/diagnostics/index.js'
import { installChecks, resetChecks, configureStrict, isStrictEnabled } from '../src/extra/diagnostics/checks/index.js'

const settle = (ms = 40) => new Promise(r => setTimeout(r, ms))
const codes = t => t.diagnostics.map(d => d.code)
const core = () => globalThis.__SYGNAL_DIAGNOSTICS__

let t
beforeEach(() => {
  delete globalThis.__SYGNAL_DEV__
  delete globalThis.__SYGNAL_STRICT__
  _resetDiagnostics()
  installChecks()
  resetChecks()
  configureStrict(undefined)
})
afterEach(() => {
  if (t) t.dispose()
  t = null
  configureStrict(undefined)
  delete globalThis.__SYGNAL_STRICT__
  _resetDiagnostics()
  vi.restoreAllMocks()
})

// ─── B-016 ───────────────────────────────────────────────────────────────────

describe('B-016: isolatedState sub-component without a model applies its initialState', () => {
  it('no state prop: the child renders its own initialState, not the parent state', async () => {
    function Badge({ state }) { return h('span', { className: 'badge' }, `${state.label}:${state.count}`) }
    Badge.isolatedState = true
    Badge.initialState = { label: 'new', count: 3 }
    function App({ state }) { return h('div', null, h('b', null, String(state.n)), h(Badge)) }
    App.initialState = { n: 1 }
    t = renderComponent(App)
    await t.ready()
    await settle(30)
    expect(t.html()).toContain('<span class="badge">new:3</span>')
    // the parent's state is untouched
    expect(t.states.every(s => JSON.stringify(s) === '{"n":1}')).toBe(true)
  })

  it('with a state prop whose slice is undefined: the child renders its initialState (guard)', async () => {
    function Badge({ state }) { return h('span', { className: 'badge' }, `${state.label}`) }
    Badge.isolatedState = true
    Badge.initialState = { label: 'fresh' }
    function App() { return h('div', null, h(Badge, { state: 'badge' })) }
    App.initialState = { n: 1 }
    t = renderComponent(App)
    await t.ready()
    await settle(30)
    expect(t.html()).toContain('<span class="badge">fresh</span>')
  })

  it('a child with a model still starts from initialState and keeps its own updates (guard)', async () => {
    function Counter({ state }) { return h('button', { className: 'c' }, String(state.k)) }
    Counter.isolatedState = true
    Counter.initialState = { k: 5 }
    Counter.intent = ({ DOM }) => ({ INC: DOM.click('.c') })
    Counter.model = { INC: s => ({ ...s, k: s.k + 1 }) }
    function App() { return h('div', null, h(Counter)) }
    App.initialState = { n: 0 }
    t = renderComponent(App)
    await t.ready()
    await settle(30)
    t.simulateEvent('.c', 'click')
    await settle(40)
    expect(t.html()).toContain('<button class="c">6</button>')
  })
})

// ─── G-027 / G-044: codes surface under their own code ───────────────────────

describe('G-027 / G-044: each code surfaces under its own code', () => {
  const view = ({ state }) => h('div', null, String(state.n))

  it('SYG218: an unsupported driver-sink return type is reported as SYG218 (not SYG216); nothing is sent', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function App(p) { return view(p) }
    App.initialState = { n: 0 }
    App.model = { GO: { EVENTS: () => Symbol('oops') } }
    t = renderComponent(App)
    t.simulateAction('GO')
    await t.settle()
    expect(t.emitted).toEqual([])
    expect(codes(t)).toContain('SYG218')
    expect(codes(t)).not.toContain('SYG216')
    const d = t.diagnostics.find(d => d.code === 'SYG218')
    expect(d.severity).toBe('error')
    expect(d.message).toMatch(/returned a symbol/)
  })

  it('SYG215: next() with a non-number delay inside a STATE reducer is reported as SYG215 (not SYG216)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function App(p) { return view(p) }
    App.initialState = { n: 0 }
    App.model = { GO: (s, d, next) => { next('LATER', 1, 'soon'); return { ...s, n: 1 } } }
    t = renderComponent(App)
    t.simulateAction('GO')
    await t.settle()
    expect(codes(t)).toContain('SYG215')
    expect(codes(t)).not.toContain('SYG216')
    expect(t.diagnostics.find(d => d.code === 'SYG215').severity).toBe('error')
    // the reducer threw, so the state is unchanged (as before)
    expect(t.states.at(-1)).toEqual({ n: 0 })
  })

  it('SYG215: inside an EFFECT handler it is reported as SYG215 (not SYG214)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function App(p) { return view(p) }
    App.initialState = { n: 0 }
    App.model = { GO: { EFFECT: (s, d, next) => { next('LATER', 1, 'soon') } } }
    t = renderComponent(App)
    t.simulateAction('GO')
    await t.settle()
    expect(codes(t)).toContain('SYG215')
    expect(codes(t)).not.toContain('SYG214')
  })

  it('a plain exception in a reducer is still SYG216 (guard)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function App(p) { return view(p) }
    App.initialState = { n: 0 }
    App.model = { GO: () => { throw new Error('boom') } }
    t = renderComponent(App)
    t.simulateAction('GO')
    await t.settle()
    expect(codes(t)).toContain('SYG216')
  })

  it('SYG405: a coded throw while instantiating a sub-component is reported under its own code, not SYG408', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Child({ state }) { return h('i', null, String(state.a)) }
    Child.initialState = { a: 1 } // no isolatedState
    function App() { return h('div', null, h(Child)) }
    App.initialState = { n: 0 }
    t = renderComponent(App)
    await t.ready()
    await settle(30)
    expect(codes(t)).toContain('SYG405')
    expect(codes(t)).not.toContain('SYG408')
    expect(t.diagnostics.find(d => d.code === 'SYG405').severity).toBe('error')
    expect(t.html()).toContain('data-sygnal-error')
  })

  it('an uncoded throw while instantiating a sub-component is still SYG408 (guard)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Child() { return h('i', null, 'x') }
    Child.intent = () => { throw new Error('intent boom') }
    function App() { return h('div', null, h(Child)) }
    App.initialState = { n: 0 }
    t = renderComponent(App)
    await t.ready()
    await settle(30)
    expect(codes(t)).toContain('SYG408')
  })

  it('SYG420: an undefined JSX tag is collected by the diagnostics core', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    configureDiagnostics({ mode: 'collect' })
    const vnode = h(undefined, null)
    expect(vnode.sel).toBe('UNDEFINED')
    const found = getDiagnostics().filter(d => d.code === 'SYG420')
    expect(found).toHaveLength(1)
    expect(found[0].severity).toBe('error')
    // error severity is still printed in 'collect' mode, once
    expect(err.mock.calls.filter(c => String(c[0]).includes('SYG420'))).toHaveLength(1)
  })

  it("SYG420: with diagnostics 'off' it is printed exactly as before and not collected", () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h(undefined, null)
    expect(getDiagnostics()).toEqual([])
    expect(err.mock.calls.map(c => c[0])).toEqual([
      '[Sygnal SYG420] JSX: A JSX tag is undefined, so <UNDEFINED> is rendered instead. Import or define the component in this file. https://sygnal.js.org/reference/errors#syg420',
    ])
  })
})

// ─── G-036: run(App, drivers, { diagnostics: { strict: true } }) ────────────

describe('G-036: run() diagnostics.strict', () => {
  function App() { return h('div', null, 'x') }
  const drivers = { NOOP: () => xs.never() }
  let app
  afterEach(() => { app?.dispose(); app = undefined })

  it('turns runtime strict checks on, and diagnostics on (warn) when no mode is given', () => {
    app = run(App, drivers, { useDefaultDrivers: false, diagnostics: { strict: true } })
    expect(isStrictEnabled()).toBe(true)
    expect(getDiagnosticsMode()).toBe('warn')
  })

  it('keeps an explicit mode', () => {
    app = run(App, drivers, { useDefaultDrivers: false, diagnostics: { mode: 'collect', strict: true } })
    expect(isStrictEnabled()).toBe(true)
    expect(getDiagnosticsMode()).toBe('collect')
  })

  it('strict: false turns strict off; without the option an earlier configureStrict() is kept', () => {
    configureStrict(true)
    app = run(App, drivers, { useDefaultDrivers: false })
    expect(isStrictEnabled()).toBe(true)
    app.dispose()
    app = run(App, drivers, { useDefaultDrivers: false, diagnostics: { strict: false } })
    expect(isStrictEnabled()).toBe(false)
  })

  it('strict checks report through run()', async () => {
    function Positional(props, state) { return h('div', null, String(state.n)) }
    Positional.initialState = { n: 0 }
    app = run(Positional, drivers, { useDefaultDrivers: false, diagnostics: { mode: 'collect', strict: true } })
    await settle(20)
    expect(getDiagnostics().map(d => d.code)).toContain('SYG501')
  })

  it("without the 'sygnal/diagnostics' dev entry it warns once (SYG608) and nothing else changes", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const c = core()
    const uninstall = c.__uninstallChecks
    uninstall()
    try {
      app = run(App, drivers, { useDefaultDrivers: false, diagnostics: { strict: true } })
      app.dispose()
      app = run(App, drivers, { useDefaultDrivers: false, diagnostics: { strict: true } })
      const printed = warn.mock.calls.filter(c => String(c[0]).includes('SYG608'))
      expect(printed).toHaveLength(1)
      expect(printed[0][0]).toMatch(/sygnal\/diagnostics/)
    } finally {
      installChecks()
    }
  })
})

// ─── G-007 part 2: SYG106 is an error in strict mode ─────────────────────────

describe('G-007 part 2: SYG106 severity follows strict mode', () => {
  function Card({ title }) { return h('div', { className: 'card' }, String(title)) }
  function Parent() { return h('div', null, h(Card, { title: 'a', context: 'mine' })) }
  Parent.initialState = { n: 0 }

  it('non-strict: warn (unchanged)', async () => {
    t = renderComponent(Parent)
    await settle(60)
    const d = t.diagnostics.find(d => d.code === 'SYG106')
    expect(d.severity).toBe('warn')
  })

  it('renderComponent({ strict: true }): error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    t = renderComponent(Parent, { strict: true })
    await settle(60)
    const d = t.diagnostics.find(d => d.code === 'SYG106')
    expect(d.severity).toBe('error')
  })

  it('configureStrict(true) / __SYGNAL_STRICT__: error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    globalThis.__SYGNAL_STRICT__ = true
    t = renderComponent(Parent)
    await settle(60)
    expect(t.diagnostics.find(d => d.code === 'SYG106').severity).toBe('error')
  })
})
