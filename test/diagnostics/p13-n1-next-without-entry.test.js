// PLAN-13 N-1: SYG117, next('X') where the component has no model entry X (the dev entry's
// onNext check). next() stays in its own component, so an ancestor's entry never runs.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupChecks, diagnostics, settle } from './helpers.js'
import { renderComponent } from '../../src/extra/testing.js'
import { createElement as h } from '../../src/pragma/index.js'
import { until } from '../support/wait.js'
import { defineBehavior } from '../../src/extra/behaviors.js'

let t
beforeEach(() => setupChecks())
afterEach(() => { if (t) t.dispose(); t = null })

describe('SYG117: next() names an action with no model entry', () => {
  it('a child next() for an action only its parent handles: names the parent and the fix', async () => {
    function Card() { return h('button', { className: 'go' }, 'go') }
    Card.intent = ({ DOM }) => ({ CLICK: DOM.click('.go') })
    Card.model = { CLICK: { EFFECT: (s, d, next) => next('ENTER') } }
    function App({ state }) { return h('main', null, h(Card, { state: 'card' }), h('p', null, String(state.entered))) }
    App.initialState = { entered: false, card: {} }
    App.model = { ENTER: (s) => ({ ...s, entered: true }) }
    t = renderComponent(App)
    await t.ready()
    t.simulateEvent('.go', 'click')
    await until(() => expect(diagnostics('SYG117')).toHaveLength(1))
    const [d] = diagnostics('SYG117')
    expect(d.severity).toBe('warn')
    expect(d.component).toBe('Card')
    expect(d.message).toContain("next('ENTER')")
    expect(d.message).toContain('App')
    expect(d.fix).toContain('PARENT')
    expect(d.fix).toContain('CHILD.select(Card)')
    expect(d.data).toEqual({ action: 'ENTER', handledBy: 'App' })
    expect(t.state.entered).toBe(false)
  })

  it('a typo in the component itself: did you mean', async () => {
    function App() { return h('button', { className: 'go' }, 'go') }
    App.initialState = { n: 0 }
    App.intent = ({ DOM }) => ({ CLICK: DOM.click('.go') })
    App.model = { CLICK: { EFFECT: (s, d, next) => next('INCREMNT') }, INCREMENT: (s) => ({ n: s.n + 1 }) }
    t = renderComponent(App)
    await t.ready()
    t.simulateEvent('.go', 'click')
    await until(() => expect(diagnostics('SYG117')).toHaveLength(1))
    const [d] = diagnostics('SYG117')
    expect(d.message).toContain("did you mean 'INCREMENT'")
    expect(d.data).toEqual({ action: 'INCREMNT' })
    expect(d.fix).toContain('App.model')
  })

  it('no report for an action the component handles (STATE or other sinks), reported once per name', async () => {
    function App() { return h('button', { className: 'go' }, 'go') }
    App.initialState = { n: 0 }
    App.intent = ({ DOM }) => ({ CLICK: DOM.click('.go') })
    App.model = {
      CLICK: { STATE: (s) => s, EFFECT: (s, d, next) => { next('INC'); next('LOG') } },
      INC: (s) => ({ n: s.n + 1 }),
      LOG: { EFFECT: () => {} },
    }
    t = renderComponent(App)
    await t.ready()
    t.simulateEvent('.go', 'click')
    await until(() => expect(t.state.n).toBe(1))
    await settle(30)
    expect(diagnostics('SYG117')).toEqual([])
  })

  it('a behavior next() to its own action is not reported', async () => {
    const pager = defineBehavior({
      initialState: { page: 0 },
      intent: ({ DOM }) => ({ NEXT: DOM.click('.go') }),
      model: { NEXT: { EFFECT: (s, d, next) => next('MOVE') }, MOVE: (s) => ({ ...s, page: s.page + 1 }) },
    })
    function App() { return h('button', { className: 'go' }, 'go') }
    App.uses = { pager: pager() }
    t = renderComponent(App)
    await t.ready()
    t.simulateEvent('.go', 'click')
    await until(() => expect(t.state.pager.page).toBe(1))
    await settle(30)
    expect(diagnostics('SYG117')).toEqual([])
  })
})
