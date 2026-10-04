// @vitest-environment jsdom
// P45-R G-257/G-258: a new component's first render waits for its intent (D153, so a visible
// element always responds). That gate opens on a timer, which the flush didn't wait for: a move
// between Collections whose items have intent + model was two patches ~2 ms apart (the item
// missing in between), and with View Transitions the second patch landed mid-animation. The
// flush now holds the patch while such a gate is pending (bounded).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { run, Collection, makeDOMDriver } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { makeViewTransitionDOMDriver } from '../src/extra/viewTransitions.js'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const until = (fn) => vi.waitFor(fn, { timeout: 2000, interval: 2 })

let apps = []
afterEach(() => { apps.forEach(a => a.dispose()); apps = []; document.body.innerHTML = ''; delete document.startViewTransition; vi.useRealTimers() })

function mount(App, id = 'root', make = makeDOMDriver) {
  const el = document.createElement('div')
  el.id = id
  document.body.appendChild(el)
  const log = []
  const inner = make('#' + id)
  const DOM = (vnode$, name) => inner(vnode$.map(v => (log.push('patch'), v)), name)
  const app = run(App, { DOM }, { mountPoint: '#' + id })
  apps.push(app)
  return { app, patches: () => log.length, $: (s) => el.querySelector(s), $$: (s) => [...el.querySelectorAll(s)] }
}
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
// records how many items each DOM mutation leaves in the document
const watchItems = (m) => {
  const counts = [], mo = new MutationObserver(() => counts.push(m.$$('.item').length))
  mo.observe(document.body, { subtree: true, childList: true })
  return { counts, stop: () => mo.disconnect() }
}

function Item({ state }) { return h('li', { className: 'item' }, h('button', { className: 'x' }, state.id + ':' + (state.n || 0))) }
Item.intent = ({ DOM }) => ({ CLICK: DOM.click('.x') })
Item.model = { CLICK: (s) => ({ ...s, n: (s.n || 0) + 1 }) }

function App() {
  return h('div', null, h('button', { className: 'mv' }, 'mv'),
    h('ul', { className: 'l' }, h(Collection, { of: Item, from: 'left' })),
    h('ul', { className: 'r' }, h(Collection, { of: Item, from: 'right' })))
}
App.initialState = { left: [{ id: 'x' }, { id: 'y' }], right: [{ id: 'z' }] }
App.intent = ({ DOM }) => ({ MV: DOM.click('.mv') })
App.model = { MV: (s) => ({ left: s.left.slice(1), right: [...s.right, s.left[0]] }) }

describe('P45-R G-257: a move between Collections whose items have intent + model', () => {
  it('is one patch, and no DOM state in between misses the item', async () => {
    const m = mount(App)
    await until(() => expect(m.$$('.item').length).toBe(3))
    await sleep(20)
    const before = m.patches(), w = watchItems(m)
    click(m.$('.mv'))
    await until(() => expect(m.$$('.r .item').map(e => e.textContent)).toEqual(['z:0', 'x:0']))
    await sleep(20)
    w.stop()
    expect(m.patches() - before).toBe(1)
    expect(w.counts.length).toBeGreaterThan(0)
    expect(w.counts.every(n => n == 3)).toBe(true)
  })

  it('the moved item responds to a click as soon as it is visible (D153)', async () => {
    const m = mount(App)
    await until(() => expect(m.$$('.item').length).toBe(3))
    await sleep(20)
    click(m.$('.mv'))
    await until(() => expect(m.$$('.r .item').length).toBe(2))
    click(m.$$('.r .x')[1])
    await until(() => expect(m.$$('.r .item').map(e => e.textContent)).toEqual(['z:0', 'x:1']))
  })

  it('an update that creates no component still patches without waiting for a timer', async () => {
    vi.useFakeTimers()
    const m = mount(App, 'ft')
    await vi.advanceTimersByTimeAsync(50)
    expect(m.$$('.item').length).toBe(3)
    click(m.$$('.l .x')[0])
    for (let i = 0; i < 30; i++) await Promise.resolve()
    expect(m.$$('.l .x')[0].textContent).toBe('x:1')
  })

  it('a chain of gated components never holds the patch for long (bounded)', async () => {
    // every render of Grow adds a new gated child; the patch still comes, within ~10 holds
    function Leaf({ state }) { return h('i', { className: 'leaf' }, String(state.n)) }
    Leaf.intent = ({ DOM }) => ({ C: DOM.click('.leaf') })
    Leaf.model = { C: (s) => s }
    function Grow({ state }) { return h('div', null, h('b', { className: 'g' }, String(state.items.length)), h(Collection, { of: Leaf, from: 'items' })) }
    Grow.initialState = { items: [] }
    // each patch adds one more item (a new gated component), up to 30
    Grow.intent = ({ DOM }) => ({ ADD: DOM.select('.g').elements() })
    Grow.model = { ADD: (s) => s.items.length < 30 ? { items: [...s.items, { id: s.items.length, n: s.items.length }] } : s }
    const m = mount(Grow, 'grow')
    await until(() => expect(m.$$('.leaf').length).toBe(30))
  })
})

// a fake View Transitions API: runs the update callback a task later (as browsers do)
function fakeVT() {
  const calls = []
  document.startViewTransition = (update) => {
    const t = { update }
    calls.push(t)
    t.updateCallbackDone = new Promise(r => setTimeout(r, 0)).then(() => { t.ran = 1; update() })
    return t
  }
  return calls
}

describe('P45-R G-258: View Transitions', () => {
  it('a move between Collections whose items have intent + model is applied in the update callback', async () => {
    const VApp = Object.assign((p) => App(p), App, { viewTransitions: ['MV'] })
    const calls = fakeVT()
    const m = mount(VApp, 'vt', makeViewTransitionDOMDriver)
    await until(() => expect(m.$$('.item').length).toBe(3))
    await sleep(30)
    const n0 = calls.length, before = m.patches(), w = watchItems(m)
    click(m.$('.mv'))
    await until(() => expect(m.$$('.r .item').length).toBe(2))
    await sleep(30)
    w.stop()
    expect(calls.length - n0).toBe(1)
    expect(m.patches() - before).toBe(1)
    expect(w.counts.every(n => n == 3)).toBe(true)
  })
})
