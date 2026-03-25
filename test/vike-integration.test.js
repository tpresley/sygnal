import { describe, it, expect } from 'vitest'

/**
 * Tests for the vike-sygnal extension.
 *
 * These test the config shape, onRenderHtml output, and data flow.
 * onRenderClient is harder to unit test (needs DOM + Vike runtime)
 * so it's covered by the config/shape tests and manual verification.
 */

// Import the built config
import vikeConfig from '../dist/vike/+config.js'

// Import onRenderHtml directly (we mock the vike/server dependency)
// We test renderToString integration separately since onRenderHtml
// depends on vike/server which isn't installed.
import { renderToString } from '../dist/index.esm.js'

describe('vike-sygnal config', () => {
  it('has the correct extension name', () => {
    expect(vikeConfig.name).toBe('sygnal')
  })

  it('enables client routing', () => {
    expect(vikeConfig.clientRouting).toBe(true)
  })

  it('allows hydration to be aborted', () => {
    expect(vikeConfig.hydrationCanBeAborted).toBe(true)
  })

  it('passes data to client', () => {
    expect(vikeConfig.passToClient).toContain('data')
    expect(vikeConfig.passToClient).toContain('routeParams')
  })

  it('references onRenderHtml via import directive', () => {
    expect(vikeConfig.onRenderHtml).toBe(
      'import:sygnal/vike/onRenderHtml:onRenderHtml'
    )
  })

  it('references onRenderClient via import directive', () => {
    expect(vikeConfig.onRenderClient).toBe(
      'import:sygnal/vike/onRenderClient:onRenderClient'
    )
  })

  it('defines Layout meta with server and client env', () => {
    expect(vikeConfig.meta.Layout).toEqual({
      env: { server: true, client: true },
      cumulative: true,
    })
  })

  it('defines Head meta with server-only env', () => {
    expect(vikeConfig.meta.Head).toEqual({
      env: { server: true },
    })
  })

  it('defines title meta', () => {
    expect(vikeConfig.meta.title).toEqual({
      env: { server: true, client: true },
    })
  })

  it('defines description meta', () => {
    expect(vikeConfig.meta.description).toEqual({
      env: { server: true },
    })
  })

  it('defines favicon meta as global', () => {
    expect(vikeConfig.meta.favicon).toEqual({
      env: { server: true },
      global: true,
    })
  })

  it('defines lang meta', () => {
    expect(vikeConfig.meta.lang).toEqual({
      env: { server: true, client: true },
    })
  })

  it('defines ssr meta with config env and effect', () => {
    expect(vikeConfig.meta.ssr.env).toEqual({ config: true })
    expect(typeof vikeConfig.meta.ssr.effect).toBe('function')
  })

  it('ssr effect throws for non-boolean values', () => {
    expect(() =>
      vikeConfig.meta.ssr.effect({
        configDefinedAt: 'test',
        configValue: 'string',
      })
    ).toThrow('should be a boolean')
  })

  it('ssr effect returns meta override when false', () => {
    const result = vikeConfig.meta.ssr.effect({
      configDefinedAt: 'test',
      configValue: false,
    })
    expect(result.meta.ssr.env).toEqual({ server: true, client: true })
  })

  it('ssr effect returns empty object when true', () => {
    const result = vikeConfig.meta.ssr.effect({
      configDefinedAt: 'test',
      configValue: true,
    })
    expect(result).toEqual({})
  })
})

