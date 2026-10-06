// @vitest-environment jsdom
// PLAN-5 4-J: the review of 4-I/4-R. G-564: a vnode in both the old tree and the new one (a
// component's cached vnode, a Collection item's copy) under an ancestor that is recreated: destroy
// hooks get the old element (widgets inside unmount, the scope keeps the new element). G-565:
// every listening `route` declarer gets its first ROUTE in the flush that declared it (after the
// first declarer's, which may redirect: G-168), and a navigation reaches them all in one flush. The
// reviewer's probes (rv4ir i.probe P7, r2 R6, old/h, old/f, old/g*) are the cases below.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { run, Collection, defineWidget } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { makeRouter } from '../src/extra/router.js'
import { ABORT } from '../src/shared.js'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let apps = []
beforeEach(() => { vi.stubGlobal('requestAnimationFrame', (f) => setTimeout(f, 1)) })
afterEach(() => { apps.forEach(a => a.dispose()); apps = []; document.body.innerHTML = ''; vi.unstubAllGlobals() })
function mount(App) {
  document.body.innerHTML = '<div id="root"></div>'
  const app = run(App, {}, { mountPoint: '#root' }); apps.push(app)
  return { app, el: document.getElementById('root') }
}
const op = (f) => document.dispatchEvent(new CustomEvent('p4j-op', { detail: f }))

describe('G-564: a reused vnode under a recreated ancestor', () => {
  // mode: how the ancestor is recreated, and what is reused under it
  const cases = {
    'Collection under <ul>/<ol> (rv4ir P7)': (alt, c) => h('div', null, alt ? h('ol', null, c) : h('ul', null, c)),
    'Collection two levels down': (alt, c) => h('div', null, alt ? h('section', null, h('ul', null, c)) : h('div', null, h('ul', null, c))),
    'Collection in a <ul> whose key changes': (alt, c) => h('div', null, h('ul', { key: alt ? 'a' : 'b' }, c)),
    'a child component (its cached vnode)': (alt, c) => h('div', null, alt ? h('ol', null, c) : h('ul', null, c)),
  }
  for (const [name, view] of Object.entries(cases)) {
    it(name + ': widgets unmount, destroy hooks see the old element, events work', async () => {
      const log = []
      const Box = defineWidget({
        mount(el, p) { log.push('mount ' + p.id); el.textContent = 'w' + p.id; return { id: p.id, el } },
        unmount(i, el) { log.push('unmount ' + i.id + (el === i.el ? '' : ' (another element)')) },
        update() {},
      })
      let old = []
      function Item({ state }) {
        return h('li', { hook: { destroy: (v) => log.push('destroy ' + state.id + (old.includes(v.elm) ? '' : ' (not the old element)')) } }, h(Box, { id: state.id }))
      }
      Item.intent = ({ DOM }) => ({ HIT: DOM.select('li').events('click') })
      Item.model = { HIT: (s) => ({ ...s, hits: (s.hits || 0) + 1 }) }
      const one = name.startsWith('a child')
      function App({ state }) { return view(state.alt, one ? h(Item, { state: 'one' }) : h(Collection, { of: Item, from: 'items' })) }
      App.intent = ({ DOM }) => ({ OP: DOM.select('document').events('p4j-op').map(e => e.detail) })
      App.model = { OP: (s, f) => f(s) }
      App.initialState = { alt: false, items: [{ id: 1 }, { id: 2 }], one: { id: 1 } }
      const { app, el } = mount(App); await sleep(20)
      const ids = one ? [1] : [1, 2]
      for (const alt of [true, false]) {
        old = [...el.querySelectorAll('li')]
        log.length = 0
        op(s => ({ ...s, alt })); await sleep(20)
        expect(log).toEqual([...ids.flatMap(i => ['destroy ' + i, 'unmount ' + i]), ...ids.map(i => 'mount ' + i)])
        expect([...el.querySelectorAll('li')].every(li => !old.includes(li) && li.isConnected)).toBe(true)
        expect(old.some(li => li.isConnected)).toBe(false)
      }
      // the items' scope has the new elements: their events still reach them
      el.querySelector('li').click(); await sleep(20)
      const s = app.__runtime.getState()
      expect(one ? s.one.hits : s.items[0].hits).toBe(1)
      // and dispose unmounts what is mounted now
      log.length = 0
      old = [...el.querySelectorAll('li')]
      app.dispose(); apps = []
      expect(log.filter(l => l.startsWith('unmount')).sort()).toEqual(ids.map(i => 'unmount ' + i))
    })
  }
})

