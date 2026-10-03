/**
 * TypeScript declarations for 'sygnal/config' (also 'sygnal/vike' and
 * 'sygnal/vike/config'): the Vike extension config (default export), and the
 * custom config settings, which augment Vike's Config interface so users get
 * autocomplete and type checking in their +config.ts files.
 *
 *   import vikeSygnal from 'sygnal/config'
 *   export default { extends: [vikeSygnal] }
 */

declare global {
  namespace Vike {
    interface Config {
      /** Sygnal component to wrap all pages (receives children) */
      Layout?: any
      /** Sygnal component wrapping Layout + Page (for context providers, state management). Cumulative. */
      Wrapper?: any
      /** Sygnal component rendered inside <head> for per-page meta tags */
      Head?: any
      /** Page <title> */
      title?: string
      /** <meta name="description"> */
      description?: string
      /** Path to favicon */
      favicon?: string
      /** <html lang="..."> attribute (default: "en") */
      lang?: string
      /** Additional Cycle.js drivers to pass to run() (e.g. WebSocket, HTTP). Client-only. */
      drivers?: Record<string, (sink: any) => any>
      /**
       * App-level error hook (PLAN-4 GS-11), passed to run() on the client and to renderToString
       * on the server: called after a component's onError boundary, reporting only. (Vike's own
       * `onError` is a different, server-only hook)
       */
      sygnalOnError?: (error: any, info: { componentName?: string; action?: string; phase: 'view' | 'reducer' | 'effect' | 'declaration' | 'driver' | 'instantiate' | 'widget'; driver?: string }) => void
      /** Enable/disable SSR for this page (default: true). Set false for SPA mode. */
      ssr?: boolean
    }
  }
}

/**
 * The Sygnal extension for Vike: put it in `extends` of your root +config.
 * (Declared here; the value is the package's dist/vike/config/+config.js entry.)
 */
declare const vikeSygnal: {
  name: 'sygnal'
  clientRouting: boolean
  hydrationCanBeAborted: boolean
  onRenderHtml: string
  onRenderClient: string
  passToClient: string[]
  meta: Record<string, any>
}

export default vikeSygnal
