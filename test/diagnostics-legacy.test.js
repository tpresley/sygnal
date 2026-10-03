import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

if (typeof globalThis.window === 'undefined') {
  globalThis.window = undefined
}

import { warn, error, fail } from '../src/extra/diagnostics/legacy.js'
import {
  configureDiagnostics,
  getDiagnostics,
  formatDiagnostic,
  DiagnosticError,
  _resetDiagnostics,
} from '../src/extra/diagnostics/index.js'
import { getCodeInfo } from '../src/extra/diagnostics/codes.js'
import { renderComponent } from '../src/extra/testing.js'
import { createElement } from '../src/pragma/index.js'
import { until } from './support/wait.js'
import collection from '../src/collection.js'
import switchable from '../src/switchable.js'

const settle = (ms = 60) => new Promise(r => setTimeout(r, ms))

let warnSpy, errorSpy

beforeEach(() => {
  delete globalThis.__SYGNAL_DEV__
  _resetDiagnostics()
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  _resetDiagnostics()
})

describe("legacy helpers in 'off' mode (production default)", () => {
  it('warn() prints the formatted text with console.warn', () => {
    warn('SYG213', { name: 'Comp' }, "Duplicate model entry for action 'A' on sink 'STATE'", 'Remove the duplicate')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      "[Sygnal SYG213] Comp: Duplicate model entry for action 'A' on sink 'STATE'. Remove the duplicate. https://sygnal.js.org/reference/errors#syg213"
    )
    expect(getDiagnostics()).toEqual([])
  })

  it('error() prints with console.error and passes the extra value through', () => {
    const err = new Error('boom')
    error('SYG406', 'Comp', 'View threw; rendering the error fallback', undefined, err)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0][0]).toBe(
      '[Sygnal SYG406] Comp: View threw; rendering the error fallback. https://sygnal.js.org/reference/errors#syg406'
    )
    expect(errorSpy.mock.calls[0][1]).toBe(err)
  })

  it('prints without a component prefix when no component is given', () => {
    warn('SYG417', undefined, 'Target not found', 'Render it first')
    expect(warnSpy.mock.calls[0][0]).toMatch(/^\[Sygnal SYG417\] Target not found\. Render it first\. https:/)
  })

  it('prints even when the code is in the ignore list (ignore only applies when diagnostics are on)', () => {
    configureDiagnostics({ ignore: ['SYG213'] })
    warn('SYG213', 'Comp', 'msg')
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})

