/*
 * PLAN-6 A-1 (0-S2): the agent layer. `agentTools(app | runtime, options)` turns the `agent`
 * statics of an app's shown instances into tools, and runs tool calls as actions with
 * `cause: 'agent'`, through the same queue, reducers and flush as a click. The chat behavior
 * (L-3), WebMCP (A-2), the command bar (M-3), the dev endpoint (E-1) and renderComponent's
 * `t.tools()` / `t.callTool()` / `t.agentContext()` (A-4) all use it.
 *
 *   Comp.agent = { name, description?, read?, label?, untrusted?,
 *                  actions: { ACTION: { description, input?, consequential?, when?, idempotent? } } }
 *
 * It reaches the app only through the runtime API (`root`, `get`, `dispatch`, `flushed`,
 * `addHooks`) and one hook layer, so the core pays 0 bytes:
 * - discovery: a walk of the shown instances (`InstanceView.shown`: hidden Switchable pages stay
 *   alive and are filtered), redone at most once per flush after onCreate / onDispose / onPatch /
 *   onReducer marked it dirty; subscribers hear about a changed tool list or context once per
 *   flush (after `flushed()`). A `setState` on a hidden page is published on the next flush that
 *   fires one of those hooks (G-595);
 * - Collection items: one tool per item declaration with a key parameter (`id`, or `item` when
 *   the input has its own `id`, D265), an enum of the live keys (`state.id`, G-592) labelled by
 *   `agent.label(state)` (D258; consumers strip user-entered labels with `unlabel`, G-644); a key hidden by the Collection's filter gets an error that says
 *   so (D257);
 * - a call: serialized (D260), then the tool, the input (`parseInput`: unwrap, repair, validate),
 *   the target, `when`, `confirm` for a consequential action (awaited BEFORE dispatch, then the
 *   target resolved and `when` checked again), dispatch with cause 'agent', `flushed()`, and the
 *   outcome measured by `wrapHandler` on that action only: success when a STATE handler changed
 *   the state structurally, a sink got a value or an EFFECT ran; `abort(reason)` refuses with the
 *   reason; otherwise "changed nothing" (`idempotent: true`: `{ ok: true, unchanged: true }`, D256);
 * - `when` and `read`: cached by state identity per instance (reducers are immutable);
 * - HMR: given the `run()` result, it re-binds to `app.__runtime` after the root's dispose.
 * Diagnostics (dev, once each): SYG240 an input with no JSON Schema form (the tool is left out;
 * `list({ all: true })` shows it with `error`), SYG241 `read` / `when` / `label` threw, SYG243 a
 * lossy input schema, SYG440 two declarations with one name, SYG441 Collection items with no or
 * duplicate keys.
 */
import {abortReason, isAbort, ORIGINAL} from '../../../shared'
import {objIsEqual} from '../../../cycle/state/objIsEqual'
import {report} from '../../diagnostics/index'
import {toJsonSchema, parseInput, isObj} from '../schema/index'

/** One tool, as an agent sees it */
export interface AgentTool {
  name: string
  description: string
  inputSchema: any
  annotations: {readOnlyHint?: true; consequentialHint?: true; untrustedContentHint?: true}
  /** a declared tool that isn't offered (SYG240), in `list({ all: true })` only */
  error?: string
}
export interface ConfirmInfo {tool: string; component: string; action: string; description: string; input: any; key?: any; label?: string}
export type Confirm = boolean | ((info: ConfirmInfo) => boolean | Promise<boolean>)
export type AgentResult = {ok: boolean; [k: string]: any}
/** internal (A-2): one declaration's offered tools */
export interface AgentGroup {name: string; untrusted?: boolean; read: boolean; tools: string[]; enums: Set<string>; labels?: Record<string, string>; reader?: string}
export interface AgentToolsOptions {
  /** consequential calls: resolve true to run (default: decline) */
  confirm?: Confirm
  /** run calls one at a time, in call order (default true, D260) */
  serial?: boolean
  /** numeric / boolean strings coerced where the schema says so (default true, D264) */
  repair?: boolean
  /** only this instance (an InstanceView or id) and its descendants */
  from?: any
  /** only these components' declarations */
  components?: any[]
}

