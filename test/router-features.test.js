// @vitest-environment jsdom
// PLAN-3 5-4b: the router beyond the 5-0c spike (test/router.test.js): the command key and
// SYG620, redirect order with several declarers (G-168), commands (forward, url, replace, go,
// prefetch), block + beforeunload, link interception gaps (SVG, rel=external, shadow DOM,
// <base>, trailing slash, forms), history.state keys, scroll restoration and focus (G-169),
// hash mode, an injected (memory) window, Vike's navigate(), dispose, and the dev checks
// (SYG130-133).
import { it, expect, beforeEach, afterEach, vi, describe } from 'vitest'
import xs from 'xstream'
import run from '../src/extra/run.js'
import { ABORT } from '../src/component.js'
import { createElement as h } from '../src/pragma/index.js'
import { makeRouter } from '../src/extra/router.js'
import { waitFor, textOf, sleep } from '../evals/agent-ergonomics/hidden/_support/queries.js'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

const routes = { home: '/', task: '/tasks/:id', note: '/tasks/:id/notes/:noteId', notFound: '*' }

let app, errorSpy, scrolls
beforeEach(() => {
  window.history.replaceState(null, '', '/')
  document.head.innerHTML = ''
  document.body.innerHTML = '<div id="root"></div>'
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  scrolls = []
  Object.defineProperty(window, 'scrollX', { value: 0, writable: true, configurable: true })
  Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true })
  window.scrollTo = (x, y) => { scrolls.push([x, y]); window.scrollX = x; window.scrollY = y }
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  try { app?.dispose() } catch (_) {}
  app = null
  vi.restoreAllMocks()
  _resetDiagnostics()
})

const path = () => window.location.pathname + window.location.search + window.location.hash
const text = sel => textOf(document.querySelector(sel))
const clickEvent = (init = {}) => new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, button: 0, ...init })
const clickOn = (el, init) => { const ev = clickEvent(init); el.dispatchEvent(ev); return ev }

/**
 * A root that declares `route`, records every route it gets, renders `body(state)`, and sends
 * each value pushed with `send()` to the ROUTER sink (CMD).
 */
function probe(router, { body = () => [], extra = {}, name = 'Probe', options } = {}) {
  const seen = [], cmd$ = xs.create()
  const P = ({ state }) => h('main', null, h('p', { className: 'where' }, state.route ? state.route.path : '-'), ...body(state))
  Object.defineProperty(P, 'name', { value: name })
  P.route = 'ROUTE'
  P.initialState = { route: null, blocked: [] }
  P.intent = () => ({ CMD: cmd$ })
  P.model = {
    ROUTE: (s, r) => { seen.push(r); return { ...s, route: r } },
    CMD: { ROUTER: (_, c) => c },
    LEAVE: (s, d) => ({ ...s, blocked: [...s.blocked, d] }),
    ...extra,
  }
  const start = () => (app = run(P, { ROUTER: router.driver }, { mountPoint: '#root', ...options }))
  return { P, seen, start, send: c => cmd$.shamefullySendNext(c), last: () => seen[seen.length - 1] }
}

