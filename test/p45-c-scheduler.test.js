// @vitest-environment jsdom
// P45-C: one render scheduler per app. Components are marked dirty and flushed once per tick on a
// microtask (after the reducers), parents before children, with one DOM patch per flush.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { run, Collection, makeDOMDriver } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const until = (fn) => vi.waitFor(fn, { timeout: 2000, interval: 2 })
const microtasks = async (n = 20) => { for (let i = 0; i < n; i++) await Promise.resolve() }

let apps = []
afterEach(() => { apps.forEach(a => a.dispose()); apps = []; document.body.innerHTML = ''; vi.useRealTimers() })

/** run() with a DOM driver that logs each patch: 'patch' as the vnode arrives, 'done' after it */
function mount(App, id = 'root') {
  const el = document.createElement('div')
  el.id = id
  document.body.appendChild(el)
  const log = []
  const inner = makeDOMDriver('#' + id)
  const DOM = (vnode$, name) => {
    const src = inner(vnode$.map(v => (log.push('patch'), v)), name)
    src.elements().drop(1).addListener({ next: () => log.push('done') })
    return src
  }
  const app = run(App, { DOM }, { mountPoint: '#' + id })
  apps.push(app)
  const patches = () => log.filter(x => x == 'patch').length
  return { app, log, patches, $: (s) => el.querySelector(s), $$: (s) => [...el.querySelectorAll(s)] }
}
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))

