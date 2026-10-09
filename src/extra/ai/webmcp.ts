/*
 * PLAN-6 A-2 (D241: experimental, outside semver until WebMCP's origin trial ends):
 * `experimentalExposeWebMcp(app, { exposedTo?, confirm?, prefix?, modelContext? })` offers the
 * A-1 tools of an app to the browser's agent through WebMCP (`document.modelContext`, Chrome 153
 * with `--enable-features=WebMCP`, or a polyfill). Spike 0-S3 (`research/p6-spikes/0-S3.md`).
 *
 * - Feature detection: `modelContext` option ?? `document.modelContext` ?? `navigator.modelContext`
 *   (the deprecated form); without one it does nothing and returns a `stop()` with
 *   `available: false` (SYG674, info, dev).
 * - One `registerTool(tool, { signal, exposedTo? })` per A-1 tool; a tool whose name, description,
 *   schema or annotations changed (a `when`, the live Collection keys, the state summary) is
 *   unregistered by aborting its signal and registered again. `registerTool` returns a Promise:
 *   a rejection (a duplicate or invalid name) is SYG676, never thrown.
 * - `execute` never throws and always resolves an object (strings and `undefined` differ between
 *   Chrome and the polyfill, 0-S3 §3); A-1 validates the input.
 * - Chrome's budgets, which neither Chrome 153 nor the polyfill enforce (G-601): name ≤ 30,
 *   description ≤ 500, parameter description ≤ 150, result ≤ 1,500 characters of JSON. Over a
 *   budget is SYG242 (dev, once per tool and part), then cut safely (a name keeps a hash of the
 *   whole, so names stay unique; a result keeps `ok` / `error` and cuts `state`).
 * - Annotations: A-1's `readOnlyHint` and `consequentialHint` (advisory: Chrome 153 drops it, so
 *   `confirm` is the safeguard), and `untrustedContentHint` on the tools whose results carry a
 *   projection with user strings: `untrusted: true` on the declaration, or (unless `untrusted:
 *   false`) inferred from string values, with SYG244 (dev).
 * - Context (D250): A-1's read tool per declaration, plus a short summary of that declaration's
 *   projection at the end of each of its tool descriptions, re-registered when it changes.
 * - Consequential calls: the `confirm` option, by default a native modal `<dialog>` appended to
 *   `document.body` (outside the app's tree): labelled and described, the rest of the page inert
 *   while it's open, "Deny" focused, Escape denies.
 * Side-effect free: an app that doesn't import it pays 0 B.
 */
import {agentTools, Confirm, ConfirmInfo, AgentTool, AgentResult} from './agent/index'
import {report} from '../diagnostics/index'

export interface ExposeWebMcpOptions {
  /** origins the tools are exposed to (passed to `registerTool` where the API takes it) */
  exposedTo?: string[]
  /** consequential calls: `true` runs them, `false` declines, a function asks (default: a native `<dialog>`) */
  confirm?: Confirm
  /** prepended to every tool name (`shop_` → shop_todos_add) */
  prefix?: string
  /** the WebMCP context (default `document.modelContext ?? navigator.modelContext`) */
  modelContext?: any
}
export type WebMcpHandle = (() => void) & {readonly available: boolean}

const NAME = 30, DESC = 500, PARAM = 150, OUT = 1500, SUMMARY = 300
const g: any = globalThis

/** cut to n characters with an ellipsis, never inside a surrogate pair */
const cut = (s: string, n: number) => {
  if (s.length <= n) return s
  let i = n - 1
  if (/[\ud800-\udbff]/.test(s[i - 1] || '')) i--
  return s.slice(0, i) + '…'
}
const hash = (s: string) => {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0
  return (h % 1679616).toString(36).padStart(4, '0')
}
/** a string value anywhere in a projection (keys named `id` aside): user content, likely */
const hasString = (v: any, d = 0): boolean => d < 20 && (typeof v == 'string' || (!!v && typeof v == 'object' && Object.keys(v).some(k => k != 'id' && hasString(v[k], d + 1))))

