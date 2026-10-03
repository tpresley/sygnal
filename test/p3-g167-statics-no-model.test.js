// @vitest-environment jsdom
// PLAN-3 G-167: a component without a model still sends its declaration statics (head, route,
// connections, resources); before, initModel$ returned early and nothing was sent.
import { describe, it, expect, afterEach } from 'vitest'
import { run, makeHeadDriver, Switchable } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

let app
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = ''; document.title = '' })
const tick = (ms = 60) => new Promise(r => setTimeout(r, ms))

describe('G-167: statics without a model', () => {
  it('a model-less page sharing its parent state sends its head static', async () => {
    function A({ state }) { return h('p', null, state.name) }
    A.head = (s) => ({ title: 'Hello ' + s.name })            // no model, no initialState
    function App({ state }) { return h('div', null, h(Switchable, { of: { a: A }, current: 'a' })) }
    App.initialState = { name: 'Ada' }
    document.body.innerHTML = '<div id="root"></div>'
    app = run(App, { HEAD: makeHeadDriver() }, { mountPoint: '#root' })
    await tick()
    expect(document.title).toBe('Hello Ada')
  })

  it('a model-less root sends its head static', async () => {
    function App({ state }) { return h('p', null, state.n) }
    App.initialState = { n: 1 }
    App.head = (s) => ({ title: 'n=' + s.n })
    document.body.innerHTML = '<div id="root"></div>'
    app = run(App, { HEAD: makeHeadDriver() }, { mountPoint: '#root' })
    await tick()
    expect(document.title).toBe('n=1')
  })
})
