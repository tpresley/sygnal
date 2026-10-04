import isolate from './cycle/isolate/index';
import collection from './collection';
import switchable from './switchable';
import {StateSource} from './cycle/state/index';
import {objIsEqual} from './cycle/state/objIsEqual';
import {init as snabbdomInit} from './cycle/dom/snabbdom';
import defaultModules from './cycle/dom/modules';
import {renderSeq} from './cycle/dom/controlledInputModule';
import {uidPart, isAbort} from './shared';
import {makeCommandSource} from './extra/command';
import {runElementCommands} from './extra/elementCommands';
import type {Command} from './extra/command';
// [diagnostics hook] shared diagnostics core — hooks are no-ops when diagnostics are off
import * as diag from './extra/diagnostics/index';
import {warn, error as logError, fail, caught, appError} from './extra/diagnostics/legacy';

import xs, {Stream} from './extra/xstreamCompat';
import {delay, concat, debounce, dropRepeats} from './extra/xstreamExtras';

declare var process: { env: Record<string, any> };

const ENVIRONMENT: any =
  (typeof window != 'undefined' && window) || (typeof process !== 'undefined' && process.env) || {};

const BOOTSTRAP_ACTION = 'BOOTSTRAP';
const INITIALIZE_ACTION = 'INITIALIZE';
const DISPOSE_ACTION = 'DISPOSE';
const PARENT_SINK_NAME = 'PARENT';
const CHILD_SOURCE_NAME = 'CHILD';
const READY_SINK_NAME = 'READY';
const EFFECT_SINK_NAME = 'EFFECT';
// fix hint for coded messages that carry the caught error (printed after the text, or diagnostic.data)
const ERR_FIX = 'See the attached error'
// B-003: the state an action's non-STATE sinks see (stamped by initModel$)
const STATE_SNAPSHOT = Symbol('sygnal.stateSnapshot');

let COMPONENT_COUNT = 0;
// 1H-1: STATE reducers emitted but not applied yet (in any component)
let pendingReducers = 0;

function wrapDOMSource(domSource: any): any {
  return new Proxy(domSource, {
    get(target, prop, receiver) {
      if (typeof prop === 'symbol' || prop in target) {
        return Reflect.get(target, prop, receiver)
      }
      return (selector: any) => target.select(selector).events(prop)
    }
  })
}


export const ABORT = Symbol.for('sygnal.ABORT')


function normalizeCalculatedEntry(field: string, entry: any): {fn: (...args: any[]) => any; deps: string[] | null} {
  if (typeof entry === 'function') {
    return { fn: entry, deps: null }
  }
  if (Array.isArray(entry) && entry.length === 2
      && Array.isArray(entry[0]) && typeof entry[1] === 'function') {
    return { fn: entry[1], deps: entry[0] }
  }
  fail('SYG206', undefined, `Invalid calculated field '${field}'`, 'Use fn or [deps, fn]')
}

const OPTION_KEYS = ['model', 'intent', 'hmrActions', 'context', 'peers', 'components', 'initialState', 'calculated', 'storeCalculatedInState', 'DOMSourceName', 'stateSourceName', 'onError', 'debug']

/** component() options for a function component: its static properties (`extra`: more keys), `name`, `view: fn`. */
export function optionsOf(fn: any, name: string, extra: string[] = []): any {
  const options: any = {name, view: fn}
  for (const key of OPTION_KEYS.concat(extra)) options[key] = fn[key]
  return options
}

export interface ComponentOptions {
  name?: string;
  sources?: Record<string, any>;
  intent?: ((sources: Record<string, any>) => any) | Record<string, any>;
  model?: Record<string, any>;
  hmrActions?: string | string[];
  context?: Record<string, boolean | ((state: any) => any)>;
  response?: Record<string, any>;
  view?: (...args: any[]) => any;
  peers?: Record<string, (...args: any[]) => any>;
  components?: Record<string, any>;
  initialState?: Record<string, any>;
  calculated?: Record<string, ((state: any) => any) | [string[], (...args: any[]) => any]>;
  storeCalculatedInState?: boolean;
  DOMSourceName?: string;
  stateSourceName?: string;
  isolateOpts?: string | boolean | Record<string, any>;
  isolatedState?: boolean;
  onError?: (error: Error, info: { componentName: string }) => any;
  debug?: boolean;
}

export default function component(opts: ComponentOptions): any {
  const { name, sources, isolateOpts, stateSourceName='STATE' } = opts

  if (sources && !isObj(sources)) {
    fail('SYG601', name, 'Invalid sources', 'Pass sources from run()')
  }

  const fixedIsolateOpts = typeof isolateOpts == 'string' ? { [stateSourceName]: isolateOpts } : isolateOpts === true ? {} : isolateOpts

  const make: any = (sources: any) => {
    const instance = new Component({ ...opts, sources })
    instance.sinks.__dispose = () => instance.dispose()
    return instance.sinks
  }
  const factory = isObj(fixedIsolateOpts) ? isolate(make, fixedIsolateOpts) : make
  const returnFunction = typeof sources === 'undefined' ? factory : factory(sources)

  returnFunction.componentName = name
  returnFunction.isSygnalComponent = true

  return returnFunction
}





class Component {
  _componentNumber: number;
  name!: string;
  sources: any;
  intent: any;
  model: any;
  hmrActions: any;
  context: any;
  view: any;
  peers!: Record<string, any>;
  components!: Record<string, any>;
  initialState: any;
  calculated: any;
  storeCalculatedInState!: boolean;
  DOMSourceName!: string;
  stateSourceName!: string;
  sourceNames!: string[];
  _debug!: boolean;
  onError: ((error: Error, info: { componentName: string }) => any) | undefined;
  isolatedState!: boolean;
  declare _inputSeq: number;
  isSubComponent: boolean;
  currentState: any;
  currentProps: any;
  currentChildren: any;
  currentSlots: Record<string, any[]>;
  currentContext: any;
  intent$: any;
  hmrAction$: any;
  action$: any;
  model$: any;
  context$: any;
  peers$: any;
  subComponentSink$: any;
  subComponentsRendered$: any;
  vdom$: any;
  sinks: any;
  log: any;
  addCalculated: (state: any) => any;
  newChildSources!: (sources: any) => void;
  newSubComponentSinks!: (sinks: any) => void;
  triggerSubComponentsRendered!: (() => void);
  _calculatedNormalized: Record<string, {fn: (...args: any[]) => any; deps: string[] | null}> | null;
  _calculatedFieldNames: Set<string> | null;
  _calculatedOrder: Array<[string, {fn: (...args: any[]) => any; deps: string[] | null}]> | null;
  _calculatedFieldCache: Record<string, {lastDepValues: any; lastResult: any}> | null;
  _subscriptions: any[];
  _processedChildren$: any;
  _disposeListener: any;
  _dispose$: any;
  _disposed?: boolean;
  _replies?: any[];
  _ac?: AbortController;
  _s?: any;
  _idle?: any;
  _activeSubComponents: Map<string, any>;
  _childReadyState: Record<string, boolean>;
  _uid!: (name?: string) => string;
  _cu?: string;
  _readyChanged$: any;
  _readyChangedListener: any;

