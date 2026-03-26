/**
 * Vike client-side render hook for Sygnal.
 *
 * On first page load (hydration): reads server-serialized state and
 * boots the Sygnal app via run().
 *
 * On client-side navigation with a Layout: the Layout stays mounted
 * and only the Page sub-component is hot-swapped. Layout state persists
 * across navigations. Without a Layout, the app is disposed and recreated.
 *
 * When a Layout is configured, a synthetic wrapper component is created
 * that composes Layout and Page into a single reactive graph. The Layout
 * becomes a live interactive sub-component (not static HTML), and the
 * Page is rendered as children of the Layout.
 */

// Import from the package entry so rollup externalizes it
// @ts-ignore — resolved at runtime via package exports
import { run } from 'sygnal'

declare global {
  interface Window {
    __VIKE_SYGNAL_STATE__?: any
  }
}

interface PageContext {
  Page: any
  data?: any
  routeParams?: Record<string, string>
  urlPathname?: string
  isHydration?: boolean
  config: {
    Layout?: any | any[]
    title?: string
    ssr?: boolean
  }
}

/** Track the running Sygnal app for disposal on navigation */
let currentApp: { sources: any; sinks: any; dispose: () => void } | null = null

/**
 * Mutable references read by the wrapper's view function.
 * Updated on navigation to swap the Page without disposing the Layout.
 */
let currentPage: any = null
let currentPageName: string = ''
let currentPageData: any = {}
let currentRouteParams: any = {}
let currentUrlPathname: string = ''
let pageNavCounter: number = 0

/**
 * Build a component vnode that matches what the JSX pragma produces.
 */
function componentVNode(comp: any, stateField: string, children: any[], compInitialState?: any): any {
  const name = comp.componentName || comp.name || 'FUNCTION_COMPONENT'
  return {
    sel: name,
    data: {
      props: {
        state: stateField,
        sygnalOptions: {
          name,
          view: comp,
          model: comp.model,
          intent: comp.intent,
          hmrActions: comp.hmrActions,
          context: comp.context,
          peers: comp.peers,
          components: comp.components,
          initialState: compInitialState,
          isolatedState: true,
          calculated: comp.calculated,
          storeCalculatedInState: comp.storeCalculatedInState,
          DOMSourceName: comp.DOMSourceName,
          stateSourceName: comp.stateSourceName,
          onError: comp.onError,
          debug: comp.debug,
        },
      },
    },
    children,
    text: undefined,
    elm: undefined,
    key: '__vike_' + stateField + '__',
  }
}

/**
 * Build a vnode for the current Page as a child of the Layout.
 * Reads from mutable `currentPage` / `currentPageName` so the wrapper
 * view picks up the new Page component on navigation without being recreated.
 */
function pageChildVNode(pageState: any): any {
  // Include pageNavCounter in sel so instantiateSubComponents detects a
  // component swap even when both pages have the same function name (e.g. 'Page').
  const sel = currentPageName + '__nav' + pageNavCounter
  return {
    sel,
    data: {
      props: {
        state: 'page',
        sygnalOptions: {
          name: sel,
          view: currentPage,
          model: currentPage.model,
          intent: currentPage.intent,
          hmrActions: currentPage.hmrActions,
          context: currentPage.context,
          peers: currentPage.peers,
          components: currentPage.components,
          initialState: pageState,
          isolatedState: true,
          calculated: currentPage.calculated,
          storeCalculatedInState: currentPage.storeCalculatedInState,
          DOMSourceName: currentPage.DOMSourceName,
          stateSourceName: currentPage.stateSourceName,
          onError: currentPage.onError,
          debug: currentPage.debug,
        },
      },
    },
    children: [],
    text: undefined,
    elm: undefined,
    key: '__vike_page__',
  }
}

/**
 * Create a synthetic wrapper component that nests Page inside Layout(s).
 *
 * The wrapper's view reads `currentPage` from the mutable closure, so
 * on client-side navigation only the Page sub-component changes while
 * the Layout stays mounted with its state preserved.
 */
function createLayoutWrapper(layouts: any[], Page: any): any {
  currentPage = Page
  currentPageName = Page.componentName || Page.name || 'VikePageComponent'

  function LayoutWrapperView({ state }: any) {
    const lastIdx = layouts.length - 1
    const layoutState = state['layout_' + lastIdx] || {}
    let inner: any = componentVNode(
      layouts[lastIdx],
      'layout_' + lastIdx,
      [pageChildVNode(layoutState.page)],
      layoutState
    )

    // Wrap with outer layouts (if multiple)
    for (let i = lastIdx - 1; i >= 0; i--) {
      inner = componentVNode(layouts[i], 'layout_' + i, [inner], state['layout_' + i])
    }

    return inner
  }

  LayoutWrapperView.componentName = 'VikeLayoutWrapper'

  // The wrapper's state holds layout slices. The Page state is nested under
  // the innermost layout's slice since the Page is a sub-component of the Layout.
  const wrapperInitialState: any = {}
  layouts.forEach((Layout: any, i: number) => {
    const layoutState: any = { ...(Layout.initialState || {}) }
    if (i === layouts.length - 1) {
      layoutState.page = Page.initialState || {}
    }
    wrapperInitialState['layout_' + i] = layoutState
  })

  LayoutWrapperView.initialState = wrapperInitialState

  // Context uses mutable references so navigation updates are picked up.
  // Layout contexts are merged once; page-level context (pageData, routeParams,
  // urlPathname) reads from mutable variables updated on each navigation.
  const layoutContext: any = {}
  layouts.forEach((Layout: any) => {
    if (Layout.context) {
      Object.assign(layoutContext, Layout.context)
    }
  })

  LayoutWrapperView.context = {
    ...layoutContext,
    ...(Page.context || {}),
    pageData: () => currentPageData,
    routeParams: () => currentRouteParams,
    urlPathname: () => currentUrlPathname,
  }

  return LayoutWrapperView
}