describe('commands', () => {
  it('{ to } with params, query and hash; { url }; replace keeps the history length', async () => {
    const r = makeRouter({ routes })
    const p = probe(r)
    p.start()
    await waitFor(() => expect(p.last()?.name).toBe('home'))
    p.send({ to: 'note', params: { id: 'a b', noteId: 7 }, query: { tab: 'x', none: null }, hash: 'top' })
    await waitFor(() => expect(p.last()).toEqual({ name: 'note', params: { id: 'a b', noteId: '7' }, query: { tab: 'x' }, hash: 'top', path: '/tasks/a%20b/notes/7' }))
    expect(path()).toBe('/tasks/a%20b/notes/7?tab=x#top')
    const len = window.history.length
    p.send({ url: r.href('task', { id: 3 }), replace: true })
    await waitFor(() => expect(p.last().params).toEqual({ id: '3' }))
    expect(window.history.length).toBe(len)
  })

  it('{ back: true } and { forward: true } traverse; history.state carries { key, i }', async () => {
    const r = makeRouter({ routes })
    const p = probe(r)
    p.start()
    await waitFor(() => expect(p.last()?.name).toBe('home'))
    const first = window.history.state
    expect(first).toMatchObject({ i: 0 })
    expect(typeof first.key).toBe('string')
    p.send({ to: 'task', params: { id: 1 } })
    await waitFor(() => expect(p.last().path).toBe('/tasks/1'))
    expect(window.history.state.i).toBe(1)
    expect(window.history.state.key).not.toBe(first.key)
    p.send({ back: true })
    await waitFor(() => expect(p.last().path).toBe('/'))
    expect(window.history.state.key).toBe(first.key)
    p.send({ forward: true })
    await waitFor(() => expect(p.last().path).toBe('/tasks/1'))
  })

  it('SYG620: an unknown route, a missing param, the `route` key or an unknown command does not navigate', async () => {
    const r = makeRouter({ routes })
    const p = probe(r)
    p.start()
    await waitFor(() => expect(p.last()?.name).toBe('home'))
    p.send({ to: 'tasks', params: { id: 1 } })
    p.send({ to: 'task' })
    p.send({ to: 'notFound' })
    p.send({ route: 'task' })
    p.send({ go_to: 'task' })
    await sleep(30)
    expect(path()).toBe('/')
    const texts = errorSpy.mock.calls.map(c => c.join(' '))
    expect(texts.filter(t => t.includes('SYG620'))).toHaveLength(5)
    expect(texts.join('\n')).toMatch(/no route named 'tasks'/)
    expect(texts.join('\n')).toMatch(/needs params: id/)
    expect(texts.join('\n')).toMatch(/`route` is the declaration key/)
    expect(p.seen).toHaveLength(1)
  })

  it('{ prefetch } calls options.prefetch(route, url) and does not navigate (a no-op without it)', async () => {
    const prefetch = vi.fn()
    const p = probe(makeRouter({ routes, prefetch }))
    p.start()
    await waitFor(() => expect(p.last()?.name).toBe('home'))
    p.send({ prefetch: 'task', params: { id: 4 }, query: { a: 1 } })
    p.send({ prefetch: '/tasks/5' })
    await waitFor(() => expect(prefetch).toHaveBeenCalledTimes(2))
    expect(prefetch.mock.calls[0][0]).toMatchObject({ name: 'task', params: { id: '4' }, query: { a: '1' } })
    expect(prefetch.mock.calls[0][1]).toBe('/tasks/4?a=1')
    expect(prefetch.mock.calls[1][0]).toMatchObject({ name: 'task', params: { id: '5' } })
    expect(path()).toBe('/')
    app.dispose()
    const q = probe(makeRouter({ routes }))
    q.start()
    await waitFor(() => expect(q.last()?.name).toBe('home'))
    q.send({ prefetch: 'task', params: { id: 4 } })
    await sleep(20)
    expect(path()).toBe('/')
  })

  it('a route static that is a function of state declares only while it returns a name', async () => {
    const r = makeRouter({ routes })
    const seen = [], cmd$ = xs.create()
    const P = ({ state }) => h('p', null, String(state.on))
    P.route = s => s.on && 'ROUTE'
    P.initialState = { on: false }
    P.intent = () => ({ ON: cmd$.filter(c => c == 'on'), NAV: cmd$.filter(c => c != 'on') })
    P.model = { ROUTE: (s, r) => { seen.push(r.path); return s }, ON: s => ({ ...s, on: true }), NAV: { ROUTER: (_, c) => c } }
    app = run(P, { ROUTER: r.driver }, { mountPoint: '#root' })
    await sleep(30)
    expect(seen).toEqual([])
    cmd$.shamefullySendNext('on')
    await waitFor(() => expect(seen).toEqual(['/']))
  })
})