  constructor({name = 'NO NAME', sources, intent, model, hmrActions, context, view, peers = {}, components = {}, initialState, calculated, storeCalculatedInState = true, DOMSourceName = 'DOM', stateSourceName = 'STATE', isolatedState = false, onError, debug = false}: ComponentOptions) {
    if (!sources || !isObj(sources)) fail('SYG601', name, 'Missing or invalid sources', 'Pass sources from run()')

    this._componentNumber = COMPONENT_COUNT++

    Object.assign(this, { name, sources, intent, model, hmrActions, context, view, peers, components, initialState, calculated, storeCalculatedInState, DOMSourceName, stateSourceName, sourceNames: Object.keys(sources), onError, isolatedState, _debug: debug })

    // Warn if calculated fields shadow base state keys
    if (this.calculated && this.initialState
        && isObj(this.calculated) && isObj(this.initialState)) {
      for (const key of Object.keys(this.calculated)) {
        if (key in this.initialState) {
          warn('SYG207', name, `Calculated field '${key}' overwrites the initialState key of the same name`, 'Rename one of them')
        }
      }
    }

    // Normalize calculated entries, build dependency graph, topological sort
    if (this.calculated && isObj(this.calculated)) {
      const calcEntries = Object.entries(this.calculated)

      // Normalize all entries to { fn, deps } shape
      this._calculatedNormalized = {}
      for (const [field, entry] of calcEntries) {
        this._calculatedNormalized[field] = normalizeCalculatedEntry(field, entry)
      }

      this._calculatedFieldNames = new Set(Object.keys(this._calculatedNormalized))

      // Warn on deps referencing nonexistent keys
      for (const [field, { deps }] of Object.entries(this._calculatedNormalized)) {
        if (deps !== null) {
          for (const dep of deps) {
            if (!this._calculatedFieldNames.has(dep)
                && this.initialState && !(dep in this.initialState)) {
              warn('SYG208', name, `Calculated field '${field}' depends on unknown key '${dep}'`, 'Add it to initialState')
            }
          }
        }
      }

      // Build adjacency: for each field, which other calculated fields must run first?
      const calcDeps: Record<string, string[]> = {}
      for (const [field, { deps }] of Object.entries(this._calculatedNormalized)) {
        if (deps === null) {
          calcDeps[field] = []
        } else {
          calcDeps[field] = deps.filter(d => this._calculatedFieldNames!.has(d))
        }
      }

      // Kahn's algorithm for topological sort
      const inDegree: Record<string, number> = {}
      const reverseGraph: Record<string, string[]> = {}
      for (const field of this._calculatedFieldNames) {
        inDegree[field] = 0
        reverseGraph[field] = []
      }
      for (const [field, depList] of Object.entries(calcDeps)) {
        inDegree[field] = depList.length
        for (const dep of depList) {
          reverseGraph[dep].push(field)
        }
      }

      const queue = []
      for (const [field, degree] of Object.entries(inDegree)) {
        if (degree === 0) queue.push(field)
      }

      const sorted: string[] = []
      while (queue.length > 0) {
        const current: string = queue.shift()!
        sorted.push(current)
        for (const dependent of reverseGraph[current]) {
          inDegree[dependent]--
          if (inDegree[dependent] === 0) queue.push(dependent)
        }
      }

      if (sorted.length !== this._calculatedFieldNames.size) {
        // Cycle detected — build error message with cycle path
        const inCycle = [...this._calculatedFieldNames].filter(f => !sorted.includes(f))
        const visited = new Set()
        const path: string[] = []
        const traceCycle = (node: any) => {
          if (visited.has(node)) { path.push(node); return true }
          visited.add(node)
          path.push(node)
          for (const dep of calcDeps[node]) {
            if (inCycle.includes(dep) && traceCycle(dep)) return true
          }
          path.pop()
          visited.delete(node)
          return false
        }
        traceCycle(inCycle[0])
        const start = path[path.length - 1]
        const cycle = path.slice(path.indexOf(start))
        fail('SYG209', name, `Circular calculated dependency: ${cycle.join(' \u2192 ')}`, 'Break the cycle')
      }

      this._calculatedOrder = sorted.map(f => [f, this._calculatedNormalized![f]])

      // Initialize per-field memoization caches for fields with declared deps
      this._calculatedFieldCache = {}
      for (const [field, { deps }] of this._calculatedOrder) {
        if (deps !== null) {
          this._calculatedFieldCache[field] = { lastDepValues: undefined, lastResult: undefined }
        }
      }
    } else {
      this._calculatedOrder = null
      this._calculatedNormalized = null
      this._calculatedFieldNames = null
      this._calculatedFieldCache = null
    }

    this.isSubComponent = this.sourceNames.includes('props$')

    const state$ = sources[stateSourceName] && sources[stateSourceName].stream

    this.currentSlots = {}

    this._disposeListener = null
    this._dispose$ = xs.create({
      start: (listener: any) => { this._disposeListener = listener },
      stop: () => {},
    })

    if (state$) {
      this.currentState = initialState || {}
      this.sources[stateSourceName] = new StateSource(state$.map((val: any) => {
        this.currentState = val
        if (typeof window !== 'undefined' && window.__SYGNAL_DEVTOOLS__?.connected) {
          window.__SYGNAL_DEVTOOLS__.onStateChanged(this._componentNumber, this.name, val)
        }
        return val
      }), stateSourceName, this._dispose$) // GS-6: STATE.watch ends on dispose
    }

    const props$ = sources.props$
    if (props$) {
      this.sources.props$ = props$.map((val: any) => {
        const { sygnalFactory, sygnalOptions, ...sanitizedProps }: any = val
        this.currentProps = sanitizedProps
        if (typeof window !== 'undefined' && window.__SYGNAL_DEVTOOLS__?.connected) {
          window.__SYGNAL_DEVTOOLS__.onPropsChanged(this._componentNumber, this.name, sanitizedProps)
        }
        return val
      })
    }

    const children$ = sources.children$
    if (children$) {
      // Process children and extract slots once, share across subscribers
      this._processedChildren$ = children$.map((val: any) => {
        if (Array.isArray(val)) {
          const { slots, defaultChildren } = extractSlots(val)
          this.currentSlots = slots
          this.currentChildren = defaultChildren
          return { children: defaultChildren, slots }
        } else {
          this.currentSlots = {}
          this.currentChildren = val
          return { children: val, slots: {} }
        }
      })
      this.sources.children$ = this._processedChildren$.map((p: any) => p.children)
    }

    if (this.sources[DOMSourceName]) {
      this.sources[DOMSourceName] = wrapDOMSource(this.sources[DOMSourceName])
    }

    // Ensure that the root component has an intent and model
    // This is necessary to ensure that the component tree's state sink is subscribed to
    // G-172: also for a root with an intent but no model (it rendered nothing under run())
    if (!this.isSubComponent && typeof this.model === 'undefined') {
      this.initialState = initialState || true
      if (typeof this.intent === 'undefined') this.intent = (_: any) => ({__NOOP_ACTION__:xs.never()})
      this.model = {
        __NOOP_ACTION__: (state: any) => state
      }
    }
    // PLAN-3 3-A: Component.resources = { name: state => request | falsy }. The makeFetchDriver
    // source gets { resources } (below, as connections) and writes state[name] = { status, data,
    // error } with the built-in RESOURCE action (a model RESOURCE entry replaces it). Until then
    // state[name] reads as idle (addCalculated)
    const res = (view as any)?.resources
    if (res) {
      this.model = { RESOURCE: (s: any, { name, ...r }: any) => ({ ...s, [name]: r }), ...this.model }
      this._idle = {}
      for (const k in res) this._idle[k] = { status: 'idle' }
    }
    // PLAN-4 GS-1: Component.uses = { key: behavior(options) }. Each defineBehavior value carries
    // its own merge (src/extra/behaviors.ts, D114); anything else is skipped (reported by the dev entry)
    const uses = (view as any)?.uses
    for (const k in uses) uses[k]?.merge?.(this, k)
    // PLAN-4 GS-5: Root.persist = persist({ ... }); the helper value carries its setup (src/extra/persist.ts)
    if (!this.isSubComponent) (view as any)?.persist?.setup?.(this)
    // B-016: initialState is applied by the INITIALIZE action, which needs a model. D44: only
    // for a sub-component with no `state` prop; an existing parent slice is never overwritten
    if (sources.__localState && isolatedState && initialState !== undefined && !this.model) this.model = {}
    sources.__localState = 0 // not inherited by this component's children

    this._subscriptions = []
    this._activeSubComponents = new Map()
    this._childReadyState = {}
    this._readyChangedListener = null
    this._readyChanged$ = xs.create({
      start: (listener: any) => { this._readyChangedListener = listener },
      stop: () => {},
    })
    this.sources.dispose$ = this._dispose$
    // PLAN-4 GS-9: uid(name?) from the instance's position: the parent sets sources.__uid (its uid
    // + the child's path or id prop, + a Collection item's key, + a Switchable page name, each
    // encoded by uidPart: 'Name::r.0.2' → 'u-0_46_2'); 'u' at the root (run() sanitizes its `uid`
    // option). renderToString builds the same strings (ssr.ts)
    const base = sources.__uid || 'u'
    this._uid = (n?: string) => n ? base + '-' + n : base

    this.addCalculated = this.createMemoizedAddCalculated()
    this.log = makeLog(`${this._componentNumber} | ${name}`)

    this.initChildSources$()
    this.initIntent$()
    this.initHmrActions()
    this.initAction$()
    this.initState()
    this.initContext()
    this.initModel$()
    this.initPeers$()
    this.initSubComponentSink$()
    this.initSubComponentsRendered$()
    this.initVdom$()
    this.initSinks()

    this.sinks.__index = this._componentNumber

    this.log(`Instantiated`, true)

    // Hook 1: Register with DevTools
    if (typeof window !== 'undefined' && window.__SYGNAL_DEVTOOLS__) {
      window.__SYGNAL_DEVTOOLS__.onComponentCreated(this._componentNumber, name, this)

      // Hook 1b: Register parent-child relationship
      const parentNum = sources?.__parentComponentNumber
      if (typeof parentNum === 'number') {
        window.__SYGNAL_DEVTOOLS__.onSubComponentRegistered(parentNum, this._componentNumber)
      }
    }
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    // [diagnostics hook]
    diag.onDispose(this)
    if (typeof window !== 'undefined' && window.__SYGNAL_DEVTOOLS__?.connected) {
      window.__SYGNAL_DEVTOOLS__.onComponentDisposed(this._componentNumber, this.name)
    }
    // Fire the DISPOSE built-in action so model handlers can run cleanup logic
    const hasDispose = this.model && (this.model[DISPOSE_ACTION] || Object.keys(this.model).some(k => k.includes('|') && k.split('|')[0].trim() === DISPOSE_ACTION))
    if (hasDispose && this.action$ && typeof this.action$.shamefullySendNext === 'function') {
      try {
        this.action$.shamefullySendNext({ type: DISPOSE_ACTION })
      } catch (_) {}
    }
    // Signal disposal to the component via dispose$ stream (for advanced use cases)
    if (this._disposeListener) {
      try {
        this._disposeListener.next(true)
        this._disposeListener.complete()
      } catch (_) {}
      this._disposeListener = null
    }
    // G-144: stop the reply actions now, so none reaches this instance after DISPOSE and the
    // drivers abort its requests with reply actions in flight (rather than when action$ completes below)
    this._replies?.forEach(r$ => r$.shamefullySendComplete())
    // 1-B: abort the EFFECT props.signal (after DISPOSE ran, so a DISPOSE EFFECT gets it too)
    this._ac?.abort()
    // Dispose the sub-components now (R3), so the whole subtree's DISPOSE actions and
    // onDispose hooks run within this call (e.g. before renderComponent restores diagnostics)
    this._activeSubComponents.forEach((entry) => entry?.sink$?.__dispose?.())
    this._activeSubComponents.clear()
    // Tear down streams on next macrotask to allow DISPOSE/cleanup actions to process
    setTimeout(() => {
      // Complete action$ (stops the entire component cycle) and vdom$ (stops rendering), then
      // unsubscribe the tracked internal subscriptions
      for (const s of [this.action$, this.vdom$]) try { s?.shamefullySendComplete?.() } catch (_) {}
      for (const sub of this._subscriptions) try { sub?.unsubscribe?.() } catch (_) {}
      this._subscriptions = []
    }, 0)
  }

  get debug(): boolean {
    return this._debug || (ENVIRONMENT.SYGNAL_DEBUG === 'true' || ENVIRONMENT.SYGNAL_DEBUG === true)
  }

  initIntent$(): void {
    if (!this.intent) {
      // [diagnostics hook]
      diag.onIntent(this, [], undefined)
      return
    }
    if (typeof this.intent != 'function') {
      fail('SYG602', this, 'intent must be a function', 'Use intent = sources => ({ ACTION: stream$ })')
    }

    // [diagnostics hook] checks may wrap the sources (SYG609, renderComponent's fake sources)
    this.intent$ = this.intent(diag.sourcesFor(this))

    if (!(this.intent$ instanceof Stream) && (!isObj(this.intent$))) {
      fail('SYG603', this, 'intent must return a stream or an object of streams', 'Return { ACTION: stream$ }')
    }

    // [diagnostics hook] TODO(1A): selectorsUsed via MainDOMSource.select instrumentation
    diag.onIntent(this, this.intent$ instanceof Stream ? [] : Object.keys(this.intent$), undefined)
  }

  initHmrActions(): void {
    if (typeof this.hmrActions === 'undefined') {
      this.hmrAction$ = xs.empty()
      return
    }
    if (typeof this.hmrActions === 'string') {
      this.hmrActions = [this.hmrActions]
    }
    if (!Array.isArray(this.hmrActions) || this.hmrActions.some(action => typeof action !== 'string')) {
      fail('SYG604', this, 'hmrActions must be an action name or an array of action names', "Use hmrActions = ['ACTION']")
    }
    this.hmrAction$ = xs.fromArray(this.hmrActions.map(action => ({ type: action })))
  }

  initAction$(): void {
    // G-107: a component with a model but no intent still gets BOOTSTRAP
    const intent$ = this.intent$ || {}

    let runner
    if (intent$ instanceof Stream) {
      runner = intent$
    } else {
      // Validate that no intent action names contain '|' (reserved for model shorthand)
      for (const key of Object.keys(intent$)) {
        if (key.includes('|')) {
          fail('SYG605', this, `Intent action '${key}' contains '|', which is reserved for model shorthand`, 'Rename the action')
        }
      }
      const mapped = Object.entries(intent$)
                           .map(([type, data$]: [string, any]) => data$.map((data: any) => ({type, data})))
      runner = mapped.length > 0 ? xs.merge(...mapped) : xs.never()
    }

    const action$    = ((runner instanceof Stream) ? runner : (runner.apply && runner(this.sources) || xs.never()))
    const bootstrap$ = xs.of({ type: BOOTSTRAP_ACTION }).compose(delay(10))
    // G-216: this app's hot swap (run()'s __hmr source: { u: swapping, s: the state to keep })
    const _hmrUpdating = this.sources.__hmr?.u
    const hmrAction$ = _hmrUpdating ? this.hmrAction$ : xs.empty()
    const wrapped$   = (this.model?.[BOOTSTRAP_ACTION] &&!_hmrUpdating) ? concat(bootstrap$, action$) : concat(xs.of().compose(delay(1)).filter((_: any) => false), hmrAction$, action$)

    // PLAN-3 reply actions: a reply-capable source (makeFetchDriver, driverFromAsync, ...)
    // delivers the replies to this instance's own requests as actions (src/extra/replies.ts).
    // === true: the DOM source is a Proxy that answers any property with a function.
    // dispose() completes them, so the driver drops/aborts this instance's requests at once (G-144)
    this._replies = this.sourceNames.filter(n => this.sources[n]?.__sygnalReplies === true).map(n => this.sources[n].replies(this._componentNumber))
    // xs.never(): action$ outlives a finite intent, so DISPOSE can still be sent (it was
    // the legacy hydrate$ that did this)
    this.action$   = xs.merge(wrapped$, xs.never(), ...this._replies)
      .compose(this.log(({ type }: any) => `<${type}> Action triggered`))
      .map((action: any) => {
        if (typeof window !== 'undefined' && window.__SYGNAL_DEVTOOLS__?.connected) {
          window.__SYGNAL_DEVTOOLS__.onActionDispatched(
            this._componentNumber, this.name, action.type, action.data
          )
        }
        return action
      })
  }

