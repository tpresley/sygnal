/*
 * PLAN-6 X-1 (D247): `makeMcpAppDriver(options?)`, the view side of MCP Apps (SEP-1865, protocol
 * 2026-01-26): a Sygnal app as the HTML resource a host (Claude, ChatGPT, VS Code, MCPJam, the
 * ext-apps basic-host) shows in a sandboxed iframe, talking JSON-RPC 2.0 over postMessage with
 * the host window. Hand-written (D209: the `@modelcontextprotocol/ext-apps` SDK is a test-only
 * devDependency; its `App` pulls in the MCP client and zod).
 *
 * - Handshake on start: `ui/initialize` { appInfo, appCapabilities, protocolVersion } →
 *   { hostInfo, hostCapabilities, hostContext }, then `ui/notifications/initialized`. Requests
 *   made before it completes are queued. With no host (not in an iframe, SSR) nothing is sent and
 *   every request gets its `error` action.
 * - Source `MCP.select(type)`: 'tool-input' ({ arguments } → the arguments object),
 *   'tool-input-partial' (the same, streamed while the model writes them), 'tool-result' (the
 *   CallToolResult: { content, structuredContent?, isError? }), 'tool-cancelled' ({ reason? }),
 *   'host-context-changed' (the whole host context, merged: first the one from the handshake,
 *   then after each change) and 'teardown' (the host is about to remove the view; it is answered
 *   after the actions it caused have run). The latest tool-input, tool-result and host context
 *   are replayed to a stream that starts later (a component shown after they arrived).
 * - Sink values (reply actions `ok` / `error` to the sending instance, like makeFetchDriver):
 *   - `{ callTool: name, args?, ok?, error? }`: `tools/call` on the MCP server through the host;
 *     ok gets the CallToolResult, error `{ error, result?, request }` (a JSON-RPC error, or a
 *     result with isError: true);
 *   - `{ updateModelContext }`: `ui/update-model-context`; a string → one text block, an array →
 *     content blocks, an object → structuredContent (or `{ content, structuredContent }` as is);
 *   - `{ message }`: `ui/message` as the user; a string or content blocks;
 *   - `{ openLink: url }`: `ui/open-link`;
 *   - `{ displayMode: 'inline' | 'fullscreen' | 'pip' }`: `ui/request-display-mode` (ok gets
 *     `{ mode }`, the mode the host chose);
 *   - G-641: `{ downloadFile }`: `ui/download-file` { contents } (EmbeddedResource / ResourceLink
 *     blocks; a bare `{ uri, mimeType, text | blob }` is embedded); `{ readResource: uri }`:
 *     `resources/read`; `{ listResources: true | { cursor } }`: `resources/list`;
 *     `{ createMessage }`: `sampling/createMessage` (a string is one user message; maxTokens
 *     defaults to 1024); notifications (ok runs once sent): `{ log, level?, logger? }`:
 *     `notifications/message`, `{ requestTeardown: true }`: `ui/notifications/request-teardown`.
 * - Source `MCP.select('host')`: { hostInfo, hostCapabilities, protocolVersion } of the
 *   handshake (replayed), to check e.g. `hostCapabilities.sampling` / `downloadFile`.
 * - Host → view requests: `ping`; `ui/resource-teardown`; with `tools: agentTools`, `tools/list` and
 *   `tools/call` serve the app's A-1 tools (`appCapabilities.tools`, `listChanged`
 *   notifications); anything else is -32601.
 * - `autoResize` (default true): `ui/notifications/size-changed` from a ResizeObserver, as the SDK.
 * - Dispose: the listener and observer go; pending requests are dropped.
 * Side-effect free: an app that doesn't import it pays 0 B.
 */
import xs from 'xstream'
import {senderOf, allowed, makeReplies} from '../replies'
import type {Confirm} from './agent/index'
import {labelsUntrusted, unlabel, lookUp} from './agent/index'

/**
 * G-644 (D286): the offered tools, user-entered `agent.label`s out of the schemas the host's model
 * reads; G-650: an item tool without labels names the read tool to call first
 */