describe('redirect order with several declarers (G-168)', () => {
  // the root guards: an unknown task id redirects home; Crumb records every route it gets
  const TASKS = { 1: 'Alpha' }
  function build(r) {
    const crumbSeen = [], cmd$ = xs.create()
    function Crumb({ state }) { return h('span', { className: 'crumb' }, state.path || '') }
    Crumb.route = 'ROUTE'
    Crumb.model = { ROUTE: (s, rt) => { crumbSeen.push(rt.path); return { ...s, path: rt.path } } }
    function Page({ state }) { return h('div', null, h(Crumb, { state: 'crumb' }), h('p', { className: 'at' }, state.route?.path || '')) }
    Page.route = 'ROUTE'
    Page.initialState = { route: null, crumb: { path: '' } }
    Page.intent = () => ({ CMD: cmd$ })
    Page.model = {
      ROUTE: {
        STATE: (s, rt) => rt.name == 'task' && !TASKS[rt.params.id] ? ABORT : { ...s, route: rt },
        ROUTER: (s, rt) => rt.name == 'task' && !TASKS[rt.params.id] ? { to: 'home', replace: true } : ABORT,
      },
      CMD: { ROUTER: (_, c) => c },
    }
    return { Page, crumbSeen, send: c => cmd$.shamefullySendNext(c) }
  }

  it('the first declarer is the guard owner: the others never see a route it redirects away from', async () => {
    const r = makeRouter({ routes })
    const { Page, crumbSeen, send } = build(r)
    app = run(Page, { ROUTER: r.driver }, { mountPoint: '#root' })
    await waitFor(() => expect(text('.crumb')).toBe('/'))
    send({ to: 'task', params: { id: 99 } })
    await sleep(40)
    send({ to: 'task', params: { id: 1 } })
    await waitFor(() => expect(text('.crumb')).toBe('/tasks/1'))
    expect(crumbSeen).toEqual(['/', '/', '/tasks/1'])
    expect(crumbSeen).not.toContain('/tasks/99')
  })

  it('also for the initial URL', async () => {
    window.history.replaceState(null, '', '/tasks/99')
    const r = makeRouter({ routes })
    const { Page, crumbSeen } = build(r)
    app = run(Page, { ROUTER: r.driver }, { mountPoint: '#root' })
    await waitFor(() => expect(path()).toBe('/'))
    await waitFor(() => expect(text('.crumb')).toBe('/'))
    await sleep(30)
    expect(crumbSeen).toEqual(['/'])
  })
})

describe('block (unsaved-changes guard)', () => {
  const links = () => [h('a', { href: '/tasks/2', className: 'go' }, 'go')]

  it('a blocked link click goes to the block action with { to, route, proceed }; proceed navigates', async () => {
    const r = makeRouter({ routes })
    let state
    const p = probe(r, { body: s => (state = s, links()) })
    p.start()
    await waitFor(() => expect(p.last()?.name).toBe('home'))
    p.send({ block: 'LEAVE' })
    await sleep(10)
    const ev = clickOn(document.querySelector('.go'))
    expect(ev.defaultPrevented).toBe(true)
    await waitFor(() => expect(state.blocked).toHaveLength(1))
    expect(path()).toBe('/')
    const d = state.blocked[0]
    expect(d.to).toBe('/tasks/2')
    expect(d.route).toMatchObject({ name: 'task', params: { id: '2' } })
    expect(d.proceed).toEqual({ url: '/tasks/2', replace: undefined, force: true })
    p.send({ to: 'home', query: { x: 1 } })
    await waitFor(() => expect(state.blocked).toHaveLength(2))
    p.send(d.proceed)
    await waitFor(() => expect(p.last().path).toBe('/tasks/2'))
    p.send({ block: false })
    await sleep(10)
    p.send({ to: 'home' })
    await waitFor(() => expect(p.last().path).toBe('/'))
    expect(state.blocked).toHaveLength(2)
  })

  it('a blocked back is undone; its proceed ({ go, force }) makes it', async () => {
    const r = makeRouter({ routes })
    let state
    const p = probe(r, { body: s => (state = s, []) })
    p.start()
    await waitFor(() => expect(p.last()?.name).toBe('home'))
    p.send({ to: 'task', params: { id: 1 } })
    await waitFor(() => expect(p.last().path).toBe('/tasks/1'))
    p.send({ block: 'LEAVE' })
    await sleep(10)
    window.history.back()
    await waitFor(() => expect(state.blocked).toHaveLength(1))
    await waitFor(() => expect(path()).toBe('/tasks/1'))
    expect(state.blocked[0].proceed).toEqual({ go: -1, force: true })
    expect(state.blocked[0].route.path).toBe('/')
    await sleep(30)
    expect(p.last().path).toBe('/tasks/1')
    p.send(state.blocked[0].proceed)
    await waitFor(() => expect(p.last().path).toBe('/'))
    expect(path()).toBe('/')
  })

  it('beforeunload is prevented while a block is set, and the block goes with its component', async () => {
    const r = makeRouter({ routes })
    const p = probe(r)
    p.start()
    await waitFor(() => expect(p.last()?.name).toBe('home'))
    const unload = () => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented }
    expect(unload()).toBe(false)
    p.send({ block: 'LEAVE' })
    await sleep(10)
    expect(unload()).toBe(true)
    p.send({ block: null })
    await sleep(10)
    expect(unload()).toBe(false)
    p.send({ block: 'LEAVE' })
    await sleep(10)
    app.dispose()
    app = null
    expect(unload()).toBe(false)
  })
})

