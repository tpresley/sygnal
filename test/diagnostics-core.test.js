import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import xs from 'xstream'

if (typeof globalThis.window === 'undefined') {
  globalThis.window = undefined
}

import {
  report,
  formatDiagnostic,
  getDiagnostics,
  clearDiagnostics,
  onDiagnostic,
  configureDiagnostics,
  getDiagnosticsMode,
  isDiagnosticsEnabled,
  resolveDiagnosticsMode,
  registerCheck,
  DiagnosticError,
  onIntent,
  onModel,
  onRender,
  onReducer,
  onDispose,
  _resetDiagnostics,
} from '../src/extra/diagnostics/index.js'
import { getCodeInfo, listCodes, docsUrlFor, DOCS_BASE_URL, registerCodes } from '../src/extra/diagnostics/codes.js'
import * as publicApi from '../src/index.js'
import run from '../src/extra/run.js'
import { getDevTools } from '../src/extra/devtools.js'
import { renderComponent } from '../src/extra/testing.js'
import { createElement } from '../src/pragma/index.js'

const settle = (ms = 60) => new Promise(r => setTimeout(r, ms))

beforeEach(() => {
  delete globalThis.__SYGNAL_DEV__
  _resetDiagnostics()
})

afterEach(() => {
  delete globalThis.__SYGNAL_DEV__
  _resetDiagnostics()
  vi.restoreAllMocks()
})

describe('diagnostics core — code registry', () => {
  it('pre-seeds the 1A codes with severity, title and docs slug', () => {
    for (const code of ['SYG101', 'SYG102', 'SYG103', 'SYG104', 'SYG105', 'SYG110', 'SYG201', 'SYG202', 'SYG301', 'SYG401']) {
      const info = getCodeInfo(code)
      expect(info, code).toBeDefined()
      expect(info.code).toBe(code)
      expect(['error', 'warn', 'info']).toContain(info.severity)
      expect(info.title.length).toBeGreaterThan(0)
      expect(info.docsSlug).toBe(code.toLowerCase())
    }
  })

  it('listCodes returns full records; registerCodes adds entries', () => {
    const before = listCodes().length
    expect(listCodes().every(c => c.code && c.severity && c.title && c.docsSlug)).toBe(true)
    registerCodes([['SYG199', 'info', 'Test-only code']])
    expect(getCodeInfo('SYG199')).toEqual({ code: 'SYG199', severity: 'info', title: 'Test-only code', docsSlug: 'syg199' })
    expect(listCodes().length).toBe(before + 1)
    configureDiagnostics({ mode: 'error' })
    expect(report('SYG199', { message: 'info never throws' }).severity).toBe('info')
  })

  it('unknown codes return undefined from getCodeInfo', () => {
    expect(getCodeInfo('SYG998')).toBeUndefined()
  })

  it('builds docs URLs from the docs site base', () => {
    expect(DOCS_BASE_URL).toBe('https://sygnal.js.org')
    expect(docsUrlFor('SYG101')).toBe('https://sygnal.js.org/reference/errors#syg101')
  })
})

