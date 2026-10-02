// @vitest-environment jsdom
// PLAN-3 1-A: routed requests ({ url, ok, error }) delivered as actions to exactly the sending
// component instance (makeFetchDriver, driverFromAsync), SYG610 (then/catch keys), G-144
// (dispose mid-flight), G-147 (EVENTS stamping), and the removed legacy HTTP 'initial' hydration.
import { it, expect, beforeEach, afterEach, vi, describe } from 'vitest'
import xs from 'xstream'
import run from '../src/extra/run.js'
import component from '../src/component.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'
import { makeFetchDriver } from '../src/extra/fetchDriver.js'
import { driverFromAsync } from '../src/extra/driverFactories.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (cond, what) => {
  for (const end = Date.now() + 2000; !cond(); await sleep(5)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
  }
}
const text = sel => document.querySelector(sel)?.textContent
const click = sel => document.querySelector(sel).click()

// a fetch stub whose calls are resolved by hand
function stubFetch() {
  const calls = []
  const fetch = vi.fn((url, init) => new Promise((resolve, reject) => calls.push({ url, init, resolve, reject })))
  const respond = (call, body, status = 200) => call.resolve({
    ok: status >= 200 && status < 300, status,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(body),
  })
  const call = url => calls.find(c => c.url === url)
  return { fetch, calls, respond, call }
}

let app, errorSpy
beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>'
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  try { app?.dispose() } catch (_) {}
  app = null
  errorSpy.mockRestore()
})
const start = (App, drivers) => { app = run(App, drivers, { mountPoint: '#root' }); return app }

// ---------------------------------------------------------------------------------------------
// One component; buttons send the requests named in data-* (via intent mapping)
function Quote({ state }) {
  return h('div', null,
    h('button', { className: 'load' }, 'load'),
    h('button', { className: 'other' }, 'other'),
    h('button', { className: 'abort-action' }, 'aa'),
    h('button', { className: 'abort-key' }, 'ak'),
    h('p', { className: 'out' }, `${state.status}:${state.quote ?? ''}`),
    h('p', { className: 'err' }, state.err ? JSON.stringify(state.err) : ''))
}
Quote.initialState = { status: 'idle', n: 0 }
Quote.intent = ({ DOM }) => ({
  LOAD: DOM.click('.load'),
  OTHER: DOM.click('.other'),
  ABORT_ACTION: DOM.click('.abort-action'),
  ABORT_KEY: DOM.click('.abort-key'),
})
const quoteModel = (req = {}) => ({
  LOAD: {
    STATE: s => ({ ...s, status: 'loading', n: s.n + 1 }),
    HTTP: s => ({ url: `/api/q/${s.n}`, ok: 'LOADED', error: 'FAILED', latest: true, ...req }),
  },
  OTHER: { HTTP: () => ({ url: '/api/other', ok: 'OTHER_LOADED', error: 'FAILED', latest: true, ...req }) },
  ABORT_ACTION: { HTTP: () => ({ abort: 'LOADED' }) },
  ABORT_KEY: { HTTP: () => ({ abort: true, key: 'k' }) },
  LOADED: (s, quote) => ({ ...s, status: 'done', quote: quote?.text }),
  OTHER_LOADED: (s, body) => ({ ...s, status: 'other', quote: body.text }),
  FAILED: (s, err) => ({ ...s, status: err.status === 404 ? 'missing' : 'error', err: { status: err.status, body: err.body, message: err.error?.message, url: err.request?.url, keys: Object.keys(err).sort() } }),
})
Quote.model = quoteModel()

