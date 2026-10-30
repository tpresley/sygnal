/*
 * 'sygnal/agent-ui': a Sygnal app rendered for an LLM agent. The app renders into a sygnal/host
 * tree; this target's "screen" is an accessibility snapshot (roles, names, states, values, refs:
 * the format browser agents read), and its "input" is tool calls: ui_click, ui_type, ui_press,
 * ui_select, ui_check, which become the same DOM events a user's input makes. The app's views,
 * intents and models don't change: an agent operates the app the way a person does, without a
 * browser, deterministically, and in a test.
 *
 *   const {app, ui} = runAgentUI(App)
 *   ui.snapshot()                                   // what the agent sees
 *   await ui.call('ui_click', { ref: 'e12' })       // → { ok: true, snapshot }
 *   serveMcp(ui, { name: 'my-app' })                // the same tools over MCP (stdio)
 *
 * With sygnal/ai: `agentTools(app)` (the semantic tools of the app's `agent` declarations) can be
 * served alongside (`serveMcp(ui, { tools: agentTools(app) })`); `ui.chatTools()` gives the tools
 * in the chat driver's format. Separate entry: './index' and './host' become the external
 * 'sygnal' and 'sygnal/host'.
 */
import {run} from './index'
import type {HostElement, HostStyleRule} from './host'
import {
  HostDocument, makeHostDriver, nodeId,
  activate, doubleClick, pressKey, typeText, fill, chooseOption, isInteractive,
} from './host'
import {snapshotTree, formatSnapshot, AgentNode} from './agent-ui/snapshot'
import {serveMcpStream, McpStdio, McpTool} from './agent-ui/mcp'

export {snapshotTree, formatSnapshot, roleOf, nameOf} from './agent-ui/snapshot'
export type {AgentNode} from './agent-ui/snapshot'
export {createMcpHandler, serveMcpStream} from './agent-ui/mcp'
export type {McpTool, McpToolResult, McpServerSpec, McpStdio} from './agent-ui/mcp'

export interface AgentUIOptions {
  /** the app's stylesheet for what is shown (CSS that hides things: `['.todo .edit', { display: 'none' }]`) */
  styles?: readonly HostStyleRule[]
  /** a link's default action: an <a href> clicked and not prevented (a router driver's go) */
  onNavigate?: (href: string, el: HostElement) => void
  /** how long the app must stay unchanged before a tool call answers (ms, default 20: covers next()'s 10 ms) */
  quietMs?: number
  /** the longest a tool call waits for the app to settle (ms, default 2000) */
  maxWaitMs?: number
  /** the host document (default: a new one) */
  document?: HostDocument
}

export interface AgentUITool extends McpTool {
  annotations: {readOnlyHint?: boolean, destructiveHint?: boolean}
}
export type AgentUIResult =
  | {ok: true, snapshot: string}
  | {ok: false, error: string, snapshot?: string}

export interface AgentUI {
  readonly doc: HostDocument
  /** the DOM driver: run(App, { DOM: ui.driver }) */
  readonly driver: ReturnType<typeof makeHostDriver>
  /** the snapshot text */
  snapshot(): string
  /** the snapshot as nodes */
  tree(): AgentNode[]
  /** the element a ref names (null: gone) */
  element(ref: string): HostElement | null
  /** the tools (MCP / sygnal/ai AgentTool shape) */
  tools(): AgentUITool[]
  /** the tools in the chat driver's format: ChatRequest.tools */
  chatTools(): Record<string, {description: string, inputSchema: Record<string, any>}>
  /** run a tool; answers once the app has settled, with the new snapshot */
  call(name: string, args?: Record<string, any>): Promise<AgentUIResult>
  /** the app's runtime (run()'s result) to wait on its flushes; runAgentUI attaches it */
  attach(app: any): void
  /** resolves once the app has been quiet for quietMs */
  settle(): Promise<void>
  /** called after each change of the tree (returns unsubscribe) */
  subscribe(listener: () => void): () => void
}