  initState(): void {
    if (this.model !== undefined) {
      if (this.model[INITIALIZE_ACTION] === undefined) {
        this.model[INITIALIZE_ACTION] = {
          [this.stateSourceName]: (_: any, data: any) => ({ ...this.addCalculated(data) })
        }
      } else if (isObj(this.model[INITIALIZE_ACTION])) {
        Object.keys(this.model[INITIALIZE_ACTION]).forEach(name => {
          if (name !== this.stateSourceName) {
            warn('SYG210', this, `${INITIALIZE_ACTION} only supports the ${this.stateSourceName} sink; ignoring '${name}'`, 'Use another action')
            delete this.model[INITIALIZE_ACTION][name]
          }
        })
      }
    }
  }

  initContext(): void {
    if (!this.context && !this.sources.__parentContext$) {
      this.context$ = xs.of({})
      return
    }

    const state$ = this.sources[this.stateSourceName]?.stream.startWith({}).compose(dropRepeats(objIsEqual)) || xs.never()
    const parentContext$ = this.sources.__parentContext$?.startWith({}).compose(dropRepeats(objIsEqual)) || xs.of({})
    if (this.context && !isObj(this.context)) {
      logError('SYG402', this, `context must be an object, got ${typeof this.context}; ignoring it`, 'Use context = { name: state => value }')
    }
    this.context$ = xs.combine(state$, parentContext$)
      .map(([_, parent]: [any, any]) => {
        const _parent = isObj(parent) ? parent : {}
        const context = isObj(this.context) ? this.context : {}
        // G-122: recompute the calculated fields, as the view does. The stored ones are only
        // refreshed by this component's own reducers, not by a child's write through a lens.
        const state = isObj(this.currentState) ? this.addCalculated(this.currentState) : this.currentState
        const values = Object.entries(context).reduce((acc, current) => {
          const [name, value] = current
          let _value
          const valueType = typeof value
          if (valueType === 'string') {
            _value = state[value]
          } else if (valueType === 'boolean') {
            _value = state[name]
          } else if (valueType === 'function') {
            _value = value(state)
          } else {
            logError('SYG403', this, `Invalid context entry '${name}'; skipping it`, 'Use a state key or state => value')
            return acc
          }
          acc[name] = _value
          return acc
        }, {} as Record<string, any>)
        const newContext = { ..._parent, ...values }
        this.currentContext = newContext
        if (typeof window !== 'undefined' && window.__SYGNAL_DEVTOOLS__?.connected) {
          window.__SYGNAL_DEVTOOLS__.onContextChanged(this._componentNumber, this.name, newContext)
        }
        return newContext
      })
      .compose(dropRepeats(objIsEqual))
      .startWith({})
    this._subscriptions.push(this.context$.subscribe({ next: (_: any) => _, error: (err: any) => logError('SYG404', this, 'Context stream errored; context stops updating', 'Check the context functions', err) }))
  }

  // PLAN-3 statics (connections, resources, route, head): see the comment where model$ is built
  initStatics(model$: Record<string, any>, keep?: any): void {
    this.sourceNames.forEach(n => {
      const k = this.sources[n]?.__sygnalStatic, f = typeof k == 'string' && this.view?.[k]
      if (!f) return
      const own$: any = xs.create()
      model$[n] = xs.merge(
        xs.combine(xs.merge(this.sources[this.stateSourceName].stream, this._s ||= xs.create()).compose(dropRepeats())
          .map((s: any) => {
            try {
              s = this.addCalculated(s)
              let v = f
              if (typeof f == 'function') v = f(s)
              else if (typeof f == 'object') { v = {}; for (const r in f) v[r] = f[r](s) }
              return [v]
            } catch (err) { caught('SYG216', this, `${k} threw; nothing sent`, ERR_FIX, err, 'declaration') }
          }), this.sources.__switchPage?.shown$ || xs.of(1))
          .map(([w, shown]: any) => {
            let v = w?.[0]
            if (!shown && v && typeof v == 'object') { v = {}; for (const r in w[0]) if (w[0][r]?.background) v[r] = w[0][r] }
            return w && {[k]: v}
          }).compose(dropRepeats(objIsEqual)),
        (model$[n] || xs.never()).filter((v: any) => queueMicrotask(() => queueMicrotask(() => own$.shamefullySendNext(v))) as any),
        // G-167: without a model nothing else subscribes action$ (and its replies), so the driver
        // would never see this sender stop
        keep ? keep.filter(() => false) : xs.never(),
        own$)
    })

  }

  initModel$(): void {
    if (typeof this.model == 'undefined') {
      this.model$ = this.sourceNames.reduce((a: Record<string, any>, s) => {
        a[s] = xs.never()
        return a
      }, {} as Record<string, any>)
      // G-167: statics are sent without a model too
      this.initStatics(this.model$, this.action$)
      // [diagnostics hook]
      diag.onModel(this, {})
      return
    }

    const hmrState = this.sources.__hmr?.s
    const effectiveInitialState = (typeof hmrState !== 'undefined') ? hmrState : this.initialState
    const initial  = { type: INITIALIZE_ACTION, data: effectiveInitialState }
    if (this.isSubComponent && this.initialState && !this.isolatedState) {
      warn('SYG405', this, 'Sub-component initialState replaces the state its parent passes in', 'Remove initialState, or set isolatedState = true')
    }
    const hasInitialState = (typeof effectiveInitialState !== 'undefined')
    const shouldInjectInitialState = hasInitialState && (!this.sources.__hmr?.u || typeof hmrState !== 'undefined')
    // Only INITIALIZE is delayed (user actions start >= 1ms later), so the other actions, and
    // their non-STATE sinks, stay synchronous with the event that caused them (1H-1).
    const shimmed$ = shouldInjectInitialState ? xs.merge(xs.of(initial).compose(delay(0)), this.action$) : this.action$
    // B-003: STATE reducers are applied later (withState queues each one in a microtask), so
    // while one is pending a non-STATE sink must not read this.currentState. Then, before the
    // action reaches any reducer, queue a microtask (ahead of this action's own STATE reducer,
    // behind every earlier one) that snapshots the state and runs the non-STATE sinks.
    // Otherwise run them now, so EFFECT can still preventDefault() the live event (1H-1).
    let snapListener: any = null
    const sequenced$ = shimmed$.map((action: any) => {
      const l = snapListener
      const run = () => l.next({ ...action, [STATE_SNAPSHOT]: this.currentState })
      if (l) pendingReducers ? queueMicrotask(run) : run()
      return action
    })
    let snapSub: any
    const snapshotted$ = xs.create({
      start: (l: any) => { snapListener = l; snapSub = sequenced$.subscribe({}) },
      stop: () => { snapListener = null; snapSub?.unsubscribe() },
    })
    const onState  = () => this.makeOnAction(sequenced$, true, this.action$)
    const onNormal = () => this.makeOnAction(snapshotted$, false, this.action$)


    const modelEntries = Object.entries(this.model)

    const reducers: Record<string, any[]> = {}
    const seenActionSinks = new Set<string>()
    const modelMap: Record<string, string[]> = {}  // [diagnostics hook]

    modelEntries.forEach((entry) => {
      let [action, sinks]: [string, any] = entry

      // ACTION | DRIVER shorthand: 'MY_ACTION | EVENTS': (state) => ({ type: 'foo', data: 'bar' })
      if (action.includes('|')) {
        const parts = action.split('|').map((s: string) => s.trim())
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          fail('SYG211', this, `Invalid shorthand model entry '${action}'`, "Use 'ACTION | SINK'")
        }
        action = parts[0]
        sinks = { [parts[1]]: sinks }
      }

      if (typeof sinks === 'function') {
        sinks = { [this.stateSourceName]: sinks }
      }

      if (!isObj(sinks)) {
        fail('SYG212', this, `Model entry '${action}' must be a function or an object`, 'Use { STATE: reducer }')
      }

      const sinkEntries = Object.entries(sinks)

      sinkEntries.forEach((entry) => {
        const [sink, reducer] = entry

        const actionSinkKey = `${action}::${sink}`
        if (seenActionSinks.has(actionSinkKey)) {
          warn('SYG213', this, `Duplicate model entry for action '${action}' on sink '${sink}'; both run`, 'Remove the duplicate')
        }
        seenActionSinks.add(actionSinkKey)
        ;(modelMap[action] ||= []).push(sink)  // [diagnostics hook]

        // EFFECT sink: run the reducer for side effects only, no state change or sink output
        if (sink === EFFECT_SINK_NAME) {
          ;(reducers[sink] ||= []).push(this.makeEffectHandler(snapshotted$, action, reducer, this.action$))
          return
        }

        const isStateSink  = (sink === this.stateSourceName)
        const isParentSink = (sink === PARENT_SINK_NAME)

        const on  = isStateSink ? onState() : onNormal()
        const on$ = isParentSink ? on(action, reducer).map((value: any) => ({ name: this.name, component: this.view, value })) : on(action, reducer)

        const wrapped$ = on$
          .compose(this.log((data: any) => {
            if (isStateSink) {
              return `<${action}> State reducer added`
            } else if (isParentSink) {
              return `<${action}> Data sent to parent component: ${JSON.stringify(data.value).replaceAll('"', '')}`
            } else {
              const extra = data && (data.type || data.command || data.name || data.key || (Array.isArray(data) && 'Array') || data)
              return `<${action}> Data sent to [${sink}]: ${JSON.stringify(extra).replaceAll('"', '')}`
            }
          }))

        ;(reducers[sink] ||= []).push(wrapped$)
      })
    })

    const model$ = Object.entries(reducers).reduce((acc: Record<string, any>, entry: [string, any]) => {
      const [sink, streams] = entry
      acc[sink] = streams.length === 1 ? streams[0] : xs.merge(...streams)
      return acc
    }, {} as Record<string, any>)

    // PLAN-3 §1.3: Component.connections(state) is sent as { connections } to the sink of a
    // makeSocketDriver (its source is marked), from the current state (and from this
    // component's own reducer results: below a Collection the state stream lags a debounce),
    // without equal repeats. G-158: the component's own values on that sink go two microtasks
    // later, after its reducer ran, so a connection the same action opens or changes is first
    // 3-A: the same for Component.resources ({ name: state => request }) to makeFetchDriver: the
    // source names the static it takes (__sygnalStatic)
    // D85: in a hidden Switchable page, an object declaration keeps only its entries with
    // `background: true` (the driver closes / idles the rest as removed); shown, all of them.
    // Any other value (a `route` string) stays as it is
    this.initStatics(model$)

    this.model$ = model$

