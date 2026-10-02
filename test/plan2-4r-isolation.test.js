// @vitest-environment jsdom
// PLAN-2 4-R (R4-2, D54): component instances get their own HTTP replies, `latest` and
// `abort`, under run() with makeFetchDriver and in renderComponent's fake. Two Search
// instances, and Collection items each loading their detail with latest: true, need no
// request ids or stale checks.
import { describe, it, expect, vi, afterEach } from 'vitest'
import run from '../src/extra/run.js'
import { makeFetchDriver } from '../src/extra/fetchDriver.js'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/index.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))
// G-126: wait for conditions (bounded), not fixed sleeps: the machine may be loaded
const until = async (cond, what) => {
  for (const end = Date.now() + 3000; !cond(); await sleep(5)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
  }
}

let app, t
afterEach(() => {
  try { app?.dispose() } catch (_) {}
  app = null
  if (t) t.dispose()
  t = null
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

// the docs' Search shape, without the debounce
function Search({ state }) {
  return h('div', { className: 'search' },
    h('input', { className: 'q', value: state.query }),
    h('p', { className: 'status' }, state.status),
    h('ul', { className: 'results' }, ...state.results.map(r => h('li', null, r))))
}
Search.initialState = { query: '', status: 'idle', results: [] }
Search.isolatedState = true
Search.intent = ({ DOM, HTTP }) => ({
  SEARCH: DOM.input('.q').value(),
  RESULTS: HTTP.select('search'),
  FAILED: HTTP.errors('search'),
})
Search.model = {
  SEARCH: {
    STATE: (state, query) => ({ ...state, query, status: 'searching' }),
    HTTP: (state, q) => ({ category: 'search', url: '/api/search', query: { q }, latest: true }),
  },
  RESULTS: (state, { value }) => ({ ...state, status: 'done', results: value }),
  FAILED: (state) => ({ ...state, status: 'failed', results: [] }),
}
function TwoSearches() {
  return h('main', null, h('section', { className: 'left' }, h(Search)), h('section', { className: 'right' }, h(Search)))
}

function Item({ state }) {
  return h('li', { className: 'item', data: { id: state.id } }, h('button', { className: 'load' }, 'load'), `${state.id}:${state.detail || '-'}`)
}
Item.intent = ({ DOM, HTTP }) => ({ LOAD: DOM.click('.load'), GOT: HTTP.select('detail') })
Item.model = {
  LOAD: { HTTP: (state) => ({ url: `/items/${state.id}`, category: 'detail', latest: true }) },
  GOT: (state, { value }) => ({ ...state, detail: value }),
}
function List() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
List.initialState = { items: [{ id: 1 }, { id: 2 }] }

/** a fetch stub: calls stay pending; records aborts */
function stubFetch() {
  const calls = []
  vi.stubGlobal('fetch', vi.fn((url, init) => new Promise((resolve, reject) => {
    const call = { url, resolve, reject, aborted: false }
    init?.signal?.addEventListener('abort', () => { call.aborted = true })
    calls.push(call)
  })))
  return calls
}
const reply = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
const input = (sel, value) => {
  const el = document.querySelector(sel)
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('R4-2 under run() with makeFetchDriver', () => {
  it('two Search instances: each gets its own results; latest: true in one does not abort the other', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const calls = stubFetch()
    app = run(TwoSearches, { HTTP: makeFetchDriver() }, { mountPoint: '#root' })
    await until(() => document.querySelector('.right .q'), 'the first render')
    input('.left .q', 'dune')
    await until(() => calls.length === 1, 'the left request')
    input('.right .q', 'emma')
    await until(() => calls.length === 2, 'the right request')
    expect(calls.map(c => c.aborted)).toEqual([false, false])
    calls[1].resolve(reply(['Emma']))
    calls[0].resolve(reply(['Dune']))
    const text = (sel) => document.querySelector(sel).textContent
    await until(() => text('.left .results') === 'Dune' && text('.right .results') === 'Emma', 'both results')
    // latest: true still drops the superseded request within one instance
    input('.left .q', 'dun')
    input('.left .q', 'du')
    await until(() => calls.length === 4, 'two more left requests')
    expect(calls.map(c => c.aborted)).toEqual([false, false, true, false])
  })

  it('Collection items each loading their detail with latest: true', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const calls = stubFetch()
    app = run(List, { HTTP: makeFetchDriver() }, { mountPoint: '#root' })
    await until(() => document.querySelectorAll('.item .load').length === 2, 'the items')
    document.querySelector('.item[data-id="1"] .load').click()
    document.querySelector('.item[data-id="2"] .load').click()
    await until(() => calls.length === 2, 'two requests')
    expect(calls.map(c => c.aborted)).toEqual([false, false])
    calls[0].resolve(reply('D1'))
    calls[1].resolve(reply('D2'))
    const items = () => [...document.querySelectorAll('.item')].map(e => e.textContent.replace('load', ''))
    await until(() => items().join() === '1:D1,2:D2', 'each item its own detail')
  })
})

describe('R4-2 in renderComponent (the fake HTTP source)', () => {
  it('Collection items (child-only HTTP): each item gets the reply to its own request', async () => {
    t = renderComponent(List)
    await t.ready()
    t.simulateEvent('.item[data-id="1"] .load', 'click')
    t.simulateEvent('.item[data-id="2"] .load', 'click')
    await t.settle()
    const [r1, r2] = t.requests('HTTP')
    expect([r1, r2]).toEqual([{ url: '/items/1', category: 'detail', latest: true }, { url: '/items/2', category: 'detail', latest: true }])
    t.respond('HTTP', 'D1', { request: r1 })
    t.respond('HTTP', 'D2', { request: r2 })
    await t.settle()
    expect(t.html()).toContain('1:D1')
    expect(t.html()).toContain('2:D2')
    expect(t.diagnostics.map(d => d.code)).toEqual([])
  })

  it('two Search instances: latest: true in one does not supersede the other', async () => {
    t = renderComponent(TwoSearches)
    await t.ready()
    t.simulateEvent('.left .q', 'input', { value: 'dune' })
    t.simulateEvent('.right .q', 'input', { value: 'emma' })
    await t.settle()
    const [left, right] = t.requests('HTTP')
    t.respond('HTTP', ['Emma'], { request: right })
    t.respond('HTTP', ['Dune'], { request: left })
    await t.settle()
    const [, leftHtml, rightHtml] = t.html().match(/<section class="left">(.*)<\/section><section class="right">(.*)<\/section>/)
    expect(leftHtml).toContain('<ul class="results"><li>Dune</li></ul>')
    expect(rightHtml).toContain('<ul class="results"><li>Emma</li></ul>')
  })

  it('a root component that sends HTTP itself: children are scoped through isolate (driver path)', async () => {
    function Page({ state }) { return h('div', null, h('button', { className: 'mine' }, 'm'), h('span', { className: 'own' }, state.own || '-'), h(Search)) }
    Page.initialState = { own: '' }
    Page.intent = ({ DOM, HTTP }) => ({ MINE: DOM.click('.mine'), GOT: HTTP.select('search') })
    Page.model = {
      MINE: { HTTP: () => ({ url: '/mine', category: 'search', latest: true }) },
      GOT: (state, { value }) => ({ ...state, own: String(value) }),
    }
    t = renderComponent(Page)
    await t.ready()
    t.simulateEvent('.q', 'input', { value: 'dune' })
    t.simulateEvent('.mine', 'click')
    await t.settle()
    const [child, own] = t.requests('HTTP')
    expect(own.url).toBe('/mine')
    // the root's latest: true didn't supersede the child's request; the child's reply reaches
    // the root too (it sees everything), the root's own reply doesn't reach the child
    t.respond('HTTP', ['Dune'], { request: child })
    await t.settle()
    expect(t.html()).toContain('<li>Dune</li>')
    t.respond('HTTP', 'ROOT', { request: own })
    await t.settle()
    expect(t.html()).toContain('<span class="own">ROOT</span>')
    expect(t.html()).toContain('<li>Dune</li>')
  })

  it("t.respond's 'nothing receives it' message lists no legacy select('initial') (R4-7)", async () => {
    function Q({ state }) { return h('div', null, h('button', { className: 'get' }, 'g'), state.text) }
    Q.initialState = { text: '' }
    Q.intent = ({ DOM, HTTP }) => ({ LOAD: DOM.click('.get'), LOADED: HTTP.select('quotes') })
    Q.model = { LOAD: { HTTP: () => ({ category: 'quote', url: '/q' }) }, LOADED: (s, r) => ({ text: r.value }) }
    t = renderComponent(Q)
    t.simulateEvent('.get', 'click')
    t.respond('HTTP', 'hi')
    const err = await t.next(s => s.text === 'hi', 2000).then(() => null, e => e)
    expect(err.message).toContain("listening: HTTP.select('quotes')")
    expect(err.message).not.toContain('initial')
  })
})
