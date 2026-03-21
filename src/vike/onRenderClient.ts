/**
 * Vike client-side render hook for Sygnal.
 *
 * On first page load (hydration): reads server-serialized state and
 * boots the Sygnal app via run().
 *
 * On client-side navigation: disposes the previous app and boots
 * a fresh one for the new page.
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
  isHydration?: boolean
  config: {
    Layout?: any | any[]
    title?: string
    ssr?: boolean
  }
}

/** Track the running Sygnal app for disposal on navigation */
let currentApp: { dispose: () => void } | null = null

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

  // If Layout(s) exist, create a wrapper component
  const layouts = config.Layout
  let RootComponent = Page

  if (layouts) {
    const layoutArray = Array.isArray(layouts) ? layouts : [layouts]
    // Build wrapper chain: outermost Layout wraps inner Layout wraps Page
    // For client, Layout components need to render children.
    // The simplest approach: Layout receives its content via props.innerHTML
    // and renders it. But for a live client app, we need component nesting.
    //
    // For MVP: run Page directly (Layout is SSR-only document wrapper).
    // Full Layout-as-Sygnal-component support is a post-MVP enhancement
    // since it requires composing independent reactive graphs.
    RootComponent = Page
  }

  // Boot the Sygnal app
  currentApp = run(RootComponent, {}, { mountPoint: '#page-view' })

  // Update document title on client navigation
  if (config.title) {
    document.title = config.title
  }
}
