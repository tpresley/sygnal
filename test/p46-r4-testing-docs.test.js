// @vitest-environment jsdom
// PLAN-4.6 R4 (D176): the waiting patterns docs/integration/testing.md documents, as written there,
// on both cores. On the next core a reducer runs synchronously, so the state an input causes can
// be recorded before the next() call that follows it; the input-armed cursor (testing.ts) has to
// keep every pattern below working unchanged.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { renderComponent, createElement as h, xs, event } from '../src/index.js'

let t
afterEach(() => { t?.dispose(); t = null; vi.useRealTimers() })

function Counter({ state }) { return h('div', null, h('button', { className: 'inc' }, '+'), h('button', { className: 'reset' }, '0'), h('span', { className: 'count' }, String(state.count))) }
Counter.initialState = { count: 0 }
Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc'), RESET: DOM.click('.reset') })
Counter.model = {
  INC: (s) => ({ ...s, count: s.count + 1 }),
  RESET: { STATE: (s) => ({ ...s, count: 0 }), EVENTS: event('COUNTER_RESET', (s) => s.count) },
}

describe('integration/testing.md patterns (both cores)', () => {
  it('the opening sample: simulateEvent, then next()', async () => {
    t = renderComponent(Counter, { initialState: { count: 0 } })
    t.simulateEvent('.inc', 'click')
    const state = await t.next(s => s.count === 1)
    expect(state.count).toBe(1)
    expect(t.html()).toContain('1')
    t.expectNoDiagnostics()
  })

  it('ready() is a cursor: buffered input, then ready(), then next() (and the other order)', async () => {
    t = renderComponent(Counter)
    t.simulateEvent('.inc', 'click')
    await t.ready()
    await t.next(s => s.count === 1)
    t.dispose()
    t = renderComponent(Counter)
    t.simulateEvent('.inc', 'click')
    const p = t.next(s => s.count === 1)
    await t.ready()
    await p
  })

  it('Promise.all of two next() calls from the cursor', async () => {
    t = renderComponent(Counter)
    t.simulateEvent('.inc', 'click')
    t.simulateEvent('.inc', 'click')
    await t.ready()
    const [a, b] = await Promise.all([t.next(s => s.count === 1), t.next(s => s.count === 2)])
    expect([a.count, b.count]).toEqual([1, 2])
  })

  it('next() vs waitForState(): waitForState matches history, next() waits for the reset', async () => {
    t = renderComponent(Counter)
    await t.ready()
    t.simulateEvent('.inc', 'click')
    await t.next(s => s.count === 1)
    t.simulateEvent('.reset', 'click')
    expect(await t.waitForState(s => s.count === 0)).toBe(t.states[0])
    const s = await t.next(s => s.count === 0)
    expect(t.states.indexOf(s)).toBeGreaterThan(1)
  })

  it('next() after next() (a fast follow-up) and the Reading Output sample', async () => {
    t = renderComponent(Counter)
    t.simulateEvent('.inc', 'click')
    await t.next(s => s.count === 1)
    t.simulateEvent('.reset', 'click')
    await t.next(s => s.count === 0)
    expect(t.emitted).toEqual([{ type: 'COUNTER_RESET', data: 1 }])
    expect(t.html()).toContain('<span class="count">0</span>')
  })

  it('settle() before checking that something did not happen', async () => {
    function Saver({ state }) { return h('button', { className: 'save' }, String(state.n)) }
    Saver.initialState = { n: 0 }
    Saver.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
    Saver.model = { SAVE: (s) => s }
    t = renderComponent(Saver)
    t.simulateEvent('.save', 'click')
    await t.settle()
    expect(t.emitted).toEqual([])
  })

  it('respond() / fail() right after simulateEvent', async () => {
    function Quote({ state }) { return h('div', null, h('button', { className: 'get' }, 'Get'), h('p', null, state.text)) }
    Quote.initialState = { text: '', status: 'idle' }
    Quote.intent = ({ DOM }) => ({ LOAD: DOM.click('.get') })
    Quote.model = {
      LOAD: { STATE: (state) => ({ ...state, status: 'loading' }), HTTP: () => ({ url: '/api/quote', ok: 'LOADED', error: 'FAILED' }) },
      LOADED: (state, quote) => ({ ...state, status: 'done', text: quote.text }),
      FAILED: (state, { status }) => ({ ...state, status: status === 404 ? 'missing' : 'error' }),
    }
    t = renderComponent(Quote)
    t.simulateEvent('.get', 'click')
    await t.respond('HTTP', { text: 'Hi' }, 'LOADED')
    expect(t.html()).toContain('Hi')
    expect(t.requests('HTTP')).toEqual([{ url: '/api/quote', ok: 'LOADED', error: 'FAILED' }])
    t.simulateEvent('.get', 'click')
    await t.fail('HTTP', 404)
    expect(t.state.status).toBe('missing')
  })

  it('resources: simulateAction then respond by resource name, without a settle in between', async () => {
    function Quote({ state }) { return h('p', null, state.quote.data ? state.quote.data.text : state.quote.status) }
    Quote.initialState = { id: null }
    Quote.resources = { quote: (state) => state.id && `/api/quotes/${state.id}` }
    Quote.model = { PICK: (state, id) => ({ ...state, id }) }
    t = renderComponent(Quote)
    await t.ready()
    t.simulateAction('PICK', 2)
    await t.respond('HTTP', { text: 'Hi' }, 'quote')
    expect(t.html()).toContain('Hi')
  })
})

