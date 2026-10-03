// @vitest-environment jsdom
// PLAN-4 2-A2 G-207: SSR determinism of uid() with a Vike Wrapper/Layout. The server renders each
// shell component and the Page as its own root, while the client nests the Page in the shell; both
// sides now give each shell component and the Page the same uid base (the client an `id` prop on
// each nested vnode, the server renderToString's uid root), so the ids match after hydration.
// Runs against the built files (npm run build).
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

// shell components as the Vike example writes them: live children on the client, the page HTML
// as `innerHTML` on the server
function Wrapper({ uid, children, innerHTML }) {
  return h('section', { attrs: { id: uid('wrap') } },
    ...(children && children.length ? children : [h('div', { props: { innerHTML: innerHTML || '' } })]))
}
Wrapper.initialState = {}
function Layout({ uid, children, innerHTML }) {
  return h('main', { attrs: { id: uid('main') } },
    h('label', { attrs: { for: uid('q') } }, 'Search'), h('input', { attrs: { id: uid('q') } }),
    ...(children && children.length ? children : [h('div', { props: { innerHTML: innerHTML || '' } })]))
}
Layout.initialState = {}
function Field({ uid, label }) {
  return h('p', null, h('label', { attrs: { for: uid('input') } }, label), h('input', { attrs: { id: uid('input') } }))
}
function Page({ uid }) {
  return h('article', { attrs: { id: uid('page') } }, h(Field, { label: 'email' }), h('div', null, h(Field, { label: 'name' })))
}
Page.initialState = {}

let onRenderClient, onRenderHtml
beforeEach(async () => {
  vi.resetModules()
  ;({ onRenderClient } = await import('../dist/vike/onRenderClient.mjs'))
  ;({ onRenderHtml } = await import('../dist/vike/onRenderHtml.mjs'))
  delete window.__VIKE_SYGNAL_STATE__
})
afterEach(() => { document.body.innerHTML = '' })

const idsOf = (html) => [...html.matchAll(/ id="([^"]+)"/g)].map(m => m[1]).filter(id => id !== 'page-view' && id !== 'vike-shell')
const pageView = (doc) => doc.match(/<div id="page-view">([\s\S]*)<\/div>\s*<\/body>/)[1]

async function hydrate(config) {
  const doc = onRenderHtml({ Page, data: {}, config }).documentHtml._escaped
  const html = pageView(doc)
  const ssrIds = idsOf(html)
  window.__VIKE_SYGNAL_STATE__ = JSON.parse(html.match(/window\.__VIKE_SYGNAL_STATE__=(.*?)<\/script>/)[1])
  document.body.innerHTML = `<div id="page-view">${html.replace(/<script>.*?<\/script>/, '')}</div>`
  onRenderClient({ Page, data: {}, config, isHydration: true })
  await settle()
  const clientIds = [...document.querySelectorAll('#page-view [id]')].map(e => e.id).filter(id => id !== 'vike-shell')
  return { ssrIds, clientIds }
}

describe('G-207: uid() with a Vike Wrapper/Layout is the same on the server and the client', () => {
  it('with a Layout: the Layout, the Page and its children', async () => {
    const { ssrIds, clientIds } = await hydrate({ Layout })
    expect(ssrIds).toHaveLength(2 + 1 + 2)
    expect(new Set(ssrIds).size).toBe(ssrIds.length)
    expect([...clientIds].sort()).toEqual([...ssrIds].sort())
  })

  it('with a Wrapper and a Layout', async () => {
    const { ssrIds, clientIds } = await hydrate({ Wrapper, Layout })
    expect(ssrIds).toHaveLength(1 + 2 + 1 + 2)
    expect(new Set(ssrIds).size).toBe(ssrIds.length)
    expect([...clientIds].sort()).toEqual([...ssrIds].sort())
  })

  it('the ids stay short', async () => {
    const { clientIds } = await hydrate({ Wrapper, Layout })
    for (const id of clientIds) expect(id.length).toBeLessThanOrEqual(24)
  })
})