export function onRenderClient(pageContext: PageContext) {
  const { Page, config } = pageContext
  const data = pageContext.data || {}

  const layouts = config.Layout
    ? (Array.isArray(config.Layout) ? config.Layout : [config.Layout])
      .filter((L: any) => typeof L === 'function')
    : []

  // Update mutable context references (used by the wrapper's context functions)
  currentPageData = data
  currentRouteParams = pageContext.routeParams || {}
  currentUrlPathname = pageContext.urlPathname || ''

  // --- Layout path: hot-swap Page, keep Layout alive ---
  if (layouts.length > 0) {
    const innermostKey = 'layout_' + (layouts.length - 1)

    if (currentApp) {
      // Client-side navigation: swap the Page without disposing the Layout.
      // Update the mutable Page reference, then push a state reducer that
      // resets the page slice. The wrapper re-renders, instantiateSubComponents
      // detects the new component (different sel), disposes the old Page,
      // and creates the new one.
      currentPage = Page
      currentPageName = Page.componentName || Page.name || 'VikePageComponent'
      pageNavCounter++

      const newPageState = { ...(Page.initialState || {}), ...data }
      if (currentApp.sinks?.STATE?.shamefullySendNext) {
        currentApp.sinks.STATE.shamefullySendNext((state: any) => {
          const layoutState = state[innermostKey] || {}
          return {
            ...state,
            [innermostKey]: { ...layoutState, page: newPageState },
          }
        })
      }
    } else {
      // First load: read hydrated state or build from initialState
      let initialState: any
      if (typeof window !== 'undefined' && window.__VIKE_SYGNAL_STATE__ !== undefined) {
        initialState = window.__VIKE_SYGNAL_STATE__
        delete window.__VIKE_SYGNAL_STATE__
      } else {
        initialState = null
      }

      if (initialState && initialState[innermostKey] !== undefined) {
        // Hydrated combined state — distribute slices
        layouts.forEach((Layout: any, i: number) => {
          const key = 'layout_' + i
          if (initialState[key] !== undefined) {
            if (i === layouts.length - 1) {
              const { page: pageState, ...layoutState } = initialState[key]
              Layout.initialState = layoutState
              Page.initialState = pageState || { ...(Page.initialState || {}), ...data }
            } else {
              Layout.initialState = initialState[key]
            }
          }
        })
      } else {
        // SPA mode or client-side first navigation
        Page.initialState = { ...(Page.initialState || {}), ...data }
      }

      // Inject page-level context into Page (for SSR renderToString compat)
      Page.context = {
        ...Page.context,
        pageData: () => currentPageData,
        routeParams: () => currentRouteParams,
        urlPathname: () => currentUrlPathname,
      }

      const Component = createLayoutWrapper(layouts, Page)

      try {
        currentApp = run(Component, {}, { mountPoint: '#page-view' }) as any
      } catch (err: any) {
        console.error('[sygnal/vike] Client render error:', err)
        const container = document.getElementById('page-view')
        if (container) {
          container.innerHTML = `<div data-sygnal-error style="padding:2rem;color:#e74c3c;font-family:monospace">
            <h2>Render Error</h2>
            <pre>${String(err.message || err)}</pre>
          </div>`
        }
      }
    }

  // --- No Layout path: dispose and recreate ---
  } else {
    if (currentApp) {
      currentApp.dispose()
      currentApp = null
    }

    let initialState: any
    if (typeof window !== 'undefined' && window.__VIKE_SYGNAL_STATE__ !== undefined) {
      initialState = window.__VIKE_SYGNAL_STATE__
      delete window.__VIKE_SYGNAL_STATE__
    } else {
      initialState = { ...(Page.initialState || {}), ...data }
    }

    Page.initialState = initialState
    Page.context = {
      ...Page.context,
      pageData: () => currentPageData,
      routeParams: () => currentRouteParams,
      urlPathname: () => currentUrlPathname,
    }

    try {
      currentApp = run(Page, {}, { mountPoint: '#page-view' }) as any
    } catch (err: any) {
      console.error('[sygnal/vike] Client render error:', err)
      const container = document.getElementById('page-view')
      if (container) {
        container.innerHTML = `<div data-sygnal-error style="padding:2rem;color:#e74c3c;font-family:monospace">
          <h2>Render Error</h2>
          <pre>${String(err.message || err)}</pre>
        </div>`
      }
    }
  }

  // Update document title on client navigation
  if (config.title) {
    document.title = config.title
  }
}
