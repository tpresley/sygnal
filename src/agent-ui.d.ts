// 'sygnal/agent-ui': a Sygnal app rendered for an LLM agent, on 'sygnal/host'. Guide: https://sygnal.js.org/renderers/agent-ui
import type { HostDocument, HostElement, HostSource, HostStyleRule } from 'sygnal/host'

/** A snapshot node */
export interface AgentNode {
  role: string
  name?: string
  /** `e<id>`: what tools act on */
  ref?: string
  value?: string
  /** checked, disabled, expanded, pressed, selected, focused, required, level=n */
  states?: string[]
  /** events the app's intents listen for on a non-native element */
  on?: string[]
  text?: string
  children?: AgentNode[]
}
export function snapshotTree(doc: HostDocument, options?: { rules?: readonly HostStyleRule[] }): AgentNode[]
export function formatSnapshot(nodes: AgentNode[], indent?: string): string
export function roleOf(el: HostElement): string | null
export function nameOf(el: HostElement, rules?: readonly HostStyleRule[]): string

export interface AgentUIOptions {
  /** what is shown: `['.todo .edit', { display: 'none' }]` */
  styles?: readonly HostStyleRule[]
  /** a link's default action (a router driver's go) */
  onNavigate?: (href: string, el: HostElement) => void
  /** quiet time before a tool call answers (ms, default 20) */
  quietMs?: number
  /** longest wait for the app to settle (ms, default 2000) */
  maxWaitMs?: number
  document?: HostDocument
}

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, any>
  annotations?: Record<string, any>
}
export interface AgentUITool extends McpTool {
  annotations: { readOnlyHint?: boolean, destructiveHint?: boolean }
}
export type AgentUIResult =
  | { ok: true, snapshot: string }
  | { ok: false, error: string, snapshot?: string }

export interface AgentUI {
  readonly doc: HostDocument
  /** run(App, { DOM: ui.driver }) */
  readonly driver: (vnode$: any, name?: string) => HostSource
  snapshot(): string
  tree(): AgentNode[]
  element(ref: string): HostElement | null
  /** ui_snapshot, ui_click, ui_type, ui_press, ui_select, ui_check */
  tools(): AgentUITool[]
  /** the tools as ChatRequest.tools (sygnal/ai) */
  chatTools(): Record<string, { description: string, inputSchema: Record<string, any> }>
  /** run a tool; answers after the app settles, with the new snapshot */
  call(name: string, args?: Record<string, any>): Promise<AgentUIResult>
  /** run()'s result, to wait on its flushes (runAgentUI does this) */
  attach(app: any): void
  settle(): Promise<void>
  subscribe(listener: () => void): () => void
}
export function createAgentUI(options?: AgentUIOptions): AgentUI

export interface RunAgentUIOptions extends AgentUIOptions {
  drivers?: Record<string, any>
  runOptions?: Record<string, any>
}
export function runAgentUI(App: any, options?: RunAgentUIOptions): { app: any, ui: AgentUI }

/** a tool set served alongside: sygnal/ai's agentTools(app), or your own */
export interface ExtraTools {
  list(): { name: string, description: string, inputSchema: Record<string, any>, annotations?: Record<string, any> }[]
  call(name: string, args?: unknown): Promise<unknown>
  subscribe?(listener: (change: any) => void): () => void
}
export interface ServeMcpOptions {
  name?: string
  version?: string
  instructions?: string
  tools?: ExtraTools
  /** default process.stdin / process.stdout */
  input?: any
  output?: any
}
export interface McpStdio {
  listChanged(): void
  stop(): void
  done: Promise<void>
}
/** the UI tools (and extra tools) as an MCP server over newline-delimited JSON (default stdio) */
export function serveMcp(ui: AgentUI, options?: ServeMcpOptions): McpStdio

export interface McpToolResult { text: string, value?: Record<string, any>, isError?: boolean }
export interface McpServerSpec {
  name: string
  version: string
  instructions?: string
  tools(): McpTool[]
  call(name: string, args: Record<string, any>): Promise<McpToolResult>
}
export function createMcpHandler(spec: McpServerSpec): { handle(message: unknown, inBatch?: boolean): Promise<unknown> }
export function serveMcpStream(spec: McpServerSpec, input?: any, output?: any): McpStdio
