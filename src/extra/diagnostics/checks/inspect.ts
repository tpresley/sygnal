/**
 * inspect() — the machine-readable app graph at runtime (PLAN-1 workstream 2B).
 *
 * Built only from what the diagnostics hooks already see, keyed by component
 * instance (so diagnostics must be on while the app runs):
 *   onIntent    registers the instance (name, parent, kind) and its intent
 *               action names; claims the EVENTS.select() types seen since the
 *               previous onIntent (intent runs synchronously right before it)
 *   onModel     action -> sinks; and wraps the component's own EVENTS model
 *               stream (component.model$.EVENTS, before initSinks merges it)
 *               in an identity map that records the emitted types. Since
 *               B-023 the driver-side emitter name (onBusEmit) is the
 *               emitting component's, but it is only a name, and this
 *               graph is per instance, so the per-instance tap stays.
 *   onReducer   which model-only actions actually ran (=> dispatched by next(),
 *               unless a request named them as reply actions: replies.ts, 'reply')
 *   onBusEmit   EVENTS types seen on the bus
 *   onBusSelect EVENTS types selected (see onIntent)
 *   onRender    (PLAN-4 CT-1) the controls the instance renders: its own vtree, up to the
 *               isolated child components, through ./controls' vnode -> control map
 *   onDispose   prunes the instance
 *   (PLAN-4 2-C) onIntent / onModel also install the action log (./actionLog) on the instance;
 *               inspect({ actions }) lists the recent actions (the last RECENT_MAX, any instance)
 * Selectors come from the DOM check (real DOM) or from renderComponent (mock
 * DOM, passed in as options.selectors). The same shape is produced statically
 * by `sygnal-check --graph`; the JSON Schema is
 * sygnal-check/schema/inspect.schema.json, the types are in ./public.d.ts.
 *
 * This lives in the 'sygnal/diagnostics' dev entry only (D29: zero bytes in
 * app bundles). installInspect() publishes inspect() on the core bridge
 * (renderComponent's t.inspect() reads it there) and on the devtools object
 * (window.__SYGNAL_DEVTOOLS__, which is getDevTools()) once it exists.
 */
import type {DiagnosticCheck} from '../index'
import type {InspectGraph, InspectComponent, InspectOptions, InspectSelector, InspectDiagnostic, InspectChild, InspectResource, InspectControl, InspectRecentAction} from './public'
import {trackActions, trackActionStreams, clockNow} from './actionLog'
import type {ActionListener, ActionRecord} from './actionLog'
import {bridge, onReset, nameOf, isPlainObject, BUILTIN_ACTIONS, replySeen} from './shared'
import {checkEventBus} from './events'
import {selectorStatus} from './dom'
import {controlOfVnode, keyOfSelector} from './controls'

type Kind = InspectComponent['kind']

interface Rec {
  instance: any
  id: string
  name: string
  parentId: string | null
  kind: Kind
  /** null: single-stream intent (no action names) */
  intentActions: string[] | null
  injected: Set<string>
  modelMap: Record<string, string[]>
  fired: Set<string>
  eventsSelected: Set<string>
  eventsEmitted: Set<string>
  /** CT-1: controls seen in its renders, by key (first-seen order) */
  controls: Map<string, {element: string | null; kind?: string}>
}

let records = new Map<any, Rec>()
let pendingSelects: string[] = []
/** every EVENTS type seen on the bus */
let busTypes = new Set<string>()
/** PLAN-4 2-C (GS-10): the most recent actions of any instance, oldest first */
const RECENT_MAX = 200
let recent: ActionRecord[] = []
let epoch = clockNow()
const actionListener: ActionListener = {
  action(r) { if (recent.push(r) > RECENT_MAX) recent.shift() },
}

onReset(() => {
  records = new Map()
  pendingSelects = []
  busTypes = new Set()
  recent = []
  epoch = clockNow()
})
const uniq = <T>(list: Iterable<T>): T[] => [...new Set(list)]

function kindOf(c: any): Kind {
  const s = (c && c.sources) || {}
  if (typeof s.__parentComponentNumber !== 'number') return 'root'
  // Collection items get PARENT: null (src/component.ts instantiateCollection)
  if ('PARENT' in s && s.PARENT === null) return 'collection-item'
  // switchable() adds a lower-case `state` source next to the component's own (src/switchable.ts)
  if (c.stateSourceName !== 'state' && 'state' in s && s.state !== s[c.stateSourceName]) return 'switchable'
  return 'child'
}

