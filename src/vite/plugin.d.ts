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
   * By default the existing ones of src/, pages/ and renderer/ (Vike apps),
   * else the project root (node_modules, dist and other build output are
   * skipped); a one-time notice is logged when the default finds no
   * directory or when none of the given paths exists.
   * @default ['src', 'pages', 'renderer'] (those that exist), else ['.']
   */
  include?: string[]
  /**
   * Codes to drop.
   * @default the `diagnostics` ignore list
   */
  ignore?: string[]
  /**
   * Error-severity findings also open Vite's error overlay ('error');
   * false: never. Every finding is printed in the terminal and logged in the
   * browser console (sygnal-check's codes are currently all warnings or
   * info, so in practice that is where they go). Warnings never use the
   * overlay, because Vite's client reloads the page on the next HMR update
   * while an overlay is open: 'warn' is still accepted, and treated as
   * 'error' with a one-time notice. The overlay is sent only to the page that
   * loads (not to every client), closed before each HMR update and sent
   * again after the re-check.
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
   * entries get the same. 'off' injects none of it (DevTools: see `devtools`). Any other mode than 'warn',
   * or an ignore list, is passed as run()'s `diagnostics` option, unless the
   * run() call sets that option itself.
   * @default 'warn'
   */
  diagnostics?: DiagnosticsMode | DiagnosticsPluginOptions

  /**
   * Run sygnal-check (an optional dependency) in dev on startup and after
   * every source change. Findings go to the terminal and the browser console;
   * error-severity findings also to Vite's error overlay.
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

  /**
   * Resolve xstream's `globalthis` dependency to a tiny stub that returns the
   * native `globalThis`, instead of the npm polyfill and its dependency chain
   * (~4 KB gzip), in dev, build and Vitest (a `resolve.alias`; every
   * dependency's `globalthis` import gets the stub). Not added when your own
   * `resolve.alias` already maps `globalthis`. false: keep the original package.
   * @default true
   */
  nativeGlobalThis?: boolean

  /**
   * In dev (`vite`, never `vite build` or Vitest), import 'sygnal/devtools' in the
   * same files as the diagnostics snippet. It installs the DevTools bridge
   * (`window.__SYGNAL_DEVTOOLS__`) for the browser extension. Production builds
   * never contain it. false: not injected. `{ redux: true }` also sends the actions and the
   * root's state to the Redux DevTools extension (connectReduxDevtools() from 'sygnal/devtools').
   * @default true
   */
  devtools?: boolean | { redux?: boolean }

  /**
   * Serve an MCP endpoint at `/__sygnal/mcp` on the dev server (streamable HTTP; requests from
   * this machine with a local Host / Origin only), so a coding agent can read and drive the
   * running apps in the open page: get_state, dispatch, component_tree, recent_actions,
   * get_diagnostics, copy_as_test, agent_tools, apps, tabs, and sygnal-check's check / graph /
   * explain when it is installed. Every run() app of the page is served (`app` picks one).
   * MCP revisions 2026-07-28 (stateless) and 2024-11-05 … 2025-11-25 (initialize); answers are
   * application/json (no SSE stream, no sessions). Dev server only; it also loads
   * 'sygnal/devtools' in the page.
   * @default false
   */
  mcp?: boolean | McpPluginOptions
}

export interface McpPluginOptions {
  /** ms to wait for the page's answer (an open confirm dialog extends it to 5 minutes) @default 10000 */
  timeout?: number
  /**
   * Consequential agent tools called with agent_tools: 'page' asks the person in the page
   * (window.confirm), true runs them, false declines them.
   * @default 'page'
   */
  confirm?: boolean | 'page'
}

/**
 * Sygnal Vite plugin.
 *
 * Auto-configures the JSX transform and injects HMR boilerplate. In dev
 * (`vite`) it also installs the DevTools bridge, turns on runtime diagnostics
 * with the dev checks and runs sygnal-check when installed; under Vitest it adds the dev checks to the
 * test setup. Nothing is added to production builds.
 *
 * @example
 * ```js
 * import sygnal from 'sygnal/vite'
 * export default defineConfig({ plugins: [sygnal()] })
 *
 * // stricter dev setup
 * sygnal({ diagnostics: { mode: 'error', strict: true }, check: { strict: true } })
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
