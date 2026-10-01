// PLAN-2 2-A: testing completeness (G-064, G-065, G-053)
import { describe, it, expect, afterEach } from 'vitest'

if (typeof globalThis.window === 'undefined') {
  globalThis.window = undefined
}

import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))

let t
afterEach(() => {
  if (t) t.dispose()
  t = null
  _resetDiagnostics()
})

// ─── G-064: every custom sink in the tree gets a recording no-op driver ─────

describe('G-064: sinkValues() records sinks used only by descendants', () => {
  function Saver({ state }) { return h('button', { className: 'save' }, state.label) }
  Saver.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
  Saver.model = { SAVE: { API: state => ({ url: '/save', body: state.label }) } }

  it("a child's sink with no driver is recorded", async () => {
    function App({ state }) { return h('div', null, h(Saver, { state: 'saver' })) }
    App.initialState = { saver: { label: 'one' } }
    t = renderComponent(App)
    t.simulateEvent('.save', 'click')
    await t.settle()
    expect(t.sinkValues('API')).toEqual([{ url: '/save', body: 'one' }])
  })

  it("a grandchild's and Collection items' sinks are recorded", async () => {
    function Middle() { return h('section', null, h(Saver, { state: 'saver' })) }
    function App() { return h('div', null, h(Middle, { state: 'mid' }), h('ul', null, h(Collection, { of: Row, from: 'rows' }))) }
    function Row({ state }) { return h('li', null, h('button', { className: 'ping' }, state.id)) }
    Row.intent = ({ DOM }) => ({ PING: DOM.click('.ping') })
    Row.model = { PING: { TRACK: state => ({ ping: state.id }) } }
    App.initialState = { mid: { saver: { label: 'deep' } }, rows: [{ id: 'a' }, { id: 'b' }] }
    t = renderComponent(App)
    t.simulateEvent('.save', 'click')
    t.simulateEvent('li:nth-child(2) .ping', 'click')
    await t.settle()
    expect(t.sinkValues('API')).toEqual([{ url: '/save', body: 'deep' }])
    expect(t.sinkValues('TRACK')).toEqual([{ ping: 'b' }])
  })

  it('an explicitly passed driver still receives the child sink (recorded once)', async () => {
    const got = []
    const API = sink$ => { sink$.addListener({ next: v => got.push(v), error() {}, complete() {} }); return {} }
    function App() { return h('div', null, h(Saver, { state: 'saver' })) }
    App.initialState = { saver: { label: 'two' } }
    t = renderComponent(App, { drivers: { API } })
    t.simulateEvent('.save', 'click')
    await t.settle()
    expect(got).toEqual([{ url: '/save', body: 'two' }])
    expect(t.sinkValues('API')).toEqual([{ url: '/save', body: 'two' }])
  })

  it("the root's own driverless sink is still recorded", async () => {
    function App() { return h('button', { className: 'go' }, 'go') }
    App.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    App.model = { GO: { API: () => 'root' } }
    App.initialState = {}
    t = renderComponent(App)
    t.simulateEvent('.go', 'click')
    await t.settle()
    expect(t.sinkValues('API')).toEqual(['root'])
  })

  it("a removed child's sink stops being recorded and dispose() is clean", async () => {
    function App({ state }) { return h('div', null, state.show ? h(Saver, { state: 'saver' }) : h('p', null, 'gone')) }
    App.initialState = { show: true, saver: { label: 'x' } }
    App.model = { HIDE: s => ({ ...s, show: false }) }
    t = renderComponent(App)
    t.simulateEvent('.save', 'click')
    t.simulateAction('HIDE')
    await t.settle()
    expect(t.html()).toBe('<div><p>gone</p></div>')
    expect(t.sinkValues('API')).toEqual([{ url: '/save', body: 'x' }])
    expect(() => { t.dispose(); t = null }).not.toThrow()
  })
})

// ─── G-065: next() after await ready() sees the buffered input's states ─────

describe('G-065: ready() is a cursor for the next next()', () => {
  function Counter({ state }) { return h('p', null, String(state.count)) }
  Counter.initialState = { count: 0 }
  Counter.model = { INC: s => ({ count: s.count + 1 }) }

  it('next() after await ready() sees the state of input buffered before ready', async () => {
    t = renderComponent(Counter)
    t.simulateAction('INC')
    await t.ready()
    // the buffered INC is applied while ready() resolves (2-R: no macrotask in between, or
    // the unused cursor expires)
    expect(await t.next(s => s.count === 1, 300)).toEqual({ count: 1 })
  })

  it('next() with no predicate after ready() resolves with the first buffered state', async () => {
    t = renderComponent(Counter)
    t.simulateAction('INC')
    t.simulateAction('INC')
    await t.ready()
    expect(await t.next(undefined, 300)).toEqual({ count: 1 })
    // the cursor is used until a next() from it resolves: the following next() waits for a new state
    const p = t.next(undefined, 300)
    t.simulateAction('INC')
    expect(await p).toEqual({ count: 3 })
  })

  it('next() before ready() still works (the other order)', async () => {
    t = renderComponent(Counter)
    t.simulateAction('INC')
    const p = t.next(s => s.count === 1, 300)
    await t.ready()
    expect(await p).toEqual({ count: 1 })
  })

  it('input after ready() moves the cursor: next() waits for its state', async () => {
    t = renderComponent(Counter)
    t.simulateAction('INC')
    await t.ready()
    t.simulateAction('INC')
    expect(await t.next(undefined, 300)).toEqual({ count: 2 })
  })

  it('ready() called again later re-arms the cursor at that point', async () => {
    t = renderComponent(Counter)
    await t.ready()
    await t.settle()
    t.simulateAction('INC')
    await t.ready()
    expect(await t.next(undefined, 300)).toEqual({ count: 1 })
  })

  it('a next() timeout names a recorded state that already matched (use waitForState)', async () => {
    t = renderComponent(Counter)
    await t.ready()
    t.simulateAction('INC')
    await t.settle()
    await expect(t.next(s => s.count === 1, 100)).rejects.toThrow(/next timed out after 100ms.*state recorded before this next\(\) call already matches.*waitForState/s)
  })
})

