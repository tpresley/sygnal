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

  passToClient: ['data', 'routeParams', 'urlPathname'],

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
