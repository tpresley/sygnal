import sygnalVite from '../vite/plugin'
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
}

export interface SygnalAstroOptions {
  /**
   * Runtime diagnostics in `astro dev`. Islands report in 'warn' mode; 'off'
   * turns them off. ('collect', 'error' and an ignore list need run()'s own
   * option, which the bundled Astro client doesn't take yet.)
   * @default 'warn'
   */
  diagnostics?: DiagnosticsMode | DiagnosticsPluginOptions;
  /** Run sygnal-check in `astro dev` (see the sygnal/vite `check` option). @default true */
  check?: boolean | CheckPluginOptions;
}

export default function sygnalAstroIntegration(options: SygnalAstroOptions = {}) {
  return {
    name: SYGNAL_RENDERER_NAME,
    hooks: {
      'astro:config:setup': ({ addRenderer, updateConfig, command, logger }: AstroConfigSetupArgs) => {
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
        // also runs sygnal-check. Nothing is added to `astro build`.
        if (command === 'dev') {
          const d = options.diagnostics
          const o = typeof d === 'string' ? { mode: d } : d || {}
          if ((o.mode && o.mode !== 'warn' && o.mode !== 'off') || (o.ignore && o.ignore.length)) {
            logger?.warn(`sygnal: with Astro, diagnostics run in 'warn' mode (or 'off'); mode '${o.mode || 'warn'}' and ignore lists are not supported yet`)
          }
          vite.plugins = [sygnalVite({
            disableJsx: true,
            disableHmr: true,
            vitestSetup: false,
            diagnostics: o.mode === 'off' ? 'off' : { mode: 'warn', strict: o.strict },
            check: options.check,
          })]
        }

        updateConfig({ vite })
      },
    },
  }
}