    // [diagnostics hook]
    diag.onModel(this, modelMap)
  }

  initPeers$(): void {
    const initial: Record<string, any> = {}
    for (const name of this.sourceNames) initial[name] = name == this.DOMSourceName ? {} : []

    this.peers$ = Object.entries(this.peers).reduce((acc: Record<string, any>, [peerName, peerFactory]) => {
      const peer$ = peerFactory(this.sources)
      this.sourceNames.forEach(source => {
        if (source == this.DOMSourceName) {
          acc[source][peerName] = peer$[source]
        } else {
          acc[source].push(peer$[source])
        }
      })
      return acc
    }, initial)
  }

  initChildSources$(): void {
    let newSourcesNext: any
    const childSources$ = xs.create({
      start: (listener: any) => {
        newSourcesNext = listener.next.bind(listener)
      },
      stop: (_: any) => {

      }
    }).map((sources: any) => xs.merge(...sources)).flatten()

    this.sources[CHILD_SOURCE_NAME] = {
      select: (nameOrComponent: any) => {
        const all$ = childSources$
        const filtered$ = typeof nameOrComponent === 'function'
          ? all$.filter((entry: any) => entry.component === nameOrComponent)
          : nameOrComponent
            ? all$.filter((entry: any) => entry.name === nameOrComponent)
            : all$
        const unwrapped$ = filtered$.map((entry: any) => entry.value)
        return unwrapped$
      }
    }

    this.newChildSources = (sources: any) => {
      if (typeof newSourcesNext === 'function') newSourcesNext(sources)
    }
  }

  initSubComponentSink$(): void {
    const subComponentSink$ = xs.create({
      start: (listener: any) => {
        this.newSubComponentSinks = listener.next.bind(listener)
      },
      stop: (_: any) => {

      }
    })
    this._subscriptions.push(subComponentSink$.subscribe({ next: (_: any) => _, error: (err: any) => logError('SYG901', this, 'Sub-component sink stream errored', ERR_FIX, err) }))
    this.subComponentSink$ = subComponentSink$.filter((sinks: any) => Object.keys(sinks).length > 0)
  }

  initSubComponentsRendered$(): void {
    const stream = xs.create({
      start: (listener: any) => {
        this.triggerSubComponentsRendered = listener.next.bind(listener)
      },
      stop: (_: any) => {

      }
    })
    this.subComponentsRendered$ = stream.startWith(null)
  }

  initVdom$(): void {
    if (typeof this.view != 'function') {
      this.vdom$ = xs.of(null)
      return
    }

    const renderParameters$ = this.collectRenderParameters()

    this.vdom$ = renderParameters$
      .map((params: any) => {
        const { props, state, children, slots, context, ...peers }: any = params
        const { sygnalFactory, sygnalOptions, ...sanitizedProps}: any = props || {}
        try {
          return this.view({ ...sanitizedProps, state, children, slots: slots || {}, context, peers, uid: this._uid }, state, context, peers)
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          let fallback: any = { sel: 'div', data: { attrs: { 'data-sygnal-error': this.name } }, children: [] }
          // B-022: an error handled by .onError is a warning, without the "add .onError" hint
          if (typeof this.onError === 'function') {
            try {
              fallback = this.onError(error, { componentName: this.name })
              warn('SYG406', this, 'View threw; rendered the onError fallback', undefined, error)
            } catch (fallbackErr) {
              logError('SYG406', this, 'View threw; rendering the error fallback', undefined, error)
              logError('SYG407', this, 'onError threw; rendering an empty error <div>', 'Make onError return a vnode', fallbackErr)
            }
          } else logError('SYG406', this, 'View threw; rendering the error fallback', 'Add .onError for a custom fallback', error)
          // GS-11: the app hook, after the boundary chose the fallback
          appError(this, error, 'view')
          return fallback
        }
      })
      .compose(this.log('View rendered'))
      .map((vDom: any) => stampFields(vDom || { sel: 'div', data: {}, children: [] }, this._inputSeq))
      .map((vdom: any) => preprocessVdom(vdom, this))
      .compose(this.instantiateSubComponents.bind(this))
      .filter((val: any) => val !== undefined)
      .compose(this.renderVdom.bind(this))

  }

  initSinks(): void {
    // Stamp this component's own EVENTS emissions with its info for devtools, before they are
    // merged with the sub-components' (B-023: stamping the merged sink made every ancestor
    // re-stamp, so the emitter was always the root). Non-enumerable (G-020), so sink values
    // still toEqual what the model returned.
    // PLAN-3: the same stamp tags this component's own requests to a reply-capable source
    // (__emitterId is the sender its reply actions go to). Only object requests are stamped
    // (a string is a plain GET); every EVENTS value is, as before (G-147).
    ;['EVENTS', ...this.sourceNames.filter(n => this.sources[n]?.__sygnalReplies === true)].forEach(n => {
      const s$ = this.model$[n]
      if (s$) this.model$[n] = s$.map((v: any) => n == 'EVENTS' || isObj(v) ? Object.defineProperties({...v}, {
        __emitterId: { value: this._componentNumber, configurable: true },
        __emitterName: { value: this.name, configurable: true },
      }) : v)
    })
    this.sinks = this.sourceNames.reduce((acc: Record<string, any>, name) => {
      if (name == this.DOMSourceName) return acc
      const subComponentSink$ = (this.subComponentSink$ && name !== PARENT_SINK_NAME) ? this.subComponentSink$.map((sinks: any) => sinks[name]).filter((sink: any) => !!sink).flatten() : xs.never()
      acc[name] = xs.merge((this.model$[name] || xs.never()), subComponentSink$, ...(name === this.stateSourceName ? [this.sources[name].stream.filter((_: any) => false)] : []), ...(this.peers$[name] || []))
      return acc
    }, {} as Record<string, any>)

    this.sinks[this.DOMSourceName] = this.vdom$
    this.sinks[PARENT_SINK_NAME] = this.model$[PARENT_SINK_NAME] || xs.never()

    // EFFECT sink: subscribe to trigger side effects but don't expose as a driver sink
    if (this.model$[EFFECT_SINK_NAME]) {
      const effectSub = this.model$[EFFECT_SINK_NAME].subscribe({
        next: () => {},
        error: (err: any) => logError('SYG902', this, 'EFFECT stream errored; effects stop running', ERR_FIX, err),
      })
      this._subscriptions.push(effectSub)
      delete this.sinks[EFFECT_SINK_NAME]
    }
    // PLAN-4 GS-2: the built-in ELEMENT sink (element commands) runs against this instance's own
    // DOM source after the next patch (./extra/elementCommands)
    if (this.model$.ELEMENT) this._subscriptions.push(this.model$.ELEMENT.subscribe({ next: (c: any) => runElementCommands(this, c) }))
    // READY sink: if the component explicitly defined READY model entries, use them;
    // otherwise auto-emit true. Check the raw model object, not model$ (which always has keys for all sources).
    if (isObj(this.model) && Object.values(this.model).some((sinks: any) => isObj(sinks) && READY_SINK_NAME in sinks)) {
      this.sinks[READY_SINK_NAME] = this.model$[READY_SINK_NAME]
      this.sinks[READY_SINK_NAME].__explicitReady = true
    } else {
      this.sinks[READY_SINK_NAME] = xs.of(true)
    }
  }

  makeOnAction(action$: any, isStateSink: boolean = true, rootAction$?: any): (name: string, reducer: any) => any {
    rootAction$ = rootAction$ || action$
    return (name, reducer) => {
      const filtered$ = action$.filter(({type}: any) => type == name)

      let returnStream$
      if (typeof reducer === 'function') {
        returnStream$ = filtered$.map((action: any) => {
          const next = (type: any, data: any, delay=10) => {
            if (typeof delay !== 'number') fail('SYG215', this, `next() delay in '${name}' must be a number`, "Use next('ACTION', data, ms)")
            // put the "next" action request at the end of the event loop so the "current" action completes first
            setTimeout(() => {
              // push the "next" action request into the action$ stream
              rootAction$.shamefullySendNext({ type, data })
            }, delay)
            this.log(`<${name}> Triggered a next() action: <${type}> ${delay}ms delay`, true)
          }

          const props = { ...this.currentProps, children: this.currentChildren, slots: this.currentSlots || {}, context: this.currentContext, uid: this._uid }

          let data = action.data
          if (isStateSink) {
            // withState applies reducers in microtasks, so none is legitimately pending at the
            // next macrotask: reset then, in case one was never applied (e.g. app disposed)
            if (!pendingReducers++) setTimeout(() => { pendingReducers = 0 })
            let applied = false
            return (state: any) => {
              if (!applied && pendingReducers) { applied = true; pendingReducers-- }
              // Reduce from the fresh argument, not currentState (B-013, 1H-3): below a
              // Collection, currentState lags behind instantiateCollection's debounce, so a
              // second same-tick action would start from the pre-update state. The parents'
              // lenses add their calculated fields, so it matches what the view gets.
              const fresh = typeof state !== 'undefined'
              const _state = this.isSubComponent && !fresh ? this.currentState : state
              try {
                const enhancedState = this.addCalculated(_state)
                props.state = enhancedState
                const newState = reducer(enhancedState, data, next, props)
                // PLAN-4 GS-4: the object it got back = no change, as ABORT (the dev entry flags an in-place mutation)
                if (newState === enhancedState || isAbort(newState)) return _state
                // [diagnostics hook]
                diag.onReducer(this, name, _state, newState, this.stateSourceName)
                const result = this.cleanupCalculated(newState)
                // B-013: later same-tick actions' non-STATE sinks snapshot currentState (B-003)
                // (and the connections static: _s, which feeds it ahead of a Collection's debounce)
                if (fresh) {
                  this.currentState = result
                  this._s?.shamefullySendNext(result)
                }
                return result
              } catch (err) {
                caught('SYG216', this, `Reducer for '${name}' threw; state unchanged`, ERR_FIX, err, 'reducer', name)
                return _state
              }
            }
          } else {
            try {
              const enhancedState = this.addCalculated(STATE_SNAPSHOT in action ? action[STATE_SNAPSHOT] : this.currentState)
              props.state = enhancedState
              const reduced = reducer(enhancedState, data, next, props)
              // B-029: ABORT = send nothing (filtered below), before the type checks
              if (isAbort(reduced)) return reduced
              const type = typeof reduced
              // G-108: any value a constant can be (incl. null, arrays, bigints) is a payload
              if (type === 'symbol') {
                // G-027: reported directly (it used to be thrown into the catch below, i.e. SYG216)
                logError('SYG218', this, `Reducer for '${name}' returned a symbol; nothing sent`, 'Return a value, or ABORT to send nothing')
                return ABORT
              }
              if (type === 'undefined') warn('SYG217', this, `Reducer for '${name}' sent undefined to the driver`, 'Return a value, or ABORT to send nothing')
              return reduced
            } catch (err) {
              caught('SYG216', this, `Reducer for '${name}' threw; nothing sent`, ERR_FIX, err, 'reducer', name)
              return ABORT
            }
          }
        }).filter((result: any) => !isAbort(result))
      } else if (reducer === undefined || reducer === true) {
        returnStream$ = filtered$.map(({data}: any) => data)
      } else {
        const value = reducer
        returnStream$ = filtered$.mapTo(value)
      }

      return returnStream$
    }
  }

  makeEffectHandler(action$: any, name: string, reducer: any, rootAction$: any = action$): any {
    const filtered$ = action$.filter(({type}: any) => type == name)

    return filtered$.map((action: any) => {
      if (typeof reducer === 'function') {
        const next = (type: any, data: any, delay=10) => {
          if (typeof delay !== 'number') fail('SYG215', this, `next() delay in '${name}' must be a number`, "Use next('ACTION', data, ms)")
          // 1-B: an async EFFECT can resolve after unmount; its next() then does nothing
          if (this._disposed) return this.log(`next(${type}) ignored: disposed`, true)
          setTimeout(() => {
            rootAction$.shamefullySendNext({ type, data })
          }, delay)
          this.log(`<${name}> EFFECT triggered a next() action: <${type}> ${delay}ms delay`, true)
        }
        const failed = (err: any) => caught('SYG214', this, `EFFECT handler '${name}' threw`, ERR_FIX, err, 'effect', name)

        try {
          const enhancedState = this.addCalculated(STATE_SNAPSHOT in action ? action[STATE_SNAPSHOT] : this.currentState)
          // 1-B: signal (EFFECT only) aborts on DISPOSE; one controller per instance, made on
          // the first EFFECT, skipped where AbortController is missing
          const props = { ...this.currentProps, children: this.currentChildren, slots: this.currentSlots || {}, context: this.currentContext, uid: this._uid, state: enhancedState, signal: (this._ac ||= globalThis.AbortController && new AbortController())?.signal }
          const result = reducer(enhancedState, action.data, next, props)
          // 1-B: a returned thenable (async EFFECT) is expected; its rejection is SYG214
          if (result?.then) result.then(null, failed)
          else if (result !== undefined && !isAbort(result)) {
            warn('SYG219', this, `EFFECT handler '${name}' returned a value, which is ignored`, 'Use a STATE or driver sink')
          }
        } catch (err) {
          failed(err)
        }
      }
      return null
    }).filter((_: any) => false)  // EFFECT never emits — stream is consumed but produces no output
  }

  createMemoizedAddCalculated(): (state: any) => any {
    let lastState: any
    let lastResult: any

    return function(this: Component, state: any) {
      const idle = this._idle
      if (!(this.calculated || idle) || !isObj(state) || Array.isArray(state)) return state
      if (state === lastState) {
        return lastResult
      }
      if (this.calculated && !isObj(this.calculated)) fail('SYG606', this, 'calculated must be an object', 'Use calculated = { field: state => value }')

      const calculated = this.getCalculatedValues(state)
      lastState = state
      // 3-A: a resource with no state[name] yet reads as idle
      return lastResult = calculated || idle ? { ...idle, ...state, ...calculated } : state
    }
  }

  getCalculatedValues(state: any): Record<string, any> | undefined {
    if (!this._calculatedOrder || this._calculatedOrder.length === 0) {
      return
    }

    const mergedState: Record<string, any> = { ...state }
    const computedSoFar: Record<string, any> = {}

    for (const [field, { fn, deps }] of this._calculatedOrder) {
      // memoized on the declared deps; without deps, always recomputed
      const cache = deps && this._calculatedFieldCache?.[field]
      const currentDepValues: any = cache && deps!.map(d => mergedState[d])
      if (cache && cache.lastDepValues && currentDepValues.every((v: any, i: number) => v === cache.lastDepValues[i])) {
        computedSoFar[field] = mergedState[field] = cache.lastResult
        continue
      }
      try {
        const result = fn(mergedState)
        if (cache) {
          cache.lastDepValues = currentDepValues
          cache.lastResult = result
        }
        computedSoFar[field] = mergedState[field] = result
      } catch (e: unknown) {
        warn('SYG220', this, `Calculated field '${field}' threw (${e instanceof Error ? e.message : e}); skipped this update`, 'Guard against missing data')
      }
    }

    return computedSoFar
  }

  cleanupCalculated(incomingState: any): any {
    if (!incomingState || !isObj(incomingState) || Array.isArray(incomingState)) return incomingState
    const state = this.storeCalculatedInState ? this.addCalculated(incomingState) : incomingState
    const copy  = { ...state }
    if (!this.calculated || this.storeCalculatedInState) return copy
    const keys = Object.keys(this.calculated)
    keys.forEach(key => {
      if (this.initialState && typeof this.initialState[key] !== 'undefined') {
        copy[key] = this.initialState[key]
      } else {
        delete copy[key]
      }
    })
    return copy
  }

  collectRenderParameters(): any {
    const state        = this.sources[this.stateSourceName]
    const renderParams = { ...this.peers$[this.DOMSourceName] }

    const enhancedState = state && state.isolateSource(state, { get: (state: any) => this.addCalculated(state) })
    const stateStream   = (enhancedState && enhancedState.stream) || xs.never()

    
    renderParams.state  = stateStream.compose(dropRepeats(objIsEqual))

    if (this.sources.props$) {
      renderParams.props = this.sources.props$.compose(dropRepeats(propsIsEqual))
    }

    if (this._processedChildren$) {
      renderParams.children = this._processedChildren$.map((p: any) => p.children).compose(dropRepeats(objIsEqual))
      renderParams.slots = this._processedChildren$.map((p: any) => p.slots).compose(dropRepeats(objIsEqual))
    }

    if (this.context$) {
      renderParams.context = this.context$.compose(dropRepeats(objIsEqual))
    }

    const names = Object.keys(renderParams)

    let combined = xs.combine(...Object.values(renderParams))
      // G-146: the input counter as of the state and props this render will show
      .map((arr: any) => (this._inputSeq = renderSeq(), arr))
      .compose(debounce(1))
      // map the streams from an array back to an object with the render parameter names as the keys
      .map((arr: any) => {
        const params = names.reduce((acc: Record<string, any>, name, index) => {
          acc[name] = arr[index]
          if (name === 'state') {
            acc[this.stateSourceName] = arr[index]
            acc.calculated = (arr[index] && this.getCalculatedValues(arr[index])) || {}
          }
          return acc
        }, {} as Record<string, any>)
        return params
      })

    // R4-1/G-121: in a hidden Switchable page, renders wait until it is shown (the latest
    // parameters then render once); a skipped render marks the page stale (R4-10)
    const page = this.sources.__switchPage
    if (page) {
      let last: any
      combined = xs.combine(combined, page.shown$)
        .filter(([p, shown]: any) => p !== last && (shown || page.mark()))
        .map(([p]: any) => (last = p))
    }

    return combined
  }

  instantiateSubComponents(vDom$: any): any {
    // Build the component name Set once outside the fold — avoids rebuilding per render
    const componentNameSet = new Set(['collection', 'switchable', 'sygnal-factory', ...Object.keys(this.components)])

    return vDom$.fold((previousComponents: any, vDom: any) => {
      const foundComponents = getComponents(vDom, componentNameSet)
      const entries         = Object.entries(foundComponents)

      const rootEntry: Record<string, any> = { '::ROOT::': vDom }

      if (entries.length === 0) {
        // Dispose any previously active sub-components
        this._activeSubComponents.forEach((entry) => entry?.sink$?.__dispose?.())
        this._activeSubComponents.clear()
        return rootEntry
      }

      const sinkArrsByType: Record<string, any[]> = {}
      const childSources: any[] = []
      let newInstanceCount = 0

      const newComponents =  entries.reduce((acc, [id, el]) => {
        const data     = el.data
        const props    = data.props  || {}
        // a string-tag component with a single text child is a text-only vnode (B-011)
        const children = el.children || (el.text != null ? [{ text: el.text }] : [])

        const isCollection = data.isCollection || false
        const isSwitchable = data.isSwitchable || false

        const addSinks = (sinks: any) => {
          Object.entries(sinks).forEach(([name, stream]: [string, any]) => {
            sinkArrsByType[name] ||= []
            if (name === PARENT_SINK_NAME) {
              childSources.push(stream)
            } else if (name !== this.DOMSourceName && name !== READY_SINK_NAME) {
              sinkArrsByType[name].push(stream)
            }
          })
        }


        if (previousComponents[id]) {
          const entry = previousComponents[id]
          acc[id] = entry
          entry.props$.shamefullySendNext(props)
          entry.children$.shamefullySendNext(children)
          addSinks(entry.sink$)
          return acc
        }

        const props$    = xs.create().startWith(props)
        const children$ = xs.create().startWith(children)

        newInstanceCount++

        let sink$
        try {
          // GS-9: the child's uid: this uid + its path or id prop (the instantiate* functions put it
          // in the child's own sources; the sources this component received stay as they are, G-214)
          this._cu = this._uid(uidPart(id.replace(/.*::(r\.)?/, '')))
          sink$ = (isCollection ? this.instantiateCollection : isSwitchable ? this.instantiateSwitchable : this.instantiateCustomComponent).call(this, el, props$, children$)
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          let fallbackVNode = { sel: 'div', data: { attrs: { 'data-sygnal-error': this.name } }, children: [] }
          if (typeof this.onError === 'function') {
            try {
              fallbackVNode = this.onError(error, { componentName: this.name }) || fallbackVNode
            } catch (fallbackErr) {
              logError('SYG407', this, 'onError threw; rendering an empty error <div>', 'Make onError return a vnode', fallbackErr)
            }
          }
          // GS-11: logged (and given to the app's onError) after the boundary chose the fallback
          caught('SYG408', this, 'Sub-component threw; rendering the error fallback', ERR_FIX, error, 'instantiate')
          sink$ = { [this.DOMSourceName]: xs.of(fallbackVNode) }
        }

        sink$[this.DOMSourceName] = sink$[this.DOMSourceName] ? this.makeCoordinatedSubComponentDomSink(sink$[this.DOMSourceName]) : xs.never()

        acc[id] = { sink$, props$, children$ }
        this._activeSubComponents.set(id, acc[id])

        addSinks(sink$)

        return acc
      }, rootEntry)

      const mergedSinksByType = Object.entries(sinkArrsByType).reduce((acc: Record<string, any>, [name, streamArr]: [string, any]) => {
        if (streamArr.length === 0) return acc
        acc[name] = streamArr.length === 1 ? streamArr[0] : xs.merge(...streamArr)
        return acc
      }, {} as Record<string, any>)

      // Dispose removed sub-components
      const currentIds = new Set(Object.keys(newComponents))
      this._activeSubComponents.forEach((entry, id) => {
        if (!currentIds.has(id)) {
          entry?.sink$?.__dispose?.()
          this._activeSubComponents.delete(id)
          delete this._childReadyState[id]
        }
      })

      this.newSubComponentSinks(mergedSinksByType)
      this.newChildSources(childSources)


      if (newInstanceCount > 0) this.log(`New sub components instantiated: ${newInstanceCount}`, true)

      return newComponents
    }, {})
  }

  makeCoordinatedSubComponentDomSink(domSink$: any): any {
    return domSink$
      .debug((_: any) => this.triggerSubComponentsRendered())
      .remember()
  }

  // A child's reducers get their state through its lens from this component's raw reducer
  // state; adding the calculated fields here gives them what the child's view gets (1H-3).
  // 4-F: a child's write stores freshly computed fields too (as this component's own reducers
  // do), so the STATE stream (t.state, devtools) is never stale after a child changes it
  withCalculated(lense: any): any {
    return this.calculated ? { get: (state: any) => lense.get(isObj(state) ? this.addCalculated(state) : state), set: (o: any, n: any, s = lense.set(o, n)) => s === o ? s : this.cleanupCalculated(s) } : lense
  }

  createSubComponentLense(stateField: any, componentType: string, defaultState?: any): any {
    const baseLense = {
      get: (state: any) => state,
      set: (_oldState: any, newState: any) => newState
    }

    if (typeof stateField === 'undefined') return baseLense

    if (typeof stateField === 'string') {
      return {
        get: (state: any) => {
          const slice = state[stateField]
          if (typeof slice === 'undefined' && defaultState) return defaultState
          return slice
        },
        set: (oldState: any, newState: any) => {
          if (this.calculated && stateField in this.calculated) {
            warn('SYG409', this, `${componentType} tried to update calculated field '${stateField}'; ignored`, 'Bind it to a non-calculated field')
            return oldState
          }
          return { ...oldState, [stateField]: newState }
        }
      }
    }

    if (isObj(stateField)) {
      if (typeof stateField.get !== 'function') {
        logError('SYG410', this, `${componentType} 'state' prop has no get(); it gets the parent's whole state`, 'Use a state key string or { get, set }')
        return baseLense
      }
      return { get: stateField.get, set: stateField.set }
    }

    logError('SYG410', this, `${componentType} 'state' prop is a ${typeof stateField}; it gets the parent's whole state`, 'Use a state key string or { get, set }')
    return baseLense
  }

  instantiateCollection(el: any, props$: any, children$: any): any {
    const data      = el.data
    const props     = data.props || {}
    // f/s: the raw props last applied (a sort object isn't the sort function made from it)
    const arrayOperators: Record<string, any> = {
      f: props.filter,
      s: props.sort,
      filter: typeof props.filter === 'function' ? props.filter : undefined,
      sort: sortFunctionFromProp(props.sort)
    }

    const state$ = xs.combine(this.sources[this.stateSourceName].stream.startWith(this.currentState), props$.startWith(props))
      // this debounce is important. it forces state and prop updates to happen at the same time
      // without this, changes to sort or filter won't happen properly
      .compose(debounce(1))
      .map(([state, props]: [any, any]) => {
        let changed
        if (props.filter !== arrayOperators.f) {
          arrayOperators.filter = typeof (arrayOperators.f = props.filter) === 'function' ? props.filter : undefined
          changed = 1
        }
        if (props.sort !== arrayOperators.s) {
          arrayOperators.sort = sortFunctionFromProp(arrayOperators.s = props.sort)
          changed = 1
        }
        // G-102: in a child component new filter/sort props can arrive a render after the
        // state; a copy gets past the state source's dropRepeats so the items are filtered
        // and sorted again. Calculated fields are added by the lens (B-013)
        return changed && isObj(state) ? { ...state } : state
      })

    const stateSource  = new StateSource(state$, this.stateSourceName)
    const stateField   = props.from
    const collectionOf = props.of
    const idField      = props.idfield || 'id'

    let lense
    let factory

    if (typeof collectionOf === 'function') {
      if (collectionOf.isSygnalComponent) {
        factory = collectionOf
      } else {
        factory = component(optionsOf(collectionOf, collectionOf.componentName || collectionOf.label || collectionOf.name || 'FUNCTION_COMPONENT'))
      }
    } else if (this.components[collectionOf]) {
      factory = this.components[collectionOf]
    } else {
      fail('SYG411', this, `Collection 'of' is not a component: ${collectionOf}`, 'Use of={ItemComponent}')
    }

    // PLAN-4 PF-1: an item that has an id is passed as is (its identity lets the item's state
    // source skip it when unchanged); one without gets a copy with its index as the id
    const keyed = (item: any, index: any) => item[idField] ? item : { ...item, [idField]: index }
    const fieldLense = {
      get: (state: any) => {
        if (!Array.isArray(state[stateField])) return []
        const items = state[stateField]
        const filtered = typeof arrayOperators.filter === 'function' ? items.filter(arrayOperators.filter) : items
        const sorted = typeof arrayOperators.sort === 'function' ? [...filtered].sort(arrayOperators.sort) : filtered
        const mapped = sorted.map((item: any, index: any) => {
          return (isObj(item)) ? keyed(item, index) : { value: item, [idField]: index }
        })

        return mapped
      },
      set: (oldState: any, newState: any) => {
        if (this.calculated && stateField in this.calculated) {
          warn('SYG409', this, `Collection tried to update calculated field '${stateField}'; ignored`, 'Bind it to a non-calculated field')
          return oldState
        }
        // PF-1: one Map by id (filled from the end, so the first match wins, as find() did)
        const byId = new Map<any, any>(newState.map((item: any) => [item[idField], item]).reverse())
        const updated = []
        for (const oldItem of oldState[stateField].map((item: any, index: any) => (isObj(item) ? keyed(item, index) : { __primitive: true, value: item, [idField]: index }))) {
          if (typeof arrayOperators.filter === 'function' && !arrayOperators.filter(oldItem)) {
            updated.push(oldItem.__primitive ? oldItem.value : oldItem)
          } else {
            const newItem = byId.get(oldItem[idField])
            if (typeof newItem !== 'undefined') updated.push(oldItem.__primitive ? newItem.value : newItem)
          }
        }
        return { ...oldState, [stateField]: updated }
      }
    }

    if (stateField === undefined) {
      lense = {
        get: (state: any) => {
          if (!(state instanceof Array) && state.value && state.value instanceof Array) return state.value
          return state
        },
        set: (oldState: any, newState: any) => {
          return newState
        }
      }
    } else if (typeof stateField === 'string') {
      const cs = this.currentState
      if (isObj(cs) && !(stateField in cs) && !(this.calculated && stateField in this.calculated)) {
        const arrayFields = Object.keys(cs).filter(k => Array.isArray(cs[k]))
        warn('SYG401', this, `Collection from="${stateField}" is not in state${arrayFields.length ? ` (array fields: '${arrayFields.join("', '")}')` : ''}; it renders nothing`, 'Set it to an array in initialState')
      } else {
        if (!Array.isArray(cs[stateField])) warn('SYG401', this, `Collection 'from' field '${stateField}' is not an array; it renders nothing`, 'Set it to an array in initialState')
        lense = fieldLense
      }
    } else if (isObj(stateField)) {
      if (typeof stateField.get !== 'function') {
        logError('SYG412', this, "Collection 'from' prop is invalid; it renders nothing", 'Use a state key string or { get, set }', stateField)
        lense = undefined
      } else {
        lense = {
          get: (state: any) => {
            const newState = stateField.get(state)
            if (!Array.isArray(newState)) {
              warn('SYG401', this, "Collection 'from' getter returned a non-array; it renders nothing", 'Return an array from get()', newState)
              return []
            }
            return newState
          },
          set: stateField.set
        }
      }
    } else {
      logError('SYG412', this, "Collection 'from' prop is invalid; it renders nothing", 'Use a state key string or { get, set }', stateField)
      lense = undefined
    }

    // B-013: add this component's calculated fields inside the lens, not on state$, so the
    // items' reducers (which read through the lens from the raw state) see the same item
    // array as their views, e.g. for from={calculatedField} or a custom get().
    if (lense) lense = this.withCalculated(lense)

    // Strip collection-specific props and forward only user-defined extra props to each item
    const collectionKeys = ['of', 'from', 'filter', 'sort', 'idfield', 'className']
    const itemProps$ = props$.map((p: any) => {
      if (!p || typeof p !== 'object') return {}
      const itemProps: Record<string, any> = {}
      for (const key in p) {
        if (!collectionKeys.includes(key)) itemProps[key] = p[key]
      }
      return itemProps
    })

    const sources = { ...this.sources, [this.stateSourceName]: stateSource, props$: itemProps$, children$, __parentContext$: this.context$, PARENT: null, __parentComponentNumber: this._componentNumber, __uid: this._cu }
    const sink$   = collection(factory, lense as any, { container: null as any })(sources)
    if (!isObj(sink$)) {
      fail('SYG903', this, 'Collection factory returned invalid sinks', 'Return a sinks object')
    }

    // Notify devtools of collection mount
    if (typeof window !== 'undefined' && (window as any).__SYGNAL_DEVTOOLS__?.connected) {
      const itemName = typeof collectionOf === 'function'
        ? (collectionOf.componentName || collectionOf.label || collectionOf.name || 'anonymous')
        : String(collectionOf)
      ;(window as any).__SYGNAL_DEVTOOLS__.onCollectionMounted(
        this._componentNumber, this.name, itemName,
        typeof stateField === 'string' ? stateField : null
      )
    }

    return sink$
  }

  instantiateSwitchable(el: any, props$: any, children$: any): any {
    const data      = el.data
    const props     = data.props  || {}

    const state$ = this.sources[this.stateSourceName].stream.startWith(this.currentState)
      .map((state: any) => {
        return isObj(state) ? this.addCalculated(state) : state
      })

    const stateSource = new StateSource(state$, this.stateSourceName)
    const stateField  = props.state
    const lense = this.withCalculated(this.createSubComponentLense(stateField, 'Switchable sub-component'))

    const switchableComponents = props.of
    const keys = Object.keys(switchableComponents)
    keys.forEach(key => {
      const current = switchableComponents[key]
      if (!current.isSygnalComponent) {
        switchableComponents[key] = component(optionsOf(current, current.componentName || current.label || current.name || 'FUNCTION_COMPONENT'))
      }
    })
    const sources = { ...this.sources, [this.stateSourceName]: stateSource, props$, children$, __parentContext$: this.context$, __parentComponentNumber: this._componentNumber, __uid: this._cu }

    const sink$ = isolate(switchable(switchableComponents, props$.map((props: any) => [props.current, props.instance]), ''), { [this.stateSourceName]: lense })(sources)

    if (!isObj(sink$)) {
      fail('SYG903', this, 'Switchable factory returned invalid sinks', 'Return a sinks object')
    }

    return sink$
  }

  instantiateCustomComponent(el: any, props$: any, children$: any): any {
    const componentName = el.sel
    const data      = el.data
    const props     = data.props  || {}

    const state$ = this.sources[this.stateSourceName].stream.startWith(this.currentState)
      .map((state: any) => {
        return isObj(state) ? this.addCalculated(state) : state
      })

    let stateSource = new StateSource(state$, this.stateSourceName)
    const stateField  = props.state

    if (typeof props.sygnalFactory !== 'function' && isObj(props.sygnalOptions)) {
      props.sygnalFactory = component(props.sygnalOptions)
    }

    const factory   = componentName === 'sygnal-factory' ? props.sygnalFactory : (this.components[componentName] || props.sygnalFactory)
    if (!factory) {
      if (componentName === 'sygnal-factory') fail('SYG413', this, 'Unnamed component has no factory', 'Name the function, or set Comp.componentName')
      fail('SYG414', this, `Component '${componentName}' not found`, 'Import it, or add it to .components')
    }

    // Guard against sub-components accidentally overwriting parent state with .initialState
    const subInitialState = props.sygnalOptions?.initialState
    const subIsolatedState = props.sygnalOptions?.isolatedState
    if (subInitialState && !subIsolatedState) {
      const subName = props.sygnalOptions?.name || componentName
      fail('SYG405', subName, 'Sub-component initialState replaces the state its parent passes in', 'Remove initialState, or set isolatedState = true')
    }

    const subInitState = subIsolatedState ? subInitialState : undefined
    let lense = this.createSubComponentLense(stateField, 'Sub-component', subInitState)
    // B-008: isolatedState without a `state` prop = state local to this instance; the
    // parent's state is never replaced. It's kept off the parent's state stream (1H-9): the
    // child's reducers are applied below and feed its own state source, so a child write
    // doesn't produce a new parent state. Until the child first writes (its INITIALIZE, also
    // without a model since B-016) it reads the parent's state, as before.
    let local: any, local$: any
    if (subIsolatedState && typeof stateField === 'undefined') {
      local$ = xs.create()
      stateSource = new StateSource(xs.merge(state$.filter(() => local === undefined), local$), this.stateSourceName)
    }

    const sources: Record<string, any> = { ...this.sources, [this.stateSourceName]: stateSource, props$, children$, __parentContext$: this.context$, __parentComponentNumber: this._componentNumber, __localState: local$, __uid: this._cu }
    lense = local$ ? null : this.withCalculated(lense)

    // Detect Command objects in props and expose as commands$ source
    for (const key of Object.keys(props)) {
      const val = props[key]
      if (val && val.__sygnalCommand) {
        val._targetComponentName = componentName
        sources.commands$ = makeCommandSource(val as Command)
        break
      }
    }

    const sink$   = isolate(factory, { [this.stateSourceName]: lense })(sources)

    if (!isObj(sink$)) {
      const name = componentName === 'sygnal-factory' ? 'custom element' : componentName
      fail('SYG903', this, `Factory for ${name} returned invalid sinks`, 'Return a sinks object')
    }
    if (local$ && sink$[this.stateSourceName]) {
      sink$[this.stateSourceName] = sink$[this.stateSourceName]
        .map((reducer: any) => local$.shamefullySendNext(local = reducer(local === undefined ? this.addCalculated(this.currentState) : local)))
        .filter(() => false)
    }

    return sink$
  }

  renderVdom(componentInstances$: any): any {
    // Build the component name Set once — avoids rebuilding per render cycle
    const componentNameSet = new Set(['collection', 'switchable', 'sygnal-factory', ...Object.keys(this.components)])

    return xs.combine(this.subComponentsRendered$, componentInstances$, this._readyChanged$.startWith(null))
      .compose(debounce(1))
      .map(([_, components]: [any, any]) => {
        const root  = components['::ROOT::']
        const entries = Object.entries(components).filter(([id]) => id !== '::ROOT::')

        if (entries.length === 0) {
          return xs.of(processSuspensePost(root))
        }

        const ids: string[] = []
        const vdom$ = entries
          .map(([id, val]: [string, any]) => {
            ids.push(id)
            return val.sink$[this.DOMSourceName].startWith(undefined)
          })

        // Track READY state on the component instance (persists across folds)
        for (const [id, val] of entries as [string, any]) {
          if (this._childReadyState[id] !== undefined) continue // already tracking
          const readySink = val.sink$[READY_SINK_NAME]
          if (readySink) {
            const isExplicit = readySink.__explicitReady
            this._childReadyState[id] = isExplicit ? false : true
            readySink.addListener({
              next: (ready: any) => {
                const wasReady = this._childReadyState[id]
                this._childReadyState[id] = !!ready
                // When READY state changes, trigger a re-render
                if (wasReady !== !!ready) {
                  if (this._readyChangedListener) {
                    setTimeout(() => {
                      this._readyChangedListener?.next(null)
                    }, 0)
                  }
                  if (typeof window !== 'undefined' && (window as any).__SYGNAL_DEVTOOLS__?.connected) {
                    (window as any).__SYGNAL_DEVTOOLS__.onReadyChanged(this._componentNumber, this.name, id, !!ready)
                  }
                }
              },
              error: () => {},
              complete: () => {},
            })
          } else {
            this._childReadyState[id] = true
          }
        }

        return xs.combine(...vdom$)
          .filter((vdoms: any) => vdoms.every((v: any) => v !== undefined))
          .map((vdoms: any) => {
            const withIds = vdoms.reduce((acc: Record<string, any>, vdom: any, index: any) => {
              acc[ids[index]] = vdom
              return acc
            }, {} as Record<string, any>)
            const injected = injectComponents(root, withIds, componentNameSet, 'r', undefined, this._childReadyState)
            return processSuspensePost(injected)
          })
      })
      .flatten()
      .filter((val: any) => !!val)
      // [diagnostics hook]
      .map((vdom: any) => { diag.onRender(this, vdom); return vdom })
      .remember()
  }

}