describe('link interception', () => {
  const start = () => {
    const r = makeRouter({ routes })
    const p = probe(r)
    p.start()
    return p
  }

  it('SVG <a> (href and xlink:href)', async () => {
    const p = start()
    await waitFor(() => expect(p.last()?.name).toBe('home'))
    document.body.insertAdjacentHTML('beforeend',
      '<svg><a href="/tasks/2"><text class="s1">x</text></a><a xlink:href="/tasks/3" xmlns:xlink="http://www.w3.org/1999/xlink"><text class="s2">y</text></a></svg>')
    expect(clickOn(document.querySelector('.s1')).defaultPrevented).toBe(true)
    await waitFor(() => expect(p.last().path).toBe('/tasks/2'))
    expect(clickOn(document.querySelector('.s2')).defaultPrevented).toBe(true)
    await waitFor(() => expect(p.last().path).toBe('/tasks/3'))
  })

  it('rel="external" is left alone', async () => {
    const p = start()
    await waitFor(() => expect(p.last()?.name).toBe('home'))
    document.body.insertAdjacentHTML('beforeend', '<a class="x" rel="noopener external" href="/tasks/2">x</a>')
    expect(clickOn(document.querySelector('.x')).defaultPrevented).toBe(false)
  })

  it('a link inside an open shadow root (composedPath)', async () => {
    const p = start()
    await waitFor(() => expect(p.last()?.name).toBe('home'))
    const host = document.createElement('div')
    document.body.appendChild(host)
    host.attachShadow({ mode: 'open' }).innerHTML = '<a href="/tasks/4"><span class="in">x</span></a>'
    expect(clickOn(host.shadowRoot.querySelector('.in')).defaultPrevented).toBe(true)
    await waitFor(() => expect(p.last().path).toBe('/tasks/4'))
  })

  it('relative hrefs resolve against <base>; trailing slashes match', async () => {
    const p = start()
    await waitFor(() => expect(p.last()?.name).toBe('home'))
    document.head.innerHTML = '<base href="/tasks/">'
    document.body.insertAdjacentHTML('beforeend', '<a class="rel" href="5">x</a><a class="slash" href="/tasks/6/">y</a>')
    clickOn(document.querySelector('.rel'))
    await waitFor(() => expect(p.last()).toMatchObject({ name: 'task', params: { id: '5' }, path: '/tasks/5' }))
    clickOn(document.querySelector('.slash'))
    await waitFor(() => expect(p.last()).toMatchObject({ name: 'task', params: { id: '6' }, path: '/tasks/6' }))
    expect(path()).toBe('/tasks/6/')
  })

  it('forms are left alone; a hash-only link to the current page is native', async () => {
    const p = start()
    await waitFor(() => expect(p.last()?.name).toBe('home'))
    document.body.insertAdjacentHTML('beforeend', '<form class="f" action="/tasks/2"><button class="b">go</button></form><a class="h" href="#sec">h</a>')
    const submit = new Event('submit', { bubbles: true, cancelable: true })
    document.querySelector('.f').dispatchEvent(submit)
    expect(submit.defaultPrevented).toBe(false)
    expect(clickOn(document.querySelector('.h')).defaultPrevented).toBe(false)
    await waitFor(() => expect(p.last().hash).toBe('sec'))
    expect(p.last().path).toBe('/')
  })

  it('outside `base` is left alone; inside it the path is relative to base', async () => {
    window.history.replaceState(null, '', '/app/tasks/1')
    const r = makeRouter({ routes, base: '/app/' })
    const p = probe(r)
    p.start()
    await waitFor(() => expect(p.last()).toMatchObject({ name: 'task', path: '/tasks/1' }))
    document.body.insertAdjacentHTML('beforeend', '<a class="out" href="/apple/tasks/2">o</a><a class="in" href="/app/tasks/2">i</a>')
    expect(clickOn(document.querySelector('.out')).defaultPrevented).toBe(false)
    expect(clickOn(document.querySelector('.in')).defaultPrevented).toBe(true)
    await waitFor(() => expect(p.last()).toMatchObject({ name: 'task', params: { id: '2' }, path: '/tasks/2' }))
    expect(r.href('home')).toBe('/app/')
  })

  it('stops intercepting when the app is disposed', async () => {
    const p = start()
    await waitFor(() => expect(p.last()?.name).toBe('home'))
    app.dispose()
    app = null
    document.body.insertAdjacentHTML('beforeend', '<a class="x" href="/tasks/2">x</a>')
    expect(clickOn(document.querySelector('.x')).defaultPrevented).toBe(false)
  })
})