describe('integration/testing.md: fake timers (both cores)', () => {
  beforeEach(() => vi.useFakeTimers())
  it('updates the query at once and searches 300 ms after the last keystroke', async () => {
    function Search({ state }) { return h('div', null, h('input', { className: 'q', value: state.q }), h('p', null, state.status === 'searching' ? 'Searching' : '')) }
    Search.initialState = { q: '', status: 'idle' }
    Search.intent = ({ DOM }) => {
      const q$ = DOM.input('.q').value()
      return { TYPE: q$, SEARCH: q$.compose((s) => xs.create({
        start(l) { let id; this.sub = s.subscribe({ next: (v) => { clearTimeout(id); id = setTimeout(() => l.next(v), 300) } }) },
        stop() { this.sub?.unsubscribe() },
      })) }
    }
    Search.model = { TYPE: (s, q) => ({ ...s, q }), SEARCH: (s) => ({ ...s, status: 'searching' }) }
    t = renderComponent(Search)
    await t.ready()
    for (const q of ['d', 'du', 'dune']) {
      t.simulateEvent('.q', 'input', { value: q })
      await vi.advanceTimersByTimeAsync(50)
    }
    await vi.advanceTimersByTimeAsync(249)
    expect(t.state.status).toBe('idle')
    await t.next(s => s.status === 'searching')
    expect(t.html()).toContain('Searching')
  })
})

describe('integration/testing.md: real DOM (both cores)', () => {
  it('simulateEvent on real elements, then next(); a fast follow-up matched by the next next()', async () => {
    function Zip({ state }) {
      return h('form', null, h('input', { attrs: { name: 'zip' }, value: state.zip }), h('span', { className: 'zip-status' }, state.status), h('input', { attrs: { name: 'city' }, value: state.city }))
    }
    Zip.initialState = { zip: '', status: '', city: '' }
    Zip.intent = ({ DOM }) => ({ ZIP: DOM.input('input[name="zip"]').value() })
    Zip.model = {
      ZIP: { STATE: (s, zip) => ({ ...s, zip, status: 'Looking up…' }), EFFECT: (s, zip, next) => next('FOUND', 'Springfield', 0) },
      FOUND: (s, city) => ({ ...s, status: 'ok', city }),
    }
    t = renderComponent(Zip, { dom: 'real' })
    t.simulateEvent('input[name="zip"]', 'input', { value: '62704' })
    await t.next(s => s.status === 'Looking up…')
    expect(t.query('.zip-status').textContent).toBe('Looking up…')
    await t.next(s => s.city === 'Springfield')
    expect(t.query('input[name="city"]').value).toBe('Springfield')
  })
})
