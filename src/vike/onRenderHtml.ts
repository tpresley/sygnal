/**
 * Vike server-side render hook for Sygnal.
 *
 * Renders the Page component to HTML using Sygnal's renderToString,
 * wraps it in a full HTML document, and embeds serialized state for
 * client hydration.
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

  // Render the page component to HTML, with error boundary
  let pageHtml: string
  try {
    pageHtml = renderToString(Page, {
      state: initialState,
      hydrateState: '__VIKE_SYGNAL_STATE__',
    })
  } catch (err: any) {
    // If the component has an onError boundary, try rendering its fallback
    if (Page.onError) {
      try {
        const fallbackVNode = Page.onError(err, { componentName: Page.name || 'Page' })
        if (fallbackVNode) {
          pageHtml = renderToString(() => fallbackVNode, { state: {} })
          // Still embed the state so the client can attempt hydration
          pageHtml += `<script>window.__VIKE_SYGNAL_STATE__=${JSON.stringify(initialState)}</script>`
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

  // If Layout(s) are defined, render them as static HTML wrapping the page.
  // The Layout is rendered OUTSIDE #page-view so that Sygnal's DOM driver
  // (which replaces the mount point content) doesn't destroy the Layout.
  let layoutBeforeHtml = ''
  let layoutAfterHtml = ''
  const layouts = config.Layout
  if (layouts) {
    const layoutArray = Array.isArray(layouts) ? layouts : [layouts]
    for (const Layout of layoutArray) {
      if (typeof Layout === 'function') {
        // Render the Layout with a placeholder for page content.
        // The Layout view receives { innerHTML: '<!--PAGE-->' } and we split
        // the output around the placeholder to get before/after chunks.
        const PLACEHOLDER = '<!--SYGNAL_PAGE_SLOT-->'
        const layoutHtml = renderToString(Layout, {
          state: Layout.initialState || {},
          props: { innerHTML: PLACEHOLDER },
        })
        const splitIdx = layoutHtml.indexOf(PLACEHOLDER)
        if (splitIdx !== -1) {
          layoutBeforeHtml += layoutHtml.substring(0, splitIdx)
          layoutAfterHtml = layoutHtml.substring(splitIdx + PLACEHOLDER.length) + layoutAfterHtml
        } else {
          // Fallback: Layout didn't use innerHTML, render it before page content
          layoutBeforeHtml += layoutHtml
        }
      }
    }
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
    ${layoutBeforeHtml}
    <div id="page-view">${pageHtml}</div>
    ${layoutAfterHtml}
  </body>
</html>`

  // Produce the shape Vike's isDocumentHtml() recognizes: { _escaped: string }
  // This is equivalent to dangerouslySkipEscape(html) from vike/server,
  // but avoids importing vike/server (which isn't resolvable from within
  // node_modules/sygnal/ in Vite's module runner).
  return { documentHtml: { _escaped: documentHtml } }
}
