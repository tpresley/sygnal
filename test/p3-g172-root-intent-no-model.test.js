// @vitest-environment jsdom
// PLAN-3 G-172: a root component with an intent but no model rendered nothing under run()
// (the root's no-op model was only added when intent AND model were both undefined, so its
// initialState was never applied), while renderComponent rendered it.
import { describe, it, expect, afterEach } from 'vitest'
import { run } from '../src/index.js'
import { createElement } from '../src/pragma/index.js'

let app
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = '' })
const tick = (ms = 50) => new Promise(r => setTimeout(r, ms))

describe('G-172: root with intent and no model', () => {
  it('renders its initialState under run()', async () => {
    function App({ state }) { return createElement('div', { className: 'app' }, state.msg) }
    App.initialState = { msg: 'hello' }
    App.intent = () => ({})
    document.body.innerHTML = '<div id="root"></div>'
    app = run(App, {}, { mountPoint: '#root' })
    await tick()
    expect(document.querySelector('#root').textContent).toBe('hello')
  })
})