const offered = (t: any) => {
  const gs = t.groups?.() || [], bare = new Set<string>(), look = new Map<string, any>()
  for (const g of gs) if (labelsUntrusted(g)) for (const n of g.tools) bare.add(n)
  for (const g of gs) if (g.reader) for (const n of g.tools) if (!g.labels || bare.has(n)) look.set(n, g)
  const where = gs.some((g: any) => g.read) ? 'the read tool has their contents' : 'their labels are user text, not shown'
  return t.list().map(({error, ...x}: any) => {
    const g = look.get(x.name)
    if (g) x = {...x, description: lookUp(x.description || '', g, g.reader)}
    return bare.has(x.name) ? {...x, inputSchema: unlabel(x.inputSchema, g ? `${g.reader} has their contents` : where)} : x
  })
}

export type McpAppEvent = 'tool-input' | 'tool-input-partial' | 'tool-result' | 'tool-cancelled' | 'host-context-changed' | 'teardown' | 'host'

export interface McpAppDriverOptions {
  /** `appInfo` of the handshake (default `{ name: document.title || 'sygnal-app', version: '0.0.0' }`) */
  appInfo?: {name: string; version: string; [k: string]: any}
  /** display modes the view supports (`appCapabilities.availableDisplayModes`) */
  availableDisplayModes?: Array<'inline' | 'fullscreen' | 'pip'>
  /** report the document's size to the host (default true) */
  autoResize?: boolean
  /**
   * `agentTools` (from sygnal/ai): offer the app's `agent` tools (A-1) to the host as the view's
   * own tools. Passed in, so an app that doesn't use it doesn't bundle the agent layer.
   */
  tools?: (target: any, options: any) => any
  /** with `tools`: consequential calls run when it resolves true (default: declined) */
  confirm?: Confirm
  /** the host window (default `window.parent`) */
  host?: any
  /** the window to listen on (default `window`) */
  window?: any
  /** protocol version offered (default '2026-01-26') */
  protocolVersion?: string
}

const G: any = globalThis
const PROTOCOL = '2026-01-26'
const N = 'ui/notifications/'
const REPLAY: Record<string, 1> = {'tool-input': 1, 'tool-result': 1, 'host-context-changed': 1, host: 1}
/** sink key → [method, params of the value] */
const text = (v: any) => typeof v == 'string' ? [{type: 'text', text: v}] : v
const REQUESTS: Record<string, [string, (v: any) => any]> = {
  callTool: ['tools/call', v => ({name: v.callTool, arguments: v.args ?? {}})],
  updateModelContext: ['ui/update-model-context', ({updateModelContext: u}) =>
    typeof u == 'string' || Array.isArray(u) ? {content: text(u)}
    : u && (u.content || u.structuredContent) && Object.keys(u).every(k => k == 'content' || k == 'structuredContent') ? {...u, ...(u.content && {content: text(u.content)})}
    : {structuredContent: u}],
  message: ['ui/message', v => ({role: 'user', content: text(v.message)})],
  openLink: ['ui/open-link', v => ({url: v.openLink})],
  displayMode: ['ui/request-display-mode', v => ({mode: v.displayMode})],
  // G-641: an item without `type` is a resource's contents ({ uri, mimeType, text | blob }), embedded
  downloadFile: ['ui/download-file', ({downloadFile: d}) => ({contents: (Array.isArray(d) ? d : [d]).map((c: any) => c && !c.type ? {type: 'resource', resource: c} : c)})],
  readResource: ['resources/read', ({readResource: r}) => typeof r == 'string' ? {uri: r} : r],
  listResources: ['resources/list', ({listResources: l}) => l && typeof l == 'object' ? l : {}],
  createMessage: ['sampling/createMessage', ({createMessage: c}) => {
    const p = typeof c == 'string' ? {messages: c} : {...c}
    if (typeof p.messages == 'string') p.messages = [{role: 'user', content: {type: 'text', text: p.messages}}]
    return {maxTokens: 1024, ...p}
  }],
}
/** G-641: sink key → [notification method, params] (no answer: `ok` is called once it is sent) */
const NOTIFY: Record<string, [string, (v: any) => any]> = {
  log: ['notifications/message', v => ({level: v.level || 'info', ...(v.logger && {logger: v.logger}), data: v.log})],
  requestTeardown: ['ui/notifications/request-teardown', () => ({})],
}

