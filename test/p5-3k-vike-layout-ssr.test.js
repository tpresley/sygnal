// @vitest-environment jsdom
// PLAN-5 3-K G-464: a Vike Layout written as the docs show (`<main>{children}</main>`) renders the
// Page inside the Layout on the server. onRenderHtml passed only an `innerHTML` placeholder, so a
// Layout that renders `children` got none and the Page HTML was appended after the Layout.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement as h } from '../dist/index.esm.js'

let onRenderClient, onRenderHtml
beforeEach(async () => {
  vi.resetModules()
  ;({ onRenderClient } = await import('../dist/vike/onRenderClient.mjs'))
  ;({ onRenderHtml } = await import('../dist/vike/onRenderHtml.mjs'))
  delete window.__VIKE_SYGNAL_STATE__
})
afterEach(() => { document.body.innerHTML = '' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const shellOf = (html) => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.querySelector('#vike-shell')
}

function Layout({ children }) {
  return h('div', { className: 'layout' },
    h('nav', null, h('a', { href: '/' }, 'Home')),
    h('main', null, ...children),
    h('footer', null, 'f'))
}
Layout.initialState = {}
function Page({ state }) { return h('p', { className: 'page' }, 'page:' + state.title) }
Page.initialState = { title: 'x' }

describe('G-464: Vike Layout with children on the server', () => {
  it('the Page renders inside the Layout\'s <main>', () => {
    const html = onRenderHtml({ Page, data: { title: 'Home' }, config: { Layout } }).documentHtml._escaped
    const shell = shellOf(html)
    expect(shell.querySelector('.layout > main > .page')?.textContent).toBe('page:Home')
    expect(shell.children.length).toBe(1)
    expect(shell.querySelector('.layout > footer')).not.toBeNull()
    expect(html).not.toContain('sygnal-page-slot')
  })

  it('Wrapper + two Layouts with children nest in order', () => {
    function Wrapper({ children }) { return h('section', { className: 'wrapper' }, ...children) }
    Wrapper.initialState = {}
    function Outer({ children }) { return h('div', { className: 'outer' }, h('header', null, 'h'), ...children) }
    Outer.initialState = {}
    const html = onRenderHtml({ Page, data: { title: 'A' }, config: { Wrapper, Layout: [Outer, Layout] } }).documentHtml._escaped
    expect(shellOf(html).querySelector('.wrapper > .outer > .layout > main > .page')?.textContent).toBe('page:A')
  })

  it('a Layout using the innerHTML prop still works; one ignoring both gets the Page after it', () => {
    function Inner({ innerHTML }) { return h('div', { className: 'inner', props: { innerHTML } }) }
    Inner.initialState = {}
    const html = onRenderHtml({ Page, data: { title: 'B' }, config: { Layout: Inner } }).documentHtml._escaped
    expect(shellOf(html).querySelector('.inner > .page')?.textContent).toBe('page:B')
    function Bare() { return h('div', { className: 'bare' }) }
    Bare.initialState = {}
    const html2 = onRenderHtml({ Page, data: { title: 'C' }, config: { Layout: Bare } }).documentHtml._escaped
    const shell = shellOf(html2)
    expect(shell.querySelector('.bare').nextElementSibling?.className).toBe('page')
  })

  it('hydrates onto the same structure', async () => {
    const html = onRenderHtml({ Page, data: { title: 'H' }, config: { Layout } }).documentHtml._escaped
    const m = html.match(/window\.__VIKE_SYGNAL_STATE__=(.*?)<\/script>/)
    window.__VIKE_SYGNAL_STATE__ = JSON.parse(m[1])
    document.body.innerHTML = `<div id="page-view">${shellOf(html).outerHTML}</div>`
    onRenderClient({ Page, data: { title: 'H' }, config: { Layout }, isHydration: true })
    await sleep(80)
    expect(document.querySelector('.layout > main > .page')?.textContent).toBe('page:H')
    expect(document.querySelectorAll('.page').length).toBe(1)
  })
})
