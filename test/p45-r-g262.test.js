// @vitest-environment jsdom
// P45-R G-262: the public collection() / switchable() helpers given a root component's own
// sources (as a peer of the root): the depth `__d` is undefined there, so the Collection's
// scheduler key was NaN (run after the root's patch: the list lagged a patch) and the items were
// at depth 0, taken for app roots (their views sent at the patch stage).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { run, makeDOMDriver, collection, switchable, component } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

const until = (fn) => vi.waitFor(fn, { timeout: 2000, interval: 2 })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let app
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = '' })

function mount(App) {
  document.body.innerHTML = '<div id="root"></div>'
  const log = []
  const inner = makeDOMDriver('#root')
  const DOM = (vnode$, name) => inner(vnode$.map(v => (log.push(1), v)), name)
  app = run(App, { DOM }, { mountPoint: '#root' })
  return { patches: () => log.length, $: (s) => document.querySelector(s), $$: (s) => [...document.querySelectorAll(s)] }
}
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))

describe('P45-R G-262: public helpers with root sources', () => {
  it('collection() as a root peer: an update is one patch that shows the new items', async () => {
    const Item = component({ name: 'Item', view: ({ state }) => h('li', { className: 'it' }, state.label) })
    function App({ state, peers }) { return h('div', null, h('button', { className: 'add' }, String(state.items.length)), peers.list) }
    App.peers = { list: collection(Item, 'items', { container: 'ul' }) }
    App.initialState = { items: [{ id: 1, label: 'a' }] }
    App.intent = ({ DOM }) => ({ ADD: DOM.click('.add') })
    App.model = { ADD: (s) => ({ items: [...s.items, { id: s.items.length + 1, label: 'n' }] }) }
    const m = mount(App)
    await until(() => expect(m.$$('.it').length).toBe(1))
    await sleep(20)
    const before = m.patches(), seen = []
    const mo = new MutationObserver(() => seen.push([m.$('.add').textContent, m.$$('.it').length].join('/')))
    mo.observe(document.body, { subtree: true, childList: true, characterData: true })
    click(m.$('.add'))
    await until(() => expect(m.$$('.it').length).toBe(2))
    await sleep(20)
    mo.disconnect()
    expect(m.patches() - before).toBe(1)
    expect(seen.every(x => x == '2/2')).toBe(true)
  })

  it('switchable() as a root peer renders its page and switches', async () => {
    const A = component({ name: 'A', view: () => h('p', { className: 'pg' }, 'A') })
    const Bp = component({ name: 'Bp', view: () => h('p', { className: 'pg' }, 'B') })
    function App({ peers }) { return h('div', null, h('button', { className: 'sw' }, 'sw'), peers.page) }
    App.peers = { page: switchable({ a: A, b: Bp }, 'which', 'a') }
    App.initialState = { which: 'a' }
    App.intent = ({ DOM }) => ({ SW: DOM.click('.sw') })
    App.model = { SW: (s) => ({ which: 'b' }), }
    const m = mount(App)
    await until(() => expect(m.$('.pg')?.textContent).toBe('A'))
    await sleep(20)
    const before = m.patches()
    click(m.$('.sw'))
    await until(() => expect(m.$('.pg')?.textContent).toBe('B'))
    await sleep(20)
    expect(m.patches() - before).toBe(1)
  })
})
