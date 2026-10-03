import type { DiagnosticsMode, DiagnosticsPluginOptions, CheckPluginOptions } from '../vite/plugin.d'

declare type SygnalAstroIntegration = {
  name: string;
  hooks: {
    'astro:config:setup': (args: {
      addRenderer: (renderer: {
        name: string;
        clientEntrypoint: string;
        serverEntrypoint: string;
      }) => void;
      updateConfig: (config: any) => void;
      command?: 'dev' | 'build' | 'preview' | 'sync';
      logger?: { warn: (message: string) => void };
    }) => void;
  };
};

export interface SygnalAstroOptions {
  /**
   * Runtime diagnostics for islands in `astro dev`: a mode ('warn',
   * 'collect', 'error' or 'off') or { mode, strict, ignore }, the same as
   * the sygnal/vite `diagnostics` option.
   * @default 'warn'
   */
  diagnostics?: DiagnosticsMode | DiagnosticsPluginOptions;
  /**
   * Run sygnal-check in `astro dev` (see the sygnal/vite `check` option).
   * @default true
   */
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
}

/**
 * Sygnal Astro integration. In `astro dev` it also adds the sygnal Vite
 * plugin, which turns on runtime diagnostics for islands and runs sygnal-check.
 */
export default function sygnalAstroIntegration(options?: SygnalAstroOptions): SygnalAstroIntegration;
