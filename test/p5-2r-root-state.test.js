// @vitest-environment jsdom
// PLAN-5 2-R, G-393: a root with a model but no initialState has no state, so it renders nothing
// until an action sets one (as in the PLAN-4 core: INITIALIZE was only sent with an
// initialState; G-172 covers a root without a model, which renders from `initialState || true`).
// Not a regression, but silent: the dev entry reports SYG238.
import { it, expect, beforeEach } from 'vitest'
import { run, renderComponent } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { setupChecks, diagnostics, settle } from './diagnostics/helpers.js'

beforeEach(() => { setupChecks(); document.body.innerHTML = '<div id="root"></div>' })

function Counter({ state }) { return h('p', { className: 'n' }, String(state.count)) }
Counter.intent = ({ DOM }) => ({ INC: DOM.select('.n').events('click') })
Counter.model = { INC: (s) => ({ ...s, count: s.count + 1 }) }

it('run(): renders nothing, SYG238 says why', async () => {
  const app = run(Counter, {}, { mountPoint: '#root', diagnostics: 'collect' })
  await settle(30)
  expect(document.querySelector('#root').innerHTML).toBe('')
  const d = diagnostics('SYG238')
  expect(d.length).toBe(1)
  expect(d[0].severity).toBe('warn')
  expect(d[0].component).toBe('Counter')
  expect(d[0].message).toMatch(/no initialState/)
  expect(d[0].fix).toMatch(/Counter\.initialState/)
  app.dispose()
})

it('renderComponent: the same report (the test would otherwise see an empty render)', async () => {
  const t = renderComponent(Counter, { diagnostics: 'collect' })
  await t.ready()
  expect(t.html()).toBe('')
  expect(diagnostics('SYG238').map(d => d.component)).toEqual(['Counter'])
  t.dispose()
})

it('not reported: with initialState (also from renderComponent), without a model (G-172), for a child', async () => {
  function WithState({ state }) { return h('p', null, String(state.count)) }
  WithState.initialState = { count: 0 }
  WithState.model = { INC: (s) => s }
  function NoModel() { return h('p', null, 'static') }
  function Child({ state }) { return h('i', null, String(state)) }
  Child.model = { X: (s) => s }
  function Parent() { return h('div', null, [h(Child, { state: 'c' })]) }
  Parent.initialState = { c: 1 }
  for (const C of [WithState, NoModel, Parent]) {
    const t = renderComponent(C, { diagnostics: 'collect' })
    await t.ready()
    t.dispose()
  }
  const t = renderComponent(Counter, { initialState: { count: 3 }, diagnostics: 'collect' })
  await t.ready()
  expect(t.html()).toBe('<p class="n">3</p>')
  t.dispose()
  expect(diagnostics('SYG238')).toEqual([])
})
