// PLAN-5 3-J (G-456): Astro islands and Vike pages hydrate over the server's markup with run() on
// the existing container (neither clears it), so the first patch adopts the server's elements:
// identity, typed text and focus are kept. Runs against the built files (npm run build), in the
// node environment with a JSDOM document (as p4-3b2-persist-astro.test.js: Astro's virtual
// onError module can't be resolved under the jsdom environment).
import { describe, it, expect, afterEach, vi, beforeAll } from 'vitest'
import { JSDOM } from 'jsdom'

vi.mock('virtual:sygnal/astro-on-error', () => ({ default: undefined }))

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
const GLOBALS = ['window', 'document', 'localStorage', 'sessionStorage', 'MutationObserver', 'Node', 'Element', 'HTMLElement', 'DocumentFragment', 'Text', 'Comment', 'SVGElement', 'StorageEvent', 'requestAnimationFrame', 'cancelAnimationFrame']
const saved = {}
beforeAll(() => {
  for (const k of GLOBALS) { saved[k] = Object.getOwnPropertyDescriptor(globalThis, k); Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true }) }
  return () => { for (const k of GLOBALS) saved[k] ? Object.defineProperty(globalThis, k, saved[k]) : delete globalThis[k] }
})

const { createElement: h } = await import('sygnal')
const { onRenderHtml } = await import('../dist/vike/onRenderHtml.mjs')
const { onRenderClient } = await import('../dist/vike/onRenderClient.mjs')
const { default: astroClient } = await import('../dist/astro/client.mjs')
const { renderToStaticMarkup } = await import('../dist/astro/server.mjs')

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
/** the elements under `root` (no scripts), with a name for the messages */
const mark = (root) => [...root.querySelectorAll('*')].filter(e => e.tagName != 'SCRIPT').map(e => [e, e.localName + (e.className ? '.' + e.className : '') + (e.id ? '#' + e.id : '')])
const replaced = (els) => els.filter(([e]) => !e.isConnected).map(([, n]) => n)

afterEach(() => { document.body.innerHTML = '' })

describe('3-J: Astro island', () => {
  it('a server-rendered island keeps its elements, typed text and focus', async () => {
    function Island({ state, title }) { return h('section', { className: 'island' }, h('h2', null, title), h('input', { className: 'q' }), h('button', { className: 'b' }, String(state.n))) }
    Island.initialState = { n: 1 }
    const { html } = renderToStaticMarkup(Island, { title: 'T' })
    document.body.innerHTML = `<astro-island ssr="" client="load" uid="u1">${html}</astro-island>`
    const island = document.querySelector('astro-island')
    const els = mark(island)
    const q = island.querySelector('.q')
    q.value = 'typed'
    q.focus()
    await astroClient(island)(Island, { title: 'T' }, {}, { client: 'load' })
    await sleep(60)
    try {
      expect(replaced(els)).toEqual([])
      expect(els.length).toBe(4)
      expect(q.value).toBe('typed')
      expect(document.activeElement).toBe(q)
      expect(island.querySelector('section').hasAttribute('data-sygnal-ssr')).toBe(false)
      // the island's own attributes (G-466: the mount point's are kept)
      expect(island.getAttribute('uid')).toBe('u1')
    } finally { island.__sygnal?.dispose() }
  })
})

describe('3-J: Vike', () => {
  function Page({ state }) { return h('article', { className: 'page' }, h('p', null, state.msg), h('input', { className: 'q' })) }
  Page.initialState = { msg: 'hi' }
  function Layout({ children }) { return h('main', { className: 'layout' }, h('nav', null, h('a', { href: '/' }, 'home')), ...(children || [])) }
  Layout.initialState = {}

  async function hydrate(config) {
    const html = onRenderHtml({ Page, data: {}, config }).documentHtml._escaped
    document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
    const st = document.querySelector('#page-view script')?.textContent.match(/__VIKE_SYGNAL_STATE__=(.*)$/)?.[1]
    if (st) window.__VIKE_SYGNAL_STATE__ = JSON.parse(st)
    const els = mark(document.getElementById('page-view'))
    onRenderClient({ Page, data: {}, config, isHydration: true })
    await sleep(60)
    return els
  }
  // the next test starts from a fresh app: navigate to a page without a shell (disposes the app;
  // the shell test runs first: a shell app takes a navigation as a Page swap)
  afterEach(() => onRenderClient({ Page: () => h('p', null, 'x'), data: {}, config: {} }))

  it('with a Layout: the shell and the Layout are kept', async () => {
    const els = await hydrate({ Layout })
    const names = els.map(([, n]) => n)
    expect(names.slice(0, 4)).toEqual(['div#vike-shell', 'main.layout', 'nav', 'a'])
    // the Page's elements: where onRenderHtml places them (G-464, 3-K) decides whether they are kept
    expect(replaced(els).filter(n => !/^(article|p$|input)/.test(n))).toEqual([])
    expect(document.querySelectorAll('article.page').length).toBe(1)
    expect(document.querySelector('a').getAttribute('href')).toBe('/')
  })
  it('a Page without a shell keeps every element', async () => {
    const els = await hydrate({})
    expect(replaced(els)).toEqual([])
    expect(els.map(([, n]) => n)).toEqual(['article.page', 'p', 'input.q'])
  })

})
