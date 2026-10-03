// @vitest-environment jsdom
// PLAN-3 1-D: the dev-entry checks for reply actions. SYG102 counts a request's
// ok/error names as triggers, SYG112 reports a reply action with no model entry when the
// request is sent (with a did-you-mean), strict SYG508 reports the select()/errors() round
// trip on a reply-capable source, inspect() reports the 'reply' trigger, and HYDRATE is an
// ordinary action (D66).
import { it, expect, beforeEach, afterEach, vi, describe } from 'vitest'
import run from '../src/extra/run.js'
import { createElement as h } from '../src/pragma/index.js'
import { makeFetchDriver } from '../src/extra/fetchDriver.js'
import { driverFromAsync } from '../src/extra/driverFactories.js'
import { onIntent, onModel } from '../src/extra/diagnostics/index.js'
import { configureStrict, inspect } from '../src/extra/diagnostics/checks/index.js'
import { setupChecks, diagnostics, settle } from './diagnostics/helpers.js'

const click = sel => document.querySelector(sel).click()
const json = body => Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) })

let app, errorSpy
beforeEach(() => {
  setupChecks()
  document.body.innerHTML = '<div id="root"></div>'
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  try { app?.dispose() } catch (_) {}
  app = null
  configureStrict(undefined)
  errorSpy.mockRestore()
})
const start = (App, drivers) => { app = run(App, drivers, { mountPoint: '#root', diagnostics: 'collect' }); return app }

function Quote({ state }) {
  return h('div', null, h('button', { className: 'load' }, 'load'), h('p', { className: 'out' }, state.status))
}
const make = (request, extra = {}) => {
  const C = (props) => Quote(props)
  Object.defineProperty(C, 'name', { value: 'Quote' })
  C.initialState = { status: 'idle' }
  C.intent = ({ DOM }) => ({ LOAD: DOM.click('.load') })
  C.model = {
    LOAD: { HTTP: request },
    LOADED: (s, body) => ({ ...s, status: `done:${body.text}` }),
    FAILED: (s) => ({ ...s, status: 'error' }),
    ...extra,
  }
  return C
}

describe('SYG102: reply-action names count as triggers', () => {
  it('reports nothing for entries a request with reply actions names', async () => {
    start(make(() => ({ url: '/q', ok: 'LOADED', error: 'FAILED' })), { HTTP: makeFetchDriver({ fetch: () => json({ text: 'hi' }) }) })
    await settle(30)
    expect(diagnostics('SYG102')).toEqual([])
  })

  it('still reports an entry nothing names', async () => {
    start(make(() => ({ url: '/q', ok: 'LOADED' })), { HTTP: makeFetchDriver({ fetch: () => json({ text: 'hi' }) }) })
    await settle(30)
    expect(diagnostics('SYG102').map(d => d.data.action)).toEqual(['FAILED'])
  })

  it('reads the names from the sink functions, shorthand keys and connections (no request sent)', () => {
    const view = () => null
    view.connections = (state) => ({ room: { socket: '/ws', message: 'RECEIVED', close: "CLOSED" } })
    const component = { name: 'Chat', view, intent$: {}, model: {
      'GO | HTTP': () => ({ url: '/a', "ok": "DONE" }),
      SEND: { WS: function (s) { return { to: 'room', error: `SEND_FAILED` } } },
    } }
    onIntent(component, [], undefined)
    onModel(component, { GO: ['HTTP'], SEND: ['WS'], DONE: ['STATE'], SEND_FAILED: ['STATE'], RECEIVED: ['STATE'], CLOSED: ['STATE'], ORPHAN: ['STATE'] })
    expect(diagnostics('SYG102').map(d => d.data.action).sort()).toEqual(['GO', 'ORPHAN', 'SEND'])
  })
})

describe('SYG112: reply action with no model entry', () => {
  it('reports when the request is sent, as an error, with the nearest model key', async () => {
    start(make(() => ({ url: '/q', ok: 'LAODED', error: 'FAILED' })), { HTTP: makeFetchDriver({ fetch: () => json({ text: 'hi' }) }) })
    await settle(20)
    expect(diagnostics('SYG112')).toEqual([])   // nothing sent yet
    click('.load')
    await settle(30)
    const found = diagnostics('SYG112')
    expect(found).toHaveLength(1)
    expect(found[0].severity).toBe('error')
    expect(found[0].component).toBe('Quote')
    expect(found[0].data).toMatchObject({ action: 'LAODED', key: 'ok', sink: 'HTTP', suggestion: 'LOADED' })
    expect(found[0].message).toContain("did you mean 'LOADED'?")
    expect(found[0].fix).toContain("ok: 'LOADED'")
    expect(document.querySelector('.out').textContent).toBe('idle')   // the reply was dropped
  })

  it('reports once per component and name, and not for names the model has', async () => {
    start(make(() => ({ url: '/q', ok: 'LOADED', error: 'OOPS_NOT_HANDLED' })), { HTTP: makeFetchDriver({ fetch: () => json({ text: 'hi' }) }) })
    await settle(20)
    click('.load'); click('.load')
    await settle(30)
    const found = diagnostics('SYG112')
    expect(found.map(d => d.data.action)).toEqual(['OOPS_NOT_HANDLED'])
    expect(found[0].data.suggestion).toBeUndefined()
    expect(document.querySelector('.out').textContent).toBe('done:hi')
  })

  it('works for driverFromAsync too, and ignores plain requests and sinks without reply actions', async () => {
    const C = make(() => ({ url: '/q', ok: 'LOADED' }), {
      LOAD: { QUOTE: () => ({ value: 1, ok: 'LOADDE' }), LOG: () => ({ ok: 'NOPE' }), HTTP: () => '/plain-get' },
    })
    const log = () => ({ select: () => null })
    start(C, { QUOTE: driverFromAsync(async () => ({ text: 'x' })), HTTP: makeFetchDriver({ fetch: () => json({}) }), LOG: () => { return log() } })
    await settle(20)
    click('.load')
    await settle(30)
    expect(diagnostics('SYG112').map(d => [d.data.sink, d.data.action])).toEqual([['QUOTE', 'LOADDE']])
  })
})

