export type DiagnosticsMode = 'off' | 'collect' | 'warn' | 'error'

export interface DiagnosticsPluginOptions {
  /**
   * Runtime diagnostics mode in dev.
   * @default 'warn'
   */
  mode?: DiagnosticsMode
  /**
   * Strict (canonical-form, SYG5xx) runtime checks: the dev snippet sets
   * `globalThis.__SYGNAL_STRICT__ = true`. Also the default for `check.strict`.
   * @default false
   */
  strict?: boolean
  /** Diagnostic codes to drop, e.g. ['SYG105'] (runtime and static) */
  ignore?: string[]
}

export interface CheckPluginOptions {
  /**
   * Also run sygnal-check's strict (SYG5xx) rules.
   * @default the `diagnostics` strict setting
   */
  strict?: boolean
  /**
   * Files, directories or globs to check, relative to the Vite root.
   * @default ['src']
   */
  include?: string[]
  /**
   * Codes to drop.
   * @default the `diagnostics` ignore list
   */
  ignore?: string[]
  /**
   * Which findings also open Vite's error overlay: 'error' findings only,
   * warnings too ('warn'), or none (false). Every finding is printed in the
   * terminal and logged in the browser console.
   * @default 'error'
   */
  overlay?: 'error' | 'warn' | false
}

export interface SygnalPluginOptions {
  /**
   * Disable automatic JSX configuration.
   * @default false
   */
  disableJsx?: boolean

  /**
   * Disable automatic HMR wiring.
   * @default false
   */
  disableHmr?: boolean

  /**
   * Runtime diagnostics in dev (`vite`, never `vite build`). In every file
   * that imports `run` from 'sygnal' the plugin sets the dev flag and imports
   * 'sygnal/diagnostics' (the runtime checks); the Vike and Astro client
   * entries get the same. 'off' injects nothing. Any other mode than 'warn',
   * or an ignore list, is passed as run()'s `diagnostics` option, unless the
   * run() call sets that option itself.
   * @default 'warn'
   */
  diagnostics?: DiagnosticsMode | DiagnosticsPluginOptions

  /**
   * Run sygnal-check (an optional dependency) in dev on startup and after
   * every source change. Findings go to the terminal and the browser console;
   * errors (or, with `overlay: 'warn'`, warnings) to Vite's error overlay.
   * Skipped silently when sygnal-check isn't installed.
   * @default true
   */
  check?: boolean | CheckPluginOptions

  /**
   * Under Vitest, add the 'sygnal/diagnostics' entry to `test.setupFiles`
   * so tests (e.g. renderComponent) get the runtime checks.
   * @default true
   */
  vitestSetup?: boolean
}

/**
 * Sygnal Vite plugin.
 *
 * Auto-configures the JSX transform and injects HMR boilerplate. In dev
 * (`vite`) it also turns on runtime diagnostics with the dev checks and runs
 * sygnal-check when installed; under Vitest it adds the dev checks to the
 * test setup. Nothing is added to production builds.
 *
 * @example
 * ```js
 * import sygnal from 'sygnal/vite'
 * export default defineConfig({ plugins: [sygnal()] })
 *
 * // stricter dev setup
 * sygnal({ diagnostics: { mode: 'error', strict: true }, check: { overlay: 'warn' } })
 * ```
 */
export default function sygnal(options?: SygnalPluginOptions): {
  name: string
  config: (config: any, env: { command: string }) => any
  configResolved: (config: any) => void
  resolveId: {
    order: 'pre'
    handler: (source: string, importer: string | undefined, options?: any) => Promise<any>
  }
  load: (id: string) => string | null
  configureServer: (server: any) => void
  transform: (code: string, id: string, options?: { ssr?: boolean }) => { code: string; map: any } | null
}