const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/\W+/g, '_').toLowerCase()
const keyOf = (iv: any) => iv.state?.id
const done = new WeakMap<object, Set<string>>()
/** a dev diagnostic, once per (declaration, what); 'error' mode rethrows outside the caller */
const dev = (code: string, decl: any, what: string, component: string, message: string) => {
  let s = done.get(decl)
  if (!s) done.set(decl, s = new Set())
  if (s.has(code + what)) return
  s.add(code + what)
  // severities are passed (DEV_CODE_SEVERITY, kept out of the main bundle's table): 240 / 241 error, 243 / 440 / 441 warn
  try { report(code, {component, message, severity: code < 'SYG242' ? 'error' : 'warn'}) } catch (e) { queueMicrotask(() => { throw e }) }
}

/** the string `enum` / `const` values anywhere in a JSON Schema (the app's own words: filter names, statuses) */
function enumsOf(s: any, out: Set<string>, d = 0): Set<string> {
  if (!s || typeof s != 'object' || d > 20) return out
  if (Array.isArray(s)) { for (const x of s) enumsOf(x, out, d + 1); return out }
  for (const v of Array.isArray(s.enum) ? s.enum : []) if (typeof v == 'string') out.add(v)
  if (typeof s.const == 'string') out.add(s.const)
  for (const k in s) if (k != 'enum' && k != 'const' && s[k] && typeof s[k] == 'object') enumsOf(s[k], out, d + 1)
  return out
}

/** keys whose string values are the app's own (ids and enum-like fields), not user text (G-623) */
const OWN_KEYS = /^(id|status|type|kind)$/

/**
 * Whether a `read` projection holds user text, when its declaration doesn't say (`untrusted`
 * unset; WebMCP's SYG244, the chat behavior's app-state block). The rule (G-623), kept simple on
 * purpose: any string is user text except a value under a key named `id`, `status`, `type` or
 * `kind` (at any depth), and a value that is one of the string enum / const values of the same
 * declaration's action inputs (a filter name the model can set). Declare `untrusted` to be exact.
 */
export function hasUserText(v: any, enums?: Set<string>, d = 0): boolean {
  if (d > 20) return false
  if (typeof v == 'string') return !enums?.has(v)
  if (!v || typeof v != 'object') return false
  if (Array.isArray(v)) return v.some(x => hasUserText(x, enums, d + 1))
  return Object.keys(v).some(k => !OWN_KEYS.test(k) && hasUserText(v[k], enums, d + 1))
}

/**
 * D286 / G-644: whether an item declaration's `agent.label` texts are user-entered: `untrusted` as
 * declared, else inferred by hasUserText (so any label text but the app's own enum values; declare
 * `untrusted: false` to keep the labels in the schema). Shared by WebMCP, chat and the command bar
 */
export const labelsUntrusted = (g: AgentGroup): boolean =>
  !!g.labels && Object.keys(g.labels).length > 0 && (g.untrusted ?? hasUserText(Object.values(g.labels), g.enums))

/**
 * D286 / G-644: an item tool's key parameter (`id` / `item`: an enum with "Which todo (1: buy
 * milk; …)") with its ids only: `agent.label` text stays out of the schema, which agents read as
 * instructions. `where` says where the labels are instead ("the read tool has their contents")
 */
