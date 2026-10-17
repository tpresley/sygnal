/**
 * Sygnal Vite Plugin
 *
 * Auto-configures JSX, wires up HMR with state preservation and, in dev,
 * turns on Sygnal's diagnostics (runtime checks and the static checker).
 * Nothing it adds in dev reaches a production build.
 *
 * Usage:
 *   import sygnal from 'sygnal/vite'
 *   export default defineConfig({ plugins: [sygnal()] })
 *
 * What it does:
 *   1. Configures the automatic JSX transform with sygnal as the import source:
 *      `oxc` (Vite 8), plus `esbuild` under Vite 7 and older
 *   2. Detects files that call `run()` from sygnal and auto-injects HMR wiring.
 *      A module that calls `defineElement()` from 'sygnal/element' at the top level
 *      (and doesn't import run()) gets `if (import.meta.hot) import.meta.hot.accept()`
 *      appended: re-running it swaps the elements' component, keeping their state
 *   3. Dev mode (`vite` / `vite dev` only; never `vite build`). Into every
 *      file that imports `run` from sygnal (including entries with manual HMR
 *      wiring or `disableHmr`) it inserts, on an existing line:
 *
 *        if (globalThis.__SYGNAL_DEV__ === undefined) globalThis.__SYGNAL_DEV__ = true;
 *        import 'sygnal/diagnostics';import 'virtual:sygnal/dev';
 *
 *      The flag turns on runtime diagnostics in 'warn' mode; 'sygnal/diagnostics'
 *      registers the runtime checks (SYG101-106, 201, 202, 301, 401, ...);
 *      'virtual:sygnal/dev' logs static-check results in the browser console
 *      (see 5). With `diagnostics: { strict: true }` the snippet also sets
 *      `globalThis.__SYGNAL_STRICT__ = true` (same guard), which turns on the
 *      strict (SYG5xx) runtime checks of 'sygnal/diagnostics'. The snippet goes
 *      after any shebang line and directive prologue ('use strict',
 *      'use client'); line numbers are unchanged and the transform returns a
 *      sourcemap. Opt out per app with `run(App, drivers, { diagnostics: 'off' })`
 *      or for the whole dev server with `sygnal({ diagnostics: 'off' })`.
 *   4. `diagnostics` option. The runtime core only understands
 *      `__SYGNAL_DEV__ === true` ('warn'), so another mode or an ignore list
 *      is passed as run()'s own `diagnostics` option: imports of 'sygnal'
 *      from the entry files above resolve to a dev-only wrapper module
 *      ('\0sygnal-dev:runtime') that re-exports sygnal with a run() that adds
 *      `diagnostics: { mode, ignore }` unless the call sets `diagnostics`
 *      itself. With the default ('warn', no ignore list) there is no wrapper.
 *   5. `check` option: runs sygnal-check (an optional dependency, loaded
 *      lazily from the project) over `include` when the dev server starts and
 *      again after every source file change. Settings, highest first: the
 *      explicit `check.*` options; the project's sygnal-check config file
 *      (sygnal-check.config.json or the package.json "sygnal-check" key, read
 *      by sygnal-check itself, PLAN-7 C-5 / D299; JSON only, so the editor and
 *      the CLI see the same settings without evaluating vite.config); then
 *      `strict` from `diagnostics.strict`, `ignore` from `diagnostics.ignore`,
 *      and `include` from the existing ones of src/, pages/ and renderer/,
 *      else the project root (with a notice). An older sygnal-check without
 *      config support (no `loadConfig` export) gets exactly the options it got
 *      before: the explicit ones over the `diagnostics` defaults. With config
 *      support a change to the config file also re-checks (`include` is fixed
 *      when the server starts). Results go to
 *      the terminal in sygnal-check's format, and to the browser as a
 *      'sygnal:check' HMR event that the dev client ('virtual:sygnal/dev')
 *      logs with console.warn (non-disruptive). The dev client asks for the
 *      current findings when the page loads ('sygnal:check:request'), and only
 *      that client is answered; after a source change the new findings go to
 *      every connected client, and only when they changed. Error-severity
 *      findings also open Vite's error overlay (`overlay: false`: never):
 *      SYG112, SYG124, SYG125, SYG128, SYG405 and the checker's other
 *      error-severity codes. The a11y lane SYG701-708 is a warning, also
 *      under `diagnostics.strict` (D144, amending D111); `check.a11y: 'error'`
 *      makes it an error (and opens the overlay). Without that opt-in a 7xx
 *      finding never opens the overlay, even from an older sygnal-check that
 *      reports it as an error under strict. Everything else is a warning or
 *      info and goes to the console. Warnings never use the overlay: while
 *      one is open Vite's client reloads the page on the next HMR update
 *      (`overlay: 'warn'` is treated as 'error', with a notice). The dev
 *      client closes a sygnal-check overlay before each update, and the
 *      server sends it again after the re-check, so it never causes a reload
 *      and doesn't go stale. A missing sygnal-check is skipped silently; a
 *      checker that throws only logs a warning.
 *   6. Vitest (process.env.VITEST): appends the package's 'sygnal/diagnostics'
 *      ESM file to `test.setupFiles` (merged with a string or array value;
 *      not added twice), so renderComponent tests get the runtime checks.
 *      Its directory is added to the resolved `server.fs.allow` (G-050):
 *      in jsdom / happy-dom environments Vitest loads setup files through
 *      Vite's /@fs/ URLs, which a linked sygnal outside the workspace would
 *      otherwise fail. Opt out with `vitestSetup: false`. Under Vitest the transform adds
 *      nothing (no flags, HMR wiring, run() wrapper, dev client or checker):
 *      a __SYGNAL_DEV__ / __SYGNAL_STRICT__ flag set by one test file would
 *      leak into later test files of the same worker, and renderComponent()
 *      manages the diagnostics modes itself.
 *   7. Vike and Astro (G-014): the app is started by sygnal's own client
 *      entry, which user code doesn't import. Client-side imports of
 *      'sygnal/vike/onRenderClient' resolve to a dev wrapper that sets the
 *      flag and loads the checks first. That entry is excluded from
 *      pre-bundling in dev (B-020), so it shares the pages' core. Astro resolves its renderer entry on
 *      the server and the browser loads the file itself, so the same snippet
 *      is added to sygnal's 'astro/client' file by the transform. That file
 *      imports the public 'sygnal' entry (one shared core, B-019), so its
 *      'sygnal' import gets the run() wrapper too: every `diagnostics` mode
 *      and ignore list works for islands. The sygnal/astro integration adds
 *      this plugin in `astro dev`.
 *   8. `nativeGlobalThis` (G-099, default true): a `resolve.alias` from
 *      `globalthis` (xstream's `require('globalthis').getPolyfill()`) to the
 *      package's dist/shims/globalthis.cjs, which returns the native
 *      globalThis. Drops the polyfill chain (~4 KB gzip) from every bundle,
 *      in dev (including pre-bundling), build and Vitest. Dependencies left
 *      external (SSR, Vitest) still load the real package from Node. The
 *      sygnal/astro integration adds the same alias in `astro build`. Any
 *      dependency's `require('globalthis')` gets the stub; a `globalthis`
 *      entry in the user's own `resolve.alias` wins (R2-7).
 *   9. `devtools` option (D77, default true): in dev the same files (run()
 *      importers, the Vike wrapper, the Astro client) also get
 *      `import 'sygnal/devtools';`, first, which installs the DevTools bridge
 *      (window.__SYGNAL_DEVTOOLS__) for the browser extension. Independent of
 *      `diagnostics` ('off' still injects it). Never in `vite build` or under
 *      Vitest: production builds carry no DevTools code. `devtools: false`
 *      injects nothing. PLAN-4 3-E: `devtools: { redux: true }` also calls
 *      connectReduxDevtools() (actions + state to the Redux DevTools extension).
 *  10. `mcp` option (PLAN-6 E-1, default false): the dev server serves an MCP endpoint at
 *      /__sygnal/mcp (./mcp.ts: streamable HTTP, loopback / local Host / local Origin only)
 *      and the dev entries also import 'virtual:sygnal/mcp', which connects the page over the
 *      HMR channel (installMcpBridge from 'sygnal/devtools'). Never in `vite build` or Vitest.
 *  11. SYG103 view words (dev server with diagnostics on; never `vite build`, SSR or Vitest): a
 *      module that sets `X.intent` or `X.uses` gets a tail registering, for each such X, the
 *      words of its string literals and of the relative modules it imports, in
 *      `globalThis.__SYGNAL_VIEW_TOKENS__`. The runtime SYG103 check then takes a selector drawn
 *      by a view helper (`{state.open && panel()}`) as conditionally rendered, as it does for
 *      markup in the view function itself (see viewTokensTail).
 *  12. `graph` option (PLAN-10 W-2 / P-2, D543 / D544, default true; dev server only, never
 *      `vite build`, `vite preview` or Vitest): the live app graph page at /__sygnal/graph, with
 *      its SSE stream at /__sygnal/graph/events (./graph.ts; the /__sygnal/mcp guard: loopback
 *      peer, local Host or server.allowedHosts, local Origin). sygnal-check (from the project,
 *      skipped silently when missing; a sygnal-check without the page keeps the checker as in 5)
 *      builds it with createLiveProject on start and after each change: one build gives the page,
 *      the check overlay / console findings of 5, and the component stamps. Its URL is printed
 *      under Vite's ("➜  Sygnal graph: http://localhost:5173/__sygnal/graph"; without a sygnal-check
 *      0.10.0+ in the project, a line saying so instead). The modules of the
 *      scanned files get a tail setting a non-enumerable `__sygnalKey` (the static 'file#name'
 *      key, D521) on each top-level component function, which the runtime inspect() reports as
 *      `key`; with DevTools on, the dev entries also import 'virtual:sygnal/graph'
 *      (installGraphBridge from 'sygnal/devtools'), which answers the page's "Live data" over a
 *      same-origin BroadcastChannel: the page fades components with no instance, shows instance
 *      counts, flashes a card when its action runs and shows an instance's state. `graph: false`:
 *      no route, stamps or bridge (the checker of 5 runs check() as before).
 *
 * Why not Vite's `define`? Vite's dependency optimizer does not apply user
 * `define` replacements to pre-bundled dependencies (only process.env.NODE_ENV),
 * so a `define` would never reach sygnal's own code when sygnal is pre-bundled.
 * Vite's client does copy `define` entries onto globalThis at runtime, but only
 * when `/@vite/client` is loaded (not under SSR or Vitest, where it would also
 * switch diagnostics on for every test run). Injecting the flag into the
 * entry file that calls run() is deterministic and scoped to the dev app; it
 * runs before run() is called, which is when the diagnostics mode is resolved.
 *
 * The HMR transform finds the pattern:
 *   import { run } from 'sygnal'
 *   import App from './App.jsx'
 *   run(App)
 *
 * And appends:
 *   if (import.meta.hot) {
 *     import.meta.hot.accept('./App.jsx', __sygnal.hmr)
 *     import.meta.hot.dispose(__sygnal.dispose)
 *   }
 *
 * HMR wiring is only added for a recognized top-level (column 0) run()
 * statement whose result reference is actually defined (see RUN_CALL_RE). It
 * is skipped — the dev flag is still injected — for any other shape (e.g.
 * `app = run(App)`, nested or indented calls), for test files (*.test.*,
 * *.spec.*) and under Vitest (process.env.VITEST).
 */