// ─── G-053: timing options and delayed model next() ─────────────────────────

describe('G-053: timing options', () => {
  function Counter({ state }) { return h('p', null, String(state.count)) }
  Counter.initialState = { count: 0 }
  Counter.model = { INC: s => ({ count: s.count + 1 }) }

  it('timeoutMs sets the default timeout of next(), waitForState() and settle()', async () => {
    t = renderComponent(Counter, { timeoutMs: 80 })
    await t.ready()
    const start = Date.now()
    await expect(t.next(s => s.count === 99)).rejects.toThrow(/next timed out after 80ms/)
    await expect(t.waitForState(s => s.count === 99)).rejects.toThrow(/waitForState timed out after 80ms/)
    expect(Date.now() - start).toBeLessThan(1000)
  })

  it('eventWaitMs sets how long simulateEvent waits for its element', async () => {
    function App() { return h('div', null, 'nothing') }
    App.initialState = {}
    App.intent = ({ DOM }) => ({ GO: DOM.click('.missing') })
    App.model = { GO: s => s }
    t = renderComponent(App, { eventWaitMs: 40 })
    t.simulateEvent('.missing', 'click')
    const start = Date.now()
    await expect(t.settle()).rejects.toThrow(/waited 40ms for it to render.*eventWaitMs/s)
    expect(Date.now() - start).toBeLessThan(250)
  })

  it("settleMs sets settle()'s quiet window (a longer one covers a delayed model next())", async () => {
    function Saver({ state }) { return h('p', null, state.status) }
    Saver.initialState = { status: 'idle' }
    Saver.model = {
      SAVE: { STATE: s => ({ ...s, status: 'saving' }), EFFECT: (_s, _d, next) => next('DONE', null, 60) },
      DONE: s => ({ ...s, status: 'done' }),
    }
    t = renderComponent(Saver)
    t.simulateAction('SAVE')
    await t.settle()
    expect(t.html()).toBe('<p>saving</p>')
    t.dispose()

    t = renderComponent(Saver, { settleMs: 120 })
    t.simulateAction('SAVE')
    await t.settle()
    expect(t.html()).toBe('<p>done</p>')
  })

  it('rejects invalid timing options', () => {
    expect(() => renderComponent(Counter, { settleMs: -1 })).toThrow(/settleMs must be a finite number of ms/)
    expect(() => renderComponent(Counter, { timeoutMs: 'x' })).toThrow(/timeoutMs must be a finite number of ms/)
  })
})

describe('G-053: a model next() delay that outlasts the wait is explained', () => {
  function Saver({ state }) { return h('p', null, state.status) }
  Saver.initialState = { status: 'idle' }
  Saver.model = {
    SAVE: { STATE: s => ({ ...s, status: 'saving' }), EFFECT: (_s, _d, next) => next('DONE', null, 400) },
    DONE: s => ({ ...s, status: 'done' }),
  }

  it('next() timing out before a scheduled next() fires names the action, the delay and the option', async () => {
    t = renderComponent(Saver, { timeoutMs: 100 })
    t.simulateAction('SAVE')
    await expect(t.next(s => s.status === 'done')).rejects.toThrow(
      /next timed out after 100ms.*next\('DONE'\) scheduled by Saver.*400ms.*timeoutMs/s)
  })

  it('waitForState() gets the same explanation', async () => {
    t = renderComponent(Saver)
    t.simulateAction('SAVE')
    await expect(t.waitForState(s => s.status === 'done', 100)).rejects.toThrow(/next\('DONE'\).*400ms/s)
  })

  it('the wait succeeds with a long enough timeout', async () => {
    t = renderComponent(Saver, { timeoutMs: 1000 })
    t.simulateAction('SAVE')
    expect(await t.next(s => s.status === 'done')).toEqual({ status: 'done' })
  })

  it('settle() timing out on a re-scheduling next() loop names it', async () => {
    function Ticker({ state }) { return h('p', null, String(state.n)) }
    Ticker.initialState = { n: 0 }
    Ticker.model = { TICK: { STATE: s => ({ ...s, n: s.n + 1 }), EFFECT: (_s, _d, next) => next('TICK', null, 5) } }
    t = renderComponent(Ticker)
    t.simulateAction('TICK')
    await expect(t.settle(150)).rejects.toThrow(/settle timed out after 150ms.*next\('TICK'\) scheduled by Ticker/s)
  })

  it("the delayed next() of a child component is detected too", async () => {
    function Child({ state }) { return h('button', { className: 'go' }, state.status) }
    Child.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    Child.model = {
      GO: { STATE: s => ({ ...s, status: 'busy' }), EFFECT: (_s, _d, next) => next('FINISH', null, 400) },
      FINISH: s => ({ ...s, status: 'finished' }),
    }
    function App() { return h('div', null, h(Child, { state: 'child' })) }
    App.initialState = { child: { status: 'idle' } }
    t = renderComponent(App, { timeoutMs: 100 })
    t.simulateEvent('.go', 'click')
    await expect(t.next(s => s.child.status === 'finished')).rejects.toThrow(/next\('FINISH'\) scheduled by Child/)
  })
})
