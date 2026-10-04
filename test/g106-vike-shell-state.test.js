// @vitest-environment jsdom
// G-106: in a Vike app with both a Wrapper and a Layout, the page's +data must survive client
// navigation. D50 (2-R): the shell slices are siblings at the root,
//   { wrapper_0: { ...wrapper }, layout_0: { ...layout }, page }
// in the serialized SSR state, on hydration, and in the navigation write; each shell component
// (and the Page) reads its own root slice through a { get, set } lens, however deeply it is
// nested, so an outer component's reducer can't wipe the inner slices (R2-2).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement as h } from '../dist/index.esm.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))
// Wait the original 60 ms, then until the DOM has stopped changing (stable for 30 ms,
// at most 1 s): the fixed 60 ms alone was too short under a loaded full-suite run (G-126).
const settle = async () => {
  let last = document.body.innerHTML, stableSince = Date.now()
  const end = Date.now() + 1000
  await sleep(60)
  last = document.body.innerHTML; stableSince = Date.now()
  while (Date.now() < end) {
    const now = document.body.innerHTML
    if (now !== last) { last = now; stableSince = Date.now() }
    else if (Date.now() - stableSince >= 30) return
    await sleep(10)
  }
}
const text = (sel) => document.querySelector(sel)?.textContent

function makeShell() {
  function Wrapper({ state, children }) {
    return h('section', { className: 'wrapper' }, h('i', { className: 'w' }, 'w' + state.w), ...children)
  }
  Wrapper.initialState = { w: 1 }

  function Layout({ state, children }) {
    return h('main', { className: 'layout' },
      h('button', { className: 'bump' }, 'L' + state.n),
      ...children)
  }
  Layout.initialState = { n: 0 }
  Layout.intent = ({ DOM }) => ({ BUMP: DOM.click('.bump') })
  Layout.model = { BUMP: s => ({ ...s, n: s.n + 1 }) }

  function Home({ state }) { return h('p', { className: 'page' }, 'home:' + state.title) }
  Home.initialState = { title: 'none' }
  function About({ state }) { return h('p', { className: 'page' }, 'about:' + state.title) }
  About.initialState = { title: 'none' }
  return { Wrapper, Layout, Home, About }
}

let onRenderClient, onRenderHtml
beforeEach(async () => {
  vi.resetModules()
  ;({ onRenderClient } = await import('../dist/vike/onRenderClient.mjs'))
  ;({ onRenderHtml } = await import('../dist/vike/onRenderHtml.mjs'))
  document.body.innerHTML = '<div id="page-view"></div>'
  delete window.__VIKE_SYGNAL_STATE__
})
afterEach(() => { document.body.innerHTML = '' })

function serializedState(html) {
  const m = html.match(/window\.__VIKE_SYGNAL_STATE__=(.*?)<\/script>/)
  return m && JSON.parse(m[1])
}

