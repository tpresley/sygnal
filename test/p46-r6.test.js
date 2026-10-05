// @vitest-environment jsdom
// PLAN-4.6 R6: fixes of the R5 review (G-336 ... G-347), each pinned here (failing first).
import { describe, it, expect, vi, afterEach } from 'vitest'
import xs from 'xstream'
import { renderComponent } from '../src/extra/testing.js'
import { run, createElement as h } from '../src/index.js'

let t, app
afterEach(() => {
  t?.dispose(); t = null
  app?.dispose(); app = null
  vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ''
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

describe('G-338: a single-stream intent (removed) fails with a message naming the form', () => {
  it('names the removed form and links the migration guide, not a stream internal', () => {
    document.body.innerHTML = '<div id="root"></div>'
    function App({ state }) { return h('div', null, 'x' + state.n) }
    App.initialState = { n: 0 }
    App.intent = () => xs.never()
    App.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }
    let err
    try { app = run(App, {}, { mountPoint: '#root' }) } catch (e) { err = e }
    expect(err).toBeTruthy()
    expect(err.message).toContain('[Sygnal SYG603] App:')
    expect(err.message).toContain('single stream')
    expect(err.message).toContain('https://sygnal.js.org/guide/migrating-to-6#leftovers')
    expect(err.message).not.toContain('_prod')
  })
})