// Node built-ins (the plugin runs in Node). The package has no @types/node.
// @ts-ignore
import fs from 'node:fs'
// @ts-ignore
import path from 'node:path'
// @ts-ignore
import { createRequire } from 'node:module'
// @ts-ignore
import { pathToFileURL } from 'node:url'
import { globalThisAlias } from './globalthis'
import { attachMcp, mcpClientModule } from './mcp'
import type { McpPluginOptions } from './mcp'
import { GRAPH_CLIENT, createEngine, graphAvailable, graphClientModule, graphMiddleware, printGraphUrl, stampTail } from './graph'
import type { LiveEngine } from './graph'

export type { McpPluginOptions } from './mcp'

const nodeProcess: any = (globalThis as any).process

export type DiagnosticsMode = 'off' | 'collect' | 'warn' | 'error'

export interface DiagnosticsPluginOptions {
  /** Runtime diagnostics mode in dev. @default 'warn' */
  mode?: DiagnosticsMode
  /** Strict (canonical-form, SYG5xx) runtime checks: sets globalThis.__SYGNAL_STRICT__. @default false */
  strict?: boolean
  /** Diagnostic codes to drop, e.g. ['SYG105'] */
  ignore?: string[]
}

/**
 * sygnal-check in dev. Each setting left out comes from the project's
 * sygnal-check config file (`sygnal-check.config.json`, or the `"sygnal-check"`
 * key in package.json: `strict`, `a11y`, `ignore`, `paths` for `include`), so
 * the overlay, the CLI and the editor agree; without one, from the defaults
 * below. (A sygnal-check older than 0.4.0 reads no config file.)
 */
export interface CheckPluginOptions {
  /** Also run sygnal-check's strict (SYG5xx) rules. @default the config file's `strict`, else `diagnostics.strict` */
  strict?: boolean
  /**
   * Severity of the a11y lane (SYG701-708). 'warn' keeps it a warning, also
   * under `strict` (D144); 'error' makes it an error, which opens the overlay.
   * @default the config file's `a11y`, else 'warn'
   */
  a11y?: 'warn' | 'error'
  /**
   * Files, directories or globs to check, relative to the Vite root.
   * @default the config file's `paths`, else the existing ones of ['src', 'pages', 'renderer'], else the project root
   */
  include?: string[]
  /** Codes to drop. @default the config file's `ignore`, else the `diagnostics` ignore list */
  ignore?: string[]
  /**
   * Error-severity findings also open Vite's error overlay ('error', the
   * default); false: never. All findings are logged in the terminal and the
   * browser console. Warnings never use the overlay (Vite reloads the page on
   * the next update while one is open): 'warn' is accepted but treated as
   * 'error'. Error-severity codes: SYG112, SYG124, SYG125, SYG128, SYG405
   * and the checker's other errors; the a11y lane SYG701-708 only with
   * `a11y: 'error'` (D144).
   * @default 'error'
   */
  overlay?: 'error' | 'warn' | false
}

export interface SygnalPluginOptions {
  /**
   * Disable automatic JSX configuration.
   * Set to true if you want to configure JSX yourself.
   * @default false
   */
  disableJsx?: boolean

  /**
   * Disable automatic HMR wiring.
   * Set to true if you want to handle HMR manually.
   * @default false
   */
  disableHmr?: boolean

  /**
   * Runtime diagnostics in dev (`vite`, not `vite build`): a mode, or
   * { mode, strict, ignore }. 'off' injects no checks (DevTools: `devtools`). A `diagnostics` option
   * passed to run() itself still wins.
   * @default 'warn'
   */
  diagnostics?: DiagnosticsMode | DiagnosticsPluginOptions

  /**
   * Run sygnal-check in dev on startup and on file changes. Skipped silently
   * when sygnal-check isn't installed.
   * @default true
   */
  check?: boolean | CheckPluginOptions

  /**
   * Under Vitest, add 'sygnal/diagnostics' to `test.setupFiles` so tests get
   * the runtime checks.
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
   * same files as the diagnostics snippet, which installs the DevTools bridge for
   * the browser extension. Production builds never contain it. false: not injected.
   * PLAN-4 3-E: `{ redux: true }` also sends the actions and the root's state to the
   * Redux DevTools extension (connectReduxDevtools() from 'sygnal/devtools').
   * @default true
   */
  devtools?: boolean | { redux?: boolean }

