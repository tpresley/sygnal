/**
 * Vike server-side render hook for Sygnal.
 *
 * Renders the Page component to HTML using Sygnal's renderToString,
 * wraps it in a full HTML document, and embeds serialized state for
 * client hydration.
 */

// Import from the package entry so rollup externalizes it
// @ts-ignore — resolved at runtime via package exports
import { renderToString } from 'sygnal'

// Vike provides these at runtime — declare minimal types
declare function escapeInject(
  strings: TemplateStringsArray,
  ...values: any[]
): any
declare function dangerouslySkipEscape(html: string): any

// We import these dynamically to avoid hard dependency at build time
let _escapeInject: typeof escapeInject
let _dangerouslySkipEscape: typeof dangerouslySkipEscape

async function getVikeServerUtils() {
  if (!_escapeInject) {
    const mod = await import('vike/server') as any
    _escapeInject = mod.escapeInject
    _dangerouslySkipEscape = mod.dangerouslySkipEscape
  }
  return { escapeInject: _escapeInject, dangerouslySkipEscape: _dangerouslySkipEscape }
}

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

export async function onRenderHtml(pageContext: PageContext) {
  const { escapeInject, dangerouslySkipEscape } = await getVikeServerUtils()
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
    // Wrap from innermost to outermost
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

  const documentHtml = escapeInject`<!DOCTYPE html>
<html lang="${lang}">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${dangerouslySkipEscape(titleTag)}
    ${dangerouslySkipEscape(descTag)}
    ${dangerouslySkipEscape(faviconTag)}
    ${dangerouslySkipEscape(headContent)}
  </head>
  <body>
    <div id="page-view">${dangerouslySkipEscape(contentHtml)}</div>
  </body>
</html>`

  return {
    documentHtml,
    pageContext: {},
  }
}
