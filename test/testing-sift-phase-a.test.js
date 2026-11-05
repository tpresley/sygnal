// The Sift console port's Phase A findings on renderComponent's mock DOM (7.2.0-preview.5)
import { describe, it, expect, vi } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { makeRouter, Portal } from '../src/index.js'

describe("mock DOM: an intent's preventDefault", () => {
  it('a link whose click the intent prevents is not followed by the router fake', async () => {
    const router = makeRouter({ a: '/a', b: '/b' })
    function C({ state }) { return h('div', null, h('a', { className: 'go', attrs: { href: '/b' } }, 'go'), h('span', null, String(state.went))) }
    C.route = 'ROUTE'
    C.intent = ({ DOM }) => ({ GO: DOM.click('.go', { preventDefault: true }) })
    C.model = { ROUTE: (s, route) => ({ ...s, route }), GO: (s) => ({ ...s, went: s.went + 1 }) }
    const t = renderComponent(C, { initialState: { route: null, went: 0 }, router, url: '/a' })
    await t.ready()
    await t.simulateEvent('.go', 'click')
    await t.settle()
    expect(t.state.went).toBe(1)
    expect(t.location.path).toBe('/a')
    t.dispose()
  })

  it('the option applies to the event the intent receives (a pattern too); without it the link is followed', async () => {
    const router = makeRouter({ a: '/a', b: '/b' })
    const seen = []
    function C() { return h('div', null, h('a', { className: 'go', attrs: { href: '/b' } }, 'go'), h('input', { className: 'k' })) }
    C.route = 'ROUTE'
    C.intent = ({ DOM }) => ({
      GO: DOM.click('.go').map(e => e.defaultPrevented),
      KEY: DOM.select('.k').events('keydown', { preventDefault: { key: 'Enter' } }).map(e => [e.key, e.defaultPrevented]),
    })
    C.model = { ROUTE: (s, route) => ({ ...s, route }), GO: (s, p) => (seen.push(p), s), KEY: (s, p) => (seen.push(p), s) }
    const t = renderComponent(C, { initialState: { route: null }, router, url: '/a' })
    await t.ready()
    await t.simulateEvent('.k', 'keydown', { key: 'Enter' })
    await t.simulateEvent('.k', 'keydown', { key: 'a' })
    await t.simulateEvent('.go', 'click')
    await t.settle()
    expect(seen).toEqual([['Enter', true], ['a', false], false])
    expect(t.location.path).toBe('/b')
    t.dispose()
  })
})

describe("mock DOM: listening through the document (a Portal's content)", () => {
  function C({ state }) {
    return h('div', null,
      h('button', { className: 'b' }, 'x'),
      h(Portal, { target: 'body' }, h('details', { className: 'hint-box', id: 'h1' }, 'y')),
      h('span', null, String(state.got)))
  }
  C.intent = ({ DOM }) => ({
    TOGGLE: DOM.select('document').select('.hint-box').events('toggle', { useCapture: true }).map(e => e.target.id),
    // without useCapture a non-bubbling event never reaches the document
    BUBBLE: DOM.select('document').select('.hint-box').events('toggle').map(() => 'bubbled'),
    CLICK: DOM.select('document').select('.b').events('click').map(e => e.target.tagName),
  })
  C.model = { TOGGLE: (s, id) => ({ ...s, got: id }), BUBBLE: (s) => ({ ...s, bubbled: true }), CLICK: (s, tag) => ({ ...s, got: tag }) }
  C.initialState = { got: null, bubbled: false }

  it("t.simulateEvent on the element reaches DOM.select('document').select(sel); a non-bubbling event with useCapture", async () => {
    const t = renderComponent(C)
    await t.ready()
    await t.simulateEvent('.hint-box', 'toggle')
    await t.settle()
    expect(t.state).toEqual({ got: 'h1', bubbled: false })
    await t.simulateEvent('.b', 'click')
    await t.settle()
    expect(t.state.got).toBe('BUTTON')
    t.dispose()
  })

  // (a page target names the listener: it is delivered to it, whatever its options)
  it("'document .hint-box' reaches that listener with the element as its target", async () => {
    const t = renderComponent(C)
    await t.ready()
    await t.simulateEvent('document .hint-box', 'toggle')
    await t.settle()
    expect(t.state.got).toBe('h1')
    t.dispose()
  })

  it('a capture listener on an ancestor hears a non-bubbling event on its way down, before the target', async () => {
    const order = []
    function D() { return h('div', { className: 'outer' }, h('dialog', { className: 'dlg' }, 'z')) }
    D.intent = ({ DOM }) => ({
      OUTER: DOM.select('.outer').events('close', { useCapture: true }).map(() => 'outer'),
      PLAIN: DOM.select('.outer').events('close').map(() => 'plain'),
      TARGET: DOM.select('.dlg').events('close').map(() => 'target'),
    })
    D.model = { OUTER: (s, v) => (order.push(v), s), PLAIN: (s, v) => (order.push(v), s), TARGET: (s, v) => (order.push(v), s) }
    D.initialState = {}
    const t = renderComponent(D)
    await t.ready()
    await t.simulateEvent('.dlg', 'close')
    await t.settle()
    expect(order).toEqual(['outer', 'target'])
    t.dispose()
  })
})