  /**
   * PLAN-6 E-1: serve an MCP endpoint at `/__sygnal/mcp` on the dev server (streamable HTTP,
   * local requests only), so a coding agent can read and drive the running app in the open
   * page: get_state, dispatch, component_tree, recent_actions, get_diagnostics, copy_as_test,
   * agent_tools, apps, tabs, plus sygnal-check's check / graph / explain when it is installed
   * (G-638: every run() app of the page; `app` picks one). Dev
   * server only (never `vite build`, `vite preview` or Vitest); it also loads 'sygnal/devtools'
   * in the page, even with `devtools: false`.
   * @default false
   */
  mcp?: boolean | McpPluginOptions

  /**
   * PLAN-10 W-2 (D543): serve the live app graph page at `/__sygnal/graph` on the dev server (local
   * requests only, as `/__sygnal/mcp`), built by sygnal-check (skipped silently when it isn't
   * installed) and updated on every save; its URL is printed under Vite's. P-2 (D544): in dev the
   * component functions get their static key (a non-enumerable `__sygnalKey`), and the app tabs
   * answer the page's "Live data" (mounted components, instance counts, action flashes, state).
   * Dev server only: never `vite build`, `vite preview` or Vitest. false: no route, no stamps.
   * @default true
   */
  graph?: boolean
}

// Virtual modules (dev server only)
const DEV_CLIENT = 'virtual:sygnal/dev'
const DEV_CLIENT_ID = '\0' + DEV_CLIENT
const RUNTIME_ID = '\0sygnal-dev:runtime'
const VIKE_CLIENT = 'sygnal/vike/onRenderClient'
const VIKE_CLIENT_ID = '\0sygnal-dev:vike-client'
const CHECK_EVENT = 'sygnal:check'
// Sent by the dev client when it loads: the server answers that client only
const CHECK_REQUEST = 'sygnal:check:request'
const OVERLAY_PLUGIN = 'sygnal-check'
// PLAN-6 E-1: the page side of the dev MCP endpoint
const MCP_CLIENT = 'virtual:sygnal/mcp'
const MCP_CLIENT_ID = '\0' + MCP_CLIENT
// PLAN-10 P-2: the page side of the graph page's "Live data"
const GRAPH_CLIENT_ID = '\0' + GRAPH_CLIENT
// Register the runtime checks with the core that loaded last (see the Vike wrapper)
const REINSTALL_IMPORT = `import { installChecks as __sygnalInstallChecks } from 'sygnal/diagnostics';`
const REINSTALL_CALL = 'try { __sygnalInstallChecks() } catch (e) { console.warn(e) }\n'

