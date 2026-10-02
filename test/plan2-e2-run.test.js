// @vitest-environment jsdom
// PLAN-2 E2: makeFetchDriver under run() in a real DOM, and SYG609 (G-110): a sink or source
// with no driver is reported instead of being dropped silently.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import run from '../src/extra/run.js'
import { makeFetchDriver } from '../src/extra/fetchDriver.js'
import { createElement as h } from '../src/pragma/index.js'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))
let app
beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>'
  setupChecks('collect')
})
afterEach(() => {
  try { app?.dispose() } catch (_) {}
  app = null
  vi.unstubAllGlobals()
})

function Quote({ state }) {
  return h('div', null, h('button', { className: 'get' }, 'Get'), h('p', { className: 'q' }, state.text))
}
Quote.initialState = { text: 'none' }
Quote.intent = ({ DOM, HTTP }) => ({
  LOAD: DOM.click('.get'),
  LOADED: HTTP.select('quote'),
  FAILED: HTTP.errors('quote'),
})
Quote.model = {
  LOAD: {
    STATE: s => ({ ...s, text: 'Loading…' }),
    HTTP: () => ({ category: 'quote', url: '/api/quote' }),
  },
  LOADED: (s, { value }) => ({ ...s, text: `${value.text} — ${value.author}` }),
  FAILED: (s, { status }) => ({ ...s, text: status === 404 ? 'Not found' : 'Could not load a quote.' }),
}

describe('E2: makeFetchDriver under run()', () => {
  it('loads, fails and retries in the real DOM', async () => {
    const pending = []
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve, reject) => pending.push({ resolve, reject }))))
    app = run(Quote, { HTTP: makeFetchDriver() }, { mountPoint: '#root' })
    // G-126: wait for conditions (bounded), not fixed sleeps: the machine may be loaded
    const until = async (cond, what) => {
      for (const end = Date.now() + 2000; !cond(); await sleep(5)) {
        if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
      }
    }
    const text = () => document.querySelector('.q')?.textContent
    await until(() => document.querySelector('.get'), 'the first render')
    document.querySelector('.get').click()
    await until(() => text() === 'Loading…' && pending.length === 1, 'Loading… and a request')
    pending.shift().resolve(new Response(JSON.stringify({ text: 'Hi', author: 'Me' }), { headers: { 'Content-Type': 'application/json' } }))
    await until(() => text() === 'Hi — Me', 'the quote')
    document.querySelector('.get').click()
    await until(() => pending.length === 1, 'the second request')
    pending.shift().reject(new TypeError('Failed to fetch'))
    await until(() => text() === 'Could not load a quote.', 'the error text')
    expect(diagnostics('SYG609')).toEqual([])
  })
})

describe('SYG609: sink or source with no driver', () => {
  it('reports a source the intent reads that no driver provides (before the TypeError)', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => { app = run(Quote, {}, { mountPoint: '#root', diagnostics: 'collect' }) }).toThrow(/undefined/)
    const found = diagnostics('SYG609')
    expect(found.length).toBeGreaterThanOrEqual(1)
    expect(found[0].severity).toBe('warn')
    expect(found[0].message).toContain('Quote.intent reads the HTTP source, but no driver named HTTP was passed to run()')
    expect(found[0].fix).toContain('makeFetchDriver()')
    errors.mockRestore()
  })

  it("reports a child's sink that no driver receives (it would be dropped silently)", async () => {
    function Saver() { return h('button', { className: 'save' }, 'save') }
    Saver.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
    Saver.model = { SAVE: { API: () => ({ url: '/save' }) } }
    function App() { return h('div', null, h(Saver, { state: 'saver' })) }
    App.initialState = { saver: {} }
    app = run(App, {}, { mountPoint: '#root', diagnostics: 'collect' })
    await sleep(30)
    const found = diagnostics('SYG609')
    expect(found).toHaveLength(1)
    expect(found[0].component).toBe('Saver')
    expect(found[0].message).toContain("Model entry 'SAVE' sends to the API sink, but no driver named API")
    expect(found[0].data).toMatchObject({ name: 'API', kind: 'sink', action: 'SAVE' })
  })

  it('is not reported when the driver is passed, for built-in sinks, or under renderComponent', async () => {
    function App() { return h('div', null, 'x') }
    App.initialState = {}
    App.intent = ({ DOM }) => ({ GO: DOM.click('.x') })
    App.model = { GO: { LOG: () => 'x', EFFECT: () => {}, EVENTS: () => ({ type: 'A' }), API: () => ({ url: '/a' }) } }
    app = run(App, { API: makeFetchDriver() }, { mountPoint: '#root', diagnostics: 'collect' })
    await sleep(30)
    expect(diagnostics('SYG609')).toEqual([])
    app.dispose(); app = null

    const { renderComponent } = await import('../src/extra/testing.js')
    const t = renderComponent(Quote)
    await t.ready()
    expect(t.diagnostics.filter(d => d.code === 'SYG609')).toEqual([])
    t.dispose()
  })
})
