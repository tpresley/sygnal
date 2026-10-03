// @vitest-environment jsdom
// PLAN-3 5-5 (H-7): SSR cache seeding through the Vike glue (built files): a loader puts a
// queryCache() snapshot on pageContext.queryCache; onRenderHtml renders the page's resources
// from it, and onRenderClient hydrates the fetch drivers' caches with it before the page runs,
// so a fresh entry paints 'success' with no fetch, on first load and on client navigation.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement as h, makeFetchDriver, queryCache } from '../dist/index.esm.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const text = (sel) => document.querySelector(sel)?.textContent

function Layout({ children }) { return h('main', { className: 'layout' }, ...children) }
Layout.initialState = {}
function Quote({ state }) {
  const q = state.quote
  return h('div', null, h('p', { className: 'status' }, `${q.status}${q.refreshing ? '+' : ''}`), h('p', { className: 'text' }, q.data ? q.data.text : ''))
}
Quote.initialState = { id: 1 }
Quote.resources = { quote: (s) => `/api/quotes/${s.id}` }

const snapshot = (id, ageMs = 0) => {
  const c = queryCache()
  c.set(`/api/quotes/${id}`, { text: `seeded ${id}` })
  return JSON.parse(JSON.stringify(c.dehydrate())).map(e => ({ ...e, updatedAt: e.updatedAt - ageMs }))
}

let onRenderClient, onRenderHtml, fetchFn
beforeEach(async () => {
  vi.resetModules()
  ;({ onRenderClient } = await import('../dist/vike/onRenderClient.mjs'))
  ;({ onRenderHtml } = await import('../dist/vike/onRenderHtml.mjs'))
  fetchFn = vi.fn(() => new Promise(() => {}))
  vi.stubGlobal('fetch', fetchFn)
  delete window.__VIKE_SYGNAL_STATE__
})
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

function ssr(pageContext) {
  const html = onRenderHtml(pageContext).documentHtml._escaped
  const body = html.slice(html.indexOf('<div id="page-view">'), html.lastIndexOf('</body>'))
  document.body.innerHTML = body
  const m = /<script>window\.__VIKE_SYGNAL_STATE__=(.*?)<\/script>/.exec(body)
  if (m) window.__VIKE_SYGNAL_STATE__ = JSON.parse(m[1])
  return html
}

describe('Vike: SSR cache seeding', () => {
  for (const shell of [false, true]) {
    it(`${shell ? 'with' : 'without'} a Layout: the SSR HTML has the data; hydration paints success with no fetch`, async () => {
      const queryCacheSnap = snapshot(1)
      const config = { ...(shell ? { Layout: [Layout] } : {}), drivers: { HTTP: makeFetchDriver({ cache: queryCache({ staleTime: 30000 }) }) } }
      const html = ssr({ Page: Quote, data: {}, config, queryCache: queryCacheSnap })
      expect(html).toContain('<p class="status">success</p><p class="text">seeded 1</p>')
      const seen = []
      new MutationObserver(() => seen.push(text('.status'))).observe(document.body, { subtree: true, childList: true, characterData: true })
      onRenderClient({ Page: Quote, data: {}, config, queryCache: queryCacheSnap, isHydration: true })
      await sleep(50)
      expect(text('.text')).toBe('seeded 1')
      expect(seen.every(s => s === 'success')).toBe(true)
      expect(fetchFn).not.toHaveBeenCalled()
    })
  }

  it('client navigation (Layout): the new page reads the snapshot its +data seeded, with no fetch', async () => {
    const config = { Layout: [Layout], drivers: { HTTP: makeFetchDriver({ cache: queryCache({ staleTime: 30000 }) }) } }
    ssr({ Page: Quote, data: {}, config, queryCache: snapshot(1) })
    onRenderClient({ Page: Quote, data: {}, config, queryCache: snapshot(1), isHydration: true })
    await sleep(30)
    function Quote2(p) { return Quote(p) }
    Object.assign(Quote2, Quote)
    onRenderClient({ Page: Quote2, data: { id: 2 }, config, queryCache: snapshot(2) })
    await sleep(50)
    expect(text('.text')).toBe('seeded 2')
    expect(text('.status')).toBe('success')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