export default function sygnal(options: SygnalPluginOptions = {}) {
  const { disableJsx = false, disableHmr = false, vitestSetup = true, nativeGlobalThis = true } = options
  const diagnostics = normalizeDiagnostics(options.diagnostics)
  const devOn = diagnostics.mode !== 'off'
  // A mode other than the flag's 'warn', or an ignore list, needs run()'s option
  const wrapRun = devOn && (diagnostics.mode !== 'warn' || diagnostics.ignore.length > 0)
  let isServe = false
  let isVitest = false
  let root: string = nodeProcess.cwd()
  // Files whose `import ... from 'sygnal'` resolves to the run() wrapper
  const runtimeImporters = new Set<string>()
  // Statements run before the app starts: dev flag (+ strict flag)
  const flags = DEV_FLAG + (diagnostics.strict ? STRICT_FLAG : '')
  const devImports = `import 'sygnal/diagnostics';import '${DEV_CLIENT}';`
  // D77: the DevTools bridge, dev only. First, so the diagnostics entry finds it.
  // E-1: the MCP endpoint needs the bridge, so `mcp` turns it on
  const mcpOn = !!options.mcp
  const mcpOptions: McpPluginOptions = typeof options.mcp === 'object' && options.mcp ? options.mcp : {}
  const devtoolsOn = options.devtools !== false || mcpOn
  const redux = typeof options.devtools == 'object' && !!options.devtools?.redux
  // PLAN-10 W-2 / P-2 (D543, D544): the graph page, the component stamps and (with DevTools and a
  // sygnal-check that has the page, decided in config()) the app side of its "Live data"
  const graphOn = options.graph !== false
  let graphClient = false
  let engine: Promise<LiveEngine | null> | null = null
  const devtoolsBase = (!devtoolsOn ? ''
    : redux ? `import { connectReduxDevtools as __sygnalReduxDevtools } from 'sygnal/devtools';__sygnalReduxDevtools();`
    : `import 'sygnal/devtools';`) + (mcpOn ? `import '${MCP_CLIENT}';` : '')
  let devtoolsImport = devtoolsBase
  // What a dev entry gets: DevTools, then (unless diagnostics are 'off') flags + checks
  let devSnippet = devtoolsImport + (devOn ? flags + devImports : '')
  const devInject = devOn || devtoolsOn
  let astroClient: Set<string> | undefined

  return {
    name: 'vite-plugin-sygnal',

    config(this: any, config: any, env: { command: string }) {
      isServe = env.command === 'serve'
      isVitest = !!nodeProcess?.env?.VITEST
      root = config?.root ? path.resolve(config.root) : nodeProcess.cwd()
      // P-2: the graph page's app side, in the dev server only, when the page can exist
      graphClient = isServe && !isVitest && graphOn && devtoolsOn && graphAvailable(root)
      devtoolsImport = devtoolsBase + (graphClient ? `import '${GRAPH_CLIENT}';` : '')
      devSnippet = devtoolsImport + (devOn ? flags + devImports : '')

      const result: any = {
        // Ensure sygnal is bundled for SSR rather than externalized.
        // Without this, Node fails to resolve sygnal's exports from
        // Vike's server chunks in production builds.
        ssr: {
          noExternal: ['sygnal'],
        },
      }

      // G-099: xstream's `require('globalthis')` gets the native-globalThis
      // stub. An alias (not resolveId) so it also applies to pre-bundling.
      // R2-7: not when the user's config already aliases `globalthis`.
      const alias = nativeGlobalThis ? globalThisAlias(config?.resolve?.alias) : []
      if (alias.length) result.resolve = { alias }

      if (!disableJsx) {
        result.oxc = {
          jsx: {
            runtime: 'automatic' as const,
            importSource: 'sygnal',
          },
        }
        // Vite 7 and older (Astro 6, Vitest on Vite 7) compile JSX with
        // esbuild and ignore `oxc` (B-027); Vite 8 warns about `esbuild`
        // from a plugin, so it is only set below Vite 8.
        if (viteMajor(this, root) < 8) {
          result.esbuild = { jsx: 'automatic', jsxImportSource: 'sygnal' }
        }
        // Vite 8's dependency scanner doesn't use the `oxc` options: without
        // this it compiles JSX for React, fails to resolve
        // react/jsx-dev-runtime and skips pre-bundling (a reload on first load).
        if (isServe && !isVitest) {
          result.optimizeDeps = { rolldownOptions: { transform: { jsx: { runtime: 'automatic', importSource: 'sygnal' } } } }
        }
      }

      if (isVitest) {
        if (vitestSetup) {
          const setup = diagnosticsSetupFile(root)
          const existing = ([] as string[]).concat(config?.test?.setupFiles || [])
          const loaded = existing.some(f => typeof f === 'string' &&
            (f === 'sygnal/diagnostics' || (!!setup && path.resolve(root, f) === setup)))
          // Vite merges arrays (and a string with an array) by concatenation
          if (setup && !loaded) result.test = { setupFiles: [setup] }
        }
      } else if (isServe && devInject && sygnalInNodeModules(root)) {
        // The dependency scan reads the original sources, which don't import
        // the checks (or DevTools) entry: pre-bundle it with sygnal so the first
        // page load doesn't trigger a re-optimization. Only for an installed
        // sygnal: a linked one is served from source, and pre-bundling the
        // checks alone would give them their own copy of the core.
        const include = [...(devtoolsOn ? ['sygnal/devtools'] : []), ...(devOn ? ['sygnal/diagnostics'] : [])]
        result.optimizeDeps = { ...result.optimizeDeps, include }
      }

      // B-020: Vike adds its client entry 'sygnal/vike/onRenderClient' to
      // optimizeDeps.include. With a linked sygnal, the pages' 'sygnal' is
      // served from source while that pre-bundle inlines a second copy of the
      // core. Unbundled, the entry's own `import 'sygnal'` resolves like the
      // pages' imports (source when linked, the shared pre-bundle when
      // installed): one core. Vike honours the exclude list.
      // G-098: Vite doesn't discover the imports of an excluded dependency, so for an
      // installed sygnal 'sygnal' is pre-bundled up front (pages that reach it only through
      // the JSX runtime would otherwise get it, and its CommonJS xstream, unbundled).
      if (isServe && !isVitest) {
        const include = result.optimizeDeps?.include || []
        result.optimizeDeps = {
          ...result.optimizeDeps,
          exclude: [VIKE_CLIENT],
          ...(sygnalInNodeModules(root) ? { include: [...include, 'sygnal'] } : {}),
        }
      }

      return result
    },

    configResolved(config: any) {
      if (config?.root) root = config.root
      // G-050: Vitest loads setup files by URL (/@fs/...) in browser-like
      // environments (jsdom, happy-dom), and Vite refuses files outside
      // server.fs.allow, which is the project's workspace by default. A linked
      // (or hoisted) sygnal lives outside it, so allow its setup file's
      // directory. The resolved list already holds Vite's defaults.
      if (isVitest) {
        const setup = diagnosticsSetupFile(root)
        const allow = config?.server?.fs?.allow
        if (setup && Array.isArray(allow)) {
          const dir = path.dirname(setup)
          const inside = (base: string) => {
            const rel = path.relative(path.resolve(base), dir)
            return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
          }
          if (!allow.some(inside)) allow.push(dir)
        }
      }
    },

    resolveId: {
      order: 'pre' as const,
      async handler(this: any, source: string, importer: string | undefined, opts: any) {
        if (!isServe || isVitest) return null
        if (source === DEV_CLIENT) return DEV_CLIENT_ID
        if (source === MCP_CLIENT && mcpOn) return MCP_CLIENT_ID
        if (source === GRAPH_CLIENT && graphClient) return GRAPH_CLIENT_ID
        if (source === 'sygnal' && importer && wrapRun && runtimeImporters.has(cleanId(importer))) {
          return RUNTIME_ID
        }
        if (source === VIKE_CLIENT && devInject && !opts?.ssr) {
          if (importer !== VIKE_CLIENT_ID) return VIKE_CLIENT_ID
          // The wrapper's own import of the real entry: resolve it normally.
          // The real Vike client's run() then gets the run() wrapper too, when
          // it is served unbundled (a pre-bundled copy stays in 'warn' mode).
          const real = await this.resolve(source, importer, { ...opts, skipSelf: true })
          if (real && wrapRun) runtimeImporters.add(cleanId(real.id))
          return real
        }
        return null
      },
    },

    load(id: string) {
      if (id === DEV_CLIENT_ID) return devClientModule()
      if (id === MCP_CLIENT_ID && mcpOn) return mcpClientModule(mcpOptions)
      if (id === GRAPH_CLIENT_ID && graphClient) return graphClientModule()
      if (id === RUNTIME_ID) return runtimeModule(diagnostics)
      // The checks register again once the real entry has loaded: a
      // pre-bundled copy of it can carry its own copy of the Sygnal core
      // (e.g. with a linked sygnal), which then holds the diagnostics bridge.
      if (id === VIKE_CLIENT_ID) {
        if (!devOn) return `${devtoolsImport}\nexport * from '${VIKE_CLIENT}';\n`
        return `${devtoolsImport}${devImports}${REINSTALL_IMPORT}\nexport * from '${VIKE_CLIENT}';\n${flags}\n${REINSTALL_CALL}`
      }
      return null
    },

    configureServer(server: any) {
      if (isVitest) return
      // E-1: the MCP endpoint (a middleware ahead of Vite's own; it does its own host checks)
      if (mcpOn && server?.middlewares) {
        attachMcp(server, root, mcpOptions, sygnalVersion(root))
      }
      const checkOn = options.check !== false
      if (!checkOn && !graphOn) return
      const checkOptions = typeof options.check === 'object' && options.check ? options.check : {}
      const checkDefaults = { strict: diagnostics.strict, ignore: diagnostics.ignore }
      // Deferred: the dev server doesn't wait for the first check. `engine`: the live graph
      // project (W-2), null without a sygnal-check that has it
      engine = new Promise<LiveEngine | null>((resolve) => {
        setTimeout(() => {
          startDev(server, root, checkOptions, checkDefaults, options.check !== undefined, checkOn, graphOn).then(resolve, (err) => {
            server?.config?.logger?.warn?.(`[sygnal] sygnal-check could not start: ${err?.message || err}`)
            resolve(null)
          })
        }, 0)
      })
      // W-2 (D543): the page and its stream, behind the MCP endpoint's guard; its URL in the banner
      if (graphOn && server?.middlewares) {
        server.middlewares.use(graphMiddleware(server, root, engine))
        printGraphUrl(server, graphAvailable(root))
      }
    },

    transform(this: any, code: string, id: string, opts?: { ssr?: boolean }) {
      // SYG666 (PLAN-5 W-2): an adapter entry imported without its optional peers; every mode
      const adapters = adapterImports(this, code, id)
      const result = adapters
        ? checkPeers(this, adapters, id).then(() => devTransform.call(this, code, id, opts))
        : devTransform.call(this, code, id, opts)
      // 11. the words SYG103 may take as conditionally rendered markup (dev server, diagnostics on)
      const words = isServe && !isVitest && devOn && !opts?.ssr ? viewTokensTail(this, code, id) : null
      // 12. P-2 (D544): the static keys of the module's components (dev server, graph on)
      const stamps = engine && isServe && !isVitest && !opts?.ssr ? componentStampTail(engine, id) : null
      const tokens = words && stamps ? Promise.all([words, stamps]).then(([a, b]) => a + b) : words || stamps
      if (!tokens) return result
      return Promise.all([result, tokens]).then(([r, tail]: [any, string]) => {
        if (!tail) return r
        if (r == null) return withSourcemap(code, [], tail, id)
        return typeof r == 'string' ? r + tail : { ...r, code: r.code + tail }
      })
    },
  }

  function devTransform(this: any, code: string, id: string, opts?: { ssr?: boolean }) {
      if (!isServe) return null

      // sygnal/astro/client (Astro islands): flags + checks first. It imports
      // the public 'sygnal' entry (the app's core, B-019), which resolves to
      // the run() wrapper when the diagnostics option needs it.
      if (devInject && !isVitest && !opts?.ssr) {
        astroClient = astroClient || astroClientFiles(root)
        if (astroClient.has(cleanId(id))) {
          if (wrapRun) runtimeImporters.add(cleanId(id))
          return withSourcemap(code, [[0, devSnippet]], '', id)
        }
      }

      // Only transform JS/TS/JSX/TSX files
      if (!/\.[jt]sx?$/.test(id)) return null
      // Skip node_modules
      if (id.includes('node_modules')) return null
      // Must import run from sygnal
      if (!code.includes('sygnal')) return null

      // Match against the code with comments blanked out (same offsets), so
      // e.g. `// run(App)` or a commented-out import is never matched.
      const noComments = blankOut(code, false)

      // Find: import { run, ... } from 'sygnal'
      const runImportRe = /import\s+\{[^}]*\brun\b[^}]*\}\s+from\s+['"]sygnal['"]/
      if (!runImportRe.test(noComments)) {
        return disableHmr || isVitest ? null : elementHmr(code, noComments, id)
      }

      // Dev snippet: injected into every file that imports run() — also when
      // HMR wiring below is skipped. Inserted after any shebang line and
      // directive prologue, without adding a line. Nothing under Vitest: a
      // global flag set by one test file would leak dev/strict mode into the
      // later test files of the same worker; there the checks come from
      // test.setupFiles and renderComponent() manages the modes.
      const inserts: Array<[number, string]> = []
      if (devInject && !isVitest) {
        inserts.push(flagInsertion(code, devSnippet))
        if (wrapRun) runtimeImporters.add(cleanId(id))
      }
      const done = (tail = '') => (inserts.length || tail ? withSourcemap(code, inserts, tail, id) : null)

      // Skip HMR wiring if disabled, in tests, or already manually wired
      if (disableHmr || isVitest || /\.(test|spec)\.[jt]sx?$/.test(id)) return done()
      if (noComments.includes('import.meta.hot')) return done()

      // Strings and template literals blanked out too: a statement-level match only
      const runCall = RUN_CALL_RE.exec(blankOut(code, true))
      if (!runCall) return done()
      const [, binding, componentName] = runCall

      // Find the import path for this component
      // Handles: import App from './App.jsx'
      //          import App from "./App"
      const componentImportRe = new RegExp(
        `import\\s+${componentName.replace(/\$/g, '\\$')}\\s+from\\s+['"]([^'"]+)['"]`
      )
      const componentImportMatch = noComments.match(componentImportRe)
      if (!componentImportMatch) return done()
      const componentPath = componentImportMatch[1]

      // Pattern 3: bare run(App, ...) — no result captured → const __sygnal = run(
      if (!binding) {
        inserts.push([runCall.index, 'const __sygnal = '])
        return done(hmrBlock(componentPath, '__sygnal.hmr', '__sygnal.dispose'))
      }

      // Pattern 2: const app = run(App, ...)
      if (binding[0] !== '{') {
        return done(hmrBlock(componentPath, `${binding}.hmr`, `${binding}.dispose`))
      }

      // Pattern 1: const { hmr, dispose, ... } = run(App, ...) — only when both
      // are bound under their own names (a rename would leave them undefined)
      const names = binding.slice(1, -1).split(',').map(s => s.trim())
      if (names.includes('hmr') && names.includes('dispose')) {
        return done(hmrBlock(componentPath, 'hmr', 'dispose'))
      }
      return done()
  }
}

