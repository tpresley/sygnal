/**
 * TypeScript declarations for vike-sygnal custom config settings.
 *
 * These augment Vike's Config interface so users get autocomplete
 * and type checking in their +config.ts files.
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
      /** Enable/disable SSR for this page (default: true). Set false for SPA mode. */
      ssr?: boolean
    }
  }
}

export {}
