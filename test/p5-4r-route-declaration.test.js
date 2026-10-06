// @vitest-environment jsdom
// G-555 (PLAN-5 4-R): the router answers a `route` declaration at once when the declaring
// instance already listens to its replies (the core subscribes them at creation, before it
// sends its statics), so the declaration's ROUTE is part of the first flush. It used to come a
// task later (a workaround for the pre-6.0 core, which subscribed replies after the first
// declaration): the new core renders in a microtask, so a field typed into before that task
// had its edit wiped by the late ROUTE (eval task 25's Save lost the typed title).
import { it, expect, beforeEach, afterEach, vi } from 'vitest'
import run from '../src/extra/run.js'
import { createElement as h } from '../src/pragma/index.js'
import { makeRouter } from '../src/extra/router.js'
import { sleep } from '../evals/agent-ergonomics/hidden/_support/queries.js'

let app
beforeEach(() => {
  window.history.replaceState(null, '', '/tasks/1/edit')
  document.body.innerHTML = '<div id="root"></div>'
})
afterEach(() => {
  try { app?.dispose() } catch (_) {}
  app = null
  vi.restoreAllMocks()
})

function makeApp() {
  const router = makeRouter({ routes: { list: '/', edit: '/tasks/:id/edit' } })
  function App({ state }) {
    return h('section', null, h('input', { name: 'title', value: state.draft ?? 'Write the report' }), h('i', null, String(state.routes)))
  }
  App.route = 'ROUTE'
  App.initialState = { route: router.current(), draft: null, routes: 0 }
  App.intent = ({ DOM }) => ({ TYPE: DOM.input('input[name="title"]').value() })
  App.model = {
    // a route resets the draft (as task 25's App does)
    ROUTE: (s, route) => ({ ...s, route, draft: null, routes: s.routes + 1 }),
    TYPE: (s, draft) => ({ ...s, draft }),
  }
  return { App, router }
}

/** resolves once #root shows the app (checked after each microtask) */
async function firstPatch() {
  for (let i = 0; i < 1000; i++) {
    if (document.querySelector('#root input')) return
    await Promise.resolve()
  }
  throw new Error('app did not render in microtasks')
}

it('the initial ROUTE reply is applied before the first patch (no task delay)', async () => {
  const { App, router } = makeApp()
  app = run(App, { ROUTER: router.driver }, { mountPoint: '#root' })
  await firstPatch()
  expect(document.querySelector('#root i').textContent).toBe('1')
  await sleep(20)
  expect(document.querySelector('#root i').textContent).toBe('1')
})

it('typing right after the first render keeps the draft (the declaration reply does not come later)', async () => {
  const { App, router } = makeApp()
  app = run(App, { ROUTER: router.driver }, { mountPoint: '#root' })
  await firstPatch()
  const input = document.querySelector('input[name="title"]')
  input.value = 'Write the final report'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(20)
  expect(app.__runtime.getState().draft).toBe('Write the final report')
  expect(document.querySelector('input[name="title"]').value).toBe('Write the final report')
  expect(app.__runtime.getState().routes).toBe(1)
})

it('a second declarer mounted later still gets the current route', async () => {
  const router = makeRouter({ routes: { list: '/', edit: '/tasks/:id/edit' } })
  function Crumb({ state }) { return h('span', { className: 'crumb' }, state.path || '') }
  Crumb.route = 'ROUTE'
  Crumb.model = { ROUTE: (s, r) => ({ ...s, path: r.path }) }
  function App({ state }) { return h('main', null, state.show ? h(Crumb, { state: 'crumb' }) : h('b', null, '-')) }
  App.initialState = { show: false, crumb: { path: '' } }
  App.intent = ({ DOM }) => ({ SHOW: DOM.click('b') })
  App.model = { SHOW: s => ({ ...s, show: true }) }
  app = run(App, { ROUTER: router.driver }, { mountPoint: '#root' })
  await sleep(10)
  document.querySelector('#root b').click()
  await sleep(10)
  expect(document.querySelector('.crumb').textContent).toBe('/tasks/1/edit')
})