describe('makeFetchDriver: routed requests', () => {
  it('happy path: the parsed body arrives as the ok action; select()/errors() see nothing', async () => {
    const f = stubFetch()
    start(Quote, { HTTP: makeFetchDriver({ fetch: f.fetch }) })
    const selected = [], errored = []
    app.sources.HTTP.select().addListener({ next: v => selected.push(v) })
    app.sources.HTTP.errors().addListener({ next: v => errored.push(v) })
    await until(() => document.querySelector('.load'), 'render')
    click('.load')
    await until(() => f.calls.length === 1, 'the request')
    expect(f.calls[0].url).toBe('/api/q/0')  // non-STATE sinks see the pre-action state (G-146)
    f.respond(f.calls[0], { text: 'hi' })
    await until(() => text('.out') === 'done:hi', 'LOADED')
    await sleep(20)
    expect(selected).toEqual([])
    expect(errored).toEqual([])
  })

  it("parse: 'response' gives the ok action the Response", async () => {
    const f = stubFetch()
    let got
    function R() { return h('button', { className: 'go' }, 'go') }
    R.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    R.model = { GO: { HTTP: () => ({ url: '/r', ok: 'GOT', parse: 'response' }) }, GOT: (s, res) => { got = res; return s } }
    R.initialState = {}
    start(R, { HTTP: makeFetchDriver({ fetch: f.fetch }) })
    await until(() => document.querySelector('.go'), 'render')
    click('.go')
    await until(() => f.calls.length === 1, 'the request')
    f.respond(f.calls[0], { a: 1 })
    await until(() => got, 'GOT')
    expect(got.status).toBe(200)
    expect(typeof got.text).toBe('function')
  })

  it('non-2xx: the error action gets { error, status, body, request }', async () => {
    const f = stubFetch()
    start(Quote, { HTTP: makeFetchDriver({ fetch: f.fetch }) })
    await until(() => document.querySelector('.load'), 'render')
    click('.load')
    await until(() => f.calls.length === 1, 'the request')
    f.respond(f.calls[0], { message: 'nope' }, 404)
    await until(() => text('.out') === 'missing:', 'FAILED')
    const err = JSON.parse(text('.err'))
    expect(err).toEqual({ status: 404, body: { message: 'nope' }, message: 'HTTP 404: /api/q/0', url: '/api/q/0', keys: ['body', 'error', 'request', 'status'] })
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('network error: the error action gets { error, request } (no status)', async () => {
    const f = stubFetch()
    start(Quote, { HTTP: makeFetchDriver({ fetch: f.fetch }) })
    await until(() => document.querySelector('.load'), 'render')
    click('.load')
    await until(() => f.calls.length === 1, 'the request')
    f.calls[0].reject(new TypeError('Failed to fetch'))
    await until(() => text('.out') === 'error:', 'FAILED')
    const err = JSON.parse(text('.err'))
    expect(err.message).toBe('Failed to fetch')
    expect(err.url).toBe('/api/q/0')
    expect(err.status).toBeUndefined()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('latest: a second request with the same ok action aborts the first; another ok name does not', async () => {
    const f = stubFetch()
    start(Quote, { HTTP: makeFetchDriver({ fetch: f.fetch }) })
    await until(() => document.querySelector('.load'), 'render')
    click('.load')
    click('.other')
    click('.load')
    await until(() => f.calls.length === 3, 'three requests')
    expect(f.calls.map(c => c.init.signal.aborted)).toEqual([true, false, false])
    f.respond(f.calls[0], { text: 'first' })
    f.respond(f.calls[2], { text: 'second' })
    await until(() => text('.out') === 'done:second', 'second LOADED')
    f.respond(f.calls[1], { text: 'o' })
    await until(() => text('.out') === 'other:o', 'OTHER_LOADED')
  })

  it('latest: an explicit key overrides the ok name', async () => {
    const f = stubFetch()
    const Q = Object.assign(props => Quote(props), { initialState: Quote.initialState, intent: Quote.intent, model: quoteModel({ key: 'k' }) })
    start(Q, { HTTP: makeFetchDriver({ fetch: f.fetch }) })
    await until(() => document.querySelector('.load'), 'render')
    click('.load')
    click('.other')  // same key 'k', different ok: supersedes the first
    await until(() => f.calls.length === 2, 'two requests')
    expect(f.calls.map(c => c.init.signal.aborted)).toEqual([true, false])
    f.respond(f.calls[0], { text: 'late' })
    f.respond(f.calls[1], { text: 'o' })
    await until(() => text('.out') === 'other:o', 'OTHER_LOADED')
    await sleep(20)
    expect(text('.out')).toBe('other:o')
  })

  it("abort by action: { abort: 'LOADED' } cancels that action's requests only", async () => {
    const f = stubFetch()
    start(Quote, { HTTP: makeFetchDriver({ fetch: f.fetch }) })
    await until(() => document.querySelector('.load'), 'render')
    click('.load')
    click('.other')
    await until(() => f.calls.length === 2, 'two requests')
    click('.abort-action')
    await until(() => f.calls[0].init.signal.aborted, 'the abort')
    expect(f.calls[1].init.signal.aborted).toBe(false)
    f.respond(f.calls[0], { text: 'late' })
    await sleep(20)
    expect(text('.out')).toBe('loading:')
    expect(f.calls.length).toBe(2)  // an abort command is not a request
  })

  it('abort by key: { abort: true, key } cancels the requests under that key', async () => {
    const f = stubFetch()
    const Q = Object.assign(props => Quote(props), { initialState: Quote.initialState, intent: Quote.intent, model: quoteModel({ key: 'k', latest: false }) })
    start(Q, { HTTP: makeFetchDriver({ fetch: f.fetch }) })
    await until(() => document.querySelector('.load'), 'render')
    click('.load')
    click('.other')
    await until(() => f.calls.length === 2, 'two requests')
    expect(f.calls.map(c => c.init.signal.aborted)).toEqual([false, false])
    click('.abort-key')
    await until(() => f.calls.every(c => c.init.signal.aborted), 'both aborted')
  })

  it('a request naming only ok sends its failure to errors() (and success never to select())', async () => {
    const f = stubFetch()
    function O() { return h('button', { className: 'go' }, 'go') }
    O.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    O.model = { GO: { HTTP: () => ({ url: '/o', ok: 'GOT' }) }, GOT: s => s }
    O.initialState = {}
    start(O, { HTTP: makeFetchDriver({ fetch: f.fetch }) })
    const errored = []
    app.sources.HTTP.errors().addListener({ next: v => errored.push(v) })
    await until(() => document.querySelector('.go'), 'render')
    click('.go')
    await until(() => f.calls.length === 1, 'the request')
    f.respond(f.calls[0], 'boom', 500)
    await until(() => errored.length === 1, 'errors()')
    expect(errored[0].status).toBe(500)
    expect(errored[0].request).toEqual({ url: '/o', ok: 'GOT' })
  })
})

// ---------------------------------------------------------------------------------------------
// Collection: both items use the same action names; each gets only its own reply
function Item({ state }) {
  return h('li', { className: `item i${state.id}` }, h('button', { className: 'go' }, 'go'), h('span', { className: 'v' }, String(state.v ?? '')))
}
Item.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
Item.model = {
  GO: { HTTP: s => ({ url: `/api/item/${s.id}`, ok: 'GOT', error: 'BAD', latest: true }) },
  GOT: (s, body) => ({ ...s, v: body.v }),
  BAD: s => ({ ...s, v: 'bad' }),
}
function List() {
  return h('div', null, h('button', { className: 'drop' }, 'drop'), h('ul', null, h(Collection, { of: Item, from: 'items' })))
}
List.initialState = { items: [{ id: 1 }, { id: 2 }] }
List.intent = ({ DOM }) => ({ DROP: DOM.click('.drop') })
List.model = { DROP: s => ({ ...s, items: s.items.slice(1) }) }

describe('delivery to the exact instance', () => {
  it('Collection: two items, same ok name, replies in reverse order; each gets only its own', async () => {
    const f = stubFetch()
    start(List, { HTTP: makeFetchDriver({ fetch: f.fetch }) })
    await until(() => document.querySelectorAll('.go').length === 2, 'render')
    click('.i1 .go')
    click('.i2 .go')
    await until(() => f.calls.length === 2, 'both requests')
    // latest is per sender: item 2's request did not abort item 1's
    expect(f.calls.map(c => c.init.signal.aborted)).toEqual([false, false])
    f.respond(f.call('/api/item/2'), { v: 'two' })
    f.respond(f.call('/api/item/1'), { v: 'one' })
    await until(() => text('.i1 .v') === 'one' && text('.i2 .v') === 'two', 'both replies')
  })

  // the default sub-component (isolated, random scope); same action names as the parent
  function Child({ state }) { return h('span', { className: 'child' }, h('button', { className: 'cgo' }, 'c'), String(state.c ?? '')) }
  Child.intent = ({ DOM }) => ({ GO: DOM.click('.cgo') })
  Child.model = {
    GO: { HTTP: () => ({ url: '/api/child', ok: 'GOT' }) },
    GOT: (s, body) => ({ ...s, c: body.v }),
  }
  function Parent({ state }) {
    return h('div', null, h('button', { className: 'pgo' }, 'p'), h('b', { className: 'pv' }, String(state.p ?? '')), h(Child, { state: 'kid' }))
  }
  Parent.initialState = { kid: {} }
  Parent.intent = ({ DOM }) => ({ GO: DOM.click('.pgo') })
  Parent.model = {
    GO: { HTTP: () => ({ url: '/api/parent', ok: 'GOT' }) },
    GOT: (s, body) => ({ ...s, p: body.v }),
  }

  it('parent and child use the same ok name; each gets only its own reply', async () => {
    const f = stubFetch()
    start(Parent, { HTTP: makeFetchDriver({ fetch: f.fetch }) })
    await until(() => document.querySelector('.cgo'), 'render')
    click('.cgo')
    await until(() => f.calls.length === 1, 'child request')
    f.respond(f.calls[0], { v: 'kid' })
    await until(() => text('.child') === 'ckid', 'child GOT')
    expect(text('.pv')).toBe('')
    click('.pgo')
    await until(() => f.calls.length === 2, 'parent request')
    f.respond(f.calls[1], { v: 'dad' })
    await until(() => text('.pv') === 'dad', 'parent GOT')
    expect(text('.child')).toBe('ckid')
  })

  it('unisolated instances sharing one HTTP source (no scope) each get only their own reply', async () => {
    const f = stubFetch()
    const seen = { a: [], b: [] }
    const make = (name, url) => ({
      name,
      model: {
        BOOTSTRAP: { HTTP: () => ({ url, ok: 'GOT', error: 'BAD' }) },
        GOT: (s, body) => { seen[name].push(body.v); return s },
        BAD: s => s,
      },
      // HTTP (and everything but STATE) unisolated: both instances share the same source object
      isolateOpts: { STATE: name, '*': null },
    })
    const App = sources => {
      const a = component({ ...make('a', '/a'), sources })
      const b = component({ ...make('b', '/b'), sources })
      expect(a.HTTP).toBeDefined()
      return {
        HTTP: xs.merge(a.HTTP, b.HTTP),
        STATE: xs.merge(a.STATE, b.STATE),
        __dispose: () => { a.__dispose(); b.__dispose() },
      }
    }
    App.isSygnalComponent = true
    App.initialState = { a: {}, b: {} }
    app = run(App, { HTTP: makeFetchDriver({ fetch: f.fetch }) }, { useDefaultDrivers: false })
    await until(() => f.calls.length === 2, 'both requests')
    f.respond(f.call('/b'), { v: 'B' })
    f.respond(f.call('/a'), { v: 'A' })
    await until(() => seen.a.length && seen.b.length, 'both replies')
    await sleep(20)
    expect(seen).toEqual({ a: ['A'], b: ['B'] })
  })
})

// ---------------------------------------------------------------------------------------------
describe('dispose mid-flight (G-144)', () => {
  it("a removed Collection item's request is aborted at once and nothing is delivered", async () => {
    const f = stubFetch()
    start(List, { HTTP: makeFetchDriver({ fetch: f.fetch }) })
    await until(() => document.querySelectorAll('.go').length === 2, 'render')
    click('.i1 .go')
    await until(() => f.calls.length === 1, 'the request')
    click('.drop')
    await until(() => document.querySelectorAll('.go').length === 1, 'item 1 removed')
    expect(f.calls[0].init.signal.aborted).toBe(true)
    f.respond(f.calls[0], { v: 'late' })
    await sleep(30)
    expect(text('.i2 .v')).toBe('')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('app.dispose(): the routed request is aborted synchronously; a reply in that tick is not delivered', async () => {
    const f = stubFetch()
    const got = []
    function D() { return h('button', { className: 'go' }, 'go') }
    D.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    D.model = { GO: { HTTP: () => ({ url: '/d', ok: 'GOT', error: 'BAD' }) }, GOT: (s, v) => { got.push(v); return s }, BAD: (s, e) => { got.push(e); return s } }
    D.initialState = {}
    start(D, { HTTP: makeFetchDriver({ fetch: f.fetch }) })
    await until(() => document.querySelector('.go'), 'render')
    click('.go')
    await until(() => f.calls.length === 1, 'the request')
    app.dispose()
    app = null
    expect(f.calls[0].init.signal.aborted).toBe(true)
    f.respond(f.calls[0], { v: 'late' })
    await sleep(30)
    expect(got).toEqual([])
  })

  it('no routed action reaches a disposed instance even if the driver still replies', async () => {
    // a hand-made routing driver that ignores the stop and keeps replying
    const listeners = new Map()
    const driver = req$ => {
      const reqs = []
      req$.addListener({ next: r => reqs.push(r), error() {}, complete() {} })
      return {
        __sygnalRoutes: true,
        routed: sender => xs.create({ start: l => listeners.set(sender, l), stop() {} }),
        reqs,
      }
    }
    const got = []
    function D() { return h('div', null, 'd') }
    D.model = { BOOTSTRAP: { X: () => ({ ok: 'GOT' }) }, GOT: (s, v) => { got.push(v); return s } }
    D.initialState = {}
    start(D, { X: driver })
    await until(() => app.sources.X.reqs.length === 1, 'the request')
    const sender = app.sources.X.reqs[0].__emitterId
    expect(typeof sender).toBe('number')
    listeners.get(sender).next({ type: 'GOT', data: 1 })
    await until(() => got.length === 1, 'GOT')
    const l = listeners.get(sender)
    app.dispose()
    app = null
    try { l.next({ type: 'GOT', data: 2 }) } catch (_) {}
    await sleep(30)
    expect(got).toEqual([1])
  })
})

// ---------------------------------------------------------------------------------------------
describe('driverFromAsync: routed requests', () => {
  function A() { return h('div', null, h('button', { className: 'ok' }, 'ok'), h('button', { className: 'bad' }, 'bad')) }
  A.intent = ({ DOM }) => ({ OK: DOM.click('.ok'), BAD: DOM.click('.bad') })
  A.initialState = {}

  it('ok gets the resolved value (after post); error gets { error, request }; select()/errors() see nothing', async () => {
    const got = []
    A.model = {
      OK: { QUOTE: () => ({ value: 2, ok: 'GOT', error: 'FAILED' }) },
      BAD: { QUOTE: () => ({ value: -1, ok: 'GOT', error: 'FAILED' }) },
      GOT: (s, v) => { got.push(['GOT', v]); return s },
      FAILED: (s, e) => { got.push(['FAILED', e.error.message, e.request.value]); return s },
    }
    const fn = async v => { if (v < 0) throw new Error('negative'); return v * 10 }
    start(A, { QUOTE: driverFromAsync(fn, { post: v => v + 1 }) })
    const selected = [], errored = []
    app.sources.QUOTE.select().addListener({ next: v => selected.push(v) })
    app.sources.QUOTE.errors().addListener({ next: v => errored.push(v) })
    await until(() => document.querySelector('.ok'), 'render')
    click('.ok')
    click('.bad')
    await until(() => got.length === 2, 'both outcomes')
    expect(got).toEqual([['GOT', 21], ['FAILED', 'negative', -1]])
    await sleep(20)
    expect(selected).toEqual([])
    expect(errored).toEqual([])
  })

  it('category + select()/errors() are unchanged for unrouted requests', async () => {
    const got = []
    A.model = {
      OK: { QUOTE: () => ({ value: 2, category: 'q' }) },
      BAD: { QUOTE: () => ({ value: -1, category: 'q' }) },
    }
    const fn = async v => { if (v < 0) throw new Error('negative'); return v * 10 }
    start(A, { QUOTE: driverFromAsync(fn) })
    app.sources.QUOTE.select('q').addListener({ next: v => got.push(v) })
    app.sources.QUOTE.errors('q').addListener({ next: v => got.push(v.error.message) })
    await until(() => document.querySelector('.ok'), 'render')
    click('.ok')
    click('.bad')
    await until(() => got.length === 2, 'both outcomes')
    expect(got).toEqual([{ value: 20, category: 'q' }, 'negative'])
  })

  it('a reply for a disposed instance is dropped', async () => {
    const got = []
    let resolve
    A.model = { OK: { QUOTE: () => ({ value: 1, ok: 'GOT' }) }, GOT: (s, v) => { got.push(v); return s } }
    start(A, { QUOTE: driverFromAsync(() => new Promise(r => { resolve = r })) })
    await until(() => document.querySelector('.ok'), 'render')
    click('.ok')
    await until(() => resolve, 'the call')
    app.dispose()
    app = null
    resolve(5)
    await sleep(30)
    expect(got).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
describe("SYG610: requests with a 'then' / 'catch' key are refused", () => {
  it('makeFetchDriver does not send it and reports SYG610', async () => {
    const f = stubFetch()
    function T() { return h('div', null, 't') }
    T.model = { BOOTSTRAP: { HTTP: () => ({ url: '/t', then: 'LOADED' }) } }
    T.initialState = {}
    start(T, { HTTP: makeFetchDriver({ fetch: f.fetch }) })
    await until(() => errorSpy.mock.calls.length > 0, 'the report')
    expect(String(errorSpy.mock.calls[0][0])).toMatch(/SYG610/)
    expect(String(errorSpy.mock.calls[0][0])).toMatch(/\bT\b/)
    expect(f.fetch).not.toHaveBeenCalled()
  })

  it('driverFromAsync does not call the function for a request with catch', async () => {
    const fn = vi.fn(async () => 1)
    function T() { return h('div', null, 't') }
    T.model = { BOOTSTRAP: { QUOTE: () => ({ value: 1, catch: 'FAILED' }) } }
    T.initialState = {}
    start(T, { QUOTE: driverFromAsync(fn) })
    await until(() => errorSpy.mock.calls.length > 0, 'the report')
    expect(String(errorSpy.mock.calls[0][0])).toMatch(/SYG610/)
    expect(fn).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------------------------
describe('unrouted requests are unchanged', () => {
  it('category + select()/errors(); a string request is a GET with no routing', async () => {
    const f = stubFetch()
    function Plain() { return h('div', null, h('button', { className: 'x' }, 'x'), h('button', { className: 's' }, 's')) }
    Plain.intent = ({ DOM, HTTP }) => ({ GO: DOM.click('.x'), STR: DOM.click('.s'), DONE: HTTP.select('c'), ANY: HTTP.select(), FAIL: HTTP.errors('c') })
    Plain.model = {
      GO: { HTTP: () => ({ url: '/plain', category: 'c' }) },
      STR: { HTTP: () => '/str' },
      DONE: (s, r) => ({ ...s, got: r.value }),
      ANY: (s, r) => ({ ...s, any: [...(s.any || []), r.request.url] }),
      FAIL: (s, e) => ({ ...s, failed: e.status }),
    }
    Plain.initialState = {}
    start(Plain, { HTTP: makeFetchDriver({ fetch: f.fetch }) })
    const seen = []
    app.sources.STATE.stream.addListener({ next: s => seen.push(s) })
    await until(() => document.querySelector('.x'), 'render')
    click('.x')
    click('.s')
    await until(() => f.calls.length === 2, 'the requests')
    expect(f.calls[1].url).toBe('/str')
    f.respond(f.calls[0], { a: 1 })
    f.respond(f.calls[1], 'ok')
    await until(() => seen.some(s => s.got?.a === 1 && s.any?.length === 2), 'select() replies')
    click('.x')
    await until(() => f.calls.length === 3, 'third request')
    f.respond(f.calls[2], {}, 500)
    await until(() => seen.some(s => s.failed === 500), 'errors()')
  })
})

// ---------------------------------------------------------------------------------------------
describe('G-147: sender stamps', () => {
  it('EVENTS values are stamped as before (non-objects included); a null EVENTS value does not break select(type)', async () => {
    const heard = []
    function E() { return h('div', null, 'e') }
    E.model = {
      BOOTSTRAP: { EVENTS: () => null },
      SECOND: { EVENTS: () => ({ type: 'PING', data: 1 }) },
    }
    E.intent = ({ EVENTS }) => ({ SECOND: xs.periodic(20).take(1), PONG: EVENTS.select('PING') })
    E.model.PONG = (s, d) => { heard.push(d); return s }
    E.initialState = {}
    start(E, {})
    const raw = []
    app.sinks.EVENTS.addListener({ next: v => raw.push(v) })
    await until(() => heard.length === 1, 'PING')
    expect(heard).toEqual([1])
    const ping = raw.find(v => v.type === 'PING')
    expect(typeof ping.__emitterId).toBe('number')
    expect(ping.__emitterName).toBe('E')
    expect(ping).toEqual({ type: 'PING', data: 1 })  // non-enumerable stamp
  })

  it('object requests to a routing source are stamped; non-objects pass through untouched', async () => {
    const reqs = []
    const driver = req$ => {
      req$.addListener({ next: r => reqs.push(r), error() {}, complete() {} })
      return { __sygnalRoutes: true, routed: () => xs.never() }
    }
    function S() { return h('div', null, 's') }
    S.model = { BOOTSTRAP: { X: () => '/a-string' }, AGAIN: { X: () => ({ url: '/obj' }) } }
    S.intent = () => ({ AGAIN: xs.periodic(20).take(1) })
    S.initialState = {}
    start(S, { X: driver })
    await until(() => reqs.length === 2, 'both values')
    expect(reqs[0]).toBe('/a-string')
    expect(typeof reqs[1].__emitterId).toBe('number')
    expect(reqs[1]).toEqual({ url: '/obj' })
  })

  it('a source without __sygnalRoutes === true gets unstamped values (the DOM Proxy answers any key)', async () => {
    const reqs = []
    const driver = req$ => { req$.addListener({ next: r => reqs.push(r), error() {}, complete() {} }); return { routed: () => xs.never() } }
    function S() { return h('div', null, 's') }
    S.model = { BOOTSTRAP: { X: () => ({ url: '/obj' }) } }
    S.initialState = {}
    start(S, { X: driver })
    await until(() => reqs.length === 1, 'the value')
    expect(reqs[0].__emitterId).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------------------------
describe("legacy @cycle/http 'initial' hydration is removed", () => {
  it("an HTTP source whose select('initial') emits a response stream no longer becomes HYDRATE", async () => {
    let selectedInitial = false
    const legacyHttp = () => ({
      select: c => {
        if (c === 'initial') selectedInitial = true
        return c === 'initial' ? xs.of(xs.of({ hydrated: true })) : xs.never()
      },
    })
    const actions = []
    function L({ state }) { return h('p', { className: 'h' }, String(!!state.hydrated)) }
    L.model = { HYDRATE: (s, d) => { actions.push(d); return { ...s, ...d } } }
    L.initialState = { hydrated: false }
    start(L, { HTTP: legacyHttp })
    await until(() => text('.h') === 'false', 'render')
    await sleep(30)
    expect(selectedInitial).toBe(false)
    expect(actions).toEqual([])
    expect(text('.h')).toBe('false')
  })
})
