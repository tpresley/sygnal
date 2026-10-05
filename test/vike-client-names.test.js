// G-037: the Vike client wrapper keeps the user's component names, which
// diagnostics, devtools, inspect() and onError read from the `name` option
// (it said 'Page__nav0'). G-046: urlPathname is no longer in passToClient, so
// the client falls back to the location when Vike doesn't provide it.
// Runs against the built file (npm run build).
import { describe, it, expect, vi, afterAll } from 'vitest'

const runs = []
let state
vi.mock('sygnal', () => ({
  run: (component, drivers, options) => {
    state = component.initialState
    runs.push({ component, drivers, options })
    return {
      sources: {},
      sinks: {},
      // the runtime API the wrapper swaps the Page through (R5: no STATE sink pushes)
      __runtime: { setState: (_id, reducer) => { state = reducer(state) } },
      dispose() {},
    }
  },
}))

const savedWindow = globalThis.window
globalThis.window = { location: { pathname: '/from-location' } }
afterAll(() => {
  if (savedWindow === undefined) delete globalThis.window
  else globalThis.window = savedWindow
})

const { onRenderClient } = await import('../dist/vike/onRenderClient.mjs')

// Depth-first search for the vnode carrying the Page (its component function in data.c)
function findPage(vnode) {
  if (!vnode || typeof vnode !== 'object') return null
  if (vnode.key === '__vike_page__') return vnode
  for (const child of vnode.children || []) {
    const hit = findPage(child)
    if (hit) return hit
  }
  return null
}

function Layout({ children }) { return { sel: 'main', data: {}, children } }
Layout.initialState = {}

describe('vike client: component names (G-037)', () => {
  it("names the Page by its own name, not 'Page__navN', across navigations", () => {
    function Page() { return { sel: 'p', data: {}, children: [], text: 'home' } }
    Page.initialState = { count: 0 }
    onRenderClient({ Page, config: { Layout: [Layout] }, data: {} })
    expect(runs).toHaveLength(1)
    const Root = runs[0].component
    expect(Root.name).toBe('VikeLayoutWrapper')

    const first = findPage(Root({ state }))
    // R5: the vnode carries the component function (data.c), named as the user's Page
    expect(first.data.c.name).toBe('Page')
    expect(first.data.c({ state: {} }).text).toBe('home')
    expect(first.data.props.sygnalOptions).toBeUndefined()

    // Client-side navigation to another page also named 'Page'
    function AboutPage() { return { sel: 'p', data: {}, children: [], text: 'about' } }
    Object.defineProperty(AboutPage, 'name', { value: 'Page' })
    onRenderClient({ Page: AboutPage, config: { Layout: [Layout] }, data: { title: 'About' }, urlPathname: '/about' })
    expect(runs).toHaveLength(1) // the shell stays mounted
    const second = findPage(Root({ state }))
    expect(second.data.c.name).toBe('Page')
    expect(second.data.c({ state: {} }).text).toBe('about')
    // the selector still changes so the Page sub-component is swapped
    expect(second.sel).not.toBe(first.sel)
    expect(Root.context.urlPathname()).toBe('/about')
  })

  it('uses componentName when set', () => {
    function Page() { return { sel: 'p', data: {}, children: [] } }
    Page.componentName = 'Dashboard'
    onRenderClient({ Page, config: { Layout: [Layout] }, data: {} })
    const page = findPage(runs[0].component({ state }))
    expect(page.data.c.componentName).toBe('Dashboard')
  })

  it('urlPathname context falls back to the location when Vike does not provide it (G-046)', () => {
    function Page() { return { sel: 'p', data: {}, children: [] } }
    onRenderClient({ Page, config: { Layout: [Layout] }, data: {} })
    expect(runs[0].component.context.urlPathname()).toBe('/from-location')
  })
})
