// @vitest-environment jsdom
// PLAN-4.6 R4: integrations that move to the component function on the vnode (`data.c`) and
// to the runtime API, on both cores (04 §3.9-3.12).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { run, renderToString, createElement as h } from '../src/index.js'

const until = (fn, timeout = 2000) => vi.waitFor(fn, { timeout, interval: 2 })
let apps = []
afterEach(() => { apps.forEach((a) => { try { a.dispose() } catch (_) {} }); apps = []; document.body.innerHTML = '' })

describe('renderToString reads a sub-component from data.c (no sygnalOptions)', () => {
  it('a hand-built vnode with only data.c renders the child with its state slice, and leaves the function untouched', () => {
    function Child({ state }) { return h('em', { className: 'c' }, 'n=' + state.n) }
    const before = Object.keys(Child)
    function App() { return h('div', null, { sel: 'Child', data: { c: Child, props: { state: 'kid' } }, children: [], text: undefined, elm: undefined, key: undefined }) }
    App.initialState = { kid: { n: 3 } }
    const html = renderToString(App)
    expect(html).toContain('<em class="c">n=3</em>')
    expect(Object.keys(Child)).toEqual(before)
  })
})

describe('run().hmr(): the swapped app keeps the state and gets no BOOTSTRAP', () => {
  it('state kept, BOOTSTRAP once', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    let boots = 0
    function C({ state }) { return h('b', { className: 'n' }, String(state.n)) }
    C.initialState = { n: 0 }
    C.intent = ({ DOM }) => ({ INC: DOM.click('.n') })
    C.model = { BOOTSTRAP: { EFFECT: () => { boots++ } }, INC: (s) => ({ ...s, n: s.n + 1 }) }
    const app = run(C, {}, { mountPoint: '#root' })
    apps.push(app)
    await until(() => expect(boots).toBe(1))
    document.querySelector('.n').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await until(() => expect(document.querySelector('.n').textContent).toBe('1'))
    function C2({ state }) { return h('b', { className: 'n' }, 'v2:' + state.n) }
    Object.assign(C2, { initialState: C.initialState, intent: C.intent, model: C.model })
    app.hmr(C2)
    await until(() => expect(document.querySelector('.n').textContent).toBe('v2:1'))
    await new Promise((r) => setTimeout(r, 40))
    expect(boots).toBe(1)
  })
})
