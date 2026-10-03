import sygnalVite from '../vite/plugin'
import { globalThisAlias } from '../vite/globalthis'
import type { DiagnosticsMode, DiagnosticsPluginOptions, CheckPluginOptions } from '../vite/plugin'
// Node built-ins (the integration runs in Node). The package has no @types/node.
// @ts-ignore
import path from 'node:path'
// @ts-ignore
import { fileURLToPath } from 'node:url'

const SYGNAL_RENDERER_NAME = '@sygnal/astro'

// PLAN-4 GS-11 / D120: both island entries import this; it re-exports the default export of the
// module the `onError` option names (undefined without it)
const ON_ERROR_ID = 'virtual:sygnal/astro-on-error'

/** The Vite plugin serving ON_ERROR_ID; `file` is absolute (undefined: no hook) */
function onErrorPlugin(file?: string) {
  return {
    name: 'sygnal:astro-on-error',
    resolveId: (id: string) => id === ON_ERROR_ID ? '\0' + ON_ERROR_ID : undefined,
    load: (id: string) => id === '\0' + ON_ERROR_ID
      ? (file ? `export { default } from ${JSON.stringify(file)}` : 'export default undefined')
      : undefined,
    // Vite 6+ (Astro 6 renders in its own 'prerender' / 'ssr' environments): the island server
    // entry imports the virtual module, so Vite must load it (not Node). `ssr.noExternal`
    // below covers the 'ssr' environment and older Vite
    configEnvironment: (name: string) => name === 'client' ? undefined : { resolve: { noExternal: ['sygnal'] } },
  }
}

/** The project root as a directory path (Astro gives a file: URL) */
const rootDir = (root: any): string =>
  // @ts-ignore — Node's process
  !root ? process.cwd() : typeof root === 'string' ? root : fileURLToPath(root)

interface AstroRenderer {
  name: string;
  clientEntrypoint: string;
  serverEntrypoint: string;
}

interface AstroConfigSetupArgs {
  addRenderer: (renderer: AstroRenderer) => void;
  updateConfig: (config: any) => void;
  command?: 'dev' | 'build' | 'preview' | 'sync';
  logger?: { warn: (message: string) => void };
  config?: { root?: URL | string; vite?: { resolve?: { alias?: any } } };
}

export interface SygnalAstroOptions {
  /**
   * Runtime diagnostics for islands in `astro dev`: a mode or
   * { mode, strict, ignore }, the same as the sygnal/vite `diagnostics`
   * option (the island client shares the app's core, B-019).
   * @default 'warn'
   */
  diagnostics?: DiagnosticsMode | DiagnosticsPluginOptions;
  /** Run sygnal-check in `astro dev` (see the sygnal/vite `check` option). @default true */
  check?: boolean | CheckPluginOptions;
  /**
   * Resolve xstream's `globalthis` dependency to a stub returning the native
   * `globalThis` (see the sygnal/vite `nativeGlobalThis` option), in
   * `astro dev` and `astro build`. false: keep the polyfill package.
   * @default true
   */
  nativeGlobalThis?: boolean;
  /**
   * Install the DevTools bridge for islands in `astro dev` (see the sygnal/vite
   * `devtools` option). Never in `astro build`.
   * @default true
   */
  devtools?: boolean;
  /**
   * PLAN-4 GS-11: the islands' app-level error hook: the path of a module (relative to the Astro
   * project root) whose default export is called as run()'s / renderToString's `onError`
   * (error, { componentName, action, phase }), in the browser and during SSR. Reporting only,
   * after a component's onError boundary chose the fallback.
   * @example sygnal({ onError: './src/onError.js' })
   */
  onError?: string;
}

export default function sygnalAstroIntegration(options: SygnalAstroOptions = {}) {
  return {
    name: SYGNAL_RENDERER_NAME,
    hooks: {
      'astro:config:setup': ({ addRenderer, updateConfig, command, config }: AstroConfigSetupArgs) => {
        addRenderer({
          name: SYGNAL_RENDERER_NAME,
          clientEntrypoint: 'sygnal/astro/client',
          serverEntrypoint: 'sygnal/astro/server',
        })

        const vite: any = {
          esbuild: {
            jsx: 'automatic',
            jsxImportSource: 'sygnal',
          },
          // D120: the island entries import the virtual onError module, so they stay on Vite:
          // not pre-bundled with it, and not externalized (loaded by Node) during SSR
          optimizeDeps: { exclude: [ON_ERROR_ID] },
          ssr: { noExternal: ['sygnal'] },
        }
        const hook = options.onError ? path.resolve(rootDir(config?.root), options.onError) : undefined

        // Dev mode (G-014): islands are started by sygnal/astro/client, which
        // user code never imports, so the sygnal Vite plugin wraps that entry
        // in dev to install DevTools, set the dev flag and load the runtime checks first. It
        // also runs sygnal-check. `astro build` only gets the `globalthis` alias.
        if (command === 'dev') {
          vite.plugins = [sygnalVite({
            disableJsx: true,
            disableHmr: true,
            vitestSetup: false,
            diagnostics: options.diagnostics,
            check: options.check,
            nativeGlobalThis: options.nativeGlobalThis,
            devtools: options.devtools,
          })]
        } else if (options.nativeGlobalThis !== false) {
          // G-099: the same `globalthis` alias the plugin adds in dev (R2-7: unless the
          // user's vite config already aliases `globalthis`)
          const alias = globalThisAlias(config?.vite?.resolve?.alias)
          if (alias.length) vite.resolve = { alias }
        }

        vite.plugins = [...(vite.plugins || []), onErrorPlugin(hook)]

        updateConfig({ vite })
      },
    },
  }
}
