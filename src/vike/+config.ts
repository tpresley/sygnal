/**
 * Vike extension config for Sygnal.
 *
 * Usage in your project's +config.ts:
 *
 *   import vikeSygnal from 'sygnal/vike'
 *   export default { extends: [vikeSygnal] }
 */

export default {
  name: 'sygnal',
  clientRouting: true,
  hydrationCanBeAborted: true,

  onRenderHtml: 'import:sygnal/vike/onRenderHtml:onRenderHtml',
  onRenderClient: 'import:sygnal/vike/onRenderClient:onRenderClient',

  // urlPathname is not listed: Vike provides it on the client with Client
  // Routing, and listing it logs a warning in the browser (G-046)
  // PLAN-3 5-5 (H-7): queryCache, a loader's cache snapshot (see onRenderHtml)
  passToClient: ['data', 'routeParams', 'queryCache'],

  meta: {
    Layout: {
      env: { server: true, client: true },
      cumulative: true,
    },
    Wrapper: {
      env: { server: true, client: true },
      cumulative: true,
    },
    Head: {
      env: { server: true },
    },
    title: {
      env: { server: true, client: true },
    },
    description: {
      env: { server: true },
    },
    favicon: {
      env: { server: true },
      global: true,
    },
    lang: {
      env: { server: true, client: true },
    },
    drivers: {
      env: { client: true },
    },
    // PLAN-4 GS-11: run()'s / renderToString's app-level error hook
    onError: {
      env: { server: true, client: true },
    },
    ssr: {
      env: { config: true },
      effect({ configDefinedAt, configValue }: { configDefinedAt: string; configValue: unknown }) {
        if (typeof configValue !== 'boolean') {
          throw new Error(`${configDefinedAt} should be a boolean`)
        }
        if (configValue === false) {
          return {
            meta: {
              ssr: { env: { server: true, client: true } },
            },
          }
        }
        return {}
      },
    },
  },
}
