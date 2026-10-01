// @vitest-environment jsdom
// G-106: in a Vike app with both a Wrapper and a Layout, the page's +data must survive client
// navigation. Each shell component's state key is relative to its parent component (the
// Layout reads wrapper_0.layout_0), so the shell state is nested:
//   { wrapper_0: { ...wrapper, layout_0: { ...layout, page } } }
// in the serialized SSR state, on hydration, and in the navigation write.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement as h } from '../dist/index.esm.js'

const settle = (ms = 60) => new Promise(r => setTimeout(r, ms))
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
  it('onRenderHtml serializes the shell state nested by component', () => {
    const { Wrapper, Layout, Home } = makeShell()
    const html = onRenderHtml({ Page: Home, data: { title: 'Home data' }, config: { Wrapper, Layout } }).documentHtml._escaped
    expect(serializedState(html)).toEqual({
      wrapper_0: { w: 1, layout_0: { n: 0, page: { title: 'Home data' } } },
    })
    expect(html).toContain('<p class="page">home:Home data</p>')
  })

  it('onRenderHtml keeps the single-Layout shape ({ layout_0: { ..., page } })', () => {
    const { Layout, Home } = makeShell()
    const html = onRenderHtml({ Page: Home, data: { title: 'Home data' }, config: { Layout } }).documentHtml._escaped
    expect(serializedState(html)).toEqual({ layout_0: { n: 0, page: { title: 'Home data' } } })
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

  it('two Layouts: the inner Layout state is nested in the outer one', async () => {
    const { Layout, Home, About } = makeShell()
    function Outer({ children }) { return h('div', { className: 'outer' }, ...children) }
    Outer.initialState = { o: 1 }
    const html = onRenderHtml({ Page: Home, data: { title: 'Home data' }, config: { Layout: [Outer, Layout] } }).documentHtml._escaped
    expect(serializedState(html)).toEqual({ layout_0: { o: 1, layout_1: { n: 0, page: { title: 'Home data' } } } })
    window.__VIKE_SYGNAL_STATE__ = serializedState(html)
    onRenderClient({ Page: Home, data: { title: 'Home data' }, config: { Layout: [Outer, Layout] }, isHydration: true })
    await settle()
    expect(text('.page')).toBe('home:Home data')
    onRenderClient({ Page: About, data: { title: 'About data' }, config: { Layout: [Outer, Layout] } })
    await settle()
    expect(text('.page')).toBe('about:About data')
  })
})