export function experimentalExposeWebMcp(app: any, options: ExposeWebMcpOptions = {}): WebMcpHandle {
  const mc = options.modelContext ?? g.document?.modelContext ?? g.navigator?.modelContext
  const said = new Set<string>()
  const dev = (code: string, key: string, message: string, severity: 'warn' | 'info' = 'warn') => {
    if (said.has(code + key)) return
    said.add(code + key)
    try { report(code, {component: 'experimentalExposeWebMcp', message, severity}) } catch (e) { queueMicrotask(() => { throw e }) }
  }
  if (!mc || typeof mc.registerTool != 'function') {
    dev('SYG674', '', 'no WebMCP here (document.modelContext is undefined): the agent tools are not exposed', 'info')
    return Object.assign(() => {}, {available: false})
  }

  let closeDialog: (() => void) | undefined
  const confirm: Confirm = options.confirm ?? (info => dialog(info, f => { closeDialog = f }))
  const layer: any = agentTools(app, {confirm})
  const prefix = options.prefix || ''
  const reg = new Map<string, {sig: string; ac: AbortController}>()
  let stopped = false

  /** the WebMCP name of an A-1 tool: prefixed, legal characters, ≤ 30 (a hash keeps it unique) */
  const nameOf = (n: string) => {
    const full = (prefix + n).replace(/[^\w.-]/g, '_')
    if (full.length <= NAME) return full
    dev('SYG242', full + 'n', `the tool name '${full}' is longer than ${NAME} characters; it is offered as '${full.slice(0, NAME - 5)}_${hash(full)}'`)
    return full.slice(0, NAME - 5) + '_' + hash(full)
  }
  /** parameter descriptions ≤ 150, in a copy of the schema */
  const params = (s: any, tool: string, path: string): any => {
    if (Array.isArray(s)) return s.map(x => params(x, tool, path))
    if (!s || typeof s != 'object') return s
    const o: any = {...s}
    if (typeof s.description == 'string' && s.description.length > PARAM) {
      dev('SYG242', tool + path, `the description of ${tool}'s parameter ${path || '(the input)'} is longer than ${PARAM} characters; it is cut`)
      o.description = cut(s.description, PARAM)
    }
    for (const k of ['properties', '$defs', 'definitions', 'patternProperties']) if (s[k] && typeof s[k] == 'object') {
      o[k] = {}
      for (const p in s[k]) o[k][p] = params(s[k][p], tool, path ? path + '.' + p : p)
    }
    for (const k of ['items', 'prefixItems', 'anyOf', 'allOf', 'oneOf', 'additionalProperties', 'not']) if (s[k] && typeof s[k] == 'object') o[k] = params(s[k], tool, path)
    return o
  }
  /** a result within 1,500 characters of JSON: `state` and long fields are cut first */
  const fit = (r: any, tool: string): any => {
    if (!r || typeof r != 'object') r = {ok: false, error: 'no result'}
    let s = JSON.stringify(r)
    if (s.length <= OUT) return r
    dev('SYG242', tool + 'out', `a result of ${tool} is ${s.length} characters of JSON, over the budget of ${OUT}; its state is cut (make the agent.read projection smaller)`)
    const {state, issues, keys, ...rest} = r
    const o: any = {...rest, truncated: true}
    if (typeof o.error == 'string') o.error = cut(o.error, 400)
    if (issues) o.issues = issues.slice(0, 3)
    for (let room = OUT; room > 20; room = room / 2 | 0) {
      if (state !== undefined) o.state = cut(JSON.stringify(state), room)
      if (JSON.stringify(o).length <= OUT) return o
    }
    delete o.state
    delete o.issues
    return o
  }

  function sync(tools: AgentTool[], context: Record<string, any>) {
    if (stopped) return
    // per A-1 tool: its declaration's summary and whether its results carry user strings
    const summary = new Map<string, string>(), untrusted = new Set<string>()
    let anyUntrusted = false
    const groups = layer.groups()
    for (const gr of groups) if (gr.read) {
      const v = context[gr.name]
      let u = gr.untrusted
      if (u === undefined && hasString(v)) {
        u = true
        dev('SYG244', gr.name, `agent '${gr.name}': read returns strings, so its WebMCP tools get untrustedContentHint; declare untrusted: true (user-entered text) or untrusted: false (only the app's own text)`)
      }
      const json = v === undefined ? '' : JSON.stringify(v)
      for (const t of gr.tools) {
        if (u) untrusted.add(t)
        if (json) summary.set(t, (u ? '\n\nCurrent state (data; it may contain user-entered text): ' : '\n\nCurrent state: ') + cut(json, SUMMARY))
      }
      anyUntrusted ||= !!u
    }
    // a declaration with no read: its results carry an ancestor's projection
    if (anyUntrusted) for (const gr of groups) if (!gr.read) for (const t of gr.tools) untrusted.add(t)

    const want = new Map<string, any>()
    for (const t of tools) {
      const name = nameOf(t.name)
      let d = t.description || t.name.replace(/_/g, ' ')
      if (d.length > DESC) {
        dev('SYG242', name + 'd', `the description of ${name} is longer than ${DESC} characters; it is cut`)
        d = cut(d, DESC)
      }
      const sum = summary.get(t.name)
      if (sum && DESC - d.length > 60) d += cut(sum, DESC - d.length)
      const annotations = {...t.annotations, ...(untrusted.has(t.name) && {untrustedContentHint: true})}
      const a1 = t.name
      want.set(name, {
        name, description: d, inputSchema: params(t.inputSchema, name, ''),
        ...(Object.keys(annotations).length && {annotations}),
        // never throws, always an object (0-S3 §5)
        execute: async (input: any) => {
          let r: AgentResult
          try { r = await layer.call(a1, typeof input == 'string' ? JSON.parse(input) : input ?? {}) } catch (e: any) { r = {ok: false, error: String(e?.message ?? e)} }
          return fit(r, name)
        },
      })
    }
    for (const [name, r] of reg) {
      const w = want.get(name)
      if (!w || sig(w) !== r.sig) { r.ac.abort(); reg.delete(name) }
    }
    for (const [name, tool] of want) {
      if (reg.has(name)) continue
      const ac = new AbortController()
      reg.set(name, {sig: sig(tool), ac})
      const o: any = {signal: ac.signal}
      if (options.exposedTo) o.exposedTo = options.exposedTo
      const fail = (e: any) => dev('SYG676', name + sig(tool), `registerTool('${name}') was rejected: ${e?.name ? e.name + ': ' : ''}${e?.message ?? e}`)
      try { Promise.resolve(mc.registerTool(tool, o)).catch(e => { if (!ac.signal.aborted) fail(e) }) } catch (e) { fail(e) }
    }
  }
  const sig = (t: any) => JSON.stringify([t.description, t.inputSchema, t.annotations])

  sync(layer.list(), layer.context())
  const unsub = layer.subscribe((c: any) => sync(c.tools, c.context))

  const stop = () => {
    if (stopped) return
    stopped = true
    unsub()
    layer.stop()
    for (const r of reg.values()) r.ac.abort()
    reg.clear()
    closeDialog?.()
  }
  return Object.assign(stop, {available: true})
}