function ensure(c: any): Rec {
  let r = records.get(c)
  if (!r) {
    const parent = c && c.sources && c.sources.__parentComponentNumber
    r = {
      instance: c,
      id: String(c && c._componentNumber),
      name: nameOf(c),
      parentId: typeof parent === 'number' ? String(parent) : null,
      kind: kindOf(c),
      intentActions: [],
      injected: new Set(),
      modelMap: {},
      fired: new Set(),
      eventsSelected: new Set(),
      eventsEmitted: new Set(),
      controls: new Map(),
    }
    records.set(c, r)
  }
  return r
}

let devtools: any
function attachDevtools(): void {
  const dt = (globalThis as any).__SYGNAL_DEVTOOLS__
  if (!dt || typeof dt !== 'object') return
  devtools = dt
  if (dt.inspect !== inspect) {
    try { dt.inspect = inspect } catch (_) { /* frozen: ignore */ }
  }
}

export const inspectCheck: DiagnosticCheck = {
  id: 'inspect',

  onBusSelect(type) {
    if (type === undefined || type === null || type === '') pendingSelects.push('*')
    else for (const t of ([] as any[]).concat(type)) if (typeof t === 'string') pendingSelects.push(t)
    if (pendingSelects.length > 1000) pendingSelects.shift()
  },

  onIntent(component, actionNames) {
    attachDevtools()
    trackActions(component, actionListener)
    const r = ensure(component)
    const intent$ = component && component.intent$
    r.intentActions = intent$ && typeof intent$.addListener === 'function' ? null : (actionNames || [])
    r.injected = new Set((intent$ && typeof intent$ === 'object' && intent$.__sygnalTestActions) || [])
    for (const t of pendingSelects) r.eventsSelected.add(t)
    pendingSelects = []
  },

  onModel(component, modelMap) {
    trackActionStreams(component)
    const r = ensure(component)
    r.modelMap = modelMap || {}
    const model$ = component && component.model$
    const events$ = model$ && model$.EVENTS
    if (events$ && typeof events$.map === 'function' && !events$.__sygnalInspect) {
      const tapped = events$.map((ev: any) => {
        if (ev && typeof ev.type === 'string') r.eventsEmitted.add(ev.type)
        return ev
      })
      tapped.__sygnalInspect = true
      model$.EVENTS = tapped
    }
  },

  onRender(component, root) {
    const r = records.get(component)
    if (r) collectControls(root, r.controls, true)
  },

  onReducer(component, action) {
    const r = records.get(component)
    if (r && typeof action === 'string') r.fired.add(action)
  },

  onBusEmit(type) {
    if (typeof type === 'string') busTypes.add(type)
  },

  onDispose(component) {
    records.delete(component)
  },
}

/**
 * CT-1: record the controls in a component's rendered tree (data-control="<Key>"), stopping at
 * isolated child components (their root carries data.isolate on the real DOM, a '.___<scope>'
 * class in the mock DOM): the controls inside belong to the child.
 */