describe('scroll and focus (G-169)', () => {
  const pages = s => s.route?.name == 'task'
    ? [h('h1', { className: 'h' }, 'Task ' + s.route.params.id), h('div', { id: 'c3' }, 'comments'), h('a', { href: '/', className: 'home' }, 'home')]
    : [h('h1', { className: 'h' }, 'Home'), h('a', { href: '/tasks/1', className: 't1' }, 'one'), h('a', { href: '/tasks/1#c3', className: 'c3' }, 'c3')]

  it('push scrolls to the top; back restores the saved position (after render); history uses manual restoration', async () => {
    const r = makeRouter({ routes, settleMs: 5 })
    const p = probe(r, { body: pages })
    p.start()
    await waitFor(() => expect(p.last()?.name).toBe('home'))
    expect(window.history.scrollRestoration).toBe('manual')
    window.scrollTo(0, 240)
    scrolls = []
    clickOn(document.querySelector('.t1'))
    expect(scrolls).toEqual([[0, 0]])
    await waitFor(() => expect(text('.h')).toBe('Task 1'))
    window.history.back()
    await waitFor(() => expect(scrolls).toContainEqual([0, 240]))
    expect(text('.h')).toBe('Home')
    window.dispatchEvent(new Event('pagehide'))
    expect(window.history.scrollRestoration).toBe('auto')
  })

  it('a push with a hash scrolls the target into view after render; scroll: false skips the top', async () => {
    const r = makeRouter({ routes, settleMs: 5 })
    const p = probe(r, { body: pages })
    p.start()
    await waitFor(() => expect(p.last()?.name).toBe('home'))
    clickOn(document.querySelector('.c3'))
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled())
    expect(Element.prototype.scrollIntoView.mock.contexts[0].id).toBe('c3')
    scrolls = []
    p.send({ to: 'task', params: { id: 2 }, scroll: false })
    await waitFor(() => expect(text('.h')).toBe('Task 2'))
    expect(scrolls).toEqual([])
  })

  it('focus moves to [data-router-focus] or h1 after a push and a back, not on start or replace', async () => {
    const r = makeRouter({ routes, settleMs: 5 })
    const p = probe(r, { body: s => s.route?.name == 'home' && s.route.query.f
      ? [h('div', { className: 'mark', 'data-router-focus': '' }, 'x'), h('h1', null, 'H')]
      : pages(s) })
    p.start()
    await waitFor(() => expect(p.last()?.name).toBe('home'))
    await sleep(30)
    expect(document.activeElement).toBe(document.body)
    clickOn(document.querySelector('.t1'))
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Task 1'))
    expect(document.activeElement.getAttribute('tabindex')).toBe('-1')
    document.activeElement.blur()
    p.send({ to: 'task', params: { id: 2 }, replace: true })
    await waitFor(() => expect(text('.h')).toBe('Task 2'))
    await sleep(40)
    expect(document.activeElement).toBe(document.body)
    p.send({ to: 'home', query: { f: 1 } })
    await waitFor(() => expect(document.activeElement?.className).toBe('mark'))
  })

  it('focus: false and scroll: false turn both off', async () => {
    const r = makeRouter({ routes, settleMs: 5, focus: false, scroll: false })
    const p = probe(r, { body: pages })
    p.start()
    await waitFor(() => expect(p.last()?.name).toBe('home'))
    expect(window.history.scrollRestoration).toBe('auto')
    window.scrollTo(0, 100)
    scrolls = []
    clickOn(document.querySelector('.t1'))
    await waitFor(() => expect(text('.h')).toBe('Task 1'))
    await sleep(40)
    expect(scrolls).toEqual([])
    expect(document.activeElement).toBe(document.body)
  })
})

