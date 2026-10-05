// @vitest-environment jsdom
// PLAN-5 W-1: widget diagnostics through the dev entry (checks/widgets.ts): SYG140 (emit of an
// undeclared event), SYG142 (reserved command name), SYG143 (widget tag as a selector), SYG144
// (declared event the host fires natively, info), SYG660–662 (mount / update / unmount threw).
// SYG141 is static only (sygnal-check/test/widgets.vtest.js).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupChecks, diagnostics, settle } from './diagnostics/helpers.js'
import { createElement as h } from '../src/pragma/index.js'
import { defineWidget } from '../src/extra/widget.ts'
import run from '../src/extra/run.js'
import { renderComponent } from '../src/extra/testing.js'
import { getCodeInfo, DEV_CODE_SEVERITY, CODE_TITLES, CODE_SEVERITY } from '../src/extra/diagnostics/codes.ts'

let app
beforeEach(() => setupChecks())
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = ''; vi.restoreAllMocks() })
const mount = (App, opts = {}) => {
  document.body.innerHTML = '<div id="root"></div>'
  app = run(App, {}, { mountPoint: '#root', diagnostics: 'collect', ...opts })
  return app
}

describe('codes', () => {
  it('SYG140–144 and SYG660–662 are dev-entry codes (not in the core table) with titles', () => {
    for (const c of ['SYG140', 'SYG141', 'SYG142', 'SYG143', 'SYG144', 'SYG660', 'SYG661', 'SYG662']) {
      expect(DEV_CODE_SEVERITY[c]).toBeTruthy()
      expect(CODE_TITLES[c]).toBeTruthy()
    }
    expect(DEV_CODE_SEVERITY.SYG144).toBe('info')
    expect(DEV_CODE_SEVERITY.SYG660).toBe('error')
    // registered by the dev entry (setupChecks loaded it)
    expect(getCodeInfo('SYG142').severity).toBe('error')
    void CODE_SEVERITY
  })
})

describe('SYG140: emit of an undeclared event', () => {
  it('warns once per widget and name, naming the declared events; the event is still dispatched', async () => {
    let emit
    const W = defineWidget({ name: 'Picker', mount: (el, p, e) => { emit = e; return {} }, events: ['pick'] })
    function A({ state }) { return h('div', null, h(W, { className: 'w' }), h('p', { className: 'n' }, String(state.n))) }
    A.initialState = { n: 0 }
    A.intent = ({ DOM }) => ({ X: DOM.select('.w').events('pikc') })
    A.model = { X: (s) => ({ n: s.n + 1 }) }
    mount(A)
    await settle(60)
    emit('pick', 1)
    expect(diagnostics('SYG140')).toEqual([])
    emit('pikc', 1); emit('pikc', 2)
    await settle(60)
    const d = diagnostics('SYG140')
    expect(d).toHaveLength(1)
    expect(d[0].message).toMatch(/widget Picker emitted 'pikc', which is not one of its declared events \(pick\)/)
    expect(d[0].component).toBe('A')
    expect(document.querySelector('.n').textContent).toBe('2')
  })
})

describe('SYG142: reserved command names', () => {
  it('defineWidget throws the formatted SYG142 error', () => {
    expect(() => defineWidget({ mount: () => ({}), commands: { close: () => {} } }))
      .toThrow(/\[Sygnal SYG142\].*can't be named 'close'.*returnValue.*Rename it \(e\.g\. 'dismiss'\).*errors#syg142/)
    expect(() => defineWidget({ mount: () => ({}), commands: { togglePopover: () => {} } })).toThrow(/SYG142.*'togglePopover'.*force/)
    expect(() => defineWidget({ mount: () => ({}), commands: { open: () => {}, focus: () => {} } })).not.toThrow()
  })
})

describe('SYG143: a widget tag as a selector', () => {
  it('warns once per widget and still matches nothing', async () => {
    const W = defineWidget({ name: 'Chart', mount: () => ({}) })
    function A() { return h('div', null, h(W, { className: 'w' })) }
    A.initialState = {}
    A.intent = ({ DOM }) => ({ X: DOM.select(W).events('click'), Y: DOM.click(W) })
    A.model = { X: (s) => s, Y: (s) => s }
    mount(A)
    await settle(60)
    const d = diagnostics('SYG143')
    expect(d).toHaveLength(1)
    expect(d[0].message).toMatch(/widget Chart was used as a selector/)
    expect(d[0].fix).toMatch(/className="due".*controls\(\{ Due: Chart \}\)/)
  })
})

describe('SYG144: a declared event the host fires natively (info)', () => {
  it('reported once per widget at mount', async () => {
    const W = defineWidget({ tag: 'input', mount: () => ({}), events: ['change', 'pick'] })
    function A() { return h('label', null, 'x ', h(W, { className: 'a' }), h(W, { className: 'b' })) }
    A.initialState = {}
    mount(A)
    await settle(60)
    const d = diagnostics('SYG144')
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('info')
    expect(d[0].message).toMatch(/widget <input> declares 'change', which its <input> host also fires natively/)
    expect(d[0].data.events).toEqual(['change'])
  })
})

describe('SYG660–662: mount / update / unmount threw', () => {
  it('SYG660 (mount): coded diagnostic + app onError phase widget + the owner fallback', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onError = vi.fn()
    const W = defineWidget({ name: 'Broken', mount() { throw new Error('mount broke') } })
    function A() { return h('div', null, h(W, { className: 'w' })) }
    A.initialState = {}
    A.onError = (e) => h('em', { className: 'fb' }, e.message)
    mount(A, { onError })
    await settle(60)
    const d = diagnostics('SYG660')
    expect(d).toHaveLength(1)
    expect(d[0].message).toMatch(/widget Broken's mount\(\) threw: mount broke; A's onError fallback renders in its place/)
    expect(d[0].component).toBe('A')
    expect(onError.mock.calls[0][1]).toMatchObject({ phase: 'widget' })
    expect(document.querySelector('.fb').textContent).toBe('mount broke')
    // the bare fallback log is not used when the dev entry reported
    expect(console.error.mock.calls.some(c => c[0] === '[Sygnal SYG660]')).toBe(false)
  })

  it('SYG661 (update) and SYG662 (unmount)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const U = defineWidget({ mount: () => ({}), update(_, p) { if (p.v > 0) throw new Error('update broke') } })
    const D = defineWidget({ mount: () => ({}), unmount() { throw new Error('unmount broke') } })
    function A({ state }) { return h('div', null, h(U, { className: 'u', v: state.v }), state.on ? h(D, { className: 'd' }) : null, h('button', { className: 'b' }, 'b')) }
    A.initialState = { v: 0, on: true }
    A.intent = ({ DOM }) => ({ B: DOM.click('.b') })
    A.model = { B: (s) => ({ v: 1, on: false }) }
    mount(A)
    await settle(60)
    document.querySelector('.b').click()
    await settle(80)
    expect(diagnostics('SYG661').map(d => d.message)).toEqual([expect.stringMatching(/widget <div>'s update\(\) threw: update broke/)])
    expect(diagnostics('SYG662').map(d => d.message)).toEqual([expect.stringMatching(/widget <div>'s unmount\(\) threw: unmount broke/)])
  })

  it('renderComponent collects them (t.diagnostics) with the dev entry loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const W = defineWidget({ mount() { throw new Error('boom') } })
    function A() { return h('div', null, h(W, { className: 'w' })) }
    A.initialState = {}
    const t = renderComponent(A, { dom: 'real' })
    await t.ready()
    await settle(60)
    expect(t.diagnostics.map(d => d.code)).toContain('SYG660')
    t.dispose()
  })
})
