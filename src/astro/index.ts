import sygnalVite from '../vite/plugin'
import { globalThisAlias } from '../vite/globalthis'
import type { DiagnosticsMode, DiagnosticsPluginOptions, CheckPluginOptions } from '../vite/plugin'

const SYGNAL_RENDERER_NAME = '@sygnal/astro'

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
  config?: { vite?: { resolve?: { alias?: any } } };
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
        }

        // Dev mode (G-014): islands are started by sygnal/astro/client, which
        // user code never imports, so the sygnal Vite plugin wraps that entry
        // in dev to set the dev flag and load the runtime checks first. It
        // also runs sygnal-check. `astro build` only gets the `globalthis` alias.
        if (command === 'dev') {
          vite.plugins = [sygnalVite({
            disableJsx: true,
            disableHmr: true,
            vitestSetup: false,
            diagnostics: options.diagnostics,
            check: options.check,
            nativeGlobalThis: options.nativeGlobalThis,
          })]
        } else if (options.nativeGlobalThis !== false) {
          // G-099: the same `globalthis` alias the plugin adds in dev (R2-7: unless the
          // user's vite config already aliases `globalthis`)
          const alias = globalThisAlias(config?.vite?.resolve?.alias)
          if (alias.length) vite.resolve = { alias }
        }

        updateConfig({ vite })
      },
    },
  }
}