/**
 * factory to create a logging function meant to be used inside of an xstream .compose()
 *
 * @param {String} context name of the component or file to be prepended to any messages
 * @return {Function}
 *
 * returned function accepts either a `String` of `Function`
 * `String` values will be logged to `console` as is
 * `Function` values will be called with the current `stream` value and the result will be logged to `console`
 * all output will be prepended with the `context` (ex. "[CONTEXT] My output")
 * ONLY outputs if the global `DEBUG` variable is set to `true`
 */
 function makeLog(context: string): any {
  return function (this: Component, msg: any, immediate: boolean = false) {
    const out = (value: any) => {
      if (this.debug) {
        const text = `[${context}] ${typeof msg === 'function' ? msg(value) : msg}`
        console.log(text)
        if (typeof window !== 'undefined' && window.__SYGNAL_DEVTOOLS__?.connected) {
          window.__SYGNAL_DEVTOOLS__.onDebugLog(this._componentNumber, text)
        }
      }
    }
    if (immediate) return out(msg)
    return (stream: any) => stream.debug(out)
  }
}



function getComponents(currentElement: any, componentNameSet: Set<string>, path: string = 'r', parentId?: string, found?: Record<string, any>): Record<string, any> {
  if (!currentElement) return found || {}

  if (currentElement.data?.componentsProcessed) return found || {}
  if (path === 'r') currentElement.data.componentsProcessed = true

  // Allocate the result object only at the root call
  if (!found) found = {}

  const sel          = currentElement.sel
  const isCollection = sel && sel.toLowerCase() === 'collection'
  const isSwitchable = sel && sel.toLowerCase() === 'switchable'
  const isComponent  = (sel && componentNameSet.has(sel)) || typeof currentElement.data?.props?.sygnalFactory === 'function' || isObj(currentElement.data?.props?.sygnalOptions)
  const props        = (currentElement.data && currentElement.data.props) || {}
  const children     = currentElement.children || []

  let id = parentId
  if (isComponent) {
    id  = getComponentIdFromElement(currentElement, path, parentId)
    if (isCollection) {
      if (!props.of)   fail('SYG411', undefined, "Collection is missing 'of'", 'Use of={ItemComponent}')
      if (typeof props.of !== 'string' && typeof props.of !== 'function')         fail('SYG411', undefined, `Collection 'of' is a ${typeof props.of}`, 'Use of={ItemComponent}')
      if (typeof props.of !== 'function' && !componentNameSet.has(props.of))   fail('SYG411', undefined, `Collection 'of' component not found: ${props.of}`, 'Use of={ItemComponent}')
      // an invalid 'from' is reported once, with the component name, by instantiateCollection (G-026)
      currentElement.data.isCollection = true
      currentElement.data.props ||= {}
    } else if (isSwitchable) {
      if (!props.of)        fail('SYG415', undefined, "Switchable is missing 'of'", 'Use of={{ name: Component }}')
      if (!isObj(props.of)) fail('SYG415', undefined, `Switchable 'of' is a ${typeof props.of}`, 'Use of={{ name: Component }}')
      const switchableComponents = Object.values(props.of)
      if (!switchableComponents.every(comp => typeof comp === 'function')) fail('SYG415', undefined, "Switchable 'of' has a value that is not a component", 'Use of={{ name: Component }}')
      if (!props.current || (typeof props.current !== 'string' && typeof props.current !== 'function')) fail('SYG416', undefined, `Switchable 'current' is missing or a ${typeof props.current}`, "Set current to a key of 'of'")
      const switchableComponentNames = Object.keys(props.of)
      if (!switchableComponentNames.includes(props.current)) fail('SYG416', undefined, `Switchable 'current' '${props.current}' is not a key of 'of'`, "Set current to a key of 'of'")
      currentElement.data.isSwitchable = true
    }
    if (typeof props.key === 'undefined') (currentElement.data.props ||= {}).key = id
    found[id] = currentElement
    // G-084: a component's children are its own (children$): it instantiates the
    // components among them when it renders them; instantiating them here too made
    // a second, never-rendered instance per ancestor
    return found
  }

  for (let i = 0; i < children.length; i++) {
    getComponents(children[i], componentNameSet, `${path}.${i}`, id, found)
  }

  return found
}

