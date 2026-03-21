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

  // Merge fetched data into the component's initial state
  const initialState = {
    ...(Page.initialState || {}),
    ...data,
  }

  // Render the page component to HTML
  const pageHtml = renderToString(Page, {
    state: initialState,
    hydrateState: '__VIKE_SYGNAL_STATE__',
  })

  // If Layout(s) are defined, wrap the page HTML
  // Vike's cumulative meta means Layout can be an array (nested layouts)
  let contentHtml = pageHtml
  const layouts = config.Layout
  if (layouts) {
    const layoutArray = Array.isArray(layouts) ? layouts : [layouts]
    for (const Layout of layoutArray) {
      if (typeof Layout === 'function') {
        const layoutHtml = renderToString(Layout, {
          state: Layout.initialState || {},
          props: { innerHTML: contentHtml },
        })
        contentHtml = layoutHtml
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
    <div id="page-view">${contentHtml}</div>
  </body>
</html>`

  // Produce the shape Vike's isDocumentHtml() recognizes: { _escaped: string }
  // This is equivalent to dangerouslySkipEscape(html) from vike/server,
  // but avoids importing vike/server (which isn't resolvable from within
  // node_modules/sygnal/ in Vite's module runner).
  return { documentHtml: { _escaped: documentHtml } }
}