describe('hash mode', () => {
  it('reads, links and navigates in the fragment', async () => {
    window.history.replaceState(null, '', '/index.html#/tasks/1?tab=a')
    const r = makeRouter({ routes, mode: 'hash' })
    expect(r.href('task', { id: 2 })).toBe('#/tasks/2')
    expect(makeRouter({ routes, mode: 'hash', base: '/app/' }).href('home')).toBe('/app/#/')
    expect(r.current()).toMatchObject({ name: 'task', params: { id: '1' }, query: { tab: 'a' }, path: '/tasks/1' })
    const p = probe(r, { body: () => [h('a', { href: r.href('task', { id: 2 }), className: 't2' }, 'two'), h('a', { href: '#plain', className: 'plain' }, 'p')] })
    p.start()
    await waitFor(() => expect(p.last()).toMatchObject({ name: 'task', params: { id: '1' } }))
    expect(clickOn(document.querySelector('.t2')).defaultPrevented).toBe(true)
    await waitFor(() => expect(p.last().params).toEqual({ id: '2' }))
    expect(path()).toBe('/index.html#/tasks/2')
    expect(clickOn(document.querySelector('.plain')).defaultPrevented).toBe(false)
    // a plain #fragment is native, and in hash mode it is a route ('/plain': notFound); jsdom
    // navigates to it a task later
    await waitFor(() => expect(p.last().name).toBe('notFound'))
    p.send({ to: 'home' })
    await waitFor(() => expect(p.last().name).toBe('home'))
    expect(window.location.hash).toBe('#/')
    window.location.hash = '#/tasks/7'
    await waitFor(() => expect(p.last().params).toEqual({ id: '7' }))
  })
})

/**
 * An in-memory window: location + history (popstate a task after go()), event listeners, a
 * document stub. The shape the 5-4c renderComponent fake needs to give the real driver.
 */
function memoryWindow(start = 'http://app.test/') {
  const entries = [{ url: start, state: null }], on = {}
  let i = 0
  const fire = (type, e = { type }) => (on[type] || []).slice().forEach(f => f(e))
  const at = () => new URL(entries[i].url)
  const w = {
    location: {
      get href() { return entries[i].url }, get pathname() { return at().pathname }, get search() { return at().search },
      get hash() { return at().hash }, get origin() { return at().origin },
    },
    history: {
      get state() { return entries[i].state }, get length() { return entries.length },
      pushState(state, _, url) { entries.splice(i + 1); entries.push({ url: new URL(url, entries[i].url).href, state }); i++ },
      replaceState(state, _, url) { entries[i] = { url: url ? new URL(url, entries[i].url).href : entries[i].url, state } },
      go(n) { const j = i + n; if (j >= 0 && j < entries.length) setTimeout(() => { i = j; fire('popstate') }) },
      back() { this.go(-1) }, forward() { this.go(1) },
    },
    addEventListener(t, f) { (on[t] ||= []).push(f) },
    removeEventListener(t, f) { on[t] = (on[t] || []).filter(x => x !== f) },
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null, getElementById: () => null, baseURI: start },
    scrollTo() {}, scrollX: 0, scrollY: 0,
    entries: () => entries.map(e => new URL(e.url).pathname), index: () => i, listeners: on,
  }
  return w
}

