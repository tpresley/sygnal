// 'sygnal/devtools' (D77): importing it installs the DevTools bridge
// (window.__SYGNAL_DEVTOOLS__) in a browser, for the Sygnal DevTools extension.
// Dev only: sygnal/vite injects it in dev; without Vite, import it before run().
// Self-contained (like the other dev entries' types); the same shape as
// SygnalDevTools in 'sygnal'.
// PLAN-4 3-E (GS-10): it also records the action log and writes "Copy as test" tests.

export interface SygnalDevTools {
  /** true while the browser extension is connected */
  readonly connected: boolean
  /** Diagnostics collected so far (same as getDiagnostics() from 'sygnal') */
  getDiagnostics(): Array<{ code: string; severity: string; message: string; [key: string]: any }>
  /** The app graph; present only when the 'sygnal/diagnostics' dev entry is loaded */
  inspect?(): any
  /** PLAN-4 3-E: defaults for "Copy as test" from the extension panel (componentImport, drivers, ...) */
  configureCopyAsTest(options: CopyAsTestOptions): void
  /** PLAN-4 3-E: one instance's recorded session (as getSession()) */
  getSession(target?: Exclude<SessionTarget, SessionRecording>): SessionRecording
}

/** The bridge singleton of this entry (also window.__SYGNAL_DEVTOOLS__ once installed). */
export declare function getDevTools(): SygnalDevTools
/** Install the bridge (done on import; idempotent). Undefined outside a browser. */
export declare function installDevTools(): SygnalDevTools | undefined

// ── PLAN-4 3-E (GS-10): the action log, "Copy as test", the Redux DevTools bridge ──

export type DevtoolsActionCause = 'intent' | 'next' | 'reply' | 'built-in' | 'simulateAction' | 'behavior' | 'agent'

/** One recorded action (the entry records every component instance's actions) */
export interface DevtoolsAction {
  /** Sequence number (session-wide) */
  seq: number
  /** The action name (a behavior's actions are namespaced, `pager.NEXT`) */
  type: string
  /** Its data, as the model got it (a DOM event for a DOM intent stream) */
  data: any
  /** The component's name */
  component: string
  /** The instance's id */
  instance: string
  /** The parent instance's id (null: a root) */
  parent: string | null
  /** Sinks that produced a value for it (live: STATE fills in when its reducer runs) */
  sinks: string[]
  cause: DevtoolsActionCause
  /** ms since the session started */
  at: number
  /** The instance's state before / after the action's STATE reducer, when it changed the state */
  before?: any
  after?: any
  /** A reply action (or RESOURCE): the source that delivered it; 'fetch' when it is makeFetchDriver's */
  replySink?: string
  replyKind?: 'fetch' | 'other'
  /** An intent action whose data is the instance's own state (an intent over STATE.stream) */
  echo?: true
}

export interface ActionFilter {
  component?: string
  instance?: string | number
  type?: string | RegExp
  cause?: DevtoolsActionCause | DevtoolsActionCause[]
}

/** One instance's recorded session, as plain data (what copyAsTest() writes the test from) */
export interface SessionRecording {
  version: 1
  component: string
  instance: string
  /** The state when the session started for this instance */
  initialState?: any
  /** The component's own initialState (renderComponent's default) */
  definitionInitialState?: any
  finalState: any
  /** The action names the component can be sent (model keys, behavior actions) */
  actionNames?: string[]
  /** Source names beyond DOM / EVENTS / STATE / LOG / CHILD / PARENT / READY */
  drivers: string[]
  /** Those of `drivers` renderComponent fakes (makeFetchDriver sources) */
  fakeable: string[]
  /** The instance's own actions, in order */
  actions: Array<Pick<DevtoolsAction, 'type' | 'data' | 'cause' | 'sinks' | 'at' | 'replySink' | 'replyKind' | 'echo'>>
  /** State changes in descendant instances a replay at this instance can't reproduce */
  foreign: Array<{ type: string; component: string; instance: string; cause: DevtoolsActionCause }>
  truncated?: boolean
}

export interface CopyAsTestOptions {
  /** The import line(s) for the component (default: `import <Name> from './<Name>.js'`) */
  componentImport?: string
  /** The component's identifier in the test (default: its recorded name) */
  componentName?: string
  /** More import lines (drivers, helpers) */
  imports?: string[]
  /** Drivers for renderComponent, as source code by sink name: { DND: 'mockDragDriver().driver' } */
  drivers?: Record<string, string>
  /** More renderComponent options, as source code: 'strict: true' */
  renderOptions?: string
  /** The test's name */
  testName?: string
  /** Adds a `// @vitest-environment <env>` first line */
  environment?: string
}

export interface CopyAsTestResult {
  /** The test file */
  code: string
  /** true when the test asserts the final state */
  complete: boolean
  /** What was left out and why (also comments in the code) */
  warnings: string[]
  /** Actions written as simulateAction / t.respond / t.fail */
  replayed: number
}

/**
 * What a session is taken from: undefined (the newest root), an instance id, a component, run()'s
 * result, or a SessionRecording from getSession()
 */
export type SessionTarget = undefined | string | number | ((...args: any[]) => any) | { sources: any } | SessionRecording

/** Start recording (done on import in a browser; idempotent). Returns a function that stops it. */
export declare function recordActions(): () => void
/** true while the action log records */
export declare function isRecording(): boolean
/** Start a new session: forget the recorded actions */
export declare function clearActions(): void
/** The session's actions, oldest first, optionally filtered */
export declare function getActions(filter?: ActionFilter): DevtoolsAction[]
/** Subscribe to the log; returns unsubscribe */
export declare function onAction(fn: (action: DevtoolsAction | null, kind: 'add' | 'update' | 'reset') => void): () => void
/** One instance's session as plain data */
export declare function getSession(target?: Exclude<SessionTarget, SessionRecording>): SessionRecording
/** "Copy as test": a Vitest + renderComponent test that replays the session */
export declare function copyAsTest(target?: SessionTarget, options?: CopyAsTestOptions): string
/** "Copy as test", with what it left out */
export declare function copyAsTestResult(target?: SessionTarget, options?: CopyAsTestOptions): CopyAsTestResult

export interface ReduxDevtoolsOptions {
  /** The instance name in the extension (default 'Sygnal') */
  name?: string
  /** Which actions to send (default: all but 'built-in' ones) */
  filter?: (action: DevtoolsAction) => boolean
}
/**
 * Send the recorded actions and the root's state to the Redux DevTools extension
 * (window.__REDUX_DEVTOOLS_EXTENSION__); jump to state / action replaces the root's state.
 * Returns a disconnect function (a no-op without the extension).
 */
export declare function connectReduxDevtools(target?: Exclude<SessionTarget, SessionRecording>, options?: ReduxDevtoolsOptions): () => void

// ── PLAN-6 E-1: the page side of sygnal/vite's dev MCP endpoint ──

export interface McpBridgeOptions {
  /** agentTools from 'sygnal' (the app's core), for the agent_tools tool */
  agentTools?: (target: any, options?: any) => any
  /** Consequential agent tools: 'page' asks with window.confirm() (default), true runs them, false declines */
  confirm?: boolean | 'page'
  /** The only app to serve (default: every run() of the page, the first one by default; `app` picks one) */
  app?: () => any
}
/**
 * Answer the dev server's MCP requests over Vite's HMR channel. sygnal/vite calls it in dev
 * when `sygnal({ mcp: true })`; you don't call it yourself.
 */
export declare function installMcpBridge(
  hot: { on(event: string, cb: (data: any) => void): void; send(event: string, data?: any): void } | undefined,
  options?: McpBridgeOptions
): void
