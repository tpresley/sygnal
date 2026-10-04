// @vitest-environment jsdom
// PLAN-3 5-4b (X-1): makeHeadDriver. Values from the `head` static or a HEAD model entry,
// one entry per instance, merged in mount order (a later title wins), removed on dispose;
// meta by name/property, links by key/canonical/rel+href; existing tags adopted and restored;
// SSR tags (renderHead) adopted; titleTemplate; router integration through the app's state.
import { it, expect, beforeEach, afterEach, vi, describe } from 'vitest'
import xs from 'xstream'
import run from '../src/extra/run.js'
import { createElement as h } from '../src/pragma/index.js'
import { Switchable } from '../src/switchable.js'
import { makeHeadDriver, renderHead, mergeHead } from '../src/extra/head.js'
import { makeRouter } from '../src/extra/router.js'
import { renderToString } from '../src/extra/ssr.js'
import { waitFor, sleep } from '../evals/agent-ergonomics/hidden/_support/queries.js'

let app
beforeEach(() => {
  window.history.replaceState(null, '', '/')
  document.head.innerHTML = '<title>Static</title><meta name="description" content="static desc">'
  document.body.innerHTML = '<div id="root"></div>'
  window.scrollTo = () => {}
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  try { app?.dispose() } catch (_) {}
  app = null
  vi.restoreAllMocks()
})

const meta = k => document.head.querySelector(`meta[name="${k}"], meta[property="${k}"]`)?.getAttribute('content')
const links = () => [...document.head.querySelectorAll('link')].map(l => `${l.rel} ${l.getAttribute('href')}`)

describe('makeHeadDriver', () => {
  it('a head static sets title, meta and link; a child declared later wins the title; its dispose restores', async () => {
    const show$ = xs.create()
    function Child() { return h('p', null, 'child') }
    Child.head = () => ({ title: 'Child', meta: { 'og:title': 'Child OG' }, link: [{ rel: 'canonical', href: '/child' }] })
    function App({ state }) { return h('div', null, state.child ? h(Child) : h('span', null, 'none')) }
    App.initialState = { child: false, n: 1 }
    App.head = s => ({ title: 'App ' + s.n, meta: { description: 'app desc', keywords: 'a' }, link: [{ rel: 'canonical', href: '/' }, { rel: 'icon', href: '/i.svg' }] })
    App.intent = () => ({ SHOW: show$ })
    App.model = { SHOW: (s, v) => ({ ...s, child: v, n: s.n + 1 }) }
    app = run(App, { HEAD: makeHeadDriver() }, { mountPoint: '#root' })
    await waitFor(() => expect(document.title).toBe('App 1'))
    expect(meta('description')).toBe('app desc')
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1) // adopted, not duplicated
    expect(meta('keywords')).toBe('a')
    expect(links()).toEqual(['canonical /', 'icon /i.svg'])
    show$.shamefullySendNext(true)
    await waitFor(() => expect(document.title).toBe('Child'))
    expect(meta('og:title')).toBe('Child OG')
    expect(document.head.querySelector('meta[property="og:title"]')).not.toBeNull()
    expect(links()).toEqual(['canonical /child', 'icon /i.svg'])
    show$.shamefullySendNext(false)
    await waitFor(() => expect(document.title).toBe('App 3'))
    expect(meta('og:title')).toBeUndefined()
    expect(links()).toEqual(['canonical /', 'icon /i.svg'])
    app.dispose()
    app = null
    expect(document.title).toBe('Static')
    expect(meta('description')).toBe('static desc')
    expect(meta('keywords')).toBeUndefined()
    expect(links()).toEqual([])
  })

  it('HEAD values from a model entry, titleTemplate, null removes a meta key, {} clears', async () => {
    const go$ = xs.create()
    function App() { return h('p', null, 'x') }
    App.initialState = {}
    App.intent = () => ({ GO: go$ })
    App.model = { GO: { HEAD: (_, v) => v } }
    app = run(App, { HEAD: makeHeadDriver({ titleTemplate: '%s · Tasks' }) }, { mountPoint: '#root' })
    await sleep(20)
    go$.shamefullySendNext({ title: 'One', meta: { description: 'd1', robots: 'noindex' } })
    await waitFor(() => expect(document.title).toBe('One · Tasks'))
    expect(meta('robots')).toBe('noindex')
    go$.shamefullySendNext({ title: 'Two', meta: { description: null } })
    await waitFor(() => expect(document.title).toBe('Two · Tasks'))
    expect(meta('description')).toBe('static desc') // restored: nothing sets it now
    expect(meta('robots')).toBeUndefined()
    go$.shamefullySendNext({}) // (a null sink value is never sent)
    await waitFor(() => expect(document.title).toBe('Static'))
  })

  it('adopts the SSR tags renderHead() marked, and removes the ones no entry sets', async () => {
    document.head.innerHTML = renderHead([{ title: 'SSR', meta: { description: 'ssr', author: 'me' }, link: [{ rel: 'canonical', href: '/x' }] }])
    expect(document.title).toBe('SSR')
    const desc = document.head.querySelector('meta[name="description"]')
    function App() { return h('p', null, 'x') }
    App.initialState = {}
    App.head = () => ({ title: 'Client', meta: { description: 'client' } })
    app = run(App, { HEAD: makeHeadDriver() }, { mountPoint: '#root' })
    await waitFor(() => expect(document.title).toBe('Client'))
    expect(document.head.querySelector('meta[name="description"]')).toBe(desc)
    expect(desc.getAttribute('content')).toBe('client')
    expect(meta('author')).toBeUndefined()
    expect(links()).toEqual([])
  })

  it('the route title comes from the app state (no coupling between the drivers)', async () => {
    const router = makeRouter({ routes: { home: '/', task: '/tasks/:id' } })
    const titles = { home: () => 'Home', task: r => 'Task ' + r.params.id }
    const Home = () => h('a', { href: router.href('task', { id: 2 }), className: 't2' }, 'two')
    const Task = () => h('h1', null, 'task')
    function App({ state }) { return h('main', null, h(Switchable, { of: { home: Home, task: Task }, current: state.route.name })) }
    App.initialState = { route: router.current() }
    App.route = 'ROUTE'
    App.head = s => ({ title: titles[s.route.name](s.route) })
    App.model = { ROUTE: (s, route) => ({ ...s, route }) }
    app = run(App, { ROUTER: router.driver, HEAD: makeHeadDriver() }, { mountPoint: '#root' })
    await waitFor(() => expect(document.title).toBe('Home'))
    await waitFor(() => !!document.querySelector('.t2'))
    document.querySelector('.t2').click()
    await waitFor(() => expect(document.title).toBe('Task 2'))
  })
})

