/**
 * Vike client-side render hook for Sygnal.
 *
 * On first page load (hydration): reads server-serialized state and
 * boots the Sygnal app via run().
 *
 * On client-side navigation: disposes the previous app and boots
 * a fresh one for the new page.
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
let currentApp: { dispose: () => void } | null = null

/**
 * Create a synthetic wrapper component that nests Page inside Layout(s).
 *
 * The wrapper's view renders the outermost Layout with the Page as a child.
 * Nested layouts are composed from outside-in: [LayoutA, LayoutB] renders
 * as LayoutA > LayoutB > Page.
 *
 * Layout components become real interactive sub-components in the reactive
 * graph — their intent, model, and context all work normally.
 */
function createLayoutWrapper(layouts: any[], Page: any): any {
  // Build vnodes that match what the JSX pragma produces for function components.
  // The pragma extracts static properties into sygnalOptions and sets sel to a string name.
  // We must replicate this since this file is .ts (no JSX) and builds vnodes by hand.
  function componentVNode(comp: any, stateField: string, children: any[]): any {
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
            initialState: comp.initialState,
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

  function LayoutWrapperView({ state }: any) {
    // Start with the Page component as the innermost child
    let inner: any = componentVNode(Page, 'page', [])

    // Wrap inside each layout from innermost to outermost
    for (let i = layouts.length - 1; i >= 0; i--) {
      inner = componentVNode(layouts[i], 'layout_' + i, [inner])
    }

    return inner
  }

  LayoutWrapperView.componentName = 'VikeLayoutWrapper'

  // The wrapper's state holds both layout and page state in separate fields.
  // Each sub-component accesses its slice via the `state` prop.
  const wrapperInitialState: any = {
    page: Page.initialState || {},
  }
  layouts.forEach((Layout: any, i: number) => {
    wrapperInitialState['layout_' + i] = Layout.initialState || {}
  })

  LayoutWrapperView.initialState = wrapperInitialState

  // Propagate context from the Page (which has pageData, routeParams, etc.)
  // and merge context from all Layouts
  const mergedContext: any = {}
  layouts.forEach((Layout: any) => {
    if (Layout.context) {
      Object.assign(mergedContext, Layout.context)
    }
  })
  if (Page.context) {
    Object.assign(mergedContext, Page.context)
  }
  LayoutWrapperView.context = mergedContext

  return LayoutWrapperView
}

export function onRenderClient(pageContext: PageContext) {
  const { Page, config } = pageContext
  const data = pageContext.data || {}

  // Dispose previous app on client-side navigation
  if (currentApp) {
    currentApp.dispose()
    currentApp = null
  }

  // On first load with SSR, pick up server-serialized state.
  // On client navigation (or SPA mode), merge data into initialState.
  let initialState: any
  if (typeof window !== 'undefined' && window.__VIKE_SYGNAL_STATE__ !== undefined) {
    initialState = window.__VIKE_SYGNAL_STATE__
    // Clear the global after reading to avoid stale state on soft navigation
    delete window.__VIKE_SYGNAL_STATE__
  } else {
    initialState = {
      ...(Page.initialState || {}),
      ...data,
    }
  }

  // Set the initial state on the component before running
  Page.initialState = initialState

  // Inject page data, route params, and URL into the component's context
  // so sub-components can access them without prop drilling.
  // Context functions receive state but return static values per navigation.
  Page.context = {
    ...Page.context,
    pageData: () => data,
    routeParams: () => pageContext.routeParams || {},
    urlPathname: () => pageContext.urlPathname || '',
  }

  // Determine the component to run and the mount point
  let Component: any
  let mountPoint: string

  const layouts = config.Layout
    ? (Array.isArray(config.Layout) ? config.Layout : [config.Layout])
      .filter((L: any) => typeof L === 'function')
    : []

  if (layouts.length > 0) {
    // Layout present: create a wrapper that composes Layout(s) + Page
    // Mount to #page-view which now contains both Layout and Page HTML
    Component = createLayoutWrapper(layouts, Page)
    mountPoint = '#page-view'
  } else {
    // No Layout: run Page directly as before
    Component = Page
    mountPoint = '#page-view'
  }

  try {
    currentApp = run(Component, {}, { mountPoint })
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

  // Update document title on client navigation
  if (config.title) {
    document.title = config.title
  }
}