export const unlabel = (schema: any, where: string): any => {
  const props = schema?.properties
  if (!props) return schema
  let changed = false
  const out: any = {}
  for (const k in props) {
    const p = props[k], d = p?.description
    if (p && Array.isArray(p.enum) && typeof d == 'string' && /^Which \S+ \(/.test(d)) {
      out[k] = {...p, description: d.slice(0, d.indexOf(' (')) + ` (ids ${p.enum.join(', ')}; ${where})`}
      changed = true
    } else out[k] = p
  }
  return changed ? {...schema, properties: out} : schema
}

/**
 * G-650: the sentence an item tool's description gets when its key parameter has no labels (unlabel)
 * and the labels are behind a read tool: without it, small models guess an id instead of reading
 * first. Fixed text (the read tool's and the declaration's names), never a label
 */
export const lookUp = (d: string, g: AgentGroup, read: string) => {
  d = d.trim()
  return d + (!d ? '' : /[.!?]$/.test(d) ? ' ' : '. ') + `Call ${read} first to find the ${g.name}'s id.`
}

interface Entry {name: string; decl: any; ivs: any[]; item: boolean; view: any; enums: Set<string>}
interface Rec {tool: AgentTool; e: Entry; action?: string; a?: any; key?: string; off?: 1}
interface Call {id: number; type: string; data: any; ran: boolean; out: Array<{kind: string; reason?: string; error?: any}>}

/**
 * The live tool set of an app (the `run()` result, which it follows through HMR) or of a
 * runtime API (`app.__runtime`, renderComponent's)
 */
export function agentTools(target: any, options: AgentToolsOptions = {}) {
  const isApp = !!target && '__runtime' in target
  let api: any = isApp ? target.__runtime : target
  let off: (() => void) | undefined, stopped = false, ver = 0, built = -1
  let entries: Entry[] = [], recs = new Map<string, Rec>()
  /** item tools seen before: a call when no item is shown (all filtered out) explains why */
  const seen = new Map<string, Rec>()
  let current: Call | null = null, pending: Call | null = null
  const reads = new WeakMap<any, {s: any; v: any}>(), whens = new WeakMap<any, Map<string, {s: any; v: boolean}>>()
  /** item component -> its Collection owners and their `from` (hidden-by-filter errors) */
  const owners = new Map<any, Map<any, any>>()
  const listeners = new Set<(change: {tools: AgentTool[]; context: Record<string, any>}) => void>()
  let last: any, scheduled = false

  const dirty = () => {
    ver++
    if (!listeners.size || scheduled || stopped) return
    scheduled = true
    // a microtask first: onReducer runs before the write schedules the flush
    queueMicrotask(() => api.flushed().then(() => { scheduled = false; publish() }))
  }
  const hooks = {
    onCreate: dirty,
    onPatch: dirty,
    onReducer: dirty,
    onDispose: (iv: any) => {
      dirty()
      // HMR: run()'s hmr() disposes this app, starts its successor and swaps __runtime
      if (iv.isRoot && isApp) queueMicrotask(rebind)
    },
    onHostProps: (owner: any, _sel: string, props: any) => {
      if (typeof props.of == 'function') {
        let m = owners.get(props.of)
        if (!m) owners.set(props.of, m = new Map())
        m.set(owner, props.from)
      }
    },
    onAction: (iv: any, a: any) => {
      current = null
      const p = pending
      if (p && a.cause === 'agent' && iv.id === p.id && a.type === p.type && a.data === p.data) { p.ran = true; current = p; pending = null }
    },
    wrapHandler: (iv: any, type: string, sink: string, fn: any) => {
      const c = current
      if (!c || iv.id !== c.id || type !== c.type) return
      // a constant entry isn't wrapped: its outcome is known (the core: `true` / undefined send the data)
      if (typeof fn != 'function') {
        if (sink != 'EFFECT') c.out.push({kind: outcome(sink, iv.state, fn === undefined || fn === true ? c.data : fn)})
        return
      }
      const w = function (this: any, pre: any) {
        abortReason.r = undefined
        let v: any
        try { v = fn.apply(this, arguments) } catch (e) { c.out.push({kind: 'threw', error: e}); throw e }
        const reason = abortReason.r
        abortReason.r = undefined
        c.out.push(sink == 'EFFECT' ? {kind: 'effect'} : {kind: outcome(sink, pre, v), reason})
        return v
      }
      ;(w as any)[ORIGINAL] = fn[ORIGINAL] || fn
      return w
    },
  }
  // STATE: changed / same (the object it was given, or a deep-equal one); another sink: sent
  const outcome = (sink: string, pre: any, v: any) => isAbort(v) ? 'abort' : sink != 'STATE' ? (typeof v == 'symbol' ? 'abort' : 'sent')
    : v === pre || (v !== undefined && objIsEqual(pre, v, 50)) ? 'same' : 'changed'

  const attach = () => { off = api.addHooks(hooks); dirty() }
  function rebind() {
    const next = target.__runtime
    if (stopped || !next || next === api) return
    off?.()
    api = next
    attach()
  }
  attach()

  // ------------------------------------------------------------------ discovery
  const declOf = (iv: any) => iv.def.view.agent
  const project = (iv: any, d: any) => {
    if (!d.read) return
    const s = iv.state, c = reads.get(iv)
    if (c && c.s === s) return c.v
    let v: any
    try { v = d.read(s) } catch (e: any) { dev('SYG241', d, 'read', iv.name, `agent.read threw: ${e?.message ?? e}`) }
    reads.set(iv, {s, v})
    return v
  }
  const whenOk = (iv: any, action: string, w?: (s: any) => boolean) => {
    if (!w) return true
    let m = whens.get(iv)
    if (!m) whens.set(iv, m = new Map())
    const s = iv.state, c = m.get(action)
    if (c && c.s === s) return c.v
    let v = false
    try { v = !!w(s) } catch (e: any) { dev('SYG241', declOf(iv), 'when' + action, iv.name, `agent.actions.${action}.when threw: ${e?.message ?? e}`) }
    m.set(action, {s, v})
    return v
  }
  const labelOf = (iv: any) => {
    const d = declOf(iv)
    try { return d.label ? String(d.label(iv.state)) : undefined } catch (e: any) { dev('SYG241', d, 'label', iv.name, `agent.label threw: ${e?.message ?? e}`) }
  }

  function walk(iv: any, out: any[]) {
    if (!iv || iv.disposed || !iv.shown) return
    out.push(iv)
    for (const c of iv.children()) walk(c, out)
  }
  function scan() {
    if (isApp && target.__runtime !== api) rebind()
    const all: any[] = [], by = new Map<string, Entry>()
    const from = options.from
    walk(from == null ? api.root : api.get(typeof from == 'object' ? from.id : from), all)
    for (const iv of all) {
      const d = declOf(iv)
      if (!d || (options.components && !options.components.includes(iv.def.view))) continue
      const item = iv.kind == 'item', name = snake(d.name ?? iv.name)
      if (item) {
        let m = owners.get(iv.def.view)
        const p = iv.parentId !== undefined && api.get(iv.parentId)
        if (!m) owners.set(iv.def.view, m = new Map())
        if (p && !m.has(p)) m.set(p, undefined)
      }
      const e = by.get(name)
      if (!e) by.set(name, {name, decl: d, ivs: [iv], item, view: iv.def.view, enums: new Set()})
      else if (e.decl === d && e.item && item) e.ivs.push(iv)
      else dev('SYG440', d, name, iv.name, `two agent declarations are named '${name}'; only the first is offered`)
    }
    for (const e of by.values()) if (e.item) {
      const ks = new Set<string>()
      for (const iv of e.ivs) {
        const k = keyOf(iv)
        // an item without an id is keyed by its index (the core's `_i<index>` uid part): unstable
        if (k == null || /-_i\d+$/.test(iv.uid)) dev('SYG441', e.decl, 'nokey', iv.name, `items of '${e.name}' have no id: agents address them by index`)
        else if (ks.has(k + '')) dev('SYG441', e.decl, 'dup', iv.name, `two items of '${e.name}' have the id ${JSON.stringify(k)}; calls reach the first`)
        else ks.add(k + '')
      }
    }
    entries = [...by.values()]
  }

  function build(): Map<string, Rec> {
    if (built === ver && !(isApp && target.__runtime !== api)) return recs
    scan()
    built = ver
    recs = new Map()
    for (const e of entries) {
      const d = e.decl
      if (d.read) recs.set(e.name + '_read', {e, tool: {name: e.name + '_read', description: `Read ${e.name}` + (d.description ? `: ${d.description}` : ''), inputSchema: {type: 'object', properties: {}}, annotations: {readOnlyHint: true, ...(d.untrusted && {untrustedContentHint: true})}}})
      for (const action in d.actions) {
        const a = d.actions[action], name = e.name + '_' + snake(action), comp = e.ivs[0].name
        const c = a.input ? toJsonSchema(a.input) : undefined
        if (c?.schema) enumsOf(c.schema, e.enums)
        const tool: AgentTool = {name, description: a.description, inputSchema: c?.schema || {type: 'object', properties: {}}, annotations: a.consequential ? {consequentialHint: true} : {}}
        const rec: Rec = {e, action, a, tool}
        recs.set(name, rec)
        if (e.item) seen.set(name, {e: {...e, ivs: []}, action, a, tool})
        if (c?.error) {
          tool.error = `SYG240 ${c.error}`
          rec.off = 1
          dev('SYG240', d, action, comp, `agent.actions.${action}.input: ${c.error}; the tool is not offered`)
          continue
        }
        if (c?.lossy) dev('SYG243', d, action, comp, `agent.actions.${action}.input: the model doesn't see ${c.lossy}`)
        const live = e.ivs.filter(iv => whenOk(iv, action, a.when))
        if (!live.length) { rec.off = 1; continue }
        if (e.item) {
          const s = tool.inputSchema, key = rec.key = !c?.wrapped && s.properties?.id ? 'item' : 'id'
          const labels = d.label ? live.map(iv => `${keyOf(iv)}: ${labelOf(iv)}`).join('; ') : ''
          tool.inputSchema = {...s, properties: {[key]: {enum: live.map(keyOf).filter(k => k != null), description: `Which ${e.name}` + (labels && ` (${labels})`)}, ...s.properties}, required: [key, ...(s.required || [])]}
        }
      }
    }
    return recs
  }

  function list(o: {all?: boolean} = {}): AgentTool[] {
    const out: AgentTool[] = []
    for (const r of build().values()) if (!r.off || (o.all && r.tool.error)) out.push(r.tool)
    return out
  }

  /** the `read` projections by declaration name (an item declaration: an array with the keys) */
  function context(): Record<string, any> {
    build()
    const ctx: Record<string, any> = {}
    for (const e of entries) if (e.decl.read) {
      ctx[e.name] = e.item ? e.ivs.map(iv => { const v = project(iv, e.decl); return {id: keyOf(iv), ...(isObj(v) ? v : {value: v})} }) : project(e.ivs[0], e.decl)
    }
    return ctx
  }
  function publish() {
    if (stopped || !listeners.size) return
    const now = {tools: list(), context: context()}
    if (last && objIsEqual(last, now, 50)) return
    last = now
    for (const l of listeners) try { l(now) } catch (e) { queueMicrotask(() => { throw e }) }
  }

  // ------------------------------------------------------------------ calls
  /** the nearest instance at or above `iv` with a `read`: its projection is the call's `state` */
  const resultState = (iv: any) => {
    for (let i = iv; i; i = i.parentId !== undefined ? api.get(i.parentId) : undefined) {
      const d = declOf(i)
      if (d?.read && !i.disposed) return project(i, d)
    }
  }
  /** G-650: the read tool with an item declaration's data: its own, else the nearest ancestor's */
  const readerOf = (e: Entry): string | undefined => {
    const iv = e.ivs.find(iv => !iv.disposed)
    for (let i = iv; i; i = i.parentId !== undefined ? api.get(i.parentId) : undefined) {
      const d = declOf(i), n = d?.read && !i.disposed && snake(d.name ?? i.name) + '_read'
      if (n && recs.has(n)) return n
    }
  }
  /** the live keys (with labels) of an item tool, for an error */
  const keysOf = (e: Entry) => e.ivs.filter(iv => !iv.disposed).map(iv => { const l = e.decl.label && labelOf(iv); return l ? `${keyOf(iv)} (${l})` : keyOf(iv) })
  const missing = (e: Entry, view: any, k: any): AgentResult => {
    const what = e.name, keys = e.ivs.filter(iv => !iv.disposed).map(keyOf)
    // D257: an item a filter hides is disposed; its owner's array still has it
    for (const [o, from] of owners.get(view) || []) {
      if (o.disposed) continue
      const s = o.state
      for (const a of typeof from == 'string' ? [s?.[from]] : isObj(s) ? Object.values(s) : [s]) {
        if (Array.isArray(a) && a.some(x => x?.id != null && String(x.id) === String(k))) return {ok: false, error: `the ${what} with id ${JSON.stringify(k)} is hidden by the current filter`, keys}
      }
    }
    return {ok: false, error: `no ${what} with id ${JSON.stringify(k)}; ids: ${keysOf(e).join(', ') || 'none'}`, keys}
  }

  let chain: Promise<any> = Promise.resolve()
  function call(name: string, args?: any, o: {confirm?: Confirm} = {}): Promise<AgentResult> {
    if (options.serial === false) return run(name, args, o)
    const p = chain.then(() => run(name, args, o))
    chain = p.catch(() => {})
    return p
  }
  async function run(name: string, args: any, o: {confirm?: Confirm}): Promise<AgentResult> {
    if (stopped) return {ok: false, error: 'the agent tools were stopped'}
    const r = build().get(name) || seen.get(name)
    if (!r || (r.off && !r.tool.error && !r.e.item)) {
      return r ? {ok: false, error: `${name} is not available now`, state: resultState(r.e.ivs[0])} : {ok: false, error: `no tool ${name}; tools: ${list().map(t => t.name).join(', ')}`}
    }
    if (r.tool.error) return {ok: false, error: r.tool.error}
    const {e, a, action} = r
    if (!action) return {ok: true, state: context()[e.name]}
    const key = r.key || 'id', view = e.view
    let raw = args ?? {}, k: any
    if (e.item) {
      if (!isObj(raw) || raw[key] == null) return {ok: false, error: `${name} needs ${key}: one of ${keysOf(e).join(', ') || 'none'}`, keys: e.ivs.map(keyOf)}
      k = raw[key]
      const {[key]: _, ...rest} = raw
      raw = rest
    }
    let data: any
    if (a.input) {
      const p = await parseInput(a.input, raw, {repair: options.repair})
      if (p.error || p.issues) return {ok: false, error: p.error || `invalid input for ${name}: ` + p.issues!.map(i => (i.path?.length ? i.path.join('.') + ': ' : '') + i.message).join('; '), ...(p.issues && {issues: p.issues})}
      data = p.value
    }
    const resolve = () => {
      const ivs = (build().get(name)?.e || e).ivs
      return e.item ? ivs.find(iv => !iv.disposed && String(keyOf(iv)) === String(k)) : ivs.find(iv => !iv.disposed)
    }
    let iv = resolve()
    if (!iv) return e.item ? missing(e, view, k) : {ok: false, error: `${e.name} is not on the page`}
    if (!whenOk(iv, action, a.when)) return {ok: false, error: `${name} is not available now`, state: resultState(iv)}
    if (a.consequential) {
      const c = 'confirm' in o ? o.confirm : options.confirm
      const info: ConfirmInfo = {tool: name, component: iv.name, action, description: a.description, input: data, ...(e.item && {key: k, label: labelOf(iv)})}
      if (!(typeof c == 'function' ? await c(info) : c === true)) return {ok: false, error: 'the user declined'}
      // the app may have changed while the user decided: resolve and check again
      iv = resolve()
      if (!iv) return e.item ? {...missing(e, view, k), error: `the ${e.name} with id ${JSON.stringify(k)} is gone`} : {ok: false, error: `${e.name} is not on the page any more`}
      if (!whenOk(iv, action, a.when)) return {ok: false, error: `${name} is not available any more`, state: resultState(iv)}
    }
    const rec: Call = pending = {id: iv.id, type: action, data, ran: false, out: []}
    api.dispatch(iv.id, action, data, 'agent')
    await api.flushed()
    if (pending === rec) pending = null
    if (current === rec) current = null
    if (!rec.ran) return {ok: false, error: `${name} did not run: its target was removed first`}
    const out = rec.out, threw = out.find(x => x.kind == 'threw'), refused = out.find(x => x.kind == 'abort' && x.reason)
    if (threw) return {ok: false, error: `${action} failed: ${threw.error?.message ?? threw.error}`, state: resultState(iv)}
    // G-650: an item a filter moved to another Collection (a card to another column) is a new instance, not removed
    if (iv.disposed && e.item) iv = resolve() || iv
    const gone = iv.disposed
    const state = gone ? resultState(api.get(iv.parentId)) : resultState(iv)
    if (out.some(x => x.kind == 'changed' || x.kind == 'sent' || x.kind == 'effect')) return gone ? {ok: true, removed: true, state} : {ok: true, state}
    if (refused) return {ok: false, error: `${action} was refused: ${refused.reason}`, state}
    return a.idempotent ? {ok: true, unchanged: true, state} : {ok: false, error: `${action} changed nothing (already so, or the input matched nothing)`, state}
  }

  return {
    /** the offered tools; `{ all: true }` adds declared tools that can't be offered (`error`, SYG240) */
    list,
    /** run a tool as an agent: resolves with the result after the action's flush */
    call,
    context,
    /** called with `{ tools, context }` after each flush that changed either; returns unsubscribe */
    subscribe(fn: (change: {tools: AgentTool[]; context: Record<string, any>}) => void) {
      listeners.add(fn)
      dirty()
      return () => { listeners.delete(fn) }
    },
    stop() { stopped = true; off?.(); listeners.clear() },
    /** internal (A-2, WebMCP; chat; the command bar): the offered tools grouped by declaration, with `untrusted` as declared and an item declaration's live labels (id → `agent.label`) */
    groups(): AgentGroup[] {
      const rs = [...build().values()]
      return entries.map(e => {
        const labels: Record<string, string> = {}
        if (e.item && e.decl.label) for (const iv of e.ivs) {
          const id = keyOf(iv), l = !iv.disposed && id != null ? labelOf(iv) : undefined
          if (l !== undefined) labels[id] = l
        }
        return {name: e.name, untrusted: e.decl.untrusted, read: !!e.decl.read, tools: rs.filter(r => r.e === e && !r.off).map(r => r.tool.name), enums: e.enums, ...(e.item && e.decl.label && {labels}), ...(e.item && {reader: readerOf(e)})}
      })
    },
    /** internal (M-3, the command bar): the live Collection items by declaration name, with their key and `agent.label` */
    targets(): Array<{name: string; id: any; label?: string}> {
      build()
      const out: Array<{name: string; id: any; label?: string}> = []
      for (const e of entries) if (e.item) for (const iv of e.ivs) {
        const id = keyOf(iv)
        if (!iv.disposed && id != null) out.push({name: e.name, id, label: labelOf(iv)})
      }
      return out
    },
  }
}
