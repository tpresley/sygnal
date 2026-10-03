// @vitest-environment jsdom
// PLAN-3 G-167: a component without a model still sends its declaration statics (head, route,
// connections, resources); before, initModel$ returned early and nothing was sent.
import { describe, it, expect, afterEach } from 'vitest'
import { run, makeHeadDriver, Switchable } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { until } from './support/wait.js'

let app
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = ''; document.title = '' })

describe('G-167: statics without a model', () => {
  it('a model-less page sharing its parent state sends its head static', async () => {
    function A({ state }) { return h('p', null, state.name) }
    A.head = (s) => ({ title: 'Hello ' + s.name })            // no model, no initialState
    function App({ state }) { return h('div', null, h(Switchable, { of: { a: A }, current: 'a' })) }
    App.initialState = { name: 'Ada' }
    document.body.innerHTML = '<div id="root"></div>'
    app = run(App, { HEAD: makeHeadDriver() }, { mountPoint: '#root' })
    await until(() => expect(document.title).toBe('Hello Ada'))   // G-176: not a fixed tick
  })

  it('a model-less root sends its head static', async () => {
    function App({ state }) { return h('p', null, state.n) }
    App.initialState = { n: 1 }
    App.head = (s) => ({ title: 'n=' + s.n })
    document.body.innerHTML = '<div id="root"></div>'
    app = run(App, { HEAD: makeHeadDriver() }, { mountPoint: '#root' })
    await until(() => expect(document.title).toBe('n=1'))   // G-176: not a fixed tick
  })
})