const REF = {type: 'string', description: 'The element\'s ref from the snapshot, like "e12"'}
const TOOLS: AgentUITool[] = [
  {name: 'ui_snapshot', description: 'Read the app\'s current screen: an accessibility snapshot with a ref on each element you can act on. [on=…] lists events the app handles on that element.', inputSchema: {type: 'object', properties: {}, additionalProperties: false}, annotations: {readOnlyHint: true}},
  {name: 'ui_click', description: 'Click an element (a button, link, checkbox, or an element with [on=click]). double: true for a double click ([on=dblclick]).', inputSchema: {type: 'object', properties: {ref: REF, double: {type: 'boolean', description: 'A double click'}}, required: ['ref'], additionalProperties: false}, annotations: {}},
  {name: 'ui_type', description: 'Type into a text field. Replaces its value unless append is true; submit: true presses Enter afterwards (submits its form).', inputSchema: {type: 'object', properties: {ref: REF, text: {type: 'string'}, append: {type: 'boolean'}, submit: {type: 'boolean'}}, required: ['ref', 'text'], additionalProperties: false}, annotations: {}},
  {name: 'ui_press', description: 'Press a key ("Enter", "Escape", "Tab", "ArrowDown", "a", modifiers as "Control+s") on an element, or on the focused element / the whole app without a ref.', inputSchema: {type: 'object', properties: {key: {type: 'string'}, ref: REF}, required: ['key'], additionalProperties: false}, annotations: {}},
  {name: 'ui_select', description: 'Choose an option of a combobox (<select>) by its label or value.', inputSchema: {type: 'object', properties: {ref: REF, option: {type: 'string'}}, required: ['ref', 'option'], additionalProperties: false}, annotations: {}},
  {name: 'ui_check', description: 'Set a checkbox or radio to checked (true) or unchecked (false); does nothing when it already is.', inputSchema: {type: 'object', properties: {ref: REF, checked: {type: 'boolean'}}, required: ['ref', 'checked'], additionalProperties: false}, annotations: {}},
]

export function createAgentUI(options: AgentUIOptions = {}): AgentUI {
  const doc = options.document || new HostDocument()
  const rules = options.styles || []
  const ua = {onNavigate: options.onNavigate}
  const quiet = options.quietMs ?? 20, maxWait = options.maxWaitMs ?? 2000
  const listeners = new Set<() => void>()
  let changes = 0, runtime: any = null
  doc.onChange = () => { changes++; for (const l of [...listeners]) l() }
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  const find = (ref: unknown): HostElement | null => {
    const id = typeof ref == 'string' && /^e(\d+)$/.exec(ref.trim())
    if (!id) return null
    return [doc.body, ...doc.body.querySelectorAll('*')].find(el => nodeId(el) == +id[1]) || null
  }
  const target = (ref: unknown): HostElement => {
    const el = find(ref)
    if (!el) throw new Error(`no element with ref ${JSON.stringify(ref)}: take a new ui_snapshot (refs of elements that left the screen are gone)`)
    if (!el.isConnected) throw new Error(`ref ${ref} is no longer on the screen`)
    if (!isInteractive(el, rules) && !/^(input|textarea|select)$/.test(el.localName)) throw new Error(`ref ${ref} is not interactive (no ref in the snapshot)`)
    if (el.disabled) throw new Error(`ref ${ref} is disabled`)
    return el
  }
  const parseKey = (k: string) => {
    const parts = k.split('+').filter(Boolean)
    const key = parts.pop() || k
    const m = new Set(parts.map(p => p.toLowerCase()))
    return {key: key == 'Space' ? ' ' : key, init: {ctrlKey: m.has('control') || m.has('ctrl'), shiftKey: m.has('shift'), altKey: m.has('alt'), metaKey: m.has('meta') || m.has('cmd')}}
  }

  const ui: AgentUI = {
    doc,
    driver: makeHostDriver(doc),
    tree: () => snapshotTree(doc, {rules}),
    snapshot: () => formatSnapshot(ui.tree()) || '(the screen is empty)',
    element: find,
    tools: () => TOOLS.map(t => ({...t})),
    chatTools: () => Object.fromEntries(TOOLS.map(t => [t.name, {description: t.description, inputSchema: t.inputSchema}])),
    attach(app) { runtime = app?.__runtime || app || null },
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l) } },
    async settle() {
      const end = Date.now() + maxWait
      for (;;) {
        const n = changes
        if (runtime?.flushed) await runtime.flushed()
        await sleep(quiet)
        if (changes === n || Date.now() > end) return
      }
    },
    async call(name, args = {}) {
      try {
        switch (name) {
          case 'ui_snapshot': break
          case 'ui_click': {
            const el = target(args.ref)
            args.double ? doubleClick(el, ua) : (el.focus(), activate(el, ua))
            break
          }
          case 'ui_type': {
            const el = target(args.ref)
            if (typeof args.text != 'string') throw new Error('text must be a string')
            if (!/^(input|textarea)$/.test(el.localName) || /^(checkbox|radio|button|submit)$/.test(el.type)) throw new Error(`ref ${args.ref} is not a text field`)
            args.append ? typeText(el, args.text, ua) : fill(el, args.text)
            if (args.submit) pressKey(el, 'Enter', {}, ua)
            break
          }
          case 'ui_press': {
            if (typeof args.key != 'string' || !args.key) throw new Error('key must be a key name, like "Enter"')
            const el = args.ref != null ? target(args.ref) : doc.activeElement || doc.body
            if (args.ref != null) el.focus()
            const {key, init} = parseKey(args.key)
            pressKey(el, key, init, ua)
            break
          }
          case 'ui_select': {
            const el = target(args.ref)
            if (el.localName != 'select') throw new Error(`ref ${args.ref} is not a combobox`)
            el.focus()
            if (!chooseOption(el, String(args.option))) throw new Error(`no option ${JSON.stringify(args.option)}; options: ${el.options.map(o => JSON.stringify(o.textContent.trim())).join(', ')}`)
            break
          }
          case 'ui_check': {
            const el = target(args.ref)
            if (!(el.localName == 'input' && /^(checkbox|radio)$/.test(el.type))) throw new Error(`ref ${args.ref} is not a checkbox or radio`)
            if (el.checked !== !!args.checked) { el.focus(); activate(el, ua) }
            break
          }
          default:
            throw new Error(`unknown tool ${name}`)
        }
      } catch (e: any) {
        await ui.settle()
        return {ok: false, error: e?.message || String(e), snapshot: ui.snapshot()}
      }
      await ui.settle()
      return {ok: true, snapshot: ui.snapshot()}
    },
  }
  return ui
}

