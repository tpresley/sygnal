// @vitest-environment jsdom
// PLAN-4.6 R4: fixes of the R3 review's findings (G-318...G-323), on the next core. Each test is a
// behaviour both cores meet (the current core is the oracle), unless it says otherwise.
import { describe, it, expect, afterEach } from 'vitest'
import { run, createElement as h, Portal } from '../src/index.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let apps = []
afterEach(() => { apps.forEach((a) => { try { a.dispose() } catch (_) {} }); apps = []; document.body.innerHTML = '' })
const start = (App, drivers = {}) => { const a = run(App, drivers, { mountPoint: '#root' }); apps.push(a); return a }
const click = (sel) => document.querySelector(sel).dispatchEvent(new MouseEvent('click', { bubbles: true }))

describe('G-318: a Portal first reached by a patch (not an insert) mounts', () => {
  it('over server markup (hydration patches the placeholder in place)', async () => {
    document.body.innerHTML = '<div id="modal"></div><div id="root"><div><div data-sygnal-portal="#modal" style="display:none"></div></div></div>'
    function App() { return h('div', null, h(Portal, { target: '#modal' }, h('p', { className: 'hi' }, 'hi'))) }
    start(App)
    await sleep(60)
    expect(document.querySelector('#modal .hi')?.textContent).toBe('hi')
  })

  it('replacing a plain div at the same position', async () => {
    document.body.innerHTML = '<div id="modal"></div><div id="root"></div>'
    function App({ state }) { return h('div', null, h('button', null, 'x'), state.open ? h(Portal, { target: '#modal' }, h('p', { className: 'hi' }, 'hi')) : h('div', null, 'closed')) }
    App.initialState = { open: false }
    App.intent = ({ DOM }) => ({ T: DOM.click('button') })
    App.model = { T: (s) => ({ ...s, open: !s.open }) }
    start(App)
    await sleep(40)
    click('button')
    await sleep(60)
    expect(document.querySelector('#modal .hi')?.textContent).toBe('hi')
    // (switching back to the plain div patches the placeholder div in place: its content stays
    // in the target on both cores, an inherited limit of the placeholder being a div)
  })
})