describe('SSR', () => {
  it('renderToString({ head }) collects each rendered component\'s head static; renderHead() merges and escapes', () => {
    function Child({ state }) { return h('p', null, state.name) }
    Child.head = s => ({ title: s.name, meta: { 'og:title': s.name } })
    function App() { return h('div', null, h(Child, { state: 'child' })) }
    App.initialState = { child: { name: 'A & "B"' } }
    App.head = { title: 'App', meta: { description: 'd' }, link: [{ rel: 'icon', href: '/i.svg', type: 'image/svg+xml' }] }
    const list = []
    const html = renderToString(App, { head: list })
    expect(html).toBe('<div data-sygnal-ssr=""><p>A &amp; &quot;B&quot;</p></div>')
    expect(list).toHaveLength(2)
    expect(renderHead(list, { titleTemplate: '%s | Site' })).toBe(
      '<title>A &#38; &#34;B&#34; | Site</title>' +
      '<meta name="description" content="d" data-sygnal-head="m:description">' +
      '<meta property="og:title" content="A &#38; &#34;B&#34;" data-sygnal-head="m:og:title">' +
      '<link rel="icon" href="/i.svg" type="image/svg+xml" data-sygnal-head="l:icon /i.svg">')
    // without the option nothing is collected
    expect(renderToString(App)).toBe(html)
  })

  it('mergeHead: later title wins, link merge keys', () => {
    const m = mergeHead([
      { title: 'a', link: [{ rel: 'canonical', href: '/a' }, { rel: 'stylesheet', href: '/a.css' }, { rel: 'alternate', href: '/fr', key: 'fr' }] },
      null,
      { title: 'b', link: [{ rel: 'canonical', href: '/b' }, { rel: 'stylesheet', href: '/b.css' }, { rel: 'alternate', href: '/fr2', key: 'fr' }] },
    ])
    expect(m.title).toBe('b')
    expect(m.link.map(([, l]) => l.href)).toEqual(['/b', '/a.css', '/fr2', '/b.css'])
  })
})