// 12. PLAN-10 P-2 (D544): a module of the scanned files gets, in dev, a tail that sets each of its
// components' static key (sygnal-check's D521 'file#name', from the live graph engine's last build,
// built again first when the module's text changed) as a non-enumerable `__sygnalKey` on the
// function; the runtime inspect() reports it as `key`, and the graph page joins instances to cards.
function componentStampTail(engine: Promise<LiveEngine | null>, id: string): Promise<string> | null {
  const file = cleanId(id)
  if (!/\.[cm]?[jt]sx?$/.test(file) || id.includes('node_modules') || id.startsWith('\0')) return null
  return engine.then((e) => {
    if (!e) return ''
    try { return stampTail(e.stampsFor(file) || []) } catch (_) { return '' }
  })
}

// 11. SYG103 (the dev runtime check of an intent selector that never matched) lets a selector
// through as conditionally rendered when its words appear in the component's view; the runtime
// can read only the view function's own source. A component module (one that sets `X.intent` or
// `X.uses`) gets, in dev, a tail registering for each such component the words of its string
// literals and those of the relative modules it imports, where view helpers live
// (globalThis.__SYGNAL_VIEW_TOKENS__, a WeakMap read by checks/dom.ts).
const COMPONENT_WITH_SELECTORS_RE = /(?:^|[^\w$.])([A-Z][\w$]*)\.(?:intent|uses)\s*=(?!=)/g
const STRING_RE = /(['"])((?:\\.|(?!\1)[^\\\n])*)\1|`((?:\\[\s\S]|[^\\`])*)`/g
const RELATIVE_IMPORT_RE = /(?:\bfrom|\bimport)\s*\(?\s*(['"])(\.{1,2}\/[^'"]+)\1/g

// A string that is itself a selector ('.save', '#id', 'form.ask', '[data-x]') or a path / URL: its
// words aren't markup (the intent's own DOM.click('.svae') would otherwise vouch for its typo)
const NOT_MARKUP_RE = /(?:^|[\s>+~,(])[\w-]*[.#[][\w-]|^\s*(?:\/|[\w+-]+:\/\/)/

/** the class / id / tag-like words in a module's string and template literals (comments skipped) */
function stringWords(code: string, into: Set<string>): void {
  for (const m of blankOut(code, false).matchAll(STRING_RE)) {
    const text = m[2] ?? m[3] ?? ''
    if (NOT_MARKUP_RE.test(text)) continue
    for (const w of text.match(/[A-Za-z_][\w-]*/g) || []) into.add(w)
  }
}

function viewTokensTail(ctx: any, code: string, id: string): Promise<string> | null {
  const file = cleanId(id)
  if (!/\.[jt]sx?$/.test(file) || id.includes('node_modules') || id.startsWith('\0')) return null
  const names = new Set<string>()
  for (const m of blankOut(code, true).matchAll(COMPONENT_WITH_SELECTORS_RE)) names.add(m[1])
  if (!names.size) return null
  const words = new Set<string>()
  stringWords(code, words)
  const specs = new Set(Array.from(blankOut(code, false).matchAll(RELATIVE_IMPORT_RE), m => m[2]))
  return Promise.all([...specs].map(async (spec) => {
    try {
      const r = await ctx.resolve(spec, id)
      const dep = r && !r.external && cleanId(r.id)
      if (!dep || !/\.[cm]?[jt]sx?$/.test(dep) || dep.includes('node_modules')) return
      ctx.addWatchFile?.(dep)
      stringWords(await fs.promises.readFile(dep, 'utf8'), words)
    } catch (_) { /* unreadable: its words are just not added */ }
  })).then(() => {
    const comps = [...names].map(n => `typeof ${n} == 'function' && ${n}`).join(', ')
    return `\n;(() => { try { const m = globalThis.__SYGNAL_VIEW_TOKENS__ ||= new WeakMap(), t = ${JSON.stringify([...words].join(' '))}; for (const c of [${comps}]) if (c) m.set(c, t) } catch (_) {} })();\n`
  })
}

// PLAN-5 W-2 (D209): the adapter entries and the optional peer dependencies each one imports
// (the Zag packages pinned together: they depend on each other's exact versions)
const ZAG = '~1.45.0'
const ADAPTER_PEERS: Record<string, string[]> = {
  react: ['react', 'react-dom'],
  zag: ['@zag-js/vanilla'],
  // D211: one subpath per Zag part, each needing only its own machine
  'ui/menu': ['@zag-js/vanilla', '@zag-js/menu'],
  'ui/select': ['@zag-js/vanilla', '@zag-js/select'],
  'ui/combobox': ['@zag-js/vanilla', '@zag-js/combobox'],
}
// G-440: a dynamic import's specifier may be a template literal without substitutions
const ADAPTER_RE = /(?:\bfrom|\bimport)\s*\(?\s*(['"`])sygnal\/(react|zag|ui\/(?:menu|select|combobox))\1/g
const ADAPTER_ID = /^sygnal\/(react|zag|ui\/(?:menu|select|combobox))$/

/**
 * The adapter entries an app module imports (statically, dynamically or in a re-export), or null.
 * G-415: real imports only. The module's AST from the plugin context's parse() (Vite and Rollup
 * provide it; the code is plain JS by then); when there is none, or the code doesn't parse, a
 * scan of the code with comments blanked whose `from` / `import` keyword isn't inside a string
 * or template literal. A literal that mentions an entry (a docs snippet) is never an import.
 */
function adapterImports(ctx: any, code: string, id: string): string[] | null {
  if (!code.includes('sygnal/') || id.includes('node_modules') || !/\.[cm]?[jt]sx?$/.test(cleanId(id))) return null
  const noComments = blankOut(code, false)
  if (!ADAPTER_RE.test(noComments)) return null
  ADAPTER_RE.lastIndex = 0
  const found = new Set<string>()
  let ast: any = null
  try { ast = typeof ctx?.parse == 'function' ? ctx.parse(code) : null } catch (_) {}
  if (ast) {
    const walk = (n: any): void => {
      if (!n || typeof n != 'object') return
      if (Array.isArray(n)) return n.forEach(walk)
      if (/^(Import|Export(Named|All))Declaration$|^ImportExpression$/.test(n.type)) {
        // G-440: import(`sygnal/zag`): a template literal without substitutions is a known specifier
        const src = n.source, q = src?.type == 'TemplateLiteral' && !src.expressions?.length ? src.quasis?.[0]?.value?.cooked : src?.value
        const m = ADAPTER_ID.exec(q ?? '')
        if (m) found.add(m[1])
      }
      for (const k in n) if (k != 'type' && typeof n[k] == 'object') walk(n[k])
    }
    walk(ast)
  } else {
    // strings and templates blanked too: a keyword there is text, not an import
    const noStrings = blankOut(code, true)
    for (const m of noComments.matchAll(ADAPTER_RE)) {
      if (noStrings.startsWith(m[0].slice(0, m[0][0] == 'f' ? 4 : 6), m.index!)) found.add(m[2])
    }
  }
  return found.size ? [...found] : null
}

/** SYG666: resolves each entry's peers from the importing module; reports the missing ones */
async function checkPeers(ctx: any, entries: string[], id: string): Promise<void> {
  for (const e of entries) {
    const missing: string[] = []
    for (const peer of ADAPTER_PEERS[e]) {
      let r: any = null
      try { r = await ctx.resolve(peer, id, { skipSelf: true }) } catch (_) {}
      if (!r) missing.push(peer)
    }
    if (!missing.length) continue
    const install = missing.map(m => (m.startsWith('@zag-js/') ? `${m}@${ZAG}` : m)).join(' ')
    ctx.error(`[Sygnal SYG666] 'sygnal/${e}' needs ${missing.join(', ')}, which ${missing.length > 1 ? "aren't" : "isn't"} installed: npm install ${install}.` +
      (e == 'react' ? " (For Preact: alias react, react-dom and react-dom/client to preact/compat.)" : '') +
      ' https://sygnal.js.org/reference/errors#syg666')
  }
}

/**
 * Major version of the running Vite: from the plugin context (this.meta,
 * Vite 7+), else from the vite package the project resolves. Infinity when
 * unknown (treated as Vite 8+: no `esbuild` option).
 */
function viteMajor(ctx: any, root: string): number {
  const fromMeta = ctx?.meta?.viteVersion
  if (typeof fromMeta === 'string') return parseInt(fromMeta, 10)
  if (ctx?.meta?.rolldownVersion) return 8
  try {
    const req = createRequire(path.join(root, 'package.json'))
    const v = JSON.parse(fs.readFileSync(req.resolve('vite/package.json'), 'utf8')).version
    const major = parseInt(v, 10)
    if (major > 0) return major
  } catch (_) {}
  return Infinity
}

interface NormalizedDiagnostics { mode: DiagnosticsMode, strict: boolean, ignore: string[] }

const MODES: DiagnosticsMode[] = ['off', 'collect', 'warn', 'error']

function normalizeDiagnostics(value: SygnalPluginOptions['diagnostics']): NormalizedDiagnostics {
  const o: DiagnosticsPluginOptions = typeof value === 'string' ? { mode: value } : value || {}
  const mode = o.mode === undefined ? 'warn' : o.mode
  if (!MODES.includes(mode)) {
    throw new Error(`[vite-plugin-sygnal] diagnostics mode must be one of ${MODES.map(m => `'${m}'`).join(', ')}; got ${JSON.stringify(mode)}`)
  }
  return { mode, strict: !!o.strict, ignore: Array.isArray(o.ignore) ? o.ignore.map(String) : [] }
}

/** Module id without a query or hash. */
function cleanId(id: string): string {
  return id.replace(/[?#].*$/, '')
}

/** 'virtual:sygnal/dev': logs sygnal-check results in the browser console. */
function devClientModule(): string {
  // Vite's client reloads the page on the first HMR update while an error
  // overlay is open. A sygnal-check overlay is closed before each update (the
  // server sends it again after the re-check), so it never causes a reload.
  return `if (import.meta.hot) {
  let shown = 0;
  let ours = false;
  const closeOurs = () => {
    if (!ours || typeof document === 'undefined') return;
    document.querySelectorAll('vite-error-overlay').forEach((n) => n.close ? n.close() : n.remove());
    ours = false;
  };
  import.meta.hot.on('vite:error', (payload) => {
    ours = !!(payload && payload.err && payload.err.plugin === '${OVERLAY_PLUGIN}');
  });
  import.meta.hot.on('vite:beforeUpdate', closeOurs);
  import.meta.hot.on('${CHECK_EVENT}', (payload) => {
    const list = (payload && payload.diagnostics) || [];
    if (!list.some((d) => d.severity === 'error')) closeOurs();
    if (!list.length) {
      if (shown) console.info('[sygnal-check] all findings resolved');
      shown = 0;
      return;
    }
    shown = list.length;
    for (const d of list) console[d.severity === 'error' ? 'error' : 'warn']('[sygnal-check] ' + d.text);
    console.info('[sygnal-check] ' + payload.summary);
  });
  import.meta.hot.send('${CHECK_REQUEST}');
}
`
}

/** '\0sygnal-dev:runtime': sygnal with a run() that adds the plugin's diagnostics option. */
function runtimeModule(d: NormalizedDiagnostics): string {
  const option = JSON.stringify({ mode: d.mode, ignore: d.ignore })
  return `import { run as __run } from 'sygnal';
export * from 'sygnal';
export function run(app, drivers, options) {
  if (options && options.diagnostics !== undefined) return __run(app, drivers, options);
  return __run(app, drivers, Object.assign({}, options, { diagnostics: ${option} }));
}
`
}

/** Directory of the 'sygnal' package the project resolves, or undefined. */
function sygnalPackageDir(root: string): string | undefined {
  try {
    const req = createRequire(path.join(root, 'package.json'))
    let dir = path.dirname(req.resolve('sygnal'))
    while (dir !== path.dirname(dir)) {
      const pkgFile = path.join(dir, 'package.json')
      if (fs.existsSync(pkgFile) && JSON.parse(fs.readFileSync(pkgFile, 'utf8')).name === 'sygnal') return dir
      dir = path.dirname(dir)
    }
  } catch (_) {}
  return undefined
}

/** The version of the 'sygnal' package the project resolves */
function sygnalVersion(root: string): string | undefined {
  const dir = sygnalPackageDir(root)
  try { return dir ? JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version : undefined } catch (_) { return undefined }
}

/** Real paths of sygnal's 'astro/client' ESM file. */
function astroClientFiles(root: string): Set<string> {
  const files = new Set<string>()
  const dir = sygnalPackageDir(root)
  if (!dir) return files
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    const entry = pkg.exports?.['./astro/client']
    const rel = typeof entry === 'string' ? entry : entry?.import
    if (typeof rel !== 'string') return files
    const file = path.resolve(dir, rel)
    files.add(file.split(path.sep).join('/'))
    files.add(fs.realpathSync(file).split(path.sep).join('/'))
  } catch (_) {}
  return files
}

function sygnalInNodeModules(root: string): boolean {
  const dir = sygnalPackageDir(root)
  if (!dir) return false
  try {
    return fs.realpathSync(dir).split(path.sep).includes('node_modules')
  } catch (_) {
    return false
  }
}

/**
 * Absolute path of the ESM build of 'sygnal/diagnostics' (its "import"
 * condition), so the checks share the core instance the tests import.
 */
function diagnosticsSetupFile(root: string): string | undefined {
  const dir = sygnalPackageDir(root)
  if (!dir) return undefined
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    const entry = pkg.exports?.['./diagnostics']
    const rel = typeof entry === 'string' ? entry : entry?.import?.default || entry?.import || entry?.default
    if (typeof rel !== 'string') return undefined
    const file = path.resolve(dir, rel)
    return fs.existsSync(file) ? file : undefined
  } catch (_) {
    return undefined
  }
}

/** Load sygnal-check from the project (optional dependency); undefined when it is missing. */
async function loadSygnalCheck(root: string): Promise<any> {
  try {
    const file = createRequire(path.join(root, 'package.json')).resolve('sygnal-check')
    return await import(/* @vite-ignore */ pathToFileURL(file).href)
  } catch (_) {}
  try {
    const name = 'sygnal-check'
    return await import(/* @vite-ignore */ name)
  } catch (_) {
    return undefined
  }
}

const SOURCE_RE = /\.[cm]?[jt]sx?$/
// sygnal-check's config sources (PLAN-7 C-5): a change re-checks
const CONFIG_FILES = ['sygnal-check.config.json', 'package.json']

/** sygnal-check's one-line format: `file:line:col CODE [severity] Component: message (fix)` */
function formatLine(d: any): string {
  const where = d.file ? `${d.file}:${d.line}:${d.column}` : '<sygnal-check>'
  const sev = d.severity === 'warn' ? '' : ` [${d.severity}]`
  return `${where} ${d.code}${sev} ${d.component ? d.component + ': ' : ''}${d.message}${d.fix ? ` (${d.fix})` : ''}`
}

// Source directories checked by default, those that exist (Vike apps use
// pages/ and renderer/, often without src/)
const DEFAULT_INCLUDE = ['src', 'pages', 'renderer']

/**
 * What sygnal-check checks: `include` when given, else the existing default
 * directories, else the project root (sygnal-check skips node_modules, dist
 * and other build output). Logs one notice when the default finds no
 * directory, or when none of the given paths exists, so an empty check is
 * never a silent all-clear.
 */
function checkInclude(root: string, include: string[] | undefined, notice: (m: string) => void, label = 'check.include'): string[] {
  const exists = (p: string) => /[*?[{]/.test(p) || fs.existsSync(path.resolve(root, p))
  if (include && include.length) {
    if (!include.some(exists)) notice(`[sygnal] sygnal-check: none of ${label} (${include.map(p => path.isAbsolute(p) ? path.relative(root, p) || '.' : p).join(', ')}) exists under ${root}, so nothing is checked`)
    return include
  }
  const dirs = DEFAULT_INCLUDE.filter(exists)
  if (dirs.length) return dirs
  notice(`[sygnal] sygnal-check: no ${DEFAULT_INCLUDE.join('/, ')}/ directory under ${root}; checking the project root (set check.include to choose)`)
  return ['.']
}

/**
 * Load sygnal-check and start what dev uses it for: the checker (`check`, reported to the terminal
 * and the browser) and the live graph engine (`graph`, PLAN-10 W-2: the page, its stream and the
 * component stamps). With an engine, both come from one build. Resolves to the engine, or null.
 */
async function startDev(server: any, root: string, opts: CheckPluginOptions,
  defaults: { strict: boolean, ignore: string[] }, explicit: boolean, checkOn: boolean, graphOn: boolean): Promise<LiveEngine | null> {
  const mod = await loadSygnalCheck(root)
  const logger = server?.config?.logger || console
  if (!mod || typeof mod.check !== 'function') {
    if (explicit && checkOn) logger.info('[sygnal] sygnal-check is not installed, so static checks are off (npm i -D sygnal-check)')
    return null
  }
  const setup = checkSetup(mod, root, opts, defaults, (m: string) => logger.info(m))
  // PLAN-10 W-2: a sygnal-check with the live project and the page (feature-detected, so an older
  // one keeps the checker as it was)
  const engine = graphOn && setup.configAware && typeof mod.createLiveProject === 'function' && typeof mod.graphHtml === 'function'
    ? createEngine(mod, root, {
      paths: setup.include, strict: setup.checkOptions.strict, a11y: setup.checkOptions.a11y,
      ignore: setup.checkOptions.ignore, defaults: setup.checkOptions.defaults,
    }, logger, true)
    : null
  if (checkOn) startChecker(server, root, mod, setup, opts, engine)
  if (engine) {
    if (!engine.last) engine.build()
    engine.watch(server)
  }
  return engine
}

interface CheckSetup { include: string[]; checkOptions: any; configAware: boolean }

/** What sygnal-check checks, with which options (see the `check` option). */
function checkSetup(mod: any, root: string, opts: CheckPluginOptions,
  defaults: { strict: boolean, ignore: string[] }, notice: (m: string) => void): CheckSetup {
  // PLAN-7 C-5 (D299): a sygnal-check with config support resolves the settings itself:
  // explicit check.* options > its config file > the `diagnostics` defaults passed as `defaults`.
  // An older one gets exactly what it got before.
  const configAware = typeof mod.loadConfig === 'function'
  let include: string[]
  let checkOptions: any
  if (configAware) {
    let configPaths: string[] | undefined
    if (!(opts.include && opts.include.length)) {
      try { configPaths = mod.loadConfig(root)?.config?.paths } catch (_) {}
    }
    include = configPaths && configPaths.length
      ? checkInclude(root, configPaths, notice, "the config file's paths")
      : checkInclude(root, opts.include, notice)
    checkOptions = {
      cwd: root,
      strict: opts.strict === undefined ? undefined : !!opts.strict,
      ignore: opts.ignore,
      a11y: opts.a11y === 'error' || opts.a11y === 'warn' ? opts.a11y : undefined,
      defaults: { strict: defaults.strict, ignore: defaults.ignore },
    }
  } else {
    include = checkInclude(root, opts.include, notice)
    // D144: the a11y lane is a warning unless asked for as an error, under strict too
    checkOptions = {
      cwd: root,
      strict: opts.strict === undefined ? defaults.strict : !!opts.strict,
      ignore: opts.ignore || defaults.ignore,
      a11y: opts.a11y === 'error' ? 'error' : 'warn',
    }
  }
  return { include, checkOptions, configAware }
}

/**
 * Run sygnal-check now and after source changes; report to the terminal and the browser. With the
 * live graph engine (W-2) the findings come from its builds (one build for the page and the
 * checker); else from check() on each change.
 */
function startChecker(server: any, root: string, mod: any, setup: CheckSetup, opts: CheckPluginOptions, engine: LiveEngine | null) {
  const logger = server?.config?.logger || console
  const { include, checkOptions, configAware } = setup
  const a11y = checkOptions.a11y
  // Only error-severity findings open Vite's overlay: while an overlay is open
  // Vite's client reloads the page on the first HMR update, so warnings stay
  // in the terminal and the browser console. overlay: 'warn' is treated as
  // 'error' (with a one-time notice).
  if (opts.overlay === 'warn') {
    logger.info("[sygnal] check.overlay: 'warn' is treated as 'error': warnings go to the browser console, not Vite's error overlay (an open overlay makes Vite reload the page on the next update)")
  }
  const overlay = opts.overlay !== false
  let lastKey: string | undefined
  let payload: any = null
  let overlayErr: any = null

  const event = () => ({ type: 'custom', event: CHECK_EVENT, data: payload })
  const errorMessage = () => ({ type: 'error', err: overlayErr })
  // Every connected client (after a source change). An error with no client
  // connected would be buffered by Vite and shown on the next page load.
  const broadcast = (findingsChanged: boolean) => {
    const ws = server.ws
    if (!ws || typeof ws.send !== 'function') return
    try {
      if (findingsChanged && payload) ws.send(event())
      if (overlayErr && !(ws.clients && ws.clients.size === 0)) ws.send(errorMessage())
    } catch (_) {}
  }

  const run = (initial = false, built?: any[]) => {
    let diags: any[]
    if (built) diags = built
    else {
      try {
        diags = mod.check(include, checkOptions)
      } catch (err: any) {
        logger.warn(`[sygnal] sygnal-check failed: ${err?.message || err}`, { timestamp: true })
        return
      }
    }
    // A sygnal-check from before D144 reports SYG7xx as errors under strict: keep them warnings
    // (one with config support postdates D144 and resolves a11y itself)
    if (!configAware && a11y !== 'error') {
      diags = diags.map(d => d && d.severity === 'error' && /^SYG7\d\d$/.test(d.code) ? { ...d, severity: 'warn' } : d)
    }
    const shown = diags.filter(d => d.severity !== 'info')
    const lines = shown.map(formatLine)
    const key = lines.join('\n')
    const changed = key !== lastKey
    if (changed) {
      lastKey = key
      const text: string = typeof mod.formatDiagnostics === 'function'
        ? mod.formatDiagnostics(diags)
        : lines.concat(`sygnal-check: ${shown.length} finding(s)`).join('\n')
      const summary = text.split('\n').pop() || ''
      if (shown.length) logger.warn(text, { timestamp: true })
      else logger.info(summary, { timestamp: true })
      payload = {
        summary,
        diagnostics: shown.map((d, i) => ({ code: d.code, severity: d.severity, file: d.file, line: d.line, column: d.column, text: lines[i] })),
      }
      const forOverlay = overlay ? shown.filter(d => d.severity === 'error') : []
      const first = forOverlay[0]
      overlayErr = first ? {
        plugin: OVERLAY_PLUGIN,
        message: forOverlay.map(formatLine).join('\n'),
        stack: '',
        id: path.resolve(root, first.file || ''),
        loc: { file: path.resolve(root, first.file || ''), line: first.line, column: first.column },
      } : null
    }
    // The first check runs before any page is open; pages ask for the
    // findings when they load (CHECK_REQUEST). After a change the overlay is
    // sent again even when the findings are the same: the HMR update closed it.
    if (!initial) broadcast(changed)
  }

  if (engine) {
    // every build of the engine: the first on start, then after changes (its own watcher)
    let first = !engine.last
    engine.onBuild((b) => { const initial = first; first = false; run(initial, b.diagnostics || []) })
    if (engine.last) run(true, engine.last.diagnostics || [])
  } else run(true)
  // A page that loads (or reloads) asks for the current findings: answer
  // that client only, never every client.
  try {
    server.ws?.on?.(CHECK_REQUEST, (_data: any, client: any) => {
      try {
        if (payload) client?.send?.(event())
        if (overlayErr) client?.send?.(errorMessage())
      } catch (_) {}
    })
  } catch (_) {}

  if (engine) return
  let timer: any
  const onChange = (file: string) => {
    if (file.split(/[\\/]/).includes('node_modules')) return
    if (!SOURCE_RE.test(file) && !(configAware && CONFIG_FILES.includes(path.basename(file)))) return
    clearTimeout(timer)
    timer = setTimeout(run, 100)
  }
  const watcher = server?.watcher
  if (watcher && typeof watcher.on === 'function') {
    watcher.on('change', onChange)
    watcher.on('add', onChange)
    watcher.on('unlink', onChange)
  }
  try { server.httpServer?.once?.('close', () => clearTimeout(timer)) } catch (_) {}
}

const DEV_FLAG = 'if (globalThis.__SYGNAL_DEV__ === undefined) globalThis.__SYGNAL_DEV__ = true;'
const STRICT_FLAG = 'if (globalThis.__SYGNAL_STRICT__ === undefined) globalThis.__SYGNAL_STRICT__ = true;'

// A top-level (column 0) run(Component, ...) statement: bare, or declaring a
// new binding. Assignments to existing variables, nested calls and indented
// calls (e.g. inside a function or test callback) do not match (B-007). It is
// matched against the code with comments and strings blanked out.
const RUN_CALL_RE = /^(?:(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*)?run\s*\(\s*([A-Z][\w$]*)/m

// Comments, string literals and template literals (a regex literal containing
// a quote or `//` can over-blank; that only ever skips HMR wiring).
const COMMENT_OR_STRING_RE = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|(['"])(?:\\.|(?!\1)[^\\\n])*\1?|`(?:\\[\s\S]|[^\\`])*`?/g

/** Replace comments (and, with `strings`, string/template literals) by spaces, keeping offsets and newlines. */
function blankOut(code: string, strings: boolean): string {
  return code.replace(COMMENT_OR_STRING_RE, m =>
    !strings && m[0] !== '/' ? m : m.replace(/[^\n]/g, ' ')
  )
}

// One directive ('use strict', "use client", ...) with any leading whitespace
// and comments. It must end with `;` (group 2) or at the end of its line.
const DIRECTIVE_RE = /(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*(['"])(?:\\.|(?!\1)[^\\\n])*\1(?:[ \t]*(;)|(?=[ \t]*(?:\/\/[^\n]*|\/\*[^\n]*?\*\/)?[ \t]*(?:\r?\n|$)))/y

/** Insert `text` (the dev snippet) after a shebang line and the directive prologue. */
function flagInsertion(code: string, text: string): [number, string] {
  let at = code.startsWith('#!') ? (code.indexOf('\n') + 1 || code.length) : 0
  let semicolon = true
  DIRECTIVE_RE.lastIndex = at
  let m
  while ((m = DIRECTIVE_RE.exec(code))) {
    at = DIRECTIVE_RE.lastIndex
    semicolon = !!m[2]
  }
  return [at, (semicolon ? '' : ';') + text]
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function vlq(n: number): string {
  let v = n < 0 ? (-n << 1) | 1 : n << 1
  let out = ''
  do {
    let digit = v & 31
    v >>>= 5
    if (v) digit |= 32
    out += B64[digit]
  } while (v)
  return out
}

/**
 * Apply single-line insertions (at offsets in the original code) plus an
 * appended tail, and build a v3 sourcemap without extra dependencies. No line
 * is added before the tail, so every original line maps to itself; on a line
 * with an insertion, the text after it maps back to its original column.
 */
function withSourcemap(code: string, inserts: Array<[number, string]>, tail: string, id: string) {
  inserts.sort((a, b) => a[0] - b[0])
  let out = ''
  let last = 0
  for (const [at, text] of inserts) {
    out += code.slice(last, at) + text
    last = at
  }
  out += code.slice(last) + tail

  let offset = 0
  let k = 0
  let prevLine = 0
  let prevCol = 0
  const mappings = code.split('\n').map((line, i) => {
    const segments: Array<[number, number]> = [[0, 0]]  // [generated column, original column]
    let shift = 0
    while (k < inserts.length && inserts[k][0] <= offset + line.length) {
      const col = inserts[k][0] - offset
      shift += inserts[k][1].length
      segments.push([col + shift, col])
      k++
    }
    offset += line.length + 1
    let genCol = 0
    return segments.map(([gen, col]) => {
      const seg = vlq(gen - genCol) + 'A' + vlq(i - prevLine) + vlq(col - prevCol)
      genCol = gen
      prevLine = i
      prevCol = col
      return seg
    }).join(',')
  }).join(';')

  return {
    code: out,
    map: { version: 3, sources: [id], sourcesContent: [code], names: [] as string[], mappings },
  }
}

// A top-level (column 0) defineElement(...) call, as a statement or a declaration's value
const DEFINE_ELEMENT_CALL_RE = /^(?:(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*=\s*)?defineElement\s*\(/m
const ELEMENT_IMPORT_RE = /import\s+\{[^}]*\bdefineElement\b[^}]*\}\s+from\s+['"]sygnal\/element['"]/

/**
 * PLAN-4 GS-13: a module that defines custom elements with 'sygnal/element' accepts its own
 * hot updates. Re-running it calls defineElement again for the same tags, which swaps the
 * component in every live element and keeps each one's state; an edited component module it
 * imports reaches it the same way. Only for a top-level defineElement call, outside test
 * files, when the module has no HMR code of its own and doesn't import run() (an entry's
 * run() wiring decides there).
 */
function elementHmr(code: string, noComments: string, id: string) {
  if (/\.(test|spec)\.[jt]sx?$/.test(id)) return null
  if (!ELEMENT_IMPORT_RE.test(noComments) || noComments.includes('import.meta.hot')) return null
  if (!DEFINE_ELEMENT_CALL_RE.test(blankOut(code, true))) return null
  return withSourcemap(code, [], ELEMENT_HMR_BLOCK, id)
}

const ELEMENT_HMR_BLOCK = `
if (import.meta.hot) import.meta.hot.accept()
`

function hmrBlock(componentPath: string, hmrRef: string, disposeRef: string): string {
  return `
if (import.meta.hot) {
  import.meta.hot.accept('${componentPath}', ${hmrRef})
  import.meta.hot.dispose(${disposeRef})
}
`
}