describe('injected window (the 5-4c fake seam)', () => {
  it('runs the real driver over an in-memory history: start, push, back, replace, dispose', async () => {
    const w = memoryWindow('http://app.test/tasks/1')
    const r = makeRouter({ routes, window: w })
    expect(r.current()).toMatchObject({ name: 'task', params: { id: '1' } })
    const p = probe(r)
    p.start()
    await waitFor(() => expect(p.last()).toMatchObject({ name: 'task', params: { id: '1' } }))
    expect(path()).toBe('/') // the real location is untouched
    p.send({ to: 'home' })
    await waitFor(() => expect(p.last().name).toBe('home'))
    expect(w.entries()).toEqual(['/tasks/1', '/'])
    p.send({ back: true })
    await waitFor(() => expect(p.last().path).toBe('/tasks/1'))
    p.send({ to: 'task', params: { id: 9 }, replace: true })
    await waitFor(() => expect(p.last().path).toBe('/tasks/9'))
    expect(w.entries()).toEqual(['/tasks/9', '/'])
    app.dispose()
    app = null
    expect(w.listeners.popstate).toEqual([])
  })
})

describe('Vike (navigate option)', () => {
  it('navigates with navigate(), leaves links to Vike, and re-reads the route on sygnal:navigate', async () => {
    const navigate = vi.fn((url) => {
      window.history.pushState(null, '', url)
      window.dispatchEvent(new Event('sygnal:navigate'))
    })
    const r = makeRouter({ routes, navigate })
    const p = probe(r, { body: () => [h('a', { href: '/tasks/3', className: 'l' }, 'l')] })
    p.start()
    await waitFor(() => expect(p.last()?.name).toBe('home'))
    expect(window.history.scrollRestoration).toBe('auto')
    p.send({ to: 'task', params: { id: 2 }, replace: true })
    await waitFor(() => expect(p.last().path).toBe('/tasks/2'))
    expect(navigate).toHaveBeenCalledWith('/tasks/2', { overwriteLastHistoryEntry: true })
    expect(clickOn(document.querySelector('.l')).defaultPrevented).toBe(false)
    window.history.pushState(null, '', '/tasks/8')
    window.dispatchEvent(new Event('sygnal:navigate'))
    await waitFor(() => expect(p.last().path).toBe('/tasks/8'))
  })
})