describe('SYG508 (strict): select()/errors() round trip on a reply-capable source', () => {
  const roundTrip = () => {
    const C = make(() => ({ category: 'quote', url: '/q' }))
    C.intent = ({ DOM, HTTP }) => ({ LOAD: DOM.click('.load'), LOADED: HTTP.select('quote').map(r => r.value), FAILED: HTTP.errors('quote') })
    return C
  }

  it('reports when a plain request goes out whose category the instance selects', async () => {
    configureStrict(true)
    start(roundTrip(), { HTTP: makeFetchDriver({ fetch: () => json({ text: 'hi' }) }) })
    await settle(20)
    click('.load')
    await settle(30)
    const found = diagnostics('SYG508')
    expect(found).toHaveLength(1)
    expect(found[0].severity).toBe('warn')
    expect(found[0].data).toMatchObject({ sink: 'HTTP', category: 'quote' })
    expect(found[0].message).toMatch(/HTTP\.(select|errors)\('quote'\)/)
    expect(found[0].fix).toContain("ok: 'LOADED', error: 'FAILED'")
    expect(document.querySelector('.out').textContent).toBe('done:hi')   // the wrapped source still works
  })

  it('is quiet when strict is off, and for requests with reply actions', async () => {
    start(roundTrip(), { HTTP: makeFetchDriver({ fetch: () => json({ text: 'hi' }) }) })
    await settle(20)
    click('.load')
    await settle(30)
    expect(diagnostics('SYG508')).toEqual([])
    app.dispose(); app = null

    configureStrict(true)
    const C = make(() => ({ url: '/q', ok: 'LOADED', category: 'quote' }))
    C.intent = ({ DOM, HTTP }) => ({ LOAD: DOM.click('.load'), OTHER: HTTP.select('quote') })
    C.model.OTHER = (s) => s
    start(C, { HTTP: makeFetchDriver({ fetch: () => json({ text: 'hi' }) }) })
    await settle(20)
    click('.load')
    await settle(30)
    expect(diagnostics('SYG508')).toEqual([])
  })
})

describe('inspect(): reply trigger', () => {
  it("marks actions a sent request named as 'reply'", async () => {
    start(make(() => ({ url: '/q', ok: 'LOADED', error: 'FAILED' })), { HTTP: makeFetchDriver({ fetch: () => json({ text: 'hi' }) }) })
    await settle(20)
    click('.load')
    await settle(30)
    const quote = inspect().components.find(c => c.name === 'Quote')
    const t = Object.fromEntries(quote.actions.map(a => [a.name, a.trigger]))
    expect(t).toMatchObject({ LOAD: 'intent', LOADED: 'reply', FAILED: 'reply', INITIALIZE: 'builtin' })
  })
})

describe('HYDRATE is an ordinary action (D66)', () => {
  it('a HYDRATE model entry nothing triggers is SYG102', async () => {
    const component = { name: 'App', intent$: { GO: {} } }
    onIntent(component, ['GO'], undefined)
    onModel(component, { GO: ['STATE'], HYDRATE: ['STATE'] })
    expect(diagnostics('SYG102').map(d => d.data.action)).toEqual(['HYDRATE'])
  })

  it('an intent HYDRATE action without a model entry is SYG101', () => {
    const component = { name: 'App', intent$: { HYDRATE: {} } }
    onIntent(component, ['HYDRATE'], undefined)
    onModel(component, {})
    expect(diagnostics('SYG101').map(d => d.data.action)).toEqual(['HYDRATE'])
  })

  it('a HYDRATE reducer that drops keys is SYG201 (no longer skipped)', async () => {
    const C = make(() => ({ url: '/q', ok: 'LOADED', error: 'FAILED' }), { HYDRATE: () => ({ fresh: true }) })
    C.intent = ({ DOM }) => ({ LOAD: DOM.click('.load'), HYDRATE: DOM.click('.load') })
    start(C, { HTTP: makeFetchDriver({ fetch: () => json({ text: 'hi' }) }) })
    await settle(20)
    click('.load')
    await settle(30)
    expect(diagnostics('SYG201').map(d => d.data.action)).toContain('HYDRATE')
  })
})