describe('G-106: Vike shell state with a Wrapper and a Layout', () => {
  it('onRenderHtml serializes the shell slices as siblings at the root', () => {
    const { Wrapper, Layout, Home } = makeShell()
    const html = onRenderHtml({ Page: Home, data: { title: 'Home data' }, config: { Wrapper, Layout } }).documentHtml._escaped
    expect(serializedState(html)).toEqual({
      wrapper_0: { w: 1 }, layout_0: { n: 0 }, page: { title: 'Home data' },
    })
    expect(html).toContain('<p class="page" data-sygnal-ssr="">home:Home data</p>')
  })

  it('onRenderHtml with a single Layout: { layout_0, page }', () => {
    const { Layout, Home } = makeShell()
    const html = onRenderHtml({ Page: Home, data: { title: 'Home data' }, config: { Layout } }).documentHtml._escaped
    expect(serializedState(html)).toEqual({ layout_0: { n: 0 }, page: { title: 'Home data' } })
  })

  it('hydrates, then keeps +data and the Layout state across client navigation', async () => {
    const { Wrapper, Layout, Home, About } = makeShell()
    const html = onRenderHtml({ Page: Home, data: { title: 'Home data' }, config: { Wrapper, Layout } }).documentHtml._escaped
    window.__VIKE_SYGNAL_STATE__ = serializedState(html)

    onRenderClient({ Page: Home, data: { title: 'Home data' }, config: { Wrapper, Layout }, isHydration: true })
    await settle()
    expect(text('.page')).toBe('home:Home data')
    expect(text('.w')).toBe('w1')

    document.querySelector('.bump').click()
    await settle()
    expect(text('.bump')).toBe('L1')

    onRenderClient({ Page: About, data: { title: 'About data' }, config: { Wrapper, Layout } })
    await settle()
    expect(text('.page')).toBe('about:About data')
    expect(text('.bump')).toBe('L1')
    expect(text('.w')).toBe('w1')

    onRenderClient({ Page: Home, data: { title: 'Home again' }, config: { Wrapper, Layout } })
    await settle()
    expect(text('.page')).toBe('home:Home again')
    expect(text('.bump')).toBe('L1')
  })

  it('without SSR state (SPA first load), navigation keeps +data too', async () => {
    const { Wrapper, Layout, Home, About } = makeShell()
    onRenderClient({ Page: Home, data: { title: 'Home data' }, config: { Wrapper, Layout } })
    await settle()
    expect(text('.page')).toBe('home:Home data')
    onRenderClient({ Page: About, data: { title: 'About data' }, config: { Wrapper, Layout } })
    await settle()
    expect(text('.page')).toBe('about:About data')
  })

  it('two Layouts: sibling slices; hydration and navigation keep +data', async () => {
    const { Layout, Home, About } = makeShell()
    function Outer({ children }) { return h('div', { className: 'outer' }, ...children) }
    Outer.initialState = { o: 1 }
    const html = onRenderHtml({ Page: Home, data: { title: 'Home data' }, config: { Layout: [Outer, Layout] } }).documentHtml._escaped
    expect(serializedState(html)).toEqual({ layout_0: { o: 1 }, layout_1: { n: 0 }, page: { title: 'Home data' } })
    window.__VIKE_SYGNAL_STATE__ = serializedState(html)
    onRenderClient({ Page: Home, data: { title: 'Home data' }, config: { Layout: [Outer, Layout] }, isHydration: true })
    await settle()
    expect(text('.page')).toBe('home:Home data')
    onRenderClient({ Page: About, data: { title: 'About data' }, config: { Layout: [Outer, Layout] } })
    await settle()
    expect(text('.page')).toBe('about:About data')
  })

  it('R2-2: a Wrapper reducer that replaces its state keeps the Layout state and the page data', async () => {
    const { Wrapper, Layout, Home, About } = makeShell()
    Wrapper.intent = ({ DOM }) => ({ RESET: DOM.click('.w') })
    Wrapper.model = { RESET: () => ({ w: 0 }) }
    onRenderClient({ Page: Home, data: { title: 'Home data' }, config: { Wrapper, Layout } })
    await settle()
    document.querySelector('.bump').click()
    await settle()
    expect(text('.bump')).toBe('L1')
    document.querySelector('.w').click()
    await settle()
    expect(text('.w')).toBe('w0')
    expect(text('.bump')).toBe('L1')
    expect(text('.page')).toBe('home:Home data')
    onRenderClient({ Page: About, data: { title: 'About data' }, config: { Wrapper, Layout } })
    await settle()
    expect(text('.w')).toBe('w0')
    expect(text('.bump')).toBe('L1')
    expect(text('.page')).toBe('about:About data')
  })

  it("R2-2: an outer Layout's replacing reducer keeps the inner Layout and the page", async () => {
    const { Layout, Home } = makeShell()
    function Outer({ state, children }) { return h('div', { className: 'outer' }, h('i', { className: 'o' }, 'o' + state.o), ...children) }
    Outer.initialState = { o: 1 }
    Outer.intent = ({ DOM }) => ({ RESET: DOM.click('.o') })
    Outer.model = { RESET: () => ({ o: 0 }) }
    onRenderClient({ Page: Home, data: { title: 'Home data' }, config: { Layout: [Outer, Layout] } })
    await settle()
    document.querySelector('.bump').click()
    await settle()
    document.querySelector('.o').click()
    await settle()
    expect(text('.o')).toBe('o0')
    expect(text('.bump')).toBe('L1')
    expect(text('.page')).toBe('home:Home data')
  })

  it("R2-2: shell views and the page see only their own state (no foreign layout_0/page keys)", async () => {
    const seen = {}
    const { Wrapper, Layout, Home } = makeShell()
    const keysOf = (name, state) => { seen[name] = Object.keys(state || {}).sort() }
    function W(props) { keysOf('wrapper', props.state); return Wrapper(props) }
    W.initialState = Wrapper.initialState
    function L(props) { keysOf('layout', props.state); return Layout(props) }
    Object.assign(L, { initialState: Layout.initialState, intent: Layout.intent, model: Layout.model })
    function P(props) { keysOf('page', props.state); return Home(props) }
    P.initialState = Home.initialState
    onRenderClient({ Page: P, data: { title: 'Home data' }, config: { Wrapper: W, Layout: L } })
    await settle()
    document.querySelector('.bump').click()
    await settle()
    expect(text('.bump')).toBe('L1')
    expect(seen).toEqual({ wrapper: ['w'], layout: ['n'], page: ['title'] })
  })

  it('R2-2: a Layout reducer updates only its slice; the Wrapper slice is untouched', async () => {
    const { Wrapper, Layout, Home } = makeShell()
    onRenderClient({ Page: Home, data: { title: 'Home data' }, config: { Wrapper, Layout } })
    await settle()
    document.querySelector('.bump').click()
    await settle()
    document.querySelector('.bump').click()
    await settle()
    expect(text('.bump')).toBe('L2')
    expect(text('.w')).toBe('w1')
    expect(text('.page')).toBe('home:Home data')
  })

  it('R2-9: hydrates serialized state in the 5.4.0 shape (page under the innermost slice)', async () => {
    const { Wrapper, Layout, Home, About } = makeShell()
    window.__VIKE_SYGNAL_STATE__ = { wrapper_0: { w: 7 }, layout_0: { n: 3, page: { title: 'Old SSR' } } }
    onRenderClient({ Page: Home, data: { title: 'Home data' }, config: { Wrapper, Layout }, isHydration: true })
    await settle()
    expect(text('.w')).toBe('w7')
    expect(text('.bump')).toBe('L3')
    expect(text('.page')).toBe('home:Old SSR')
    onRenderClient({ Page: About, data: { title: 'About data' }, config: { Wrapper, Layout } })
    await settle()
    expect(text('.bump')).toBe('L3')
    expect(text('.page')).toBe('about:About data')
  })
})
