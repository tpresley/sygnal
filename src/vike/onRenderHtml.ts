/**
 * Vike server-side render hook for Sygnal.
 *
 * Renders the Page component to HTML using Sygnal's renderToString,
 * wraps it in a full HTML document, and embeds serialized state for
 * client hydration.
 *
 * When a Layout is configured, the Layout HTML wraps the Page HTML
 * inside #page-view so the structure matches the client-side wrapper
 * component (see onRenderClient.ts).
 *
 * Returns a plain HTML string. Vike wraps it with dangerouslySkipEscape
 * automatically. We avoid importing from vike/server because our bundled
 * output lives in node_modules/sygnal/ where vike isn't resolvable.
 */

// @ts-ignore — resolved at runtime via package exports
import { renderToString } from 'sygnal'

interface PageContext {
  Page: any
  data?: any
  routeParams?: Record<string, string>
  urlPathname?: string
  config: {
    Layout?: any | any[]
    Head?: any
    title?: string
    description?: string
    favicon?: string
    lang?: string
    ssr?: boolean
  }
  is404?: boolean
}

/**
 * Escape a string for use in HTML attributes/text.
 */
function esc(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function onRenderHtml(pageContext: PageContext) {
  const { Page, config } = pageContext
  const data = pageContext.data || {}

  // SPA mode: return empty shell, let the client render everything
  if (config.ssr === false) {
    const lang = config.lang || 'en'
    const title = config.title || ''
    const titleTag = title ? `<title>${esc(title)}</title>` : ''

    const spaHtml = `<!DOCTYPE html>
<html lang="${lang}">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${titleTag}
  </head>
  <body>
    <div id="page-view"></div>
  </body>
</html>`
    return { documentHtml: { _escaped: spaHtml } }
  }

  // Merge fetched data into the component's initial state
  const initialState = {
    ...(Page.initialState || {}),
    ...data,
  }

  // Inject page data, route params, and URL into the component's context
  // so sub-components can access them without prop drilling during SSR.
  Page.context = {
    ...Page.context,
    pageData: () => data,
    routeParams: () => pageContext.routeParams || {},
    urlPathname: () => pageContext.urlPathname || '',
  }

  // Determine if Layout(s) are present — this affects hydration state shape
  const layoutArray = config.Layout
    ? (Array.isArray(config.Layout) ? config.Layout : [config.Layout])
        .filter((L: any) => typeof L === 'function')
    : []
  const hasLayouts = layoutArray.length > 0

  // Render the page component to HTML, with error boundary.
  // When layouts are present, the hydration state is serialized separately
  // as the wrapper's combined state (with page + layout slices).
  let pageHtml: string
  try {
    pageHtml = renderToString(Page, {
      state: initialState,
      hydrateState: hasLayouts ? false : '__VIKE_SYGNAL_STATE__',
    })
  } catch (err: any) {
    // If the component has an onError boundary, try rendering its fallback
    if (Page.onError) {
      try {
        const fallbackVNode = Page.onError(err, { componentName: Page.name || 'Page' })
        if (fallbackVNode) {
          pageHtml = renderToString(() => fallbackVNode, { state: {} })
          if (!hasLayouts) {
            pageHtml += `<script>window.__VIKE_SYGNAL_STATE__=${JSON.stringify(initialState)}</script>`
          }
        } else {
          pageHtml = `<div data-sygnal-error>Render error</div>`
        }
      } catch (_) {
        pageHtml = `<div data-sygnal-error>Render error</div>`
      }
    } else {
      console.error('[sygnal/vike] SSR render error:', err)
      pageHtml = `<div data-sygnal-error><!-- SSR render error: ${esc(String(err.message || err))} --></div>`
    }
  }

  // If Layout(s) are defined, render them wrapping the page content.
  // Layout HTML is rendered INSIDE #page-view so the structure matches the
  // client-side wrapper component that composes Layout + Page in a single
  // reactive graph. Each Layout receives page content via a placeholder
  // in its children slot.
  let pageViewContent = pageHtml
  if (hasLayouts) {
    // Wrap from innermost to outermost (reverse order)
    for (let i = layoutArray.length - 1; i >= 0; i--) {
      const Layout = layoutArray[i]
      const PLACEHOLDER = '<!--SYGNAL_PAGE_SLOT-->'
      const layoutHtml = renderToString(Layout, {
        state: Layout.initialState || {},
        props: { innerHTML: PLACEHOLDER },
      })
      const splitIdx = layoutHtml.indexOf(PLACEHOLDER)
      if (splitIdx !== -1) {
        pageViewContent = layoutHtml.substring(0, splitIdx) + pageViewContent + layoutHtml.substring(splitIdx + PLACEHOLDER.length)
      } else {
        // Fallback: Layout didn't use children/innerHTML, wrap page content after it
        pageViewContent = layoutHtml + pageViewContent
      }
    }

    // Serialize the wrapper's combined state for hydration.
    // The client-side createLayoutWrapper nests page state inside the
    // innermost layout's slice:
    //   { layout_0: { ...layoutState, page: pageState } }
    const wrapperState: any = {}
    layoutArray.forEach((Layout: any, i: number) => {
      const layoutState: any = { ...(Layout.initialState || {}) }
      if (i === layoutArray.length - 1) {
        layoutState.page = initialState
      }
      wrapperState['layout_' + i] = layoutState
    })
    pageViewContent += `<script>window.__VIKE_SYGNAL_STATE__=${JSON.stringify(wrapperState)}</script>`
  }

  // Render Head component for <head> tags
  let headContent = ''
  if (config.Head && typeof config.Head === 'function') {
    try {
      headContent = renderToString(config.Head, { state: initialState })
    } catch (_) {
      // Head rendering failure is non-fatal
    }
  }

  const title = config.title || ''
  const description = config.description || ''
  const favicon = config.favicon || ''
  const lang = config.lang || 'en'

  const titleTag = title ? `<title>${esc(title)}</title>` : ''
  const descTag = description
    ? `<meta name="description" content="${esc(description)}">`
    : ''
  const faviconTag = favicon
    ? `<link rel="icon" href="${esc(favicon)}">`
    : ''

  const documentHtml = `<!DOCTYPE html>
<html lang="${lang}">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${titleTag}
    ${descTag}
    ${faviconTag}
    ${headContent}
  </head>
  <body>
    <div id="page-view">${pageViewContent}</div>
  </body>
</html>`

  // Produce the shape Vike's isDocumentHtml() recognizes: { _escaped: string }
  // This is equivalent to dangerouslySkipEscape(html) from vike/server,
  // but avoids importing vike/server (which isn't resolvable from within
  // node_modules/sygnal/ in Vite's module runner).
  return { documentHtml: { _escaped: documentHtml } }
}
