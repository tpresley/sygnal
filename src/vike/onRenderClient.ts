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
  /** PLAN-3 5-5 (H-7): the queryCache() snapshot a loader seeded (see onRenderHtml) */
  queryCache?: any
  config: {
    Layout?: any | any[]
    Wrapper?: any | any[]
    title?: string
    ssr?: boolean
    drivers?: Record<string, (sink: any) => any>
    // PLAN-4 GS-11: the app-level error hook
    onError?: (error: any, info: any) => void
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
 * PLAN-4 G-207: the uid() path part of a shell component or the Page: wrapper_0 → 'w0',
 * layout_1 → 'l1', page → 'p'. Given as the nested vnode's `id` prop, so the Page's uid is
 * 'u-w0-l0-p' however the shell nests it; onRenderHtml renders each one with the same root
 * (renderToString's `uid`), so server and client ids match. (Same helper in onRenderHtml.ts.)
 */
function uidPart(key: string): string {
  return key == 'page' ? 'p' : key[0] + key.slice(key.indexOf('_') + 1)
}

/**
 * Build a component vnode that matches what the JSX pragma produces.
 */
function componentVNode(comp: any, key: string, stateField: any, children: any[], compInitialState?: any): any {
  const name = comp.componentName || comp.name || 'FUNCTION_COMPONENT'
  return {
    sel: name,
    data: {
      props: {
        state: stateField,
        // G-207: the uid() base, as onRenderHtml gives this shell component (see uidPart)
        id: uidPart(key),
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
    key: '__vike_' + key + '__',
  }
}

/**
 * Build a vnode for the current Page as a child of the Layout.
 * Reads from mutable `currentPage` / `currentPageName` so the wrapper
 * view picks up the new Page component on navigation without being recreated.
 */
function pageChildVNode(pageState: any, stateField: any = 'page'): any {
  // Include pageNavCounter in sel so instantiateSubComponents detects a
  // component swap even when both pages have the same function name (e.g. 'Page').
  const sel = currentPageName + '__nav' + pageNavCounter
  return {
    sel,
    data: {
      props: {
        state: stateField,
        // G-207: the Page's uid() base, as onRenderHtml gives it (the same across navigations)
        id: uidPart('page'),
        sygnalOptions: {
          // G-037: diagnostics, devtools and onError name the component by
          // `name`; keep the user's name (the nav counter is only in `sel`).
          name: currentPageName,
          view: currentPage,
          model: currentPage.model,
          intent: currentPage.intent,
          hmrActions: currentPage.hmrActions,
          context: currentPage.context,
          peers: currentPage.peers,
          components: currentPage.components,
          // PLAN-3 5-5: no initialState: `pageState` is the page's root slice already, and an
          // INITIALIZE (sent a tick later) would overwrite the replies the page's statics got
          // in between, e.g. a resource served from the seeded cache
          initialState: undefined,
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

  // Combined shell = wrappers (outermost) + layouts (innermost around Page).
  // D50: the root state holds every slice as a sibling, as in 5.4.0 but with the Page at the
  // root too: { wrapper_0, ..., layout_0, ..., page }. A component's `state` prop selects from
  // its parent component's state, and the shell components are nested in each other, so each
  // one (and the Page) gets a { get, set } lens onto its own ROOT slice: an outer component's
  // reducer replacing its state can't wipe the inner slices (R2-2), and no view sees another
  // component's slice.
  const keys = shellKeys(wrappers, layouts)
  const shell = [...wrappers, ...layouts].map((comp: any, i: number) => ({ comp, key: keys[i] }))

  // The latest root state. Only the outermost lens gets the root itself; the nested lenses get
  // their parent shell component's state. In both directions the outermost lens runs first and
  // synchronously (state: root -> outer get -> inner get; a reducer: outer get, inner get, inner
  // set, outer set), so the nested lenses read and write through `root`.
  let root: any = {}
  const rootLens = (key: string, outermost: boolean, fresh: boolean) => ({
    get: (state: any) => {
      if (outermost) root = state || {}
      const slice = root[key]
      // a shell slice is a new object on every root state, so the components nested in the
      // shell component see every change (their state stream drops repeated objects)
      return fresh && slice && typeof slice === 'object' && !Array.isArray(slice) ? { ...slice } : slice
    },
    set: (state: any, slice: any) => {
      root = { ...root, [key]: slice }
      // a nested lens returns a changed parent state, so the parent's lens writes `root` back
      return outermost ? root : { ...state }
    },
  })
  const lenses = keys.map((key, i) => rootLens(key, i === 0, true))
  const pageLens = rootLens('page', false, false)

  function LayoutWrapperView({ state }: any) {
    if (shell.length === 0) {
      // No wrappers or layouts — render Page directly
      return pageChildVNode(state.page)
    }

    const lastIdx = shell.length - 1
    let inner: any = componentVNode(
      shell[lastIdx].comp,
      shell[lastIdx].key,
      lenses[lastIdx],
      [pageChildVNode(state.page, pageLens)],
      state[shell[lastIdx].key]
    )

    // Wrap with outer shell components
    for (let i = lastIdx - 1; i >= 0; i--) {
      inner = componentVNode(shell[i].comp, shell[i].key, lenses[i], [inner], state[shell[i].key])
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
  // run() names the root by `name` first
  try { Object.defineProperty(LayoutWrapperView, 'name', { value: 'VikeLayoutWrapper', configurable: true }) } catch (_) {}

  // The wrapper's initial state: a sibling slice for each shell component and the Page.
  // Must match onRenderHtml's serialized state.
  const initialState: any = {}
  shell.forEach(({ comp, key }: any) => { initialState[key] = { ...(comp.initialState || {}) } })
  initialState.page = Page.initialState || {}
  LayoutWrapperView.initialState = root = initialState

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

/** State keys of the shell components, outermost first: wrapper_0, ..., layout_0, ... */
function shellKeys(wrappers: any[], layouts: any[]): string[] {
  return [
    ...wrappers.map((_: any, i: number) => 'wrapper_' + i),
    ...layouts.map((_: any, i: number) => 'layout_' + i),
  ]
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

  // The shell is wrappers (outermost) + layouts; their state slices and the Page's are
  // siblings at the root (D50).
  const shell = shellKeys(wrappers, layouts)

  // PLAN-3 5-5 (H-7): seed the caches of the fetch drivers (makeFetchDriver({ cache: queryCache() })
  // exposes it as driver.cache) before the page renders, so its resources start at 'success'
  if (pageContext.queryCache) {
    for (const d of Object.values(config.drivers || {})) (d as any)?.cache?.hydrate?.(pageContext.queryCache)
  }

  // Update mutable context references (used by the wrapper's context functions)
  currentPageData = data
  currentRouteParams = pageContext.routeParams || {}
  // urlPathname is built in on the client with Client Routing (G-046: it is
  // not in passToClient); fall back to the location with Server Routing.
  currentUrlPathname = pageContext.urlPathname
    || (typeof window !== 'undefined' && window.location ? window.location.pathname : '')

  // --- Shell path: hot-swap Page, keep Layout/Wrapper alive ---
  if (hasShell) {
    if (currentApp) {
      // Client-side navigation: swap the Page without disposing the shell.
      // PLAN-3 5-4b: a router given Vike's navigate() (makeRouter({ routes, navigate })) re-reads
      // the route on this event; sent before the swap, so the new Page declares after it
      if (typeof window !== 'undefined') window.dispatchEvent?.(new Event('sygnal:navigate'))
      currentPage = Page
      currentPageName = Page.componentName || Page.name || 'VikePageComponent'
      pageNavCounter++

      const newPageState = { ...(Page.initialState || {}), ...data }
      if (currentApp.sinks?.STATE?.shamefullySendNext) {
        // replace the page slice, keeping every shell slice (G-106, D50)
        currentApp.sinks.STATE.shamefullySendNext((state: any) => ({ ...state, page: newPageState }))
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

      if (initialState && initialState[shell[shell.length - 1]] !== undefined) {
        // Hydrated shell state: sibling slices (D50), or the 5.4.0 shape with the Page state
        // under the innermost shell slice (R2-9) — distribute the slices to each component
        const allShellComps = [...wrappers, ...layouts]
        let pageState = initialState.page
        shell.forEach((key: string, i: number) => {
          let slice = initialState[key]
          if (slice === undefined) return
          if (i === shell.length - 1 && slice && 'page' in slice) {
            const { page, ...rest } = slice
            if (pageState === undefined) pageState = page
            slice = rest
          }
          allShellComps[i].initialState = slice
        })
        Page.initialState = pageState || { ...(Page.initialState || {}), ...data }
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
        currentApp = run(Component, config.drivers || {}, { mountPoint: '#page-view', onError: config.onError }) as any
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
      currentApp = run(Page, config.drivers || {}, { mountPoint: '#page-view', onError: config.onError }) as any
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