function injectComponents(currentElement: any, components: Record<string, any>, componentNameSet: Set<string>, path: string = 'r', parentId?: string, readyMap?: Record<string, boolean>): any {
  if (!currentElement) return undefined

  const sel          = currentElement.sel || 'NO SELECTOR'
  const isComponent  = componentNameSet.has(sel) || typeof currentElement.data?.props?.sygnalFactory === 'function' || isObj(currentElement.data?.props?.sygnalOptions)
  const isCollection = currentElement?.data?.isCollection
  const children     = currentElement.children || []

  let id = parentId
  if (isComponent) {
    id  = getComponentIdFromElement(currentElement, path, parentId)
    let component = components[id]
    // Mark an injected VNode that is NOT ready (non-mutating) so Suspense can find it.
    // Ready children get no attribute (G-018): moving markup into a child component
    // must not change the DOM.
    if (readyMap && id && readyMap[id] === false && component && typeof component === 'object' && component.sel) {
      component = {
        ...component,
        data: {
          ...(component.data || {}),
          attrs: {
            ...(component.data?.attrs || {}),
            'data-sygnal-ready': 'false'
          }
        }
      }
    }
    if (isCollection) {
      return {
        ...currentElement,
        sel: 'div',
        children: Array.isArray(component) ? component : [component]
      }
    } else {
      return component
    }
  } else if (children.length > 0) {
    const newChildren = children.map((child: any, i: any) => injectComponents(child, components, componentNameSet, `${path}.${i}`, id, readyMap)).flat()
    return { ...currentElement, children: newChildren }
  } else {
    return currentElement
  }
}

