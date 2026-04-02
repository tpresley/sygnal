/**
 * Vike client-side render hook for Sygnal.
 *
 * On first page load (hydration): reads server-serialized state and
 * boots the Sygnal app via run().
 *
 * On client-side navigation with a Layout/Wrapper: the Layout and Wrapper
 * stay mounted and only the Page sub-component is hot-swapped. Layout and
 * Wrapper state persists across navigations. Without either, the app is
 * disposed and recreated.
 *
 * Nesting order: Wrapper > Layout > Page
 * - Wrappers are outermost (context providers, state management)
 * - Layouts are inside wrappers (visual structure, navigation chrome)
 * - Page is innermost (route-specific content, swapped on navigation)
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
    Wrapper?: any | any[]
    title?: string
    ssr?: boolean
    drivers?: Record<string, (sink: any) => any>
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
 * Create a synthetic wrapper component that nests Page inside Layout(s)
 * inside Wrapper(s).
 *
 * Nesting order: Wrapper(s) > Layout(s) > Page
 *
 * The wrapper's view reads `currentPage` from the mutable closure, so
 * on client-side navigation only the Page sub-component changes while
 * the Layout and Wrapper stay mounted with their state preserved.
 */
function createLayoutWrapper(wrappers: any[], layouts: any[], Page: any): any {
  currentPage = Page
  currentPageName = Page.componentName || Page.name || 'VikePageComponent'

  // Combined shell = wrappers (outermost) + layouts (innermost around Page)
  // State keys: wrapper_0, wrapper_1, ..., layout_0, layout_1, ...
  // Page state lives under the innermost shell component's slice.
  const shell = [
    ...wrappers.map((w: any, i: number) => ({ comp: w, key: 'wrapper_' + i })),
    ...layouts.map((l: any, i: number) => ({ comp: l, key: 'layout_' + i })),
  ]

  function LayoutWrapperView({ state }: any) {
    if (shell.length === 0) {
      // No wrappers or layouts — render Page directly
      return pageChildVNode(state.page)
    }

    const lastIdx = shell.length - 1
    const innermostState = state[shell[lastIdx].key] || {}
    let inner: any = componentVNode(
      shell[lastIdx].comp,
      shell[lastIdx].key,
      [pageChildVNode(innermostState.page)],
      innermostState
    )

    // Wrap with outer shell components
    for (let i = lastIdx - 1; i >= 0; i--) {
      inner = componentVNode(shell[i].comp, shell[i].key, [inner], state[shell[i].key])
    }

    // Wrap in a plain div so the view returns a regular DOM vnode.
    // Sub-component vnodes at the root position are not processed correctly
    // by the rendering pipeline — they must be children of a DOM element.
    return {
      sel: 'div',
      data: { attrs: { id: 'vike-shell' } },
      children: [inner],
      text: undefined,
      elm: undefined,
      key: '__vike_shell__',
    }
  }

  LayoutWrapperView.componentName = 'VikeLayoutWrapper'

  // Build the wrapper's initial state with a slice for each shell component.
  // Page state is nested under the innermost shell component's slice.
  const wrapperInitialState: any = {}
  shell.forEach(({ comp, key }: any, i: number) => {
    const sliceState: any = { ...(comp.initialState || {}) }
    if (i === shell.length - 1) {
      sliceState.page = Page.initialState || {}
    }
    wrapperInitialState[key] = sliceState
  })

  LayoutWrapperView.initialState = wrapperInitialState

  // Context uses mutable references so navigation updates are picked up.
  // Wrapper and Layout contexts are merged once; page-level context
  // (pageData, routeParams, urlPathname) reads from mutable variables
  // updated on each navigation.
  const shellContext: any = {}
  shell.forEach(({ comp }: any) => {
    if (comp.context) {
      Object.assign(shellContext, comp.context)
    }
  })

  LayoutWrapperView.context = {
    ...shellContext,
    ...(Page.context || {}),
    pageData: () => currentPageData,
    routeParams: () => currentRouteParams,
    urlPathname: () => currentUrlPathname,
  }

  return LayoutWrapperView
}

/**
 * Normalize a cumulative config value into an array of functions.
 */
function toComponentArray(val: any): any[] {
  if (!val) return []
  return (Array.isArray(val) ? val : [val]).filter((c: any) => typeof c === 'function')
}

export function onRenderClient(pageContext: PageContext) {
  const { Page, config } = pageContext
  const data = pageContext.data || {}

  const wrappers = toComponentArray(config.Wrapper)
  const layouts = toComponentArray(config.Layout)
  const hasShell = wrappers.length > 0 || layouts.length > 0

  // The shell is wrappers (outermost) + layouts. The innermost component
  // holds the Page state as a nested sub-component.
  const shell = [
    ...wrappers.map((_: any, i: number) => 'wrapper_' + i),
    ...layouts.map((_: any, i: number) => 'layout_' + i),
  ]
  const innermostKey = shell.length > 0 ? shell[shell.length - 1] : null

  // Update mutable context references (used by the wrapper's context functions)
  currentPageData = data
  currentRouteParams = pageContext.routeParams || {}
  currentUrlPathname = pageContext.urlPathname || ''

  // --- Shell path: hot-swap Page, keep Layout/Wrapper alive ---
  if (hasShell) {
    if (currentApp) {
      // Client-side navigation: swap the Page without disposing the shell.
      currentPage = Page
      currentPageName = Page.componentName || Page.name || 'VikePageComponent'
      pageNavCounter++

      const newPageState = { ...(Page.initialState || {}), ...data }
      if (currentApp.sinks?.STATE?.shamefullySendNext) {
        currentApp.sinks.STATE.shamefullySendNext((state: any) => {
          const shellState = state[innermostKey!] || {}
          return {
            ...state,
            [innermostKey!]: { ...shellState, page: newPageState },
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

      if (initialState && innermostKey && initialState[innermostKey] !== undefined) {
        // Hydrated combined state — distribute slices to each shell component
        const allShellComps = [...wrappers, ...layouts]
        shell.forEach((key: string, i: number) => {
          if (initialState[key] !== undefined) {
            if (i === shell.length - 1) {
              const { page: pageState, ...compState } = initialState[key]
              allShellComps[i].initialState = compState
              Page.initialState = pageState || { ...(Page.initialState || {}), ...data }
            } else {
              allShellComps[i].initialState = initialState[key]
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

      const Component = createLayoutWrapper(wrappers, layouts, Page)

      try {
        currentApp = run(Component, config.drivers || {}, { mountPoint: '#page-view' }) as any
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

  // --- No shell path: dispose and recreate ---
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
      currentApp = run(Page, config.drivers || {}, { mountPoint: '#page-view' }) as any
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