describe('P45-C: one patch per flush', () => {
  it('an action that changes the parent and three children is one patch; parents render before children', async () => {
    const order = []
    function Kid({ state }) { order.push('Kid ' + state.k); return h('span', { className: 'kid' }, `${state.k}:${state.n}`) }
    function App({ state }) {
      order.push('App')
      return h('div', null, h('button', { className: 'inc' }, String(state.n)),
        h(Kid, { state: 'a' }), h(Kid, { state: 'b' }), h(Kid, { state: 'c' }))
    }
    App.initialState = { n: 0, a: { k: 'a', n: 0 }, b: { k: 'b', n: 0 }, c: { k: 'c', n: 0 } }
    App.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
    App.model = { INC: (s) => ({ n: s.n + 1, a: { ...s.a, n: s.a.n + 1 }, b: { ...s.b, n: s.b.n + 1 }, c: { ...s.c, n: s.c.n + 1 } }) }
    const m = mount(App)
    await until(() => expect(m.$$('.kid').length).toBe(3))
    await sleep(20)
    const before = m.patches()
    order.length = 0
    click(m.$('.inc'))
    await until(() => expect(m.$$('.kid').map(e => e.textContent)).toEqual(['a:1', 'b:1', 'c:1']))
    await sleep(20)
    expect(m.patches() - before).toBe(1)
    expect(order).toEqual(['App', 'Kid a', 'Kid b', 'Kid c'])
  })

  it('updating 10 Collection items is one patch', async () => {
    function Row({ state }) { return h('li', { className: 'row' }, state.label) }
    function App() { return h('div', null, h('button', { className: 'up' }, 'up'), h(Collection, { of: Row, from: 'rows' })) }
    App.initialState = { rows: Array.from({ length: 50 }, (_, i) => ({ id: i + 1, label: 'r' + i })) }
    App.intent = ({ DOM }) => ({ UP: DOM.click('.up') })
    App.model = { UP: (s) => ({ rows: s.rows.map((r, i) => i % 5 ? r : { ...r, label: r.label + '!' }) }) }
    const m = mount(App)
    await until(() => expect(m.$$('.row').length).toBe(50))
    await sleep(20)
    const before = m.patches()
    click(m.$('.up'))
    await until(() => expect(m.$$('.row').filter(e => e.textContent.endsWith('!')).length).toBe(10))
    await sleep(20)
    expect(m.patches() - before).toBe(1)
  })

  it('a move between two Collections is one patch, with the item in its new list', async () => {
    function Item({ state }) { return h('li', { className: 'item' }, state.id) }
    function App() {
      return h('div', null, h('button', { className: 'mv' }, 'mv'),
        h('ul', { className: 'l' }, h(Collection, { of: Item, from: 'left' })),
        h('ul', { className: 'r' }, h(Collection, { of: Item, from: 'right' })))
    }
    App.initialState = { left: [{ id: 'x' }, { id: 'y' }], right: [{ id: 'z' }] }
    App.intent = ({ DOM }) => ({ MV: DOM.click('.mv') })
    App.model = { MV: (s) => ({ left: s.left.slice(1), right: [...s.right, s.left[0]] }) }
    const m = mount(App)
    await until(() => expect(m.$$('.item').length).toBe(3))
    await sleep(20)
    const before = m.patches()
    // every patch shows all three items
    const counts = []
    new MutationObserver(() => counts.push(m.$$('.item').length)).observe(document.body, { subtree: true, childList: true })
    click(m.$('.mv'))
    await until(() => expect(m.$$('.r .item').map(e => e.textContent)).toEqual(['z', 'x']))
    await sleep(20)
    expect(m.patches() - before).toBe(1)
    expect(counts.every(n => n == 3)).toBe(true)
  })

  it('the flush is a microtask: under fake timers the patch needs no clock advance', async () => {
    vi.useFakeTimers()
    function App({ state }) { return h('button', { className: 'b' }, String(state.n)) }
    App.initialState = { n: 0 }
    App.intent = ({ DOM }) => ({ INC: DOM.click('.b') })
    App.model = { INC: (s) => ({ n: s.n + 1 }) }
    const m = mount(App)
    await vi.advanceTimersByTimeAsync(50)
    expect(m.$('.b').textContent).toBe('0')
    click(m.$('.b'))
    await microtasks()
    expect(m.$('.b').textContent).toBe('1')
  })

  it('an action sent during a flush (from the patch) gets a second flush, never a nested one', async () => {
    function App({ state }) {
      return h('div', null, h('button', { className: 'add' }, 'add'), h('p', { className: 'n' }, String(state.seen)),
        ...state.items.map(i => h('i', { className: 'it' }, i)))
    }
    App.initialState = { items: [], seen: 0 }
    // the DOM source emits after each patch: an action from it runs while the patch's flush is on
    App.intent = ({ DOM }) => ({ ADD: DOM.click('.add'), SEEN: DOM.select('.it').elements().map(e => e.length) })
    App.model = { ADD: (s) => ({ ...s, items: [...s.items, 'i'] }), SEEN: (s, n) => n == s.seen ? s : ({ ...s, seen: n }) }
    const m = mount(App)
    await until(() => expect(m.$('.add')).toBeTruthy())
    await sleep(20)
    m.log.length = 0
    click(m.$('.add'))
    await until(() => expect(m.$('.n').textContent).toBe('1'))
    await sleep(20)
    expect(m.log).toEqual(['patch', 'done', 'patch', 'done'])
  })

  it('two apps on one page have their own schedulers', async () => {
    const make = () => {
      function App({ state }) { return h('button', { className: 'b' }, String(state.n)) }
      App.initialState = { n: 0 }
      App.intent = ({ DOM }) => ({ INC: DOM.click('.b') })
      App.model = { INC: (s) => ({ n: s.n + 1 }) }
      return App
    }
    const a = mount(make(), 'a'), b = mount(make(), 'b')
    await until(() => expect(a.$('.b') && b.$('.b')).toBeTruthy())
    await sleep(20)
    const [pa, pb] = [a.patches(), b.patches()]
    click(a.$('.b'))
    await until(() => expect(a.$('.b').textContent).toBe('1'))
    await sleep(20)
    expect([a.patches() - pa, b.patches() - pb]).toEqual([1, 0])
    // both in the same tick: one patch each
    click(a.$('.b')); click(b.$('.b'))
    await until(() => expect([a.$('.b').textContent, b.$('.b').textContent]).toEqual(['2', '1']))
    await sleep(20)
    expect([a.patches() - pa, b.patches() - pb]).toEqual([2, 1])
    // disposing one leaves the other running
    a.app.dispose()
    apps = apps.filter(x => x !== a.app)
    click(b.$('.b'))
    await until(() => expect(b.$('.b').textContent).toBe('2'))
  })

  it('a child removed by the same action that changes it is disposed mid-flush without rendering again', async () => {
    const renders = []
    function Kid({ state }) { renders.push(state.v); return h('span', { className: 'kid' }, String(state.v)) }
    function App({ state }) { return h('div', null, h('button', { className: 'go' }, 'go'), state.show ? h(Kid, { state: 'kid' }) : h('em', null, 'gone')) }
    App.initialState = { show: true, kid: { v: 0 } }
    App.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    App.model = { GO: (s) => ({ show: false, kid: { v: 1 } }) }
    const errors = []
    const onErr = (e) => errors.push(e)
    window.addEventListener('error', onErr)
    const m = mount(App)
    await until(() => expect(m.$('.kid')).toBeTruthy())
    await sleep(20)
    click(m.$('.go'))
    await until(() => expect(m.$('em')?.textContent).toBe('gone'))
    await sleep(30)
    window.removeEventListener('error', onErr)
    expect(renders).toEqual([0])
    expect(errors).toEqual([])
    expect(m.$('.kid')).toBe(null)
  })
})

describe('P45-C rec 9: the DOM driver emits after a patch, not on outside DOM changes', () => {
  it('elements() emits once per patch; a DOM change made outside Sygnal emits nothing', async () => {
    function App({ state }) { return h('div', null, h('button', { className: 'b' }, String(state.n))) }
    App.initialState = { n: 0 }
    App.intent = ({ DOM }) => ({ INC: DOM.click('.b') })
    App.model = { INC: (s) => ({ n: s.n + 1 }) }
    const m = mount(App)
    await until(() => expect(m.$('.b')).toBeTruthy())
    await sleep(20)
    const seen = []
    m.app.sources.DOM.select('.b').elements().addListener({ next: (els) => seen.push(els[0]?.textContent) })
    expect(seen).toEqual(['0'])
    m.$('.b').parentNode.appendChild(document.createElement('hr'))
    await sleep(20)
    expect(seen).toEqual(['0'])
    click(m.$('.b'))
    await until(() => expect(seen).toEqual(['0', '1']))
  })
})