describe('legacy helpers with diagnostics enabled', () => {
  it("'collect' mode routes through report(): collected; error severity is still printed (1H-2), warn isn't", () => {
    configureDiagnostics({ mode: 'collect' })
    const err = new Error('boom')
    warn('SYG213', { name: 'Comp' }, 'dup', 'fix it')
    error('SYG216', 'Comp', "Reducer for 'A' threw; state unchanged", undefined, err)
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0]).toEqual([formatDiagnostic('SYG216', { component: 'Comp', message: "Reducer for 'A' threw; state unchanged" }), err])
    const ds = getDiagnostics()
    expect(ds.map(d => [d.code, d.severity, d.component])).toEqual([
      ['SYG213', 'warn', 'Comp'],
      ['SYG216', 'error', 'Comp'],
    ])
    expect(ds[0].fix).toBe('fix it')
    expect(ds[1].data).toBe(err)
    expect(ds[0].text).toBe(formatDiagnostic('SYG213', { component: 'Comp', message: 'dup', fix: 'fix it' }))
  })

  it("'warn' mode prints the text once (via report) plus the extra value, without double-printing", () => {
    configureDiagnostics({ mode: 'warn' })
    const err = new Error('boom')
    warn('SYG213', 'Comp', 'dup', 'fix it')
    error('SYG216', 'Comp', 'threw', undefined, err)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]).toEqual([formatDiagnostic('SYG213', { component: 'Comp', message: 'dup', fix: 'fix it' })])
    expect(errorSpy).toHaveBeenCalledTimes(2)
    expect(errorSpy.mock.calls[0][0]).toMatch(/^\[Sygnal SYG216\] Comp: threw\./)
    expect(errorSpy.mock.calls[1]).toEqual([err])
    expect(getDiagnostics()).toHaveLength(2)
  })

  it("ignored codes print nothing when diagnostics are on", () => {
    configureDiagnostics({ mode: 'warn', ignore: ['SYG216'] })
    error('SYG216', 'Comp', 'threw', undefined, new Error('x'))
    expect(errorSpy).not.toHaveBeenCalled()
    expect(getDiagnostics()).toEqual([])
  })

  it("'error' mode never throws synchronously; the DiagnosticError is rethrown asynchronously", () => {
    vi.useFakeTimers()
    try {
      configureDiagnostics({ mode: 'error' })
      expect(() => warn('SYG213', 'Comp', 'dup')).not.toThrow()
      expect(getDiagnostics()).toHaveLength(1)
      let thrown
      try { vi.runAllTimers() } catch (e) { thrown = e }
      expect(thrown).toBeInstanceOf(DiagnosticError)
      expect(thrown.diagnostic.code).toBe('SYG213')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('fail()', () => {
  for (const mode of ['off', 'collect', 'warn', 'error']) {
    it(`throws an Error with the formatted message and .code (mode '${mode}')`, () => {
      configureDiagnostics({ mode })
      let thrown
      try { fail('SYG602', { name: 'Comp' }, 'intent must be a function', 'Use a function') } catch (e) { thrown = e }
      expect(thrown).toBeInstanceOf(Error)
      expect(thrown.code).toBe('SYG602')
      expect(thrown.message).toBe(
        '[Sygnal SYG602] Comp: intent must be a function. Use a function. https://sygnal.js.org/reference/errors#syg602'
      )
      expect(warnSpy).not.toHaveBeenCalled()
      expect(errorSpy).not.toHaveBeenCalled()
    })
  }
})

describe('retrofitted call sites', () => {
  it('every SYG code used in the retrofitted files is registered', () => {
    const files = ['component.ts', 'collection.ts', 'switchable.ts', 'pragma/index.ts']
    const used = new Set()
    for (const f of files) {
      const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')
      for (const m of src.matchAll(/SYG\d{3}/g)) used.add(m[0])
    }
    expect(used.size).toBeGreaterThan(30)
    const missing = [...used].filter(c => !getCodeInfo(c) || !getCodeInfo(c).title)
    expect(missing).toEqual([])
  })

  it('collection() and switchable() argument errors carry codes', () => {
    expect(() => collection(null, {})).toThrow('[Sygnal SYG411] collection: first argument (component) must be a function')
    let thrown
    try { switchable({}, undefined, '') } catch (e) { thrown = e }
    expect(thrown.code).toBe('SYG419')
    expect(() => switchable({}, 42, '')).toThrow('[Sygnal SYG419]')
  })

  it('a throwing view prints SYG406 with the original error in off mode', async () => {
    const boom = new Error('view boom')
    function Broken() { throw boom }
    Broken.initialState = { a: 1 }
    const t = renderComponent(Broken, { diagnostics: 'off' }) // renderComponent defaults to 'collect'
    // G-176: wait for the first render (a loaded machine renders later than a fixed 60ms; a late
    // SYG406 then landed in the next test)
    await until(() => expect(errorSpy.mock.calls.some(c => String(c[0]).includes('SYG406'))).toBe(true))
    const call = errorSpy.mock.calls.find(c => String(c[0]).includes('SYG406'))
    expect(call).toBeTruthy()
    expect(call[0]).toMatch(/^\[Sygnal SYG406\] Broken: View threw; rendering the error fallback\./)
    expect(call[0]).toContain('https://sygnal.js.org/reference/errors#syg406')
    expect(call[1]).toBe(boom)
    t.dispose()
  })

  it("a throwing view is collected and printed in 'collect' mode (1H-2)", async () => {
    configureDiagnostics({ mode: 'collect' })
    function Broken2() { throw new Error('view boom') }
    Broken2.initialState = { a: 1 }
    const t = renderComponent(Broken2)
    await until(() => expect(getDiagnostics().some(d => d.code === 'SYG406')).toBe(true))
    await settle()
    const d = getDiagnostics().find(d => d.code === 'SYG406')
    expect(d.component).toBe('Broken2')
    expect(d.data).toBeInstanceOf(Error)
    const printed = errorSpy.mock.calls.filter(c => String(c[0]).includes('SYG406'))
    expect(printed.length).toBe(1)
    expect(printed[0][1]).toBe(d.data)
    t.dispose()
  })

  it('a STATE reducer that throws prints SYG216 and keeps the previous state', async () => {
    function Throws() { return createElement('div', null, 'x') }
    Throws.initialState = { n: 1 }
    Throws.model = { BAD: () => { throw new Error('reducer boom') } }
    const t = renderComponent(Throws, { diagnostics: 'off' }) // renderComponent defaults to 'collect'
    await t.ready()
    t.simulateAction('BAD')
    await until(() => expect(errorSpy.mock.calls.some(c => String(c[0]).includes('SYG216'))).toBe(true))
    await t.settle()
    const call = errorSpy.mock.calls.find(c => String(c[0]).includes('SYG216'))
    expect(call[0]).toMatch(/^\[Sygnal SYG216\] Throws: Reducer for '[^']+' threw; state unchanged\./)
    expect(call[1].message).toBe('reducer boom')
    expect(t.states[t.states.length - 1]).toEqual({ n: 1 })
    t.dispose()
  })
})