describe('diagnostics core — mode resolution', () => {
  it("defaults to 'off'", () => {
    expect(resolveDiagnosticsMode()).toBe('off')
    expect(getDiagnosticsMode()).toBe('off')
    expect(isDiagnosticsEnabled()).toBe(false)
  })

  it("globalThis.__SYGNAL_DEV__ === true resolves to 'warn'", () => {
    globalThis.__SYGNAL_DEV__ = true
    expect(resolveDiagnosticsMode()).toBe('warn')
    expect(isDiagnosticsEnabled()).toBe(true)
  })

  it("__SYGNAL_DEV__ other than true resolves to 'off'", () => {
    globalThis.__SYGNAL_DEV__ = false
    expect(resolveDiagnosticsMode()).toBe('off')
    globalThis.__SYGNAL_DEV__ = 'yes'
    expect(resolveDiagnosticsMode()).toBe('off')
  })

  it('explicit mode wins over __SYGNAL_DEV__', () => {
    globalThis.__SYGNAL_DEV__ = true
    configureDiagnostics({ mode: 'collect' })
    expect(getDiagnosticsMode()).toBe('collect')
    configureDiagnostics({ mode: 'off' })
    expect(getDiagnosticsMode()).toBe('off')
  })

  it('clearing the explicit mode falls back to __SYGNAL_DEV__', () => {
    configureDiagnostics({ mode: 'error' })
    globalThis.__SYGNAL_DEV__ = true
    configureDiagnostics({ mode: undefined })
    expect(getDiagnosticsMode()).toBe('warn')
  })

  it('run(App, drivers, { diagnostics }) sets the mode (string and object forms)', () => {
    function App() { return createElement('div', null, 'x') }
    globalThis.__SYGNAL_DEV__ = true

    let app = run(App, { NOOP: () => xs.never() }, { useDefaultDrivers: false, diagnostics: 'collect' })
    expect(getDiagnosticsMode()).toBe('collect')
    app.dispose()

    app = run(App, { NOOP: () => xs.never() }, { useDefaultDrivers: false, diagnostics: { mode: 'error', ignore: ['SYG101'] } })
    expect(getDiagnosticsMode()).toBe('error')
    expect(report('SYG101', { message: 'ignored' })).toBeUndefined()
    app.dispose()
  })

  it('run() without the option resolves from __SYGNAL_DEV__', () => {
    function App() { return createElement('div', null, 'x') }
    globalThis.__SYGNAL_DEV__ = true
    const app = run(App, { NOOP: () => xs.never() }, { useDefaultDrivers: false })
    expect(getDiagnosticsMode()).toBe('warn')
    app.dispose()
  })
})

