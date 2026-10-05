// @vitest-environment jsdom
// P45-R2 G-275 / G-280: the dev statics freeze (D152).
// - G-275: sygnal/element and Vike put their caller's values (host props, pageContext.data) on a
//   wrapper function's own initialState, which the freeze deep-froze: `hostArray.push(x)` threw
//   in dev. A wrapper-built initial state is marked owned() and left alone.
// - G-280: `component({ view, model, initialState })` (options rather than statics on the view)
//   was no longer frozen at all. The options given to component() are frozen like statics.
//   (R5: component() is gone; defineComponent() assigns the options as statics, so they are.)
import { describe, it, expect, afterEach, vi } from 'vitest'
import { setupChecks } from './diagnostics/helpers.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

vi.mock('sygnal', async () => await import('../src/index.ts'))

const { run, defineComponent } = await import('../src/index.ts')
const { createElement: h } = await import('../src/pragma/index.js')
const { defineElement } = await import('../src/element.ts')
const { renderComponent } = await import('../src/extra/testing.ts')
const { onRenderClient } = await import('../src/vike/onRenderClient.ts')

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const until = (fn) => vi.waitFor(fn, { timeout: 2000, interval: 2 })
const cleanups = []
afterEach(async () => {
  for (const f of cleanups.splice(0)) f()
  document.body.innerHTML = ''
  delete window.__VIKE_SYGNAL_STATE__
  delete globalThis.__SYGNAL_DEV__
  globalThis.__SYGNAL_DIAGNOSTICS__?.__uninstallChecks?.()
  _resetDiagnostics()
  await sleep(10)
})

// run() without a diagnostics option resets the mode when no app is live: dev mode keeps it on
const dev = () => { setupChecks(); globalThis.__SYGNAL_DEV__ = true }

function List({ state }) { return h('ul', { className: 'list' }, ...state.items.map(i => h('li', null, String(i)))) }

describe('P45-R2 G-275: wrapper-built initial state is not frozen', () => {
  it('sygnal/element: the host array set as a prop', async () => {
    dev()
    function Host({ state }) { return List({ state }) }
    Host.initialState = { items: [], meta: { n: 0 } }
    Host.model = { NOOP: (s) => s }
    defineElement('p45r2-host-list', Host, { props: { items: Array } })
    const hostItems = [1, 2]
    const el = document.createElement('p45r2-host-list')
    el.items = hostItems
    document.body.appendChild(el)
    cleanups.push(() => el.remove())
    await until(() => expect(el.querySelectorAll('li').length).toBe(2))
    expect(Object.isFrozen(hostItems)).toBe(false)
    expect(() => hostItems.push(3)).not.toThrow()
    // the component's own statics are still frozen
    expect(Object.isFrozen(Host.model)).toBe(true)
  })

  // (the shell test first: onRenderClient keeps its app; the no-Layout path disposes it)
  it('Vike (with a Layout): pageContext.data', async () => {
    dev()
    document.body.innerHTML = '<div id="page-view"></div>'
    function Layout({ children }) { return h('main', null, ...children) }
    Layout.initialState = {}
    function Page({ state }) { return h('div', null, List({ state })) }
    Page.initialState = { items: [] }
    const data = { items: [1, 2] }
    onRenderClient({ Page, data, config: { Layout: [Layout] } })
    await until(() => expect(document.querySelectorAll('li').length).toBe(2))
    expect(() => data.items.push(3)).not.toThrow()
  })

  it('Vike (no Layout): pageContext.data', async () => {
    dev()
    document.body.innerHTML = '<div id="page-view"></div>'
    function Page({ state }) { return h('div', null, List({ state })) }
    Page.initialState = { items: [] }
    const data = { items: [1, 2] }
    onRenderClient({ Page, data, config: {} })
    await until(() => expect(document.querySelectorAll('li').length).toBe(2))
    expect(() => data.items.push(3)).not.toThrow()
  })
})

describe('P45-R2 G-280: defineComponent() options are frozen like statics (R5: was component())', () => {
  it('defineComponent({ view, model, initialState }): initialState deeply, model at the top level', async () => {
    setupChecks()
    const initialState = { items: [1], nested: { a: 1 } }
    const model = { ADD: (s) => ({ ...s, items: [...s.items, 2] }) }
    const C = defineComponent({ name: 'C', view: List, model, initialState })
    document.body.innerHTML = '<div id="root"></div>'
    const app = run(C, {}, { mountPoint: '#root', diagnostics: 'collect' })
    cleanups.push(() => app.dispose())
    await until(() => expect(document.querySelectorAll('li').length).toBe(1))
    expect(Object.isFrozen(initialState)).toBe(true)
    expect(Object.isFrozen(initialState.items)).toBe(true)
    expect(Object.isFrozen(initialState.nested)).toBe(true)
    expect(Object.isFrozen(model)).toBe(true)
  })

  it("renderComponent's initialState option is still not frozen (G-268)", async () => {
    setupChecks()
    function L({ state }) { return List({ state }) }
    L.initialState = { items: [] }
    const fixture = { items: [1, 2] }
    const t = renderComponent(L, { initialState: fixture })
    cleanups.push(() => t.dispose())
    await t.ready()
    expect(Object.isFrozen(fixture)).toBe(false)
    expect(Object.isFrozen(fixture.items)).toBe(false)
    expect(Object.keys(fixture)).toEqual(['items']) // the mark is not enumerable
  })
})
