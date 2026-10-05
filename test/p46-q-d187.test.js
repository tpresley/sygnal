// @vitest-environment jsdom
// PLAN-4.6 P46-Q (D187 follow-ups): the 'intent' and 'context' phases of the app-level onError
// hook, and the SSR Portal wrapper that hydration patches in place (the G-318 path)
import { describe, it, expect, afterEach, vi } from 'vitest'
import { run, renderToString, createElement as h, Portal, xs } from '../src/index.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let apps = []
afterEach(() => { apps.forEach((a) => { try { a.dispose() } catch (_) {} }); apps = []; document.body.innerHTML = ''; vi.restoreAllMocks() })
const start = (App, opts = {}) => { const a = run(App, {}, { mountPoint: '#root', ...opts }); apps.push(a); return a }

describe("onError phases 'intent' and 'context'", () => {
  it("an intent stream that errors is reported with the phase 'intent' and its action", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    document.body.innerHTML = '<div id="root"></div>'
    const seen = []
    function App() { return h('div', null, 'x') }
    App.initialState = {}
    App.intent = () => ({ BOOM: xs.throw(new Error('intent failed')) })
    App.model = { BOOM: (s) => s }
    start(App, { onError: (e, info) => seen.push([e.message, info.phase, info.componentName, info.action]) })
    await sleep(30)
    expect(seen).toEqual([['intent failed', 'intent', 'App', 'BOOM']])
  })

  it("a .context entry that throws is reported with the phase 'context'", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    document.body.innerHTML = '<div id="root"></div>'
    const seen = []
    function App({ context }) { return h('div', null, String(context.bad)) }
    App.initialState = {}
    App.context = { bad: () => { throw new Error('context failed') } }
    start(App, { onError: (e, info) => seen.push([e.message, info.phase, info.componentName]) })
    await sleep(30)
    expect(seen).toContainEqual(['context failed', 'context', 'App'])
    expect(seen.every((x) => x[1] === 'context')).toBe(true)
  })
})

describe('the pragma SPECIAL tags (sygnal-factory trimmed)', () => {
  it('a form field keeps its tree out of the same-output reuse: a controlled value is re-synced', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    function App({ state }) { return h('div', null, h('input', { className: 'f', value: state.v }), h('button', null, 'x')) }
    App.initialState = { v: 'a', n: 0 }
    App.intent = ({ DOM }) => ({ BUMP: DOM.click('button') })
    App.model = { BUMP: (s) => ({ ...s, n: s.n + 1 }) }   // a new state, the same output
    start(App)
    await sleep(30)
    const input = document.querySelector('.f')
    input.value = 'typed'                                  // no intent reads it: the state stays 'a'
    document.querySelector('button').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await sleep(30)
    expect(input.value).toBe('a')
  })
})

describe('SSR Portal: hydration patches the server wrapper in place (G-318)', () => {
  function App() {
    return h('div', null,
      h('span', null, 'before'),
      h(Portal, { target: '#modal' }, h('p', { className: 'a' }, 'one'), h('p', { className: 'b' }, 'two')),
      h('span', null, 'after'))
  }

  it('renderToString gives the wrapper the placeholder selector and the target', () => {
    const html = renderToString(App)
    expect(html).toContain('<div class="sygnal-portal" data-sygnal-portal="#modal"><p class="a">one</p><p class="b">two</p></div>')
  })

  it('the client patches that element (not a replacement) and mounts the Portal', async () => {
    document.body.innerHTML = `<div id="modal"></div><div id="root">${renderToString(App)}</div>`
    const wrapper = document.querySelector('#root .sygnal-portal')
    start(App)
    await sleep(60)
    expect(document.querySelector('#root .sygnal-portal')).toBe(wrapper)
    expect(wrapper.style.display).toBe('none')
    expect(wrapper.children.length).toBe(0)
    expect([...document.querySelectorAll('#modal p')].map((p) => p.textContent)).toEqual(['one', 'two'])
  })
})
