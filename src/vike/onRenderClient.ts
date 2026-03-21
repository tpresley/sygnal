/**
 * Vike client-side render hook for Sygnal.
 *
 * On first page load (hydration): reads server-serialized state and
 * boots the Sygnal app via run().
 *
 * On client-side navigation: disposes the previous app and boots
 * a fresh one for the new page.
 *
 * Layout is rendered outside #page-view by onRenderHtml, so it persists
 * across navigations without being destroyed by Sygnal's DOM driver.
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

  // Boot the Sygnal app into #page-view
  // Layout HTML lives outside #page-view, so it won't be destroyed
  try {
    currentApp = run(Page, {}, { mountPoint: '#page-view' })
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
