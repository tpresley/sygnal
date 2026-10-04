// @vitest-environment jsdom
// PLAN-4 P-1b (GS-12, D129): `C.viewTransitions = ['MOVE']` + makeViewTransitionDOMDriver() in
// jsdom: the fallback paths (no API, reduced motion, a refusing browser), the hold/fold/cap logic
// against a fake document.startViewTransition, and SYG645 (dev) when the static is set without
// the View Transition DOM driver. Real-browser behaviour: browser-tests view-transitions-p1b.jsx.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'
import run from '../src/extra/run.js'
import { makeViewTransitionDOMDriver } from '../src/extra/viewTransitions.js'
import { renderComponent } from '../src/extra/testing.js'
import { getDiagnostics, clearDiagnostics } from '../src/extra/diagnostics/index.js'
import { installChecks, resetChecks } from '../src/extra/diagnostics/checks/index.js'

installChecks()

const settle = (ms = 60) => new Promise(r => setTimeout(r, ms))
let app
afterEach(() => {
  app?.dispose()
  app = null
  document.body.innerHTML = ''
  delete document.startViewTransition
  delete window.matchMedia
  clearDiagnostics()
  resetChecks()
  vi.restoreAllMocks()
})

const Item = ({ state }) => h('li', { className: 'item' }, state.id)
function Board({ state }) {
  return h('div', null,
    h('ul', { className: 'a' }, h(Collection, { of: Item, from: 'a' })),
    h('ul', { className: 'b' }, h(Collection, { of: Item, from: 'b' })),
    h('button', { className: 'move' }, 'move'),
    h('button', { className: 'bump' }, 'bump'),
    h('p', { className: 'n' }, String(state.n)))
}
Board.initialState = { a: [{ id: 'x' }, { id: 'y' }], b: [{ id: 'z' }], n: 0 }
Board.intent = ({ DOM }) => ({ MOVE: DOM.click('.move'), BUMP: DOM.click('.bump') })
const move = (s) => s.a.length ? { ...s, a: s.a.slice(1), b: [...s.b, s.a[0]] } : { ...s, a: [...s.a, s.b[0]], b: s.b.slice(1) }
Board.model = { MOVE: move, BUMP: (s) => ({ ...s, n: s.n + 1 }) }
Board.viewTransitions = ['MOVE']

const ids = (sel) => [...document.querySelectorAll(sel + ' .item')].map(li => li.textContent).join()
const click = (sel) => document.querySelector(sel).click()

// a fake API: records each call and runs the update callback a task later (as browsers do)
function fakeVT() {
  const calls = []
  document.startViewTransition = (update) => {
    const t = { update, startedAt: performance.now() }
    calls.push(t)
    t.updateCallbackDone = new Promise(r => setTimeout(r, 0)).then(() => update()).then(() => { t.doneAt = performance.now() })
    return t
  }
  return calls
}

const start = (drivers = { DOM: makeViewTransitionDOMDriver('#root') }, options = {}) => {
  document.body.innerHTML = '<div id="root"></div>'
  app = run(Board, drivers, { mountPoint: '#root', ...options })
}