function getComponentIdFromElement(el: any, path: string, parentId?: string): string {
  const sel    = el.sel
  const name   = typeof sel === 'string' ? sel : 'functionComponent'
  const props  = el.data?.props || {}
  const id     = (props.id && JSON.stringify(props.id).replaceAll('"', '')) || path
  const parentString = parentId ? `${parentId}|` : ''
  const fullId = `${parentString}${name}::${id}`
  return fullId
}


function hasNotReadyChild(vnode: any): boolean {
  if (!vnode || !vnode.sel) return false
  // Check for data-sygnal-ready="false" on injected sub-components
  if (vnode.data?.attrs?.['data-sygnal-ready'] === 'false') return true
  // Check for lazy-loading placeholder (not yet instantiated as a component)
  if (vnode.data?.attrs?.['data-sygnal-lazy'] === 'loading') return true
  // Stop at inner Suspense boundaries — they handle their own children
  if (vnode.sel === 'suspense') return false
  if (Array.isArray(vnode.children)) {
    for (const child of vnode.children) {
      if (hasNotReadyChild(child)) return true
    }
  }
  return false
}

function processSuspensePost(vnode: any): any {
  if (!vnode || !vnode.sel) return vnode
  if (vnode.sel === 'suspense') {
    const props = vnode.data?.props || {}
    const fallback = props.fallback
    const children = vnode.children || []

    // Render the fallback if a child within this boundary is not ready, else the children
    const pending = fallback && children.some(hasNotReadyChild)
    if (!pending && children.length === 1) return processSuspensePost(children[0])
    return { sel: 'div', data: { attrs: { 'data-sygnal-suspense': pending ? 'pending' : 'resolved' } }, children: pending ? [typeof fallback === 'string' ? { text: fallback } : fallback] : children.map(processSuspensePost), text: undefined, elm: undefined, key: undefined }
  }
  return vnode.children?.length > 0 ? { ...vnode, children: vnode.children.map(processSuspensePost) } : vnode
}

const portalPatch = snabbdomInit(defaultModules);