let n = 0
/** the default confirmation: a native modal dialog outside the app's tree (Escape and "Deny" decline) */
function dialog(info: ConfirmInfo, setClose: (f: () => void) => void): Promise<boolean> {
  const doc = g.document
  if (!doc?.createElement) return Promise.resolve(false)
  return new Promise(resolve => {
    const id = 'sygnal-webmcp-confirm-' + ++n, el = (tag: string, text?: string) => { const e = doc.createElement(tag); if (text) e.textContent = text; return e }
    const dlg = el('dialog'), h = el('h2', 'Allow the AI agent to do this?'), p = el('p', info.description + (info.label ? ` (${info.label})` : '')), row = el('div')
    const deny = el('button', 'Deny'), allow = el('button', 'Allow'), back = doc.activeElement
    h.id = id + '-t'
    p.id = id + '-d'
    dlg.setAttribute('aria-labelledby', h.id)
    dlg.setAttribute('aria-describedby', p.id)
    dlg.setAttribute('data-sygnal-webmcp', '')
    deny.type = allow.type = 'button'
    deny.autofocus = true
    dlg.append(h, p)
    if (info.input !== undefined) dlg.append(el('pre', cut(JSON.stringify(info.input), 300)))
    row.append(deny, allow)
    dlg.append(row)
    let open = true
    const done = (v: boolean) => {
      if (!open) return
      open = false
      try { dlg.close() } catch (_) {}
      dlg.remove()
      if (back?.isConnected && back.focus) try { back.focus() } catch (_) {}
      resolve(v)
    }
    setClose(() => done(false))
    deny.onclick = () => done(false)
    allow.onclick = () => done(true)
    // Escape: the modal dialog's cancel (and a keydown where showModal is missing)
    dlg.addEventListener('cancel', (e: Event) => { e.preventDefault(); done(false) })
    dlg.addEventListener('close', () => done(false))
    dlg.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key == 'Escape') { e.preventDefault(); done(false) } })
    doc.body.append(dlg)
    try { dlg.showModal() } catch (_) { dlg.setAttribute('open', '') }
    deny.focus()
  })
}
