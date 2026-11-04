// @vitest-environment jsdom
// A RESET's (and a GOTO with a new key's) `draft` merges over draft() (maintainer decision, after
// preview.6): Sift's "Choose another source" carries one field into the new flow and had to
// restate every other field draft() gives. With `url`, the merge is over draft() on the route the
// reset lands on. A field set to undefined in the message is dropped from what draft() gave.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { makeRouter, wizard, Outlet } from '../src/index.js'

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null })
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms))
const click = async (sel) => { t.query(sel).click(); await tick() }

const MESSAGES = {
  carry: { wizard: 'RESET', draft: { carried: 'c' } },
  override: { wizard: 'RESET', draft: { r: 'given' } },
  drop: { wizard: 'RESET', draft: { bound: undefined } },
  goto: { wizard: 'GOTO', step: 'b', key: '2', draft: { carried: 'c' } },
}
function Step({ state }) { return h('div', null, h('h2', null, state.step), ...Object.keys(MESSAGES).map(m => h('button', { className: m }, m))) }
Step.intent = ({ DOM }) => Object.fromEntries(Object.keys(MESSAGES).map(m => [m.toUpperCase(), DOM.click('.' + m)]))
Step.model = Object.fromEntries(Object.entries(MESSAGES).map(([m, msg]) => [m.toUpperCase(), { PARENT: () => msg }]))

describe('without url: over draft(state)', () => {
  function Host() { return h(Outlet, { of: { a: Step, b: Step }, from: 'wizard', focus: false }) }
  Host.initialState = { bound: 'B' }
  Host.uses = { wizard: wizard({ steps: { a: {}, b: {} }, draft: (st) => ({ r: null, bound: st.bound }) }) }

  for (const [m, draft] of [['carry', { r: null, bound: 'B', carried: 'c' }], ['override', { r: 'given', bound: 'B' }], ['drop', { r: null, bound: undefined }]]) {
    it(`RESET (${m})`, async () => {
      t = renderComponent(Host, { dom: 'real' })
      await t.ready(); await tick()
      await click('.' + m)
      expect(t.state.wizard.step).toBe('a')
      expect(t.state.wizard.draft).toEqual(draft)
      expect(t.state.wizard.initial).toEqual(draft)
    })
  }

  it('GOTO with a new key and a draft', async () => {
    t = renderComponent(Host, { dom: 'real' })
    await t.ready(); await tick()
    await click('.goto')
    expect(t.state.wizard).toMatchObject({ step: 'b', key: '2', draft: { r: null, bound: 'B', carried: 'c' } })
  })
})

describe('with url: over draft(state) on the route landed on', () => {
  const router = makeRouter({ routes: { first: '/flow', step: '/flow/:step', home: '/', notFound: '*' } })
  const inW = (r) => r?.name === 'first' || r?.name === 'step'
  function App({ state }) { return inW(state.route) ? h(H, { state: 'flow' }) : h('p', null, 'home') }
  App.route = 'ROUTE'
  App.initialState = { route: router.current('/'), flow: {} }
  App.model = { ROUTE: (s, route) => ({ ...s, route, flow: { ...s.flow, route } }) }
  function H() { return h(Outlet, { of: { a: Step, b: Step }, from: 'wizard', focus: false }) }
  H.uses = {
    wizard: wizard({
      steps: { a: {}, b: {} },
      draft: (st) => ({ r: st.route?.query?.r ?? null, bound: 'B' }),
      key: (st) => inW(st.route) ? st.route.query.k ?? null : undefined,
      url: { route: 'step', param: 'step', key: 'k', from: (s) => s.route?.name === 'first' ? { ...s.route, name: 'step', params: { step: 'a' } } : s.route },
      resetTo: { to: 'first' },
    }),
  }

  for (const [m, draft] of [['carry', { r: null, bound: 'B', carried: 'c' }], ['override', { r: 'given', bound: 'B' }], ['drop', { r: null, bound: undefined }]]) {
    it(`RESET (${m}): r from the route landed on, not ?r=R`, async () => {
      t = renderComponent(App, { dom: 'real', router, url: '/flow/b?k=1&r=R' })
      await t.ready(); await tick(40)
      await click('.' + m); await tick(60)
      expect(t.location.path).toBe('/flow')
      expect(t.state.flow.wizard).toMatchObject({ step: 'a', key: null, reseed: null })
      expect(t.state.flow.wizard.draft).toEqual(draft)
    })
  }

  it('GOTO with a new key and a draft: over draft() on the route of that key', async () => {
    t = renderComponent(App, { dom: 'real', router, url: '/flow/a?k=1&r=R' })
    await t.ready(); await tick(40)
    await click('.goto'); await tick(60)
    expect(t.location.query).toEqual({ k: '2' })
    expect(t.state.flow.wizard).toMatchObject({ step: 'b', key: '2', reseed: null })
    expect(t.state.flow.wizard.draft).toEqual({ r: null, bound: 'B', carried: 'c' })
  })
})
