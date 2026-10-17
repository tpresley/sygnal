// @vitest-environment jsdom
// G-803: Vike's cumulative configs (Layout, Wrapper) list the value closest to the page first
// (vike 0.4.268 resolveVikeConfigInternal: sortAfterInheritanceOrder puts the longer inheritance
// root first), so pages/admin/+Page gets config.Layout = [AdminLayout, RootLayout]. sygnal/vike
// nested index 0 outermost, putting the admin chrome outside the root chrome, and kept the first
// page's shell on client navigation, so a nested Layout never came (or went) with the page.
// Now: every Wrapper outside every Layout, the root's outermost within each, on the server and
// the client; navigation keeps the shell components two pages share mounted (from the outside in)
// and adds or removes the rest.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement as h } from '../dist/index.esm.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))
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
const serializedState = (html) => JSON.parse(html.match(/window\.__VIKE_SYGNAL_STATE__=(.*?)<\/script>/)[1])
const pageView = (html) => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.querySelector('#page-view').innerHTML
}
/** the shell classes from the outside in to the page: 'root > admin > page' */
const chain = (root = document) => {
  const out = []
  for (let e = root.querySelector('.page'); e && e.id !== 'vike-shell'; e = e.parentElement) {
    if (e.dataset?.part) out.push(e.dataset.part)
  }
  return out.reverse().join(' > ')
}