function collectControls(v: any, out: Rec['controls'], root: boolean): void {
  if (!v || typeof v != 'object') return
  if (!root && typeof v.sel == 'string' && ((v.data && v.data.isolate) || v.sel.includes('.___'))) return
  const key = v.data && v.data.attrs && v.data.attrs['data-control']
  if (typeof key == 'string' && !out.has(key)) {
    const control = controlOfVnode(v)
    const spec = control && control.spec
    out.set(key, spec && typeof spec == 'object'
      ? {element: null, kind: String(spec.kind)}
      : {element: typeof spec == 'string' ? spec : typeof v.sel == 'string' ? v.sel.split(/[.#]/)[0] : null})
  }
  for (const k of [].concat(v.children || [], (v.data && v.data.portalChildren) || [])) collectControls(k, out, false)
}

/** CT-1: the controls a component rendered, `listened` from its intent's selectors */
function controlsOf(r: Rec, selectors: InspectSelector[]): InspectControl[] | undefined {
  if (!r.controls.size) return undefined
  const listened = new Set<string>()
  for (const s of selectors) for (const m of s.selector.matchAll(/\[data-control="([^"]+)"\]/g)) listened.add(m[1])
  return [...r.controls].map(([name, {element, kind}]) => ({name, element, ...(kind ? {kind} : {}), listened: listened.has(name)}))
}

/** CT-1: mark a selector that is a control ([data-control="<Key>"]) with its key */
const withControl = (s: InspectSelector): InspectSelector => {
  const key = keyOfSelector(s.selector)
  return key ? {...s, control: key} : s
}

const slim = (d: any): InspectDiagnostic => {
  const out: InspectDiagnostic = {code: d.code, severity: d.severity, message: d.message}
  if (d.component) out.component = d.component
  if (d.fix) out.fix = d.fix
  if (d.docsUrl) out.docsUrl = d.docsUrl
  if (d.data !== undefined) {
    // keep it JSON-safe (data can hold errors, vnodes, ...)
    try { out.data = JSON.parse(JSON.stringify(d.data)) } catch (_) { /* drop */ }
  }
  return out
}

function actionsOf(r: Rec): InspectComponent['actions'] {
  const intent = (r.intentActions || []).filter(a => !r.injected.has(a))
  const names = uniq([...intent, ...Object.keys(r.modelMap)]).filter(a => typeof a === 'string' && !a.startsWith('__'))
  const replies = replySeen.get(r.instance)
  return names.map(name => ({
    name,
    trigger: BUILTIN_ACTIONS.has(name) ? 'builtin'
      : intent.includes(name) ? 'intent'
      : replies?.has(name) ? 'reply'
      : !r.injected.has(name) && r.fired.has(name) ? 'next'
      : 'unknown',
    sinks: [...(r.modelMap[name] || [])],
  }))
}

function stateKeysOf(c: any, calculated: string[]): string[] {
  const s = c && c.currentState
  return isPlainObject(s) ? Object.keys(s).filter(k => !calculated.includes(k)) : []
}

/** PLAN-3 5-3: the instance's resources (`resources` static) and their state slots */
function resourcesOf(c: any): InspectResource[] | undefined {
  const res = c && c.view && c.view.resources
  if (!res || typeof res !== 'object') return undefined
  const s = c.currentState || {}
  return Object.keys(res).map(name => {
    const r = s[name] || {}
    return {name, status: r.status ?? 'idle', refreshing: !!r.refreshing, hasData: r.data !== undefined, error: r.error ? String(r.error.message ?? r.error) : undefined}
  })
}

/** PLAN-3 5-3: the cache entries of every makeFetchDriver source the instances use, by sink name (sinks with an empty cache left out) */
function cacheOf(recs: Rec[]): InspectGraph['cache'] {
  const out: NonNullable<InspectGraph['cache']> = {}
  for (const r of recs) {
    const sources = r.instance && r.instance.sources
    if (!sources || typeof sources !== 'object') continue
    for (const k of Object.keys(sources)) {
      const src = sources[k]
      if (out[k] || !src || src.__sygnalStatic !== 'resources' || typeof src.__inspect !== 'function') continue
      try { const list = src.__inspect().cache; if (list.length) out[k] = list } catch (_) { /* a driver without the cache listing */ }
    }
  }
  return out
}

/**
 * renderComponent's mock DOM (src/extra/testing.ts passes its listener registry):
 * listener paths are the select() chain with isolation scopes as '.___<scope>' entries;
 * probe(selectors, scope) matches one against the latest vtree: own = in the component's
 * own scope, child = the scope of the first (isolated) child component it matches inside.
 */
interface MockDom {
  listeners: Map<string, string[]>
  evTypes: Record<string, string[]>
  owners: Map<string, string>
  scopeIds: Map<string, number>
  probe: (selectors: string[], scope?: string) => {own: boolean; child?: string}
  vtree: any
}

const isScope = (s: string) => s.startsWith('.___')

function mockSelectors(mock: MockDom): Record<string, InspectSelector[]> {
  const out: Record<string, InspectSelector[]> = {}
  mock.listeners.forEach((path, key) => {
    const scope = path.filter(isScope).pop()
    const id = mock.scopeIds.get(scope || '')
    if (id === undefined) return
    const sels = path.filter(s => !isScope(s)).join(' ').split(/[\s>]+/).filter(Boolean)
    const page = !sels.length || /^(document|body)$/.test(sels[0])
    const {own, child} = mock.vtree && !page ? mock.probe(sels, scope) : {own: false, child: undefined}
    ;(out[id] = out[id] || []).push({
      selector: sels.join(' '),
      events: uniq(mock.evTypes[key] || []),
      matched: mock.vtree && !page ? own : null,
      isolationHit: !own && child ? mock.owners.get(child) || 'a child component' : null,
    })
  })
  return out
}

function selectorsOf(r: Rec, options: InspectOptions, diags: any[]): InspectSelector[] {
  const given = options.selectors && options.selectors[r.id]
  if (given) return given.map(s => withControl({...s}))
  return (selectorStatus(r.instance) || []).map(({selector, matched, crossed}) => {
    const hit = diags.find(d => d.code === 'SYG104' && d.component === r.name && d.data && d.data.selector === selector)
    const missed = diags.some(d => d.code === 'SYG103' && d.component === r.name && d.data && d.data.selector === selector)
    return withControl({
      selector,
      events: null,
      matched: matched === null && missed ? false : matched,
      isolationHit: crossed ? ((hit && hit.data.child) || 'a child component') : null,
    })
  })
}

function childrenOf(r: Rec, all: Rec[]): InspectChild[] {
  const via: Record<Kind, InspectChild['via']> = {root: 'tag', child: 'tag', 'collection-item': 'collection', switchable: 'switchable'}
  const out = new Map<string, InspectChild>()
  for (const c of all) {
    if (c.parentId !== r.id) continue
    const key = `${c.name}\u0000${via[c.kind]}`
    const entry = out.get(key)
    if (entry) entry.count = (entry.count || 1) + 1
    else out.set(key, {name: c.name, via: via[c.kind], count: 1})
  }
  return [...out.values()]
}

/** The app graph of the live component instances (see ./public.d.ts). */
export function inspect(options: InspectOptions = {}): InspectGraph {
  // report SYG105 (info) for EVENTS types selected but never emitted so far
  try { checkEventBus() } catch (_) { /* 'error' mode: info never throws; be safe */ }

  let diags: any[] = options.diagnostics as any[] || []
  if (!options.diagnostics) {
    attachDevtools()
    try { diags = (devtools && typeof devtools.getDiagnostics === 'function' && devtools.getDiagnostics()) || [] } catch (_) { diags = [] }
  }

  const mock: MockDom | undefined = (options as any).mock
  if (mock) options = {...options, selectors: {...mockSelectors(mock), ...options.selectors}}

  const all = [...records.values()]
  const ids = options.ids && new Set(options.ids.map(String))
  const recs = ids ? all.filter(r => ids.has(r.id)) : all
  const names = new Set(recs.map(r => r.name))

  const components: InspectComponent[] = recs.map(r => {
    const c = r.instance
    const calculated = c && c.calculated && typeof c.calculated === 'object' ? Object.keys(c.calculated) : []
    const selectors = selectorsOf(r, options, diags)
    const controls = controlsOf(r, selectors)
    return {
      name: r.name,
      id: r.id,
      parentId: r.parentId,
      kind: r.kind,
      actions: actionsOf(r),
      stateKeys: stateKeysOf(c, calculated),
      calculated,
      contextProvides: c && isPlainObject(c.context) ? Object.keys(c.context) : [],
      contextConsumes: null,
      eventsEmitted: [...r.eventsEmitted],
      eventsSelected: [...r.eventsSelected],
      children: childrenOf(r, all),
      selectors,
      ...(controls ? {controls} : {}),
      diagnostics: diags.filter(d => d && d.component === r.name).map(slim),
      ...(resourcesOf(c) ? {resources: resourcesOf(c)} : {}),
    }
  })

  const cache = cacheOf(recs) || {}
  const events: InspectGraph['events'] = {}
  const ev = (type: string) => events[type] || (events[type] = {emitters: [], selectors: []})
  const add = (list: string[], name: string) => { if (!list.includes(name)) list.push(name) }
  for (const c of components) {
    for (const t of c.eventsEmitted) add(ev(t).emitters, c.name)
    for (const t of c.eventsSelected) add(ev(t).selectors, c.name)
  }
  // emitted on the bus by something that isn't a listed component (e.g. a driver, a pruned component)
  if (!ids) for (const t of busTypes) ev(t)

  return {
    version: 1,
    source: 'runtime',
    components,
    events,
    diagnostics: diags.filter(d => d && (!d.component || !names.has(d.component))).map(slim),
    ...(Object.keys(cache).length ? {cache} : {}),
    ...(options.actions ? {recentActions: recentActions(options.actions, ids)} : {}),
  }
}

/** a JSON-safe copy of an action's data (dropped when it doesn't serialize, or is large: a DOM event) */
function jsonData(d: any): {data?: any} {
  if (d === undefined) return {}
  try {
    const text = JSON.stringify(d)
    return text === undefined || text.length > 1000 ? {} : {data: JSON.parse(text)}
  } catch (_) { return {} }
}

/** PLAN-4 2-C: the last `limit` actions (true: all kept) of the listed instances */
function recentActions(limit: true | number, ids: Set<string> | undefined): InspectRecentAction[] {
  const list = ids ? recent.filter(r => ids.has(r.instance)) : recent
  const n = limit === true ? list.length : Math.max(0, Math.floor(limit))
  return list.slice(list.length - n).map(r => ({
    type: r.type,
    ...jsonData(r.data),
    component: r.component,
    instance: r.instance,
    sinks: [...r.sinks],
    cause: r.cause,
    at: r.time - epoch,
  }))
}

/** Publish inspect() on the core bridge and the devtools object. Returns an uninstall function. */
export function installInspect(): () => void {
  const core = bridge()
  if (core) core.inspect = inspect
  attachDevtools()
  return () => {
    if (core && core.inspect === inspect) core.inspect = undefined
    const dt = (globalThis as any).__SYGNAL_DEVTOOLS__
    if (dt && dt.inspect === inspect) {
      try { delete dt.inspect } catch (_) { /* ignore */ }
    }
  }
}