// t.respond's wait behind queued input (up to 1 s) caught a timer's request only well inside that
// second, so a 1 s poll raced it. A poll due within timeoutMs is waited for now (maintainer decision)
describe("t.respond and refetchEvery: a poll due within timeoutMs is waited for", () => {
  function Q({ state }) { return h('p', null, String(state.quote?.data?.n ?? '-')) }
  Q.resources = { quote: () => ({ url: '/api/q', refetchEvery: 1000 }) }
  Q.initialState = {}

  it('nothing pending yet: t.respond waits for the poll and answers it', async () => {
    const t = renderComponent(Q)
    await t.ready()
    await t.respond('HTTP', { n: 1 }, 'quote')
    const t0 = Date.now()
    await t.respond('HTTP', { n: 2 }, 'quote')
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900)
    expect(t.state.quote).toMatchObject({ data: { n: 2 }, status: 'success' })
    await t.respond('HTTP', { n: 3 }, 'quote')
    expect(t.state.quote.data).toEqual({ n: 3 })
    t.dispose()
  })

  it('a poll the state turns on (refetchEvery: state.pending ? 1000 : undefined) is waited for too', async () => {
    function P({ state }) { return h('p', null, state.item?.data?.pending ? 'pending' : 'done') }
    P.resources = { item: (s) => ({ url: '/item', refetchEvery: s.item?.data?.pending ? 1000 : undefined }) }
    P.initialState = {}
    const t = renderComponent(P)
    await t.ready()
    await t.respond('HTTP', { pending: true }, 'item')
    await t.settle()
    await t.respond('HTTP', { pending: false }, 'item')
    expect(t.requests('HTTP').length).toBe(2)
    // off again: nothing polls, so the next t.respond throws at once
    await t.settle()
    expect(() => t.respond('HTTP', { pending: false }, 'item')).toThrow(/no pending HTTP request/)
    t.dispose()
  })

  it('a poll due later than timeoutMs less 250 ms (1.8 s of 2 s) throws at once', async () => {
    function L() { return h('p', null, '-') }
    L.resources = { item: () => ({ url: '/item', refetchEvery: 1800 }) }
    L.initialState = {}
    const t = renderComponent(L)
    await t.ready()
    await t.respond('HTTP', 1, 'item')
    expect(() => t.respond('HTTP', 2, 'item')).toThrow(/polls every 1800ms/)
    t.dispose()
  })

  it('behind a queued input (the race): the poll is answered every time', async () => {
    function P({ state }) { return h('p', null, String(state.quote?.data?.n ?? '-')) }
    P.resources = { quote: () => ({ url: '/api/q', refetchEvery: 1000 }) }
    P.initialState = { clicks: 0 }
    P.model = { CLICK: (s) => ({ ...s, clicks: s.clicks + 1 }) }
    const t = renderComponent(P)
    await t.ready()
    await t.respond('HTTP', { n: 1 }, 'quote')
    t.simulateAction('CLICK')
    await t.respond('HTTP', { n: 2 }, 'quote')
    expect(t.state).toMatchObject({ clicks: 1, quote: { data: { n: 2 } } })
    t.dispose()
  })

  it('a poll due later than timeoutMs: t.respond throws at once, naming the poll', async () => {
    function S() { return h('p', null, '-') }
    S.resources = { quote: () => ({ url: '/api/q', refetchEvery: 5000 }) }
    S.initialState = {}
    const t = renderComponent(S)
    await t.ready()
    await t.respond('HTTP', { n: 1 }, 'quote')
    expect(() => t.respond('HTTP', { n: 2 }, 'quote')).toThrow(/polls every 5000ms \(refetchEvery\)/)
    t.dispose()
  })

  it('real timers: wait for the poll (refreshing), then answer it', async () => {
    const t = renderComponent(Q)
    await t.ready()
    await t.respond('HTTP', { n: 1 }, 'quote')
    await t.waitForState(s => s.quote.refreshing)
    await t.respond('HTTP', { n: 2 }, 'quote')
    expect(t.state.quote).toMatchObject({ data: { n: 2 }, status: 'success' })
    t.dispose()
  })

  it('fake timers: an awaited t.respond advances the clock to the poll', async () => {
    vi.useFakeTimers()
    try {
      const t = renderComponent(Q)
      await t.ready()
      await t.respond('HTTP', { n: 1 }, 'quote')
      await t.respond('HTTP', { n: 2 }, 'quote')
      expect(t.state.quote.data).toEqual({ n: 2 })
      t.dispose()
    } finally { vi.useRealTimers() }
  })

  it('fake timers: advance by refetchEvery, then answer it', async () => {
    vi.useFakeTimers()
    try {
      const t = renderComponent(Q)
      await t.ready()
      await t.respond('HTTP', { n: 1 }, 'quote')
      await vi.advanceTimersByTimeAsync(1000)
      await t.respond('HTTP', { n: 2 }, 'quote')
      expect(t.state.quote.data).toEqual({ n: 2 })
      t.dispose()
    } finally { vi.useRealTimers() }
  })
})