describe('G-565: every listening route declarer gets its first ROUTE before the first patch', () => {
  const routes = { home: '/', login: '/login', secret: '/secret', task: '/tasks/:id' }
  // the vnodes the runtime sent to the DOM driver (one per patch)
  let patches = 0
  /** resolves once #root shows an input (checked after each microtask) */
  async function firstPatch() {
    for (let i = 0; i < 1000; i++) { if (document.querySelector('#root input')) return; await Promise.resolve() }
    throw new Error('app did not render in microtasks')
  }

  // an Edit child whose ROUTE resets its draft, under a root that declares `route` too (rv4ir r2
  // R6); `guard`: the root redirects /secret to /login (the guard owner, G-168)
  function build(router, guard) {
    const seen = []
    function Edit({ state }) { return h('input', { name: 'title', value: state.draft ?? 'orig' }) }
    Edit.route = 'ROUTE'
    Edit.intent = ({ DOM }) => ({ TYPE: DOM.input('input[name="title"]').value() })
    Edit.model = { ROUTE: (s, r) => (seen.push(r.path), { ...s, draft: null, path: r.path }), TYPE: (s, d) => ({ ...s, draft: d }) }
    function App() { return h('main', null, h(Edit, { state: 'e' })) }
    App.route = 'ROUTE'
    App.initialState = { route: router.current(), e: { draft: null } }
    App.model = guard
      ? { ROUTE: { STATE: (s, r) => r.name == 'secret' ? ABORT : { ...s, route: r }, ROUTER: (s, r) => r.name == 'secret' ? { to: 'login', replace: true } : ABORT } }
      : { ROUTE: (s, r) => ({ ...s, route: r }) }
    return { App, seen }
  }
  const start = (App, router) => {
    document.body.innerHTML = '<div id="root"></div>'
    patches = 0
    const app = run(App, { ROUTER: router.driver }, { mountPoint: '#root' }); apps.push(app)
    app.__runtime.addHooks({ onPatch: () => patches++ })
    return app
  }
  const type = async (text) => {
    const input = document.querySelector('#root input')
    input.value = text; input.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(20)
  }

  it('a nested declarer: its ROUTE is in the first patch; text typed right after it is kept (rv4ir R6)', async () => {
    window.history.replaceState(null, '', '/secret')
    const router = makeRouter({ routes })
    const { App, seen } = build(router)
    const app = start(App, router)
    await firstPatch()
    expect(seen).toEqual(['/secret'])
    await type('typed')
    expect(app.__runtime.getState().e).toMatchObject({ draft: 'typed', path: '/secret' })
    expect(document.querySelector('#root input').value).toBe('typed')
    expect(seen).toEqual(['/secret'])
  })

  it('the first declarer redirects: the nested one gets only the redirected route, in the first patch', async () => {
    window.history.replaceState(null, '', '/secret')
    const router = makeRouter({ routes })
    const { App, seen } = build(router, true)
    const app = start(App, router)
    await firstPatch()
    expect(window.location.pathname).toBe('/login')
    expect(seen).toEqual(['/login'])
    await Promise.resolve()
    expect(patches).toBe(1)
    await type('typed')
    expect(app.__runtime.getState().e.draft).toBe('typed')
    expect(seen).toEqual(['/login'])
  })

  it('a navigation reaches every declarer in one patch; a redirect still hides the route it leaves', async () => {
    window.history.replaceState(null, '', '/')
    const router = makeRouter({ routes })
    const { App, seen } = build(router, true)
    const app = start(App, router)
    await sleep(20)
    expect(seen).toEqual(['/'])
    patches = 0
    window.history.pushState(null, '', '/tasks/1'); window.dispatchEvent(new PopStateEvent('popstate'))
    // (synchronously: the popstate listener dispatches the routes; nothing waits for a task)
    expect(seen).toEqual(['/', '/tasks/1'])
    expect(app.__runtime.getState().route.path).toBe('/tasks/1')
    await sleep(20)
    expect(patches).toBe(1)
    window.history.pushState(null, '', '/secret'); window.dispatchEvent(new PopStateEvent('popstate'))
    await sleep(20)
    expect(window.location.pathname).toBe('/login')
    expect(seen).toEqual(['/', '/tasks/1', '/login'])
  })
})
