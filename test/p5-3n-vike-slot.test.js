// @vitest-environment jsdom
// PLAN-5 3-N G-491: a Vike Wrapper / Layout whose root element is its `children` (or a fragment
// whose first element is) renders the page in place on the server: the slot element there carries
// the SSR root stamp (`data-sygnal-ssr`), which the exact-string search missed, so the slot leaked
// and the Page was appended after it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createElement as h } from '../dist/index.esm.js'
import { Fragment } from '../dist/jsx-runtime.esm.js'

let onRenderHtml, onRenderClient
beforeEach(async () => {
  ;({ onRenderHtml } = await import('../dist/vike/onRenderHtml.mjs'))
  ;({ onRenderClient } = await import('../dist/vike/onRenderClient.mjs'))
  delete window.__VIKE_SYGNAL_STATE__
})
afterEach(() => { document.body.innerHTML = '' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// the server's HTML in #page-view, hydrated: the Page's element is the server's
const hydrate = async (config, title) => {
  const html = onRenderHtml({ Page, data: { title }, config }).documentHtml._escaped
  window.__VIKE_SYGNAL_STATE__ = JSON.parse(html.match(/window\.__VIKE_SYGNAL_STATE__=(.*?)<\/script>/)[1])
  document.body.innerHTML = `<div id="page-view">${shellOf(html).outerHTML}</div>`
  const before = document.querySelector('.page')
  onRenderClient({ Page, data: { title }, config, isHydration: true })
  await sleep(80)
  expect(document.querySelectorAll('.page').length).toBe(1)
  expect(document.querySelector('.page')).toBe(before)
}

const shellOf = (html) => new DOMParser().parseFromString(html, 'text/html').querySelector('#vike-shell')
function Page({ state }) { return h('p', { className: 'page' }, 'page:' + state.title) }
Page.initialState = { title: 'x' }

describe('G-491: a shell whose root is its children', () => {
  it('a Wrapper returning children[0]', async () => {
    function Wrapper({ children }) { return children[0] }
    Wrapper.initialState = {}
    const html = onRenderHtml({ Page, data: { title: 'W' }, config: { Wrapper } }).documentHtml._escaped
    expect(html).not.toContain('sygnal-page-slot')
    const shell = shellOf(html)
    expect(shell.children.length).toBe(1)
    expect(shell.querySelector(':scope > .page')?.textContent).toBe('page:W')
    await hydrate({ Wrapper }, 'W')
  })

  it('a fragment Layout <>{children}<footer/></>', async () => {
    function Layout({ children }) { return h(Fragment, null, ...children, h('footer', { className: 'foot' }, 'f')) }
    Layout.initialState = {}
    const html = onRenderHtml({ Page, data: { title: 'L' }, config: { Layout } }).documentHtml._escaped
    expect(html).not.toContain('sygnal-page-slot')
    const shell = shellOf(html)
    expect(shell.querySelectorAll('.page').length).toBe(1)
    expect(shell.querySelector('.page').nextElementSibling?.className).toBe('foot')
    await hydrate({ Layout }, 'L')
  })
})
