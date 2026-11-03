// @vitest-environment jsdom
// A child a state change removes (a new key, the other branch of a ternary) is disposed before
// it sees that state: what its STATE watch dispatches is held until the render pass, which
// disposes it. A surviving child's watch still runs in the same flush; a removed Collection item
// keeps its last value (unchanged).
import { it, expect } from 'vitest'
import { parity, mount, h, xs, Collection, Switchable, microtasks } from './harness.js'

const flush = async (m) => { await m.app.__runtime.flushed(); await microtasks() }

/** a page whose STATE.watch of `route` loads it: EFFECT + a LOG sink (as an HTTP request) */
function page(name, log) {
  function Page({ state }) { log.push(`${name}:view:${state.route}`); return h('p', { className: name }, `${name}:${state.route}`) }
  Page.intent = ({ STATE }) => ({ LOAD: STATE.watch((s) => s.route, { immediate: true }) })
  Page.model = {
    LOAD: { EFFECT: (s) => { log.push(`${name}:EFFECT:${s.route}`) }, LOG: (s) => `${name}:${s.route}` },
    DISPOSE: { EFFECT: () => { log.push(`${name}:DISPOSE`) } },
  }
  return Page
}
const logDriver = (sent) => (sink$) => { sink$.addListener({ next: (v) => sent.push(v) }); return xs.never() }

function setup(App) {
  const sent = []
  const m = mount(App, { LOG: logDriver(sent) })
  return { m, sent }
}
const go = async (m, route) => { m.app.__runtime.dispatch('root', 'GO', route); await flush(m) }

parity('a leaving child does not act on the state that removes it', () => {
  it('router-style keyed page: the leaving page sends nothing for the new route', async () => {
    const log = []
    const PAGES = { a: page('A', log), b: page('B', log) }
    function App({ state }) { const Page = PAGES[state.route]; return h('main', null, h(Page, { key: `${state.route}:/x` })) }
    App.initialState = { route: 'a' }
    App.model = { GO: (s, route) => ({ ...s, route }) }
    const { m, sent } = setup(App)
    await flush(m)
    log.length = 0; sent.length = 0
    await go(m, 'b')
    expect(log).toEqual(['A:DISPOSE', 'B:view:b', 'B:EFFECT:b'])
    expect(sent).toEqual(['B:b'])
    expect(m.text('.B')).toBe('B:b')
  })

  it('a keyed ternary: the other branch mounts, the leaving one sends nothing', async () => {
    const log = []
    const A = page('A', log), B = page('B', log)
    function App({ state }) { return h('main', null, state.route === 'a' ? h(A, { key: 'a' }) : h(B, { key: 'b' })) }
    App.initialState = { route: 'a' }
    App.model = { GO: (s, route) => ({ ...s, route }) }
    const { m, sent } = setup(App)
    await flush(m)
    log.length = 0; sent.length = 0
    await go(m, 'b')
    expect(log.filter((e) => e.startsWith('A:'))).toEqual(['A:DISPOSE'])
    expect(log).toContain('B:EFFECT:b')
    expect(sent).toEqual(['B:b'])
    expect(m.text('.B')).toBe('B:b')
  })

  it('the same component under a new key: only the new instance loads', async () => {
    const log = []
    const P = page('P', log)
    function App({ state }) { return h('main', null, h(P, { key: state.route })) }
    App.initialState = { route: '1' }
    App.model = { GO: (s, route) => ({ ...s, route }) }
    const { m, sent } = setup(App)
    await flush(m)
    expect(sent).toEqual(['P:1'])
    log.length = 0; sent.length = 0
    await go(m, '2')
    expect(log).toEqual(['P:DISPOSE', 'P:view:2', 'P:EFFECT:2'])
    expect(sent).toEqual(['P:2'])
    expect(m.text('.P')).toBe('P:2')
  })

  it('a surviving child: its watch fires after the render and its sinks run in the same flush', async () => {
    const log = []
    const P = page('P', log)
    P.model.LOAD.STATE = (s) => ({ ...s, loaded: s.route })
    function App({ state }) { log.push(`App:view:${state.loaded}`); return h('main', null, h(P)) }
    App.initialState = { route: '1', loaded: null }
    App.model = { GO: (s, route) => ({ ...s, route }) }
    const { m, sent } = setup(App)
    await flush(m)
    log.length = 0; sent.length = 0
    const patches = m.patches()
    await go(m, '2')
    expect(log).toEqual(['App:view:1', 'P:view:2', 'P:EFFECT:2', 'App:view:2', 'P:view:2'])
    expect(sent).toEqual(['P:2'])
    expect(m.state().loaded).toBe('2')
    expect(m.patches() - patches).toBe(1)
  })

  it('a hidden Switchable page is not disposed: its watch still runs', async () => {
    const log = []
    const A = page('A', log), B = page('B', log)
    function App({ state }) { return h('main', null, h(Switchable, { of: { a: A, b: B }, current: state.tab })) }
    App.initialState = { tab: 'a', route: '1' }
    App.model = { GO: (s, route) => ({ ...s, route }), TAB: (s, tab) => ({ ...s, tab }) }
    const { m, sent } = setup(App)
    await flush(m)
    m.app.__runtime.dispatch('root', 'TAB', 'b'); await flush(m)
    log.length = 0; sent.length = 0
    await go(m, '2')
    expect(sent.sort()).toEqual(['A:2', 'B:2'])
    expect(log).not.toContain('A:DISPOSE')
  })

  it('a removed Collection item keeps its last value (unchanged)', async () => {
    const log = []
    function Item({ state }) { return h('li', null, String(state.n)) }
    Item.intent = ({ STATE }) => ({ SEE: STATE.watch((s) => s.n) })
    Item.model = { SEE: { EFFECT: (s) => { log.push(`${s.id}:${s.n}`) } }, DISPOSE: { EFFECT: (s) => { log.push(`${s.id}:DISPOSE`) } } }
    function App() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
    App.initialState = { items: [{ id: 1, n: 0 }, { id: 2, n: 0 }] }
    App.model = { DROP: (s) => ({ ...s, items: [{ id: 2, n: 5 }] }) }
    const { m } = setup(App)
    await flush(m)
    log.length = 0
    m.app.__runtime.dispatch('root', 'DROP'); await flush(m)
    expect(log.filter((e) => e.startsWith('1:'))).toEqual(['1:DISPOSE'])
    expect(log).toContain('2:5')
  })
})