describe('diagnostics core — report()', () => {
  it('formats `[Sygnal CODE] Component: message. fix url`', () => {
    const text = formatDiagnostic('SYG101', {
      component: 'TodoList',
      message: "Intent action 'ADD' has no model entry",
      fix: "Add an 'ADD' entry to TodoList.model",
    })
    expect(text).toBe(
      "[Sygnal SYG101] TodoList: Intent action 'ADD' has no model entry. " +
      "Add an 'ADD' entry to TodoList.model. https://sygnal.js.org/reference/errors#syg101"
    )
  })

  it('does not double punctuation, omits missing component and fix', () => {
    expect(formatDiagnostic('SYG202', { message: 'Returned undefined.' }))
      .toBe('[Sygnal SYG202] Returned undefined. https://sygnal.js.org/reference/errors#syg202')
  })

  it('accepts a component instance and uses its name', () => {
    configureDiagnostics({ mode: 'collect' })
    const d = report('SYG201', { component: { name: 'Counter' }, message: 'm' })
    expect(d.component).toBe('Counter')
  })

  it("is a no-op in 'off' mode", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cb = vi.fn()
    onDiagnostic(cb)
    expect(report('SYG101', { component: 'A', message: 'x' })).toBeUndefined()
    expect(getDiagnostics()).toEqual([])
    expect(cb).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it("'collect' collects without console output", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    configureDiagnostics({ mode: 'collect' })
    const d = report('SYG101', { component: 'A', message: 'x', fix: 'y', data: { action: 'ADD' } })
    expect(d).toMatchObject({
      code: 'SYG101',
      severity: 'warn',
      component: 'A',
      message: 'x',
      fix: 'y',
      data: { action: 'ADD' },
      docsUrl: 'https://sygnal.js.org/reference/errors#syg101',
    })
    expect(typeof d.timestamp).toBe('number')
    expect(getDiagnostics()).toEqual([d])
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it("'warn' prints warn → console.warn, error → console.error, info → nothing", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    configureDiagnostics({ mode: 'warn' })
    report('SYG101', { component: 'A', message: 'w' })
    report('SYG301', { component: 'A', message: 'e' })
    report('SYG102', { component: 'A', message: 'i' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/^\[Sygnal SYG101\] A: w\./)
    expect(error).toHaveBeenCalledTimes(1)
    expect(error.mock.calls[0][0]).toMatch(/^\[Sygnal SYG301\] A: e\./)
    expect(getDiagnostics().map(d => d.code)).toEqual(['SYG101', 'SYG301', 'SYG102'])
  })

  it("'error' mode throws on warn and error severities, not on info", () => {
    configureDiagnostics({ mode: 'error' })
    expect(() => report('SYG101', { component: 'A', message: 'w' })).toThrow(DiagnosticError)
    expect(() => report('SYG301', { component: 'A', message: 'e' })).toThrow(/\[Sygnal SYG301\]/)
    expect(() => report('SYG102', { component: 'A', message: 'i' })).not.toThrow()
    try {
      report('SYG201', { component: 'A', message: 'x' })
    } catch (err) {
      expect(err.diagnostic.code).toBe('SYG201')
    }
    // still collected before throwing
    expect(getDiagnostics().map(d => d.code)).toEqual(['SYG101', 'SYG301', 'SYG102', 'SYG201'])
  })

  it('severity can be overridden per report', () => {
    configureDiagnostics({ mode: 'error' })
    expect(() => report('SYG103', { message: 'escalated', severity: 'warn' })).toThrow(DiagnosticError)
  })

  it('unknown codes default to warn severity', () => {
    configureDiagnostics({ mode: 'collect' })
    expect(report('SYG999', { message: 'x' }).severity).toBe('warn')
  })

  it('ignore list suppresses codes entirely', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    configureDiagnostics({ mode: 'warn', ignore: ['SYG101'] })
    expect(report('SYG101', { message: 'x' })).toBeUndefined()
    report('SYG201', { message: 'y' })
    expect(getDiagnostics().map(d => d.code)).toEqual(['SYG201'])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('clearDiagnostics empties the list; getDiagnostics returns a copy', () => {
    configureDiagnostics({ mode: 'collect' })
    report('SYG101', { message: 'x' })
    const list = getDiagnostics()
    list.pop()
    expect(getDiagnostics()).toHaveLength(1)
    clearDiagnostics()
    expect(getDiagnostics()).toEqual([])
  })

  it('onDiagnostic subscribes and unsubscribes', () => {
    configureDiagnostics({ mode: 'collect' })
    const cb = vi.fn()
    const off = onDiagnostic(cb)
    report('SYG101', { message: 'x' })
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0][0].code).toBe('SYG101')
    off()
    report('SYG101', { message: 'x' })
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('caps the collected list', () => {
    configureDiagnostics({ mode: 'collect' })
    for (let i = 0; i < 600; i++) report('SYG102', { message: String(i) })
    const list = getDiagnostics()
    expect(list.length).toBe(500)
    expect(list[list.length - 1].message).toBe('599')
  })
})

describe('diagnostics core — public surface', () => {
  it('exports getDiagnostics, clearDiagnostics, onDiagnostic from the package entry', () => {
    expect(publicApi.getDiagnostics).toBe(getDiagnostics)
    expect(publicApi.clearDiagnostics).toBe(clearDiagnostics)
    expect(publicApi.onDiagnostic).toBe(onDiagnostic)
  })

  it('getDevTools().getDiagnostics() returns the collected diagnostics', () => {
    configureDiagnostics({ mode: 'collect' })
    report('SYG101', { message: 'x' })
    expect(getDevTools().getDiagnostics().map(d => d.code)).toEqual(['SYG101'])
  })
})

describe('diagnostics core — hooks', () => {
  function recordingCheck() {
    const calls = []
    const check = {
      id: 'recorder',
      onIntent: (c, actions, selectors) => calls.push(['onIntent', c.name, actions, selectors]),
      onModel: (c, map) => calls.push(['onModel', c.name, map]),
      onRender: (c, vnode) => calls.push(['onRender', c.name, vnode]),
      onReducer: (c, action, prev, next, sink) => calls.push(['onReducer', c.name, action, prev, next, sink]),
      onDispose: (c) => calls.push(['onDispose', c.name]),
    }
    return { calls, check }
  }

  function Counter({ state }) {
    return createElement('div', { className: 'counter' }, String(state.count))
  }
  Counter.initialState = { count: 0 }
  Counter.intent = ({ DOM }) => ({ INC: DOM.select('.inc').events('click') })
  Counter.model = {
    INC: (state) => ({ ...state, count: state.count + 1 }),
    'PING | EVENTS': () => ({ type: 'ping' }),
  }

  it("hooks are no-ops in 'off' mode (registered checks are not called)", async () => {
    const { calls, check } = recordingCheck()
    registerCheck(check)
    // direct calls
    onIntent({ name: 'X' }, ['A'])
    onModel({ name: 'X' }, { A: ['STATE'] })
    onRender({ name: 'X' }, {})
    onReducer({ name: 'X' }, 'A', {}, {}, 'STATE')
    onDispose({ name: 'X' })
    // through a real component
    const t = renderComponent(Counter)
    await settle(100)
    t.simulateAction('INC')
    await settle(100)
    t.dispose()
    await settle(20)
    expect(calls).toEqual([])
    expect(getDiagnostics()).toEqual([])
  })

  it('hooks dispatch to registered checks when on', async () => {
    configureDiagnostics({ mode: 'collect' })
    const { calls, check } = recordingCheck()
    registerCheck(check)

    // fire INC through the real intent stream (simulateAction routes through a
    // synthetic __TEST_ACTION__ reducer instead)
    const click$ = xs.create()
    const t = renderComponent(Counter, { mockConfig: { '.inc': { click: click$ } } })
    await settle(100)
    click$.shamefullySendNext({})
    await settle(100)

    const intentCall = calls.find(c => c[0] === 'onIntent' && c[1] === 'Counter')
    expect(intentCall).toBeDefined()
    expect(intentCall[2]).toContain('INC')
    expect(intentCall[3]).toBeUndefined()

    const modelCall = calls.find(c => c[0] === 'onModel' && c[1] === 'Counter')
    expect(modelCall[2].INC).toEqual(['STATE'])
    expect(modelCall[2].PING).toEqual(['EVENTS'])
    expect(modelCall[2].INITIALIZE).toEqual(['STATE'])

    const intentIdx = calls.indexOf(intentCall)
    const modelIdx = calls.indexOf(modelCall)
    expect(intentIdx).toBeLessThan(modelIdx)

    const renderCall = calls.find(c => c[0] === 'onRender' && c[1] === 'Counter')
    expect(renderCall).toBeDefined()
    expect(renderCall[2].sel).toMatch(/^div/)

    const reducerCall = calls.find(c => c[0] === 'onReducer' && c[2] === 'INC')
    expect(reducerCall).toBeDefined()
    expect(reducerCall[3]).toEqual({ count: 0 })
    expect(reducerCall[4]).toEqual({ count: 1 })
    expect(reducerCall[5]).toBe('STATE')

    t.dispose()
    await settle(20)
    expect(calls.some(c => c[0] === 'onDispose' && c[1] === 'Counter')).toBe(true)
  })

  it('unregistering a check stops dispatch', () => {
    configureDiagnostics({ mode: 'collect' })
    const { calls, check } = recordingCheck()
    const unregister = registerCheck(check)
    unregister()
    onDispose({ name: 'X' })
    expect(calls).toEqual([])
  })

  it('checks can report through report()', () => {
    configureDiagnostics({ mode: 'collect' })
    registerCheck({
      id: 'no-undefined',
      onReducer(c, action, prev, next) {
        if (next === undefined) report('SYG202', { component: c, message: `Reducer '${action}' returned undefined` })
      },
    })
    onReducer({ name: 'Form' }, 'SUBMIT', {}, undefined, 'STATE')
    expect(getDiagnostics()).toHaveLength(1)
    expect(getDiagnostics()[0].text).toMatch(/^\[Sygnal SYG202\] Form: Reducer 'SUBMIT' returned undefined\./)
  })

  it('a throwing check is isolated and reported as SYG900', () => {
    configureDiagnostics({ mode: 'collect' })
    const after = vi.fn()
    registerCheck({ id: 'broken', onRender() { throw new Error('boom') } })
    registerCheck({ id: 'after', onRender: after })
    expect(() => onRender({ name: 'X' }, {})).not.toThrow()
    expect(after).toHaveBeenCalledTimes(1)
    const d = getDiagnostics()[0]
    expect(d.code).toBe('SYG900')
    expect(d.message).toMatch(/'broken' threw in onRender: boom/)
  })

  it("'error' mode diagnostics raised by a check propagate out of the hook", () => {
    configureDiagnostics({ mode: 'error' })
    registerCheck({ id: 'strict', onModel(c) { report('SYG101', { component: c, message: 'x' }) } })
    expect(() => onModel({ name: 'X' }, {})).toThrow(DiagnosticError)
  })
})