function applyTransitionHooks(vnode: any, name: string, duration?: number): any {
  const existingInsert = vnode.data?.hook?.insert
  const existingRemove = vnode.data?.hook?.remove

  vnode.data = vnode.data || {}
  vnode.data.hook = vnode.data.hook || {}

  vnode.data.hook.insert = (vn: any) => {
    if (existingInsert) existingInsert(vn)
    const el = vn.elm
    if (!el || !el.classList) return
    el.classList.add(`${name}-enter-from`, `${name}-enter-active`)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.classList.remove(`${name}-enter-from`)
        el.classList.add(`${name}-enter-to`)
        onTransitionEnd(el, duration, () => {
          el.classList.remove(`${name}-enter-active`, `${name}-enter-to`)
        })
      })
    })
  }

  vnode.data.hook.remove = (vn: any, rm: () => void) => {
    if (existingRemove) existingRemove(vn, () => {})
    const el = vn.elm
    if (!el || !el.classList) { rm(); return }
    el.classList.add(`${name}-leave-from`, `${name}-leave-active`)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.classList.remove(`${name}-leave-from`)
        el.classList.add(`${name}-leave-to`)
        onTransitionEnd(el, duration, () => {
          el.classList.remove(`${name}-leave-active`, `${name}-leave-to`)
          rm()
        })
      })
    })
  }

  return vnode
}

// G-146: stamp the view's vnodes with the input counter of the state it shows (the DOM
// modules read it on form fields)
function stampFields(vnode: any, seq: number): any {
  if (vnode && vnode.data) vnode.data.inputSeq = seq
  if (vnode && vnode.children) for (const c of vnode.children) stampFields(c, seq)
  return vnode
}

/**
 * Single-pass VNode preprocessor that handles lazy, portal, transition, and clientonly
 * nodes in one recursive walk instead of four separate passes.
 */
function preprocessVdom(vnode: any, componentInstance: any): any {
  if (!vnode || !vnode.sel) return vnode

  // Handle lazy components
  const view = vnode.data?.props?.sygnalOptions?.view
  if (view && view.__sygnalLazy) {
    if (view.__sygnalLazyLoaded()) {
      const loaded = view.__sygnalLazyLoadedComponent
      if (loaded) {
        const props = vnode.data?.props || {}
        const name = loaded.componentName || loaded.label || loaded.name || 'LazyLoaded'
        const options = optionsOf(loaded, name, ['isolatedState'])
        const cleanProps = { ...props }
        delete cleanProps.sygnalOptions
        return {
          sel: name,
          data: { props: { ...cleanProps, sygnalOptions: options } },
          children: vnode.children || [],
          text: undefined, elm: undefined, key: undefined,
        }
      }
    } else {
      if (!view.__sygnalLazyReRenderScheduled && view.__sygnalLazyPromise && componentInstance) {
        view.__sygnalLazyReRenderScheduled = true
        view.__sygnalLazyPromise.then(() => {
          setTimeout(() => {
            const stateSource = componentInstance.sources?.[componentInstance.stateSourceName]
            if (stateSource && stateSource.stream) {
              const stateCopy = { ...componentInstance.currentState, __sygnalLazyTick: Date.now() }
              stateSource.stream.shamefullySendNext(stateCopy)
            }
          }, 0)
        })
      }
    }
  }

  // Handle portals
  if (vnode.sel === 'portal') {
    const target = vnode.data?.props?.target
    const children = vnode.children || []
    return createPortalPlaceholder(target, children)
  }

  // Handle transitions — recursively preprocess the child before applying hooks
  if (vnode.sel === 'transition') {
    const props = vnode.data?.props || {}
    const name = props.name || 'v'
    const duration = props.duration
    const children = vnode.children || []
    const child = children[0]
    if (!child || !child.sel) return child || vnode
    return applyTransitionHooks(preprocessVdom(child, componentInstance), name, duration)
  }

  // Handle clientonly — unwrap to children on client
  if (vnode.sel === 'clientonly') {
    const children = vnode.children || []
    if (children.length === 0) return { sel: 'div', data: {}, children: [] }
    if (children.length === 1) return preprocessVdom(children[0], componentInstance)
    return {
      sel: 'div',
      data: {},
      children: children.map((c: any) => preprocessVdom(c, componentInstance)),
      text: undefined,
      elm: undefined,
      key: undefined,
    }
  }

  // Recurse into children
  if (vnode.children && vnode.children.length > 0) {
    vnode.children = vnode.children.map((child: any) => preprocessVdom(child, componentInstance))
  }
  return vnode
}


function onTransitionEnd(el: any, duration: number | undefined, cb: () => void): void {
  if (typeof duration === 'number') {
    setTimeout(cb, duration)
  } else {
    const handler = () => {
      el.removeEventListener('transitionend', handler)
      cb()
    }
    el.addEventListener('transitionend', handler)
  }
}


function portalMount(vnode: any, target: string, children: any[]): void {
  const container = document.querySelector(target)
  if (!container) {
    warn('SYG417', 'Portal', `Target '${target}' not found; content not rendered`, 'Render the target first')
    return
  }
  const anchor = document.createElement('div')
  container.appendChild(anchor)
  vnode.data._portalVnode = portalPatch(anchor, {
    sel: 'div', data: {}, children,
    text: undefined, elm: undefined, key: undefined,
  })
  vnode.data._portalContainer = container
}

function createPortalPlaceholder(target: string, children: any[]): any {
  const portalChildren = children || []

  return {
    sel: 'div',
    data: {
      style: { display: 'none' },
      attrs: { 'data-sygnal-portal': target },
      portalChildren,
      hook: {
        insert: (vnode: any) => {
          // Try synchronously first (target outside component tree or
          // plain element in the same patch cycle).
          const container = document.querySelector(target)
          if (container) {
            portalMount(vnode, target, portalChildren)
            return
          }
          // Target may be rendered by a sub-component whose streams
          // haven't settled yet (debounced). Retry a few times to
          // allow sub-component rendering to complete.
          let attempts = 0
          const tryMount = () => {
            if (vnode.data._portalVnode) return // already mounted
            if (document.querySelector(target)) {
              portalMount(vnode, target, portalChildren)
            } else if (++attempts < 10) {
              setTimeout(tryMount, 5)
            } else {
              warn('SYG417', 'Portal', `Target '${target}' not found; content not rendered`, 'Render the target first')
            }
          }
          setTimeout(tryMount, 5)
        },
        postpatch: (oldVnode: any, newVnode: any) => {
          const prevPortalVnode = oldVnode.data?._portalVnode
          const container = oldVnode.data?._portalContainer
          const newChildren = newVnode.data?.portalChildren || []
          if (!prevPortalVnode || !container) {
            // insert was deferred and hasn't fired yet, or target
            // wasn't found. Try mounting now with updated children.
            if (!newVnode.data._portalVnode) {
              portalMount(newVnode, target, newChildren)
            }
            return
          }
          newVnode.data._portalVnode = portalPatch(prevPortalVnode, {
            sel: 'div', data: {}, children: newChildren,
            text: undefined, elm: undefined, key: undefined,
          })
          newVnode.data._portalContainer = container
        },
        destroy: (vnode: any) => {
          const pv = vnode.data?._portalVnode
          if (pv && pv.elm && pv.elm.parentNode) {
            pv.elm.parentNode.removeChild(pv.elm)
          }
        },
      },
    },
    children: [],
    text: undefined,
    elm: undefined,
    key: undefined,
  }
}


function propsIsEqual(obj1: any, obj2: any): boolean {
  return objIsEqual(sanitizeObject(obj1), sanitizeObject(obj2))
}

function sanitizeObject(obj: any): any {
  if (!isObj(obj)) return obj
  // G-102: only the state binding; of/from/filter are ordinary props of a component
  const {state, ...sanitized} = obj
  return sanitized
}

function isObj(obj: any): obj is Record<string, any> {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj)
}

const SORT_FIX = "Use a field name, { field: 'asc'|'desc'|1|-1 }, or a function"

function __baseSort(a: any, b: any, ascending: boolean = true): number {
  return a > b ? (ascending ? 1 : -1) : a < b ? (ascending ? -1 : 1) : 0
}

function __sortFunctionFromObj(item: Record<string, any>): ((a: any, b: any) => number) | undefined {
  const entries = Object.entries(item)
  if (entries.length > 1) {
    logError('SYG418', 'Collection', 'sort object must have one key; ignored', SORT_FIX, item)
    return undefined
  }
  const entry = entries[0]
  const [field, directionRaw] = entry
  if (!['string', 'number'].includes(typeof directionRaw)) {
    logError('SYG418', 'Collection', 'sort direction must be a string or number; ignored', SORT_FIX, item)
    return undefined
  }
  let ascending = true
  if (typeof directionRaw === 'string') {
    if (!['asc', 'desc'].includes(directionRaw.toLowerCase())) {
      logError('SYG418', 'Collection', "sort direction must be 'asc' or 'desc'; ignored", SORT_FIX, item)
      return undefined
    }
    ascending = directionRaw.toLowerCase() !== 'desc'
  }
  if (typeof directionRaw === 'number') {
    if (directionRaw !== 1 && directionRaw !== -1) {
      logError('SYG418', 'Collection', 'sort direction must be 1 or -1; ignored', SORT_FIX, item)
      return undefined
    }
    ascending = directionRaw === 1
  }
  return (a, b) => __baseSort(a[field], b[field], ascending)
}

function sortFunctionFromProp(sortProp: any): ((a: any, b: any) => number) | undefined {
  if (!sortProp) return undefined
  const propType = typeof sortProp
  // if function do nothing
  if (propType === 'function') return sortProp
  if (propType === 'string') {
    // if passed either 'asc' or 'desc' sort on the entire item
    if (sortProp.toLowerCase() === 'asc' || sortProp.toLowerCase() === 'desc') {
      const ascending = sortProp.toLowerCase() !== 'desc'
      return (a, b) => __baseSort(a, b, ascending)
    }
    // assume it's a field/property name, and sort it ascending
    const field = sortProp
    return (a, b) => __baseSort(a[field], b[field], true)
  } else if (Array.isArray(sortProp)) {
    const sorters = sortProp.map(item => {
      if (typeof item === 'function') return item
      if (typeof item === 'string' && !['asc', 'desc'].includes(item.toLowerCase())) return (a: any, b: any) => __baseSort(a[item], b[item], true)
      if (isObj(item)) {
        return __sortFunctionFromObj(item)
      }
    })
    
    return (a, b) => sorters.filter(sorter => typeof sorter === 'function').reduce((comparisonSoFar, currentSorter) => {
      if (comparisonSoFar !== 0) return comparisonSoFar
      return currentSorter(a, b)
    }, 0)
  } else if (isObj(sortProp)) {
    return __sortFunctionFromObj(sortProp)
  } else {
    logError('SYG418', 'Collection', 'Invalid sort prop; ignored', SORT_FIX, sortProp)
    return undefined
  }
}

function extractSlots(children: any[]): { slots: Record<string, any[]>, defaultChildren: any[] } {
  const slots: Record<string, any[]> = {}
  const defaultChildren: any[] = []

  for (const child of children) {
    if (child && child.sel === 'slot') {
      const name = (child.data?.props?.name) || 'default'
      if (!slots[name]) slots[name] = []
      const slotChildren = Array.isArray(child.children) ? child.children : (child.children ? [child.children] : [])
      slots[name].push(...slotChildren)
    } else {
      defaultChildren.push(child)
    }
  }

  if (defaultChildren.length > 0) {
    if (!slots['default']) slots['default'] = []
    slots['default'].push(...defaultChildren)
  }

  return { slots, defaultChildren: slots['default'] || [] }
}
