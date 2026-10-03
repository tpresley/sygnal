// @vitest-environment jsdom
// PLAN-3: a `head` static on Switchable pages: the shown page's title wins (D85 pause + HEAD driver)
import { describe, it, expect, afterEach } from 'vitest'
import { run, makeHeadDriver, Switchable } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

let app
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = ''; document.title = '' })
const tick = (ms = 60) => new Promise(r => setTimeout(r, ms))

describe('head + hidden Switchable pages', () => {
  it('the shown page sets document.title, also after switching back', async () => {
    function A() { return h('p', null, 'a') }
    A.model = {}; A.head = () => ({ title: 'Page A' })
    function B() { return h('p', null, 'b') }
    B.model = {}; B.head = () => ({ title: 'Page B' })
    function App({ state }) { return h('div', null, h('button', { className: 'go' }, 'go'), h(Switchable, { of: { a: A, b: B }, current: state.page })) }
    App.initialState = { page: 'a' }
    App.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    App.model = { GO: (s) => ({ ...s, page: s.page === 'a' ? 'b' : 'a' }) }
    document.body.innerHTML = '<div id="root"></div>'
    app = run(App, { HEAD: makeHeadDriver() }, { mountPoint: '#root' })
    await tick()
    expect(document.title).toBe('Page A')
    document.querySelector('.go').click(); await tick()
    expect(document.title).toBe('Page B')
    document.querySelector('.go').click(); await tick()
    expect(document.title).toBe('Page A')
  })
})
