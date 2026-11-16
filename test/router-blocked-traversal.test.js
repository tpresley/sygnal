// @vitest-environment jsdom
// A blocked back/forward whose proceed the blocker sends at once (found by the wizard spike): the
// router replied before undoing the traversal, so the proceed and the undo were two history.go()
// calls in one task and Chromium dropped one (the fake history drops it too); a forced go() the
// browser dropped left the next traversal unguarded.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { makeRouter, run, xs } from '../src/index.js'

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null })
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms))

describe('router: a blocked back/forward whose proceed is sent at once', () => {
  const router = makeRouter({ routes: { a: '/a', b: '/b', notFound: '*' } })
  function App({ state }) { return h('p', null, state.route.name) }
  App.route = 'ROUTE'
  App.initialState = { route: router.current('/a') }
  App.intent = ({ DOM }) => ({ ARM: DOM.click('p') })
  App.model = {
    ROUTE: (s, route) => ({ ...s, route }),
    ARM: { ROUTER: () => ({ block: 'ASK' }) },
    ASK: { ROUTER: (_s, attempt) => (asks++, { ...attempt.proceed, block: 'ASK' }) },
  }
  let asks = 0

  it('lands where the traversal was going', async () => {
    t = renderComponent(App, { dom: 'real', router, url: '/a' })
    await t.ready()
    await t.navigate('/b'); await tick()
    t.query('p').click(); await tick()
    await t.back(); await tick(40)
    expect(t.location.path).toBe('/a')
    expect(t.state.route.name).toBe('a')
    // the next traversal is still guarded (nothing forced is left over): ASK again, then made
    asks = 0
    await t.forward(); await tick(40)
    expect(asks).toBe(1)
    expect(t.location.path).toBe('/b')
  })
})


// Tune's wizard trial (a hidden, throttled tab): after a held Forward and "Keep editing", a second
// Forward was not held. The router took the next popstate after a blocked traversal for its own
// undo, whatever entry it landed on.
describe('router: a traversal that arrives while a blocked one\'s undo is still owed', () => {
  function memoryWindow(start) {
    const entries = [{ url: start, state: null }], on = {}
    let i = 0
    const fire = (type) => (on[type] || []).slice().forEach(f => f({ type }))
    const at = () => new URL(entries[i].url)
    const w = {
      location: { get href() { return entries[i].url }, get pathname() { return at().pathname }, get search() { return at().search }, get hash() { return at().hash }, get origin() { return at().origin } },
      history: {
        get state() { return entries[i].state }, get length() { return entries.length },
        pushState(state, _, url) { entries.splice(i + 1); entries.push({ url: new URL(url, entries[i].url).href, state }); i++ },
        replaceState(state, _, url) { entries[i] = { url: url ? new URL(url, entries[i].url).href : entries[i].url, state } },
        // `silent`: the entry moves but its popstate never comes
        go(n) { const j = i + n, quiet = w.silent; w.silent = false; if (j >= 0 && j < entries.length) setTimeout(() => { i = j; if (!quiet) fire('popstate') }) },
      },
      addEventListener(t, f) { (on[t] ||= []).push(f) },
      removeEventListener(t, f) { on[t] = (on[t] || []).filter(x => x !== f) },
      document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null, getElementById: () => null, baseURI: start },
      scrollTo() {}, scrollX: 0, scrollY: 0, silent: false,
      // the browser's own button
      user(n) { i += n; fire('popstate') },
    }
    return w
  }

  it('is asked too, and undone', async () => {
    const w = memoryWindow('http://app.test/a')
    const router = makeRouter({ routes: { a: '/a', b: '/b', notFound: '*' }, window: w })
    const cmd$ = xs.create()
    let asks = 0
    function App({ state }) { return h('p', null, state.route.name) }
    App.route = 'ROUTE'
    App.initialState = { route: router.current() }
    App.intent = () => ({ CMD: cmd$ })
    App.model = { ROUTE: (s, route) => ({ ...s, route }), CMD: { ROUTER: (_s, c) => c }, ASK: (s) => (asks++, s) }
    document.body.innerHTML = '<div id="root"></div>'
    const app = run(App, { ROUTER: router.driver }, { mountPoint: '#root' })
    try {
      await tick()
      cmd$.shamefullySendNext({ to: 'b' }); await tick()
      w.user(-1); await tick()
      expect(w.location.pathname).toBe('/a')
      cmd$.shamefullySendNext({ block: 'ASK' }); await tick()
      w.silent = true                       // the undo lands, its popstate doesn't
      w.user(1); await tick(40)
      expect(asks).toBe(1)
      expect(w.location.pathname).toBe('/a')
      w.user(1); await tick(40)             // Forward again: held again, not taken for the undo
      expect(asks).toBe(2)
      expect(w.location.pathname).toBe('/a')
      w.user(1); await tick(40)             // and with the undo's popstate delivered, as before
      expect(asks).toBe(3)
      expect(w.location.pathname).toBe('/a')
    } finally { app.dispose() }
  })
})