describe('vike-sygnal SSR rendering', () => {
  // Test renderToString integration (the core of onRenderHtml)
  // without needing the vike/server escapeInject dependency

  function Counter({ state }) {
    return {
      sel: 'div',
      data: { props: { className: 'counter' } },
      children: [{ text: `Count: ${state.count}` }],
      text: undefined,
      elm: undefined,
      key: undefined,
    }
  }
  Counter.initialState = { count: 0 }

  it('renders a page component with initial state', () => {
    const html = renderToString(Counter, {
      state: { count: 42 },
    })
    expect(html).toContain('Count: 42')
    expect(html).toContain('class="counter"')
  })

  it('embeds hydration state with custom variable name', () => {
    const html = renderToString(Counter, {
      state: { count: 5 },
      hydrateState: '__VIKE_SYGNAL_STATE__',
    })
    expect(html).toContain('__VIKE_SYGNAL_STATE__')
    expect(html).toContain('"count":5')
    expect(html).toContain('<script>')
  })

  it('merges data into initial state for rendering', () => {
    // Simulates the data merge that onRenderHtml performs
    const data = { items: ['a', 'b'] }
    const initialState = { ...Counter.initialState, ...data }

    function DataPage({ state }) {
      return {
        sel: 'div',
        data: {},
        children: [{ text: `Items: ${state.items.length}, Count: ${state.count}` }],
        text: undefined,
        elm: undefined,
        key: undefined,
      }
    }
    DataPage.initialState = { count: 0 }

    const html = renderToString(DataPage, { state: initialState })
    expect(html).toContain('Items: 2, Count: 0')
  })

  it('falls back to component initialState when no state provided', () => {
    const html = renderToString(Counter)
    expect(html).toContain('Count: 0')
  })

  it('renders with error boundary on view error', () => {
    function Broken() {
      throw new Error('render failed')
    }
    Broken.initialState = {}
    Broken.onError = (err, { componentName }) => ({
      sel: 'div',
      data: { attrs: { 'data-error': componentName } },
      children: [{ text: 'Something went wrong' }],
      text: undefined,
      elm: undefined,
      key: undefined,
    })

    const html = renderToString(Broken, { state: {} })
    expect(html).toContain('Something went wrong')
  })

  it('renders innerHTML prop as raw HTML content', () => {
    function Layout({ innerHTML }) {
      return {
        sel: 'div',
        data: { props: { className: 'layout' } },
        children: [{
          sel: 'main',
          data: { props: { innerHTML: innerHTML || '' } },
          children: [],
          text: undefined,
          elm: undefined,
          key: undefined,
        }],
        text: undefined,
        elm: undefined,
        key: undefined,
      }
    }
    Layout.initialState = {}

    const html = renderToString(Layout, {
      state: {},
      props: { innerHTML: '<p>Page content</p>' },
    })
    expect(html).toContain('class="layout"')
    expect(html).toContain('<main><p>Page content</p></main>')
  })

  it('Layout placeholder splitting works for SSR', () => {
    // Simulate what onRenderHtml does: render Layout with a placeholder,
    // then split around it to get before/after HTML
    function NavLayout({ innerHTML }) {
      return {
        sel: 'div',
        data: { props: { className: 'wrapper' } },
        children: [
          {
            sel: 'nav',
            data: {},
            children: [{ text: 'Navigation' }],
            text: undefined, elm: undefined, key: undefined,
          },
          {
            sel: 'main',
            data: { props: { innerHTML: innerHTML || '' } },
            children: [],
            text: undefined, elm: undefined, key: undefined,
          },
        ],
        text: undefined,
        elm: undefined,
        key: undefined,
      }
    }
    NavLayout.initialState = {}

    const PLACEHOLDER = '<!--SYGNAL_PAGE_SLOT-->'
    const layoutHtml = renderToString(NavLayout, {
      state: {},
      props: { innerHTML: PLACEHOLDER },
    })

    const splitIdx = layoutHtml.indexOf(PLACEHOLDER)
    expect(splitIdx).toBeGreaterThan(-1)

    const before = layoutHtml.substring(0, splitIdx)
    const after = layoutHtml.substring(splitIdx + PLACEHOLDER.length)

    expect(before).toContain('<nav>')
    expect(before).toContain('Navigation')
    expect(before).toContain('<main>')
    expect(after).toContain('</main>')
    expect(after).toContain('</div>')
  })

  it('Layout wraps page content inside page-view for SSR', () => {
    // Simulates the new onRenderHtml behavior where Layout HTML wraps
    // page content INSIDE #page-view (not outside it)
    function Page({ state }) {
      return {
        sel: 'div',
        data: { props: { className: 'page' } },
        children: [{ text: `Count: ${state.count}` }],
        text: undefined, elm: undefined, key: undefined,
      }
    }
    Page.initialState = { count: 0 }

    function SidebarLayout({ innerHTML }) {
      return {
        sel: 'div',
        data: { props: { className: 'layout' } },
        children: [
          {
            sel: 'aside',
            data: {},
            children: [{ text: 'Sidebar' }],
            text: undefined, elm: undefined, key: undefined,
          },
          {
            sel: 'main',
            data: { props: { innerHTML: innerHTML || '' } },
            children: [],
            text: undefined, elm: undefined, key: undefined,
          },
        ],
        text: undefined, elm: undefined, key: undefined,
      }
    }
    SidebarLayout.initialState = { sidebarOpen: true }

    // Render page content
    const pageHtml = renderToString(Page, { state: { count: 42 } })

    // Wrap with layout (as onRenderHtml now does inside #page-view)
    const PLACEHOLDER = '<!--SYGNAL_PAGE_SLOT-->'
    const layoutHtml = renderToString(SidebarLayout, {
      state: SidebarLayout.initialState,
      props: { innerHTML: PLACEHOLDER },
    })
    const splitIdx = layoutHtml.indexOf(PLACEHOLDER)
    const pageViewContent = layoutHtml.substring(0, splitIdx) + pageHtml + layoutHtml.substring(splitIdx + PLACEHOLDER.length)

    // Layout wraps page content
    expect(pageViewContent).toContain('class="layout"')
    expect(pageViewContent).toContain('Sidebar')
    expect(pageViewContent).toContain('Count: 42')
    // Layout before page content
    expect(pageViewContent.indexOf('Sidebar')).toBeLessThan(pageViewContent.indexOf('Count: 42'))
  })

  it('builds combined wrapper state with page and layout slices', () => {
    // Simulates what onRenderHtml serializes for the client-side wrapper
    function Page() { return { sel: 'div', data: {}, children: [] } }
    Page.initialState = { count: 5 }

    function Layout() { return { sel: 'div', data: {}, children: [] } }
    Layout.initialState = { sidebarOpen: true }

    const initialState = { ...Page.initialState }
    const layoutArray = [Layout]

    // Build wrapper state (same logic as onRenderHtml)
    const wrapperState = { page: initialState }
    layoutArray.forEach((L, i) => {
      wrapperState['layout_' + i] = L.initialState || {}
    })

    expect(wrapperState).toEqual({
      page: { count: 5 },
      layout_0: { sidebarOpen: true },
    })
  })

  it('builds combined wrapper state for multiple nested layouts', () => {
    function Page() { return { sel: 'div', data: {}, children: [] } }
    Page.initialState = { title: 'Home' }

    function OuterLayout() { return { sel: 'div', data: {}, children: [] } }
    OuterLayout.initialState = { theme: 'dark' }

    function InnerLayout() { return { sel: 'div', data: {}, children: [] } }
    InnerLayout.initialState = { sidebarOpen: false }

    const layoutArray = [OuterLayout, InnerLayout]
    const wrapperState = { page: Page.initialState }
    layoutArray.forEach((L, i) => {
      wrapperState['layout_' + i] = L.initialState || {}
    })

    expect(wrapperState).toEqual({
      page: { title: 'Home' },
      layout_0: { theme: 'dark' },
      layout_1: { sidebarOpen: false },
    })
  })
})