describe('makeViewTransitionDOMDriver', () => {
  it('without the API (older browsers, jsdom) a listed action patches at once', async () => {
    start()
    await settle()
    expect(ids('.a')).toBe('x,y')
    click('.move')
    await settle()
    expect(ids('.a') + '|' + ids('.b')).toBe('y|z,x')
  })

  it('a listed action patches inside one transition; the patches of a Collection move are folded in', async () => {
    const calls = fakeVT()
    start()
    await settle()
    click('.move')
    await settle(10)
    expect(calls.length).toBe(1)
    await calls[0].updateCallbackDone
    expect(ids('.a') + '|' + ids('.b')).toBe('y|z,x')
    // the update callback resolves after the patches go quiet (20 ms), not at the first patch
    expect(calls[0].doneAt - calls[0].startedAt).toBeGreaterThanOrEqual(19)
    click('.bump')
    await settle()
    expect(document.querySelector('.n').textContent).toBe('1')
    expect(calls.length).toBe(1)
  })

  it('an unlisted action never starts a transition', async () => {
    const calls = fakeVT()
    start()
    await settle()
    click('.bump')
    await settle()
    expect(document.querySelector('.n').textContent).toBe('1')
    expect(calls.length).toBe(0)
  })

  it('prefers-reduced-motion: reduce patches at once', async () => {
    const calls = fakeVT()
    window.matchMedia = (q) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })
    start()
    await settle()
    click('.move')
    await settle()
    expect(calls.length).toBe(0)
    expect(ids('.b')).toBe('z,x')
  })

  it('a browser that refuses the transition (throws) still patches', async () => {
    document.startViewTransition = () => { throw new Error('InvalidStateError') }
    start()
    await settle()
    click('.move')
    await settle()
    expect(ids('.b')).toBe('z,x')
  })

  it('continuous re-renders cannot hold the update callback past the 200 ms cap', async () => {
    const calls = fakeVT()
    start()
    await settle()
    const timer = setInterval(() => click('.bump'), 5)
    try {
      click('.move')
      // poll: a fixed 5 ms wait missed the start under full-suite load
      await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0), { timeout: 150, interval: 2 })
      expect(calls.length).toBe(1)
      await calls[0].updateCallbackDone
      expect(calls[0].doneAt - calls[0].startedAt).toBeLessThan(300)
    } finally { clearInterval(timer) }
    await settle()
    expect(ids('.b')).toBe('z,x')
  })

  it('a Collection item can list its own action (self-removal)', async () => {
    const calls = fakeVT()
    const Row = ({ state }) => h('li', { className: 'item' }, h('button', { className: 'rm' }, state.id))
    Row.intent = ({ DOM }) => ({ REMOVE: DOM.click('.rm') })
    Row.model = { REMOVE: () => undefined }
    Row.viewTransitions = ['REMOVE']
    const List = () => h('ul', { className: 'a' }, h(Collection, { of: Row, from: 'a' }))
    List.initialState = { a: [{ id: 'p' }, { id: 'q' }] }
    document.body.innerHTML = '<div id="root"></div>'
    app = run(List, { DOM: makeViewTransitionDOMDriver('#root') }, { mountPoint: '#root' })
    await settle()
    expect(ids('.a')).toBe('p,q')
    click('.rm')
    await settle(10)
    expect(calls.length).toBe(1)
    await calls[0].updateCallbackDone
    expect(ids('.a')).toBe('q')
  })

  it('takes DOM driver options and keeps run()\'s fragments default', async () => {
    const F = ({ state }) => h('ul', { className: 'a' }, h(Collection, { of: Item, from: 'a' }))
    F.initialState = { a: [{ id: 'q' }] }
    document.body.innerHTML = '<div id="root"></div>'
    app = run(F, { DOM: makeViewTransitionDOMDriver('#root', { reportSnabbdomError: () => {} }) }, { mountPoint: '#root' })
    await settle()
    expect(ids('.a')).toBe('q')
  })
})

describe('SYG645', () => {
  it('reports the static without the View Transition DOM driver (run()\'s default)', async () => {
    start({}, { diagnostics: 'collect' })
    await settle()
    const d = getDiagnostics().filter(d => d.code == 'SYG645')
    expect(d.length).toBe(1)
    expect(d[0].message).toMatch(/Board declares Board\.viewTransitions \('MOVE'\)/)
    expect(d[0].fix).toMatch(/makeViewTransitionDOMDriver/)
    // and the action still patches, without a transition
    click('.move')
    await settle()
    expect(ids('.b')).toBe('z,x')
  })

  it('is silent with makeViewTransitionDOMDriver()', async () => {
    start(undefined, { diagnostics: 'collect' })
    await settle()
    expect(getDiagnostics().map(d => d.code)).not.toContain('SYG645')
  })

  it('is silent under renderComponent (mock DOM)', async () => {
    const t = renderComponent(Board)
    await t.ready()
    expect(getDiagnostics().map(d => d.code)).not.toContain('SYG645')
    t.dispose()
  })

  it("is silent under renderComponent(C, { dom: 'real' })", async () => {
    const t = renderComponent(Board, { dom: 'real' })
    await t.ready()
    expect(t.queryAll('.item').length).toBe(3)
    expect(getDiagnostics().map(d => d.code)).not.toContain('SYG645')
    t.dispose()
  })
})