/** agent: the runtime API of the app being constructed (its layer runs right before its drivers start) */
let building: any
const layer = (api: any) => {
  building = api
  queueMicrotask(() => { building = undefined })
  return {}
}

export function makeMcpAppDriver(options: McpAppDriverOptions = {}) {
  if (options.tools) {
    const D = G.__SYGNAL_DIAGNOSTICS__ ||= {}, L = D.layers ||= new Set()
    if (L.add) L.add(layer)
    else if (!L.includes(layer)) L.push(layer)
  }
  return (sink$: any) => {
    const api = building
    building = undefined
    const win = options.window ?? G.window
    const host = options.host ?? (win && win.parent !== win ? win.parent : undefined)
    const subs = new Map<string, Set<any>>()
    const last = new Map<string, any>()
    const pending = new Map<number, (m: any) => void>()
    let queue: any[] | null = [], id = 0, disposed = false, context: any = {}, stopResize: any, tools: any, offTools: any

    const post = (m: any) => { try { host.postMessage({jsonrpc: '2.0', ...m}, '*') } catch (e) { console.error('[Sygnal] makeMcpAppDriver', e) } }
    const send = (m: any) => queue ? queue.push(m) : post(m)
    const request = (method: string, params: any, done: (m: any) => void, early?: boolean) => {
      const m = {id: ++id, method, params}
      pending.set(m.id, done)
      early ? post(m) : send(m)
    }
    const emit = (type: string, data: any) => {
      if (REPLAY[type]) last.set(type, data)
      subs.get(type)?.forEach(l => { try { l.next(data) } catch (e) { console.error(e) } })
    }
    const {replies, reply} = makeReplies()

    const serve = async (m: any) => {
      const p = m.params || {}
      if (m.method == 'ping') return {}
      if (m.method == 'ui/resource-teardown') {
        emit('teardown', p)
        // answered after the actions it caused (their flush and the requests they sent)
        for (let i = 0; i < 3; i++) await Promise.resolve()
        return {}
      }
      if (tools && m.method == 'tools/list') return {tools: offered(tools)}
      if (tools && m.method == 'tools/call') {
        let r: any
        try { r = await tools.call(p.name, p.arguments ?? {}) } catch (e: any) { r = {ok: false, error: String(e?.message ?? e)} }
        return {content: [{type: 'text', text: JSON.stringify(r)}], structuredContent: r, ...(!r?.ok && {isError: true})}
      }
      throw {code: -32601, message: 'Method not found: ' + m.method}
    }

    const onMessage = (ev: any) => {
      const m = ev.data
      if (disposed || ev.source !== host || !m || m.jsonrpc !== '2.0') return
      if (m.method === undefined) {
        const done = pending.get(m.id)
        if (done) { pending.delete(m.id); done(m) }
      } else if (m.id !== undefined) {
        serve(m).then(result => post({id: m.id, result}), (e: any) => post({id: m.id, error: {code: e?.code ?? -32603, message: String(e?.message ?? e)}}))
      } else if (typeof m.method == 'string' && m.method.startsWith(N)) {
        const type = m.method.slice(N.length), p = m.params || {}
        if (type == 'host-context-changed') emit(type, context = {...context, ...p})
        else if (type == 'tool-input' || type == 'tool-input-partial') emit(type, p.arguments ?? {})
        else if (type == 'tool-result' || type == 'tool-cancelled') emit(type, p)
      }
    }

    const resize = () => {
      const RO = G.ResizeObserver, doc = G.document
      if (options.autoResize === false || typeof RO != 'function' || !doc) return
      let w = 0, h = 0, busy = false
      const measure = () => {
        if (busy) return
        busy = true
        // a frame, raced with a 100 ms timer: rAF is throttled in an off-screen or hidden iframe
        // (WebKit, a view scrolled out of the host's chat), and the size must still be reported
        let ran = false
        const once = (f: () => void) => () => { if (!ran) { ran = true; f() } }
        const go = once(() => {
          busy = false
          const el = doc.documentElement, old = el.style.height
          el.style.height = 'max-content'
          const H = Math.ceil(el.getBoundingClientRect().height)
          el.style.height = old
          const W = Math.ceil(G.innerWidth || 0)
          if (W !== w || H !== h) { w = W; h = H; send({method: N + 'size-changed', params: {width: W, height: H}}) }
        })
        G.requestAnimationFrame?.(go)
        setTimeout(go, 100)
      }
      measure()
      const ro = new RO(measure)
      ro.observe(doc.documentElement)
      if (doc.body) ro.observe(doc.body)
      stopResize = () => ro.disconnect()
    }

    if (host && win) {
      win.addEventListener('message', onMessage)
      if (options.tools && api) {
        tools = options.tools(api, {confirm: options.confirm})
        // list_changed only when the tools changed (not on every context change); the first is the list at start
        let was: string | undefined
        offTools = tools.subscribe(({tools: t}: any) => {
          const now = JSON.stringify(t)
          if (was !== undefined && now !== was) send({method: 'notifications/tools/list_changed'})
          was = now
        })
      }
      const doc = G.document
      request('ui/initialize', {
        appInfo: options.appInfo ?? {name: doc?.title || 'sygnal-app', version: '0.0.0'},
        appCapabilities: {
          ...(tools && {tools: {listChanged: true}}),
          ...(options.availableDisplayModes && {availableDisplayModes: options.availableDisplayModes}),
        },
        protocolVersion: options.protocolVersion ?? PROTOCOL,
      }, m => {
        if (m.error) return console.error('[Sygnal] makeMcpAppDriver: ui/initialize failed', m.error)
        const r = m.result || {}
        emit('host', {hostInfo: r.hostInfo, hostCapabilities: r.hostCapabilities || {}, protocolVersion: r.protocolVersion})
        if (r.hostContext) emit('host-context-changed', context = {...r.hostContext})
        post({method: N + 'initialized'})
        const q = queue || []
        queue = null
        q.forEach(post)
        resize()
      }, true)
    }

    sink$.addListener({
      next: (v: any) => {
        if (!v || typeof v != 'object' || disposed || !allowed(v, 'makeMcpAppDriver')) return
        const k = Object.keys(REQUESTS).find(k => v[k] !== undefined)
        const n = k ? undefined : Object.keys(NOTIFY).find(k => v[k] !== undefined && v[k] !== false)
        const sender = senderOf(v)
        const answer = (ok: boolean, data: any) => {
          const action = ok ? v.ok : v.error
          if (sender !== undefined && typeof action == 'string') reply(sender, action, data)
          else if (!ok) console.error('[Sygnal] makeMcpAppDriver', data.error, v)
        }
        if (!k && !n) return console.error('[Sygnal] makeMcpAppDriver: expected { callTool }, { updateModelContext }, { message }, { openLink }, { displayMode }, { downloadFile }, { readResource }, { listResources }, { createMessage }, { log } or { requestTeardown }', v)
        if (!host) return answer(false, {error: 'not running in an MCP Apps host', request: v})
        if (n) {
          const [method, params] = NOTIFY[n]
          send({method, params: params(v)})
          return answer(true, {})
        }
        const [method, params] = REQUESTS[k!]
        request(method, params(v), m => {
          if (m.error) answer(false, {error: m.error.message, code: m.error.code, request: v})
          else if (m.result?.isError) answer(false, {error: (m.result.content || []).map((c: any) => c.text).filter(Boolean).join('\n') || method + ' failed', result: m.result, request: v})
          else answer(true, m.result)
        })
      },
      error: (e: any) => console.error('[Sygnal] makeMcpAppDriver', e),
      complete: () => {},
    })

    const source = {
      select: (type: McpAppEvent) => {
        let mine: any
        return xs.create<any>({
          start: l => {
            let s = subs.get(type)
            if (!s) subs.set(type, s = new Set())
            s.add(mine = l)
            if (last.has(type)) l.next(last.get(type))
          },
          stop: () => { subs.get(type)?.delete(mine) },
        })
      },
      isolateSource: (s: any) => s,
      isolateSink: (s: any) => s,
      isolateValue: (v: any) => v,
      ...replies,
    }
    return {
      ...source,
      dispose: () => {
        disposed = true
        win?.removeEventListener?.('message', onMessage)
        stopResize?.()
        offTools?.()
        tools?.stop()
        pending.clear()
        subs.clear()
      },
    }
  }
}