describe('dev checks (sygnal/diagnostics)', () => {
  beforeEach(() => setupChecks())

  it('SYG130/131 for href(); SYG131 for { to, params }; SYG620 is collected too', async () => {
    const r = makeRouter({ routes })
    r.href('tsk', { id: 1 })
    r.href('note', { id: 1 })
    r.href('task', { id: 1, x: 2 })
    r.href('task', { id: 1 })
    expect(diagnostics('SYG130').map(d => d.message)).toEqual([
      "href('tsk') names no route, so the link points to '/' (did you mean 'task'?)",
      "href('note') leaves out 'noteId' (/tasks/:id/notes/:noteId), so that segment is empty",
    ])
    expect(diagnostics('SYG131').map(d => d.data.extra)).toEqual([['x']])
    const p = probe(r, { options: { diagnostics: 'collect' } })
    app = run(p.P, { ROUTER: r.driver }, { mountPoint: '#root', diagnostics: 'collect' })
    await waitFor(() => expect(p.last()?.name).toBe('home'))
    p.send({ to: 'home', params: { page: 2 } })
    p.send({ to: 'nope' })
    await waitFor(() => expect(diagnostics('SYG131').map(d => d.data.extra)).toEqual([['x'], ['page']]))
    await waitFor(() => expect(diagnostics('SYG620')).toHaveLength(1))
    expect(diagnostics('SYG620')[0]).toMatchObject({ severity: 'error', component: 'Probe' })
  })

  it('SYG132: a root that declares a static without initialState (G-167)', async () => {
    const r = makeRouter({ routes })
    const Bare = () => h('p', null, 'x')
    Bare.route = 'ROUTE'
    Bare.model = { ROUTE: s => s }
    app = run(Bare, { ROUTER: r.driver }, { mountPoint: '#root', diagnostics: 'collect' })
    await sleep(20)
    expect(diagnostics('SYG132').map(d => d.data)).toEqual([{ static: 'route', source: 'ROUTER', reason: 'state' }])
    app.dispose()
    // a sub-component without a model never sends its static either
    const Leaf = () => h('i', null, 'leaf')
    Leaf.route = 'ROUTE'
    const Root = () => h('div', null, h(Leaf))
    Root.initialState = {}
    app = run(Root, { ROUTER: r.driver }, { mountPoint: '#root', diagnostics: 'collect' })
    await sleep(20)
    expect(diagnostics('SYG132').map(d => [d.component, d.data.reason])).toEqual([['Bare', 'state'], ['Leaf', 'model']])
    app.dispose()
    const p = probe(r)
    app = run(p.P, { ROUTER: r.driver }, { mountPoint: '#root', diagnostics: 'collect' })
    await waitFor(() => expect(p.last()?.name).toBe('home'))
    expect(diagnostics('SYG132')).toHaveLength(2)
  })

  it('the route static and { block } name reply actions: SYG102 counts them, SYG112 checks them', async () => {
    const r = makeRouter({ routes })
    const make = (route, guard) => {
      const G = ({ state }) => h('button', { className: 'g' }, state.route?.path || '-')
      Object.defineProperty(G, 'name', { value: 'Guarded' })
      G.route = route
      G.initialState = { route: null }
      G.intent = ({ DOM }) => ({ GUARD: DOM.click('.g') })
      G.model = { ROUTE: (s, rt) => ({ ...s, route: rt }), LEAVE: s => s, GUARD: { ROUTER: guard } }
      return G
    }
    // (literal names: SYG102 reads them from the sink function's source)
    app = run(make('ROUTE', () => ({ block: 'LEAVE' })), { ROUTER: r.driver }, { mountPoint: '#root', diagnostics: 'collect' })
    await waitFor(() => expect(document.querySelector('.g').textContent).toBe('/'))
    document.querySelector('.g').click()
    await sleep(20)
    expect(diagnostics('SYG102')).toEqual([])
    expect(diagnostics('SYG112')).toEqual([])
    app.dispose()
    app = run(make('ROUTES', () => ({ block: 'LEAV' })), { ROUTER: r.driver }, { mountPoint: '#root', diagnostics: 'collect' })
    await sleep(20)
    document.querySelector('.g').click()
    await waitFor(() => expect(diagnostics('SYG112').map(d => [d.data.action, d.data.key, d.data.suggestion])).toEqual([
      ['ROUTES', 'route', 'ROUTE'], ['LEAV', 'block', 'LEAVE'],
    ]))
  })

  it('SYG133: the SPA router inside a Vike app', async () => {
    document.body.insertAdjacentHTML('beforeend', '<script id="vike_pageContext" type="application/json">{}</script>')
    const p = probe(makeRouter({ routes }))
    app = run(p.P, { ROUTER: makeRouter({ routes }).driver }, { mountPoint: '#root', diagnostics: 'collect' })
    await sleep(20)
    expect(diagnostics('SYG133')).toHaveLength(1)
    app.dispose()
    const q = probe(makeRouter({ routes, navigate: () => {} }))
    setupChecks()
    q.start()
    await sleep(20)
    expect(diagnostics('SYG133')).toHaveLength(0)
  })
})