export interface RunAgentUIOptions extends AgentUIOptions {
  /** the app's other drivers (DOM is the agent UI's) */
  drivers?: Record<string, any>
  /** run() options (onError, diagnostics, …) */
  runOptions?: Record<string, any>
}

/** run an app for an agent: `{ app, ui }`, the ui attached to the app's flushes */
export function runAgentUI(App: any, options: RunAgentUIOptions = {}): {app: any, ui: AgentUI} {
  const ui = createAgentUI(options)
  const app = run(App, {...options.drivers, DOM: ui.driver}, options.runOptions)
  ui.attach(app)
  return {app, ui}
}

/** a tool set to serve alongside the UI tools: sygnal/ai's agentTools(app), or your own */
export interface ExtraTools {
  list(): {name: string, description: string, inputSchema: Record<string, any>, annotations?: Record<string, any>}[]
  call(name: string, args?: unknown): Promise<unknown>
  subscribe?(listener: (change: any) => void): () => void
}
export interface ServeMcpOptions {
  name?: string
  version?: string
  /** what the server tells the agent first (default: how to use the UI tools) */
  instructions?: string
  /** more tools: sygnal/ai's agentTools(app) (the app's `agent` declarations) */
  tools?: ExtraTools
  input?: any
  output?: any
}

const INSTRUCTIONS = 'This server is an app\'s user interface. Call ui_snapshot to see the screen, then act on elements by their ref (ui_click, ui_type, ui_press, ui_select, ui_check); every action answers with the new snapshot. Refs change when elements are re-created: use the latest snapshot.'

/** the agent UI's tools (and any extra tools) as an MCP server on a stream pair (default stdio) */
export function serveMcp(ui: AgentUI, options: ServeMcpOptions = {}): McpStdio {
  const extra = options.tools
  const server = serveMcpStream({
    name: options.name || 'sygnal-agent-ui',
    version: options.version || '0.0.0',
    instructions: options.instructions ?? INSTRUCTIONS,
    tools: () => [...ui.tools(), ...(extra ? extra.list().map(t => ({name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations})) : [])],
    async call(name, args) {
      if (name.startsWith('ui_')) {
        const r = await ui.call(name, args)
        return r.ok ? {text: r.snapshot, value: r} : {text: `Error: ${r.error}\n\n${r.snapshot ?? ''}`, value: r, isError: true}
      }
      const r: any = await extra!.call(name, args)
      await ui.settle()
      return {text: JSON.stringify(r), value: r && typeof r == 'object' ? r : {result: r}, isError: r?.ok === false}
    },
  }, options.input, options.output)
  // only a change of the tool set is announced (agentTools' listener also fires for context changes)
  let names = extra ? extra.list().map(t => t.name).join() : ''
  const off = extra?.subscribe?.(() => {
    const now = extra.list().map(t => t.name).join()
    if (now !== names) { names = now; server.listChanged() }
  })
  const stop = server.stop
  server.stop = () => { off?.(); stop() }
  return server
}