function part(name, initialState) {
  const C = function ({ state, children }) {
    return h('div', { 'data-part': name, className: name },
      h('button', { className: 'b-' + name }, name + ':' + state.n),
      ...children)
  }
  Object.defineProperty(C, 'name', { value: name[0].toUpperCase() + name.slice(1) })
  C.initialState = initialState || { n: 0 }
  C.intent = ({ DOM }) => ({ BUMP: DOM.click('.b-' + name) })
  C.model = { BUMP: s => ({ ...s, n: s.n + 1 }) }
  return C
}
function page(name) {
  const P = function ({ state }) { return h('p', { className: 'page', 'data-part': 'page' }, name + ':' + state.title) }
  P.initialState = { title: 'none' }
  return P
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

/** a page's config as Vike gives it: closest first */
const cfg = (layouts, wrappers) => ({ Layout: layouts, ...(wrappers && { Wrapper: wrappers }) })

describe('G-803: nested Vike Layouts and Wrappers, on the server', () => {
  it('two Layouts: the root one outside the nested one; slices keyed from the outside in', () => {
    const Root = part('root'), Admin = part('admin', { n: 5 }), P = page('admin')
    const html = onRenderHtml({ Page: P, data: { title: 'A' }, config: cfg([Admin, Root]) }).documentHtml._escaped
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(chain(doc)).toBe('root > admin > page')
    expect(serializedState(html)).toEqual({ layout_0: { n: 0 }, layout_1: { n: 5 }, page: { title: 'A' } })
  })

  it('Wrappers and Layouts: every Wrapper outside every Layout, the root\'s outermost in each', () => {
    const RootW = part('rootw'), AdminW = part('adminw'), Root = part('root'), Admin = part('admin'), P = page('p')
    const html = onRenderHtml({ Page: P, data: { title: 'A' }, config: cfg([Admin, Root], [AdminW, RootW]) }).documentHtml._escaped
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(chain(doc)).toBe('rootw > adminw > root > admin > page')
    expect(Object.keys(serializedState(html))).toEqual(['wrapper_0', 'wrapper_1', 'layout_0', 'layout_1', 'page'])
  })

  it('the client hydrates the same nesting and the same HTML', async () => {
    const Root = part('root'), Admin = part('admin'), P = page('admin')
    const config = cfg([Admin, Root])
    const html = onRenderHtml({ Page: P, data: { title: 'A' }, config }).documentHtml._escaped
    const ssr = pageView(html).replace(/<script>.*<\/script>/, '')
    document.body.innerHTML = `<div id="page-view">${ssr}</div>`
    window.__VIKE_SYGNAL_STATE__ = serializedState(html)
    onRenderClient({ Page: P, data: { title: 'A' }, config, isHydration: true })
    await settle()
    expect(chain()).toBe('root > admin > page')
    expect(text('.page')).toBe('admin:A')
    document.querySelector('.b-admin').click()
    document.querySelector('.b-root').click()
    await settle()
    expect(text('.b-root')).toBe('root:1')
    expect(text('.b-admin')).toBe('admin:1')
  })
})

describe('G-803: client navigation between pages with different shells', () => {
  it('root page -> nested page -> root page: the root Layout stays mounted, the nested one comes and goes', async () => {
    const Root = part('root'), Admin = part('admin'), Home = page('home'), AdminPage = page('admin')
    onRenderClient({ Page: Home, data: { title: 'H' }, config: cfg([Root]) })
    await settle()
    expect(chain()).toBe('root > page')
    document.querySelector('.b-root').click()
    await settle()
    const rootEl = document.querySelector('.root')

    onRenderClient({ Page: AdminPage, data: { title: 'A' }, config: cfg([Admin, Root]) })
    await settle()
    expect(chain()).toBe('root > admin > page')
    expect(text('.page')).toBe('admin:A')
    expect(document.querySelector('.root')).toBe(rootEl)
    expect(text('.b-root')).toBe('root:1')
    document.querySelector('.b-admin').click()
    await settle()
    expect(text('.b-admin')).toBe('admin:1')

    onRenderClient({ Page: Home, data: { title: 'H2' }, config: cfg([Root]) })
    await settle()
    expect(chain()).toBe('root > page')
    expect(document.querySelector('.admin')).toBeNull()
    expect(document.querySelector('.root')).toBe(rootEl)
    expect(text('.b-root')).toBe('root:1')
    expect(text('.page')).toBe('home:H2')

    // a nested Layout navigated to again starts from its initialState
    onRenderClient({ Page: AdminPage, data: { title: 'A2' }, config: cfg([Admin, Root]) })
    await settle()
    expect(chain()).toBe('root > admin > page')
    expect(text('.b-admin')).toBe('admin:0')
    expect(text('.b-root')).toBe('root:1')
  })

  it('two nested pages under the same root Layout: the sibling Layouts replace each other', async () => {
    const Root = part('root'), Admin = part('admin'), Blog = part('blog'), A = page('a'), B = page('b')
    onRenderClient({ Page: A, data: { title: 'A' }, config: cfg([Admin, Root]) })
    await settle()
    document.querySelector('.b-root').click()
    document.querySelector('.b-admin').click()
    await settle()
    const rootEl = document.querySelector('.root')
    onRenderClient({ Page: B, data: { title: 'B' }, config: cfg([Blog, Root]) })
    await settle()
    expect(chain()).toBe('root > blog > page')
    expect(document.querySelector('.admin')).toBeNull()
    expect(document.querySelector('.root')).toBe(rootEl)
    expect(text('.b-root')).toBe('root:1')
    expect(text('.b-blog')).toBe('blog:0')
    expect(text('.page')).toBe('b:B')
  })

  it('a nested Wrapper goes outside the root Layout; the root Wrapper stays mounted', async () => {
    const RootW = part('rootw'), AdminW = part('adminw'), Root = part('root'), Home = page('home'), AdminPage = page('admin')
    onRenderClient({ Page: Home, data: { title: 'H' }, config: cfg([Root], [RootW]) })
    await settle()
    document.querySelector('.b-rootw').click()
    await settle()
    const wEl = document.querySelector('.rootw')
    onRenderClient({ Page: AdminPage, data: { title: 'A' }, config: cfg([Root], [AdminW, RootW]) })
    await settle()
    expect(chain()).toBe('rootw > adminw > root > page')
    expect(document.querySelector('.rootw')).toBe(wEl)
    expect(text('.b-rootw')).toBe('rootw:1')
  })

  it('a page without a shell and a page with one: each navigation renders its own', async () => {
    const Root = part('root'), Plain = page('plain'), Home = page('home')
    onRenderClient({ Page: Plain, data: { title: 'P' }, config: {} })
    await settle()
    expect(text('.page')).toBe('plain:P')
    expect(document.querySelector('.root')).toBeNull()
    onRenderClient({ Page: Home, data: { title: 'H' }, config: cfg([Root]) })
    await settle()
    expect(chain()).toBe('root > page')
    expect(text('.page')).toBe('home:H')
    onRenderClient({ Page: Plain, data: { title: 'P2' }, config: {} })
    await settle()
    expect(document.querySelector('.root')).toBeNull()
    expect(text('.page')).toBe('plain:P2')
  })
})
