// @vitest-environment jsdom
// PLAN-5 4-K: the review of 4-J. G-570: the first `route` declarer navigating from its own
// DISPOSE / dispose$ still delivers the new route to the other declarers. G-571: a redirect loop
// (any declarer) can't hang the page: past a number of navigations before a microtask each next
// one waits a task (dev: one warning); a normal chain stays synchronous, one patch. The
// reviewer's probes (rv4j router / chain / text / iso / twice) are the cases below.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { run } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { makeRouter } from '../src/extra/router.js'
import { ABORT } from '../src/shared.js'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let apps = []
beforeEach(() => { vi.stubGlobal('requestAnimationFrame', (f) => setTimeout(f, 1)) })
afterEach(() => { apps.forEach(a => a.dispose()); apps = []; document.body.innerHTML = ''; vi.unstubAllGlobals() })
const op = (f) => document.dispatchEvent(new CustomEvent('p4k-op', { detail: f }))
const routes = { home: '/', a: '/a', b: '/b', login: '/login', secret: '/secret', other: '/other' }
function start(App, router) {
  document.body.innerHTML = '<div id="root"></div>'
  const app = run(App, { ROUTER: router.driver }, { mountPoint: '#root' }); apps.push(app)
  return app
}
const pop = (path) => { window.history.pushState(null, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }

describe('G-570: the first declarer navigates from its own disposal', () => {
  for (const how of ['DISPOSE', 'dispose$']) {
    it(`${how}: the other declarers still get the new route (rv4j router)`, async () => {
      window.history.replaceState(null, '', '/')
      const router = makeRouter({ routes })
      const seenB = []
      function A() { return h('i', null, 'a') }
      A.route = 'ROUTE'
      if (how == 'DISPOSE') A.model = { ROUTE: (s) => s, DISPOSE: { ROUTER: () => ({ to: 'other' }) } }
      else {
        A.intent = ({ dispose$ }) => ({ LEAVE: dispose$ })
        A.model = { ROUTE: (s) => s, LEAVE: { ROUTER: () => ({ to: 'other' }) } }
      }
      function B() { return h('b', null, 'b') }
      B.route = 'ROUTE'
      B.model = { ROUTE: (s, r) => (seenB.push(r.path), { ...s, p: r.path }) }
      function App({ state }) { return h('main', null, state.show ? h(A, { state: 'a' }) : null, h(B, { state: 'b' })) }
      App.intent = ({ DOM }) => ({ OP: DOM.select('document').events('p4k-op').map(e => e.detail) })
      App.model = { OP: (s, f) => f(s) }
      App.initialState = { show: true, a: {}, b: {} }
      const app = start(App, router)
      await sleep(20)
      expect(seenB).toEqual(['/'])
      op(s => ({ ...s, show: false })); await sleep(30)
      expect(window.location.pathname).toBe('/other')
      expect(seenB).toEqual(['/', '/other'])
      expect(app.__runtime.getState().b.p).toBe('/other')
    })
  }

  it('a declarer that is still there gets each route once (the deferred delivery runs once)', async () => {
    window.history.replaceState(null, '', '/')
    const router = makeRouter({ routes })
    const seen = { A: [], B: [], C: [] }
    const decl = (n) => { function X() { return h('i', null, n) } X.route = 'ROUTE'; X.model = { ROUTE: (s, r) => (seen[n].push(r.path), s) }; return X }
    const B = decl('B'), C = decl('C')
    function App() { return h('main', null, h(B, { state: 'b' }), h(C, { state: 'c' })) }
    App.route = 'ROUTE'
    App.model = { ROUTE: (s, r) => (seen.A.push(r.path), s) }
    App.initialState = { b: {}, c: {} }
    start(App, router)
    await sleep(20)
    pop('/a'); pop('/b')
    await sleep(20)
    expect(seen).toEqual({ A: ['/', '/a', '/b'], B: ['/', '/a', '/b'], C: ['/', '/a', '/b'] })
  })
})
