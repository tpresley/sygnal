// @vitest-environment jsdom
// PLAN-4.6 R5: fixes of the R4 review (G-324 ... G-335), each pinned here (failing first).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { run, createElement as h, Portal } from '../src/index.js'

let t
afterEach(() => { t?.dispose(); t = null; vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('G-324: a child-only fake sink answers an intent-less child', () => {
  function App() { return h('div', null, h(Loader, { state: 'loader' })) }
  function Loader({ state }) { return h('p', { className: 'l' }, String(state.data)) }
  Loader.model = { BOOTSTRAP: { API: () => ({ url: '/x', ok: 'LOADED' }) }, LOADED: (s, d) => ({ ...s, data: d.v }) }
  App.initialState = { loader: { data: 'none' } }

  it('t.respond reaches a child that has a model but no intent', async () => {
    t = renderComponent(App)
    await t.ready()
    await t.settle()
    expect(t.requests('API')).toHaveLength(1)
    await t.respond('API', { v: 'yes' })
    await t.settle()
    expect(t.state.loader.data).toBe('yes')
    expect(t.html()).toContain('yes')
  })
})

describe('G-325: a root with a model and no intent: its model actions are simulate-only, not unreachable', () => {
  it('no SYG102 with the dev entry loaded', async () => {
    await import('../src/extra/diagnostics/checks/index.js')
    function Counter({ state }) { return h('div', null, String(state.n)) }
    Counter.initialState = { n: 0 }
    Counter.model = { INC: (s) => ({ ...s, n: s.n + 1 }), RESET: (s) => ({ ...s, n: 0 }) }
    t = renderComponent(Counter)
    await t.ready()
    t.simulateAction('INC')
    await t.next()
    await t.settle()
    expect(t.diagnostics.filter((d) => d.code === 'SYG102')).toEqual([])
  })
})

describe("G-326: an input's next() cursor expires after a macrotask (moving the clock by hand)", () => {
  function C({ state }) { return h('div', null, String(state.phase)) }
  C.initialState = { phase: 'idle' }
  C.model = {
    LOAD: { STATE: (s) => ({ ...s, phase: 'loading' }), EFFECT: (s, d, next) => next('DONE', null, 40) },
    DONE: (s) => ({ ...s, phase: 'done' }),
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  it('simulateAction, a wait, then next(): the state after the call, not the one already past', async () => {
    t = renderComponent(C)
    await t.ready()
    t.simulateAction('LOAD')
    await sleep(10)
    expect((await t.next()).phase).toBe('done')
  })

  it('fake timers: simulateAction, advanceTimersByTimeAsync, then next() (testing.md: move the clock by hand)', async () => {
    vi.useFakeTimers()
    t = renderComponent(C)
    await t.ready()
    t.simulateAction('LOAD')
    await vi.advanceTimersByTimeAsync(5)
    expect((await t.next()).phase).toBe('done')
  })

  it('in the same tick, next() still starts at the input (D176)', async () => {
    t = renderComponent(C)
    await t.ready()
    t.simulateAction('LOAD')
    expect((await t.next()).phase).toBe('loading')
    expect((await t.next()).phase).toBe('done')
  })
})

describe('G-331: one throwing queue item does not discard the rest of the queue', () => {
  it('a throwing setState function (devtools, Vike, element) is reported; the action queued after it runs', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let app
    function App({ state }) { return h('p', { className: 'v' }, state.v) }
    App.initialState = { v: 'a' }
    App.intent = ({ DOM }) => ({ GO: DOM.click('.v') })
    App.model = {
      GO: { EFFECT: (s, d, next) => { app.__runtime.setState('root', () => { throw new Error('bad setState') }); next('B') } },
      B: (s) => ({ ...s, v: 'b' }),
    }
    document.body.innerHTML = '<div id="root"></div>'
    app = run(App, {}, { mountPoint: '#root' })
    try {
      await app.__runtime.flushed()
      document.querySelector('.v').click()
      await vi.waitFor(() => expect(document.querySelector('.v').textContent).toBe('b'), { timeout: 1000, interval: 5 })
      expect(console.error.mock.calls.some((c) => String(c[0]).includes('SYG2'))).toBe(true)
    } finally { app.dispose() }
  })
})

describe('G-335: child-only sink values keep their type in t.sinkValues()', () => {
  it('an array and a Date sent from a child stay an array and a Date', async () => {
    function Saver() { return h('button', { className: 'save' }, 's') }
    Saver.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
    Saver.model = { SAVE: { API: () => [1, 2], LOGX: () => new Date(0) } }
    function App() { return h('div', null, h(Saver, { state: 'saver' })) }
    App.initialState = { saver: {} }
    t = renderComponent(App)
    t.simulateEvent('.save', 'click')
    await t.settle()
    expect(t.sinkValues('API')).toEqual([[1, 2]])
    expect(Array.isArray(t.sinkValues('API')[0])).toBe(true)
    expect(t.sinkValues('LOGX')[0]).toBeInstanceOf(Date)
  })
})

describe('G-328: a Portal and a plain div at the same position take turns without leaking content', () => {
  it('open / closed twice: the target holds the content only while open', async () => {
    document.body.innerHTML = '<div id="modal"></div><div id="root"></div>'
    function App({ state }) { return h('div', null, h('button', null, 'x'), state.open ? h(Portal, { target: '#modal' }, h('p', { className: 'hi' }, 'hi')) : h('div', null, 'closed')) }
    App.initialState = { open: false }
    App.intent = ({ DOM }) => ({ T: DOM.click('button') })
    App.model = { T: (s) => ({ ...s, open: !s.open }) }
    const app = run(App, {}, { mountPoint: '#root' })
    try {
      await app.__runtime.flushed()
      const counts = []
      for (let i = 0; i < 4; i++) {
        document.querySelector('button').click()
        await new Promise((r) => setTimeout(r, 30))
        counts.push(document.querySelectorAll('#modal .hi').length)
      }
      expect(counts).toEqual([1, 0, 1, 0])
    } finally { app.dispose() }
  })
})
