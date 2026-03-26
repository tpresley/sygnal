import isolate from './cycle/isolate/index';
import collection from './collection';
import switchable from './switchable';
import {StateSource} from './cycle/state/index';
import {init as snabbdomInit} from './cycle/dom/snabbdom';
import defaultModules from './cycle/dom/modules';
import {makeCommandSource} from './extra/command';
import type {Command} from './extra/command';

import xs, {Stream, resolveInteropDefault} from './extra/xstreamCompat';
import * as delayModule from 'xstream/extra/delay.js';
import * as concatModule from 'xstream/extra/concat.js';
import * as debounceModule from 'xstream/extra/debounce.js';
import * as dropRepeatsModule from 'xstream/extra/dropRepeats.js';

const delay = resolveInteropDefault(delayModule);
const concat = resolveInteropDefault(concatModule);
const debounce = resolveInteropDefault(debounceModule);
const dropRepeats = resolveInteropDefault(dropRepeatsModule);

declare var process: { env: Record<string, any> };

const ENVIRONMENT: any =
  (typeof window != 'undefined' && window) || (typeof process !== 'undefined' && process.env) || {};

const BOOTSTRAP_ACTION = 'BOOTSTRAP';
const INITIALIZE_ACTION = 'INITIALIZE';
const HYDRATE_ACTION = 'HYDRATE';
const DISPOSE_ACTION = 'DISPOSE';
const PARENT_SINK_NAME = 'PARENT';
const CHILD_SOURCE_NAME = 'CHILD';
const READY_SINK_NAME = 'READY';
const EFFECT_SINK_NAME = 'EFFECT';

let COMPONENT_COUNT = 0;

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

/**
 * Check if a value is the ABORT sentinel.
 * Uses Symbol.for() identity first, then falls back to description check
 * in case bundlers (e.g. Vite) create duplicate module instances with
 * separate Symbol.for() registries.
 */
function isAbort(value: any): boolean {
  if (value === ABORT) return true
  return typeof value === 'symbol' && value.description === 'sygnal.ABORT'
}


function normalizeCalculatedEntry(field: string, entry: any): {fn: (...args: any[]) => any; deps: string[] | null} {
  if (typeof entry === 'function') {
    return { fn: entry, deps: null }
  }
  if (Array.isArray(entry) && entry.length === 2
      && Array.isArray(entry[0]) && typeof entry[1] === 'function') {
    return { fn: entry[1], deps: entry[0] }
  }
  throw new Error(
    `Invalid calculated field '${field}': expected a function or [depsArray, function]`
  )
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
  requestSourceName?: string;
  isolateOpts?: string | boolean | Record<string, any>;
  isolatedState?: boolean;
  onError?: (error: Error, info: { componentName: string }) => any;
  debug?: boolean;
}

export default function component(opts: ComponentOptions): any {
  const { name, sources, isolateOpts, stateSourceName='STATE' } = opts

  if (sources && !isObj(sources)) {
    throw new Error(`[${name}] Sources must be a Cycle.js sources object`)
  }

  let fixedIsolateOpts
  if (typeof isolateOpts == 'string') {
    fixedIsolateOpts = { [stateSourceName]: isolateOpts }
  } else {
    if (isolateOpts === true) {
      fixedIsolateOpts = {}
    } else {
      fixedIsolateOpts = isolateOpts
    }
  }

  const currySources = typeof sources === 'undefined'
  let returnFunction

  if (isObj(fixedIsolateOpts)) {
    const wrapped = (sources: any) => {
      const fixedOpts = { ...opts, sources }
      const instance = new Component(fixedOpts)
      instance.sinks.__dispose = () => instance.dispose()
      return instance.sinks
    }
    returnFunction = currySources ? isolate(wrapped, fixedIsolateOpts) : isolate(wrapped, fixedIsolateOpts)(sources)
  } else {
    if (currySources) {
      returnFunction = (sources: any) => {
        const instance = new Component({ ...opts, sources })
        instance.sinks.__dispose = () => instance.dispose()
        return instance.sinks
      }
    } else {
      const instance = new Component(opts)
      instance.sinks.__dispose = () => instance.dispose()
      returnFunction = instance.sinks
    }
  }

  returnFunction.componentName = name
  returnFunction.isSygnalComponent = true

  return returnFunction
}





class Component {
  _componentNumber: number;
  name: string;
  sources: any;
  intent: any;
  model: any;
  hmrActions: any;
  context: any;
  response: any;
  view: any;
  peers: Record<string, any>;
  components: Record<string, any>;
  initialState: any;
  calculated: any;
  storeCalculatedInState: boolean;
  DOMSourceName: string;
  stateSourceName: string;
  requestSourceName: string;
  sourceNames: string[];
  _debug: boolean;
  onError: ((error: Error, info: { componentName: string }) => any) | undefined;
  isolatedState: boolean;
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
  _disposeListener: any;
  _dispose$: any;
  _activeSubComponents: Map<string, any>;
  _childReadyState: Record<string, boolean>;
  _readyChanged$: any;
  _readyChangedListener: any;

  constructor({name = 'NO NAME', sources, intent, model, hmrActions, context, response, view, peers = {}, components = {}, initialState, calculated, storeCalculatedInState = true, DOMSourceName = 'DOM', stateSourceName = 'STATE', requestSourceName = 'HTTP', isolatedState = false, onError, debug = false}: ComponentOptions) {
    if (!sources || !isObj(sources)) throw new Error(`[${name}] Missing or invalid sources`)

    this._componentNumber = COMPONENT_COUNT++

    this.name       = name
    this.sources    = sources
    this.intent     = intent
    this.model      = model
    this.hmrActions = hmrActions
    this.context    = context
    this.response   = response
    this.view       = view
    this.peers      = peers
    this.components = components
    this.initialState      = initialState
    this.calculated        = calculated
    this.storeCalculatedInState = storeCalculatedInState
    this.DOMSourceName     = DOMSourceName
    this.stateSourceName   = stateSourceName
    this.requestSourceName = requestSourceName
    this.sourceNames       = Object.keys(sources)
    this.onError           = onError
    this.isolatedState     = isolatedState
    this._debug            = debug

    // Warn if calculated fields shadow base state keys
    if (this.calculated && this.initialState
        && isObj(this.calculated) && isObj(this.initialState)) {
      for (const key of Object.keys(this.calculated)) {
        if (key in this.initialState) {
          console.warn(
            `[${name}] Calculated field '${key}' shadows a key in initialState. ` +
            `The initialState value will be overwritten on every state update.`
          )
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
              console.warn(
                `[${name}] Calculated field '${field}' declares dependency '${dep}' ` +
                `which is not in initialState or calculated fields`
              )
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
        throw new Error(`Circular calculated dependency: ${cycle.join(' \u2192 ')}`)
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

    if (state$) {
      this.currentState = initialState || {}
      this.sources[stateSourceName] = new StateSource(state$.map((val: any) => {
        this.currentState = val
        if (typeof window !== 'undefined' && window.__SYGNAL_DEVTOOLS__?.connected) {
          window.__SYGNAL_DEVTOOLS__.onStateChanged(this._componentNumber, this.name, val)
        }
        return val
      }), stateSourceName)
    }

    const props$ = sources.props$
    if (props$) {
      this.sources.props$ = props$.map((val: any) => {
        const { sygnalFactory, sygnalOptions, ...sanitizedProps }: any = val
        this.currentProps = sanitizedProps
        return val
      })
    }

    const children$ = sources.children$
    if (children$) {
      this.sources.children$ = children$.map((val: any) => {
        if (Array.isArray(val)) {
          const { slots, defaultChildren } = extractSlots(val)
          this.currentSlots = slots
          this.currentChildren = defaultChildren
        } else {
          this.currentSlots = {}
          this.currentChildren = val
        }
        return val
      })
    }

    if (this.sources[DOMSourceName]) {
      this.sources[DOMSourceName] = wrapDOMSource(this.sources[DOMSourceName])
    }

    // Ensure that the root component has an intent and model
    // This is necessary to ensure that the component tree's state sink is subscribed to
    if (!this.isSubComponent && typeof this.intent === 'undefined' && typeof this.model === 'undefined') {
      this.initialState = initialState || true
      this.intent = (_: any) => ({__NOOP_ACTION__:xs.never()})
      this.model = {
        __NOOP_ACTION__: (state: any) => state
      }
    }

    this._subscriptions = []
    this._activeSubComponents = new Map()
    this._childReadyState = {}
    this._readyChangedListener = null
    this._readyChanged$ = xs.create({
      start: (listener: any) => { this._readyChangedListener = listener },
      stop: () => {},
    })
    this._disposeListener = null
    this._dispose$ = xs.create({
      start: (listener: any) => { this._disposeListener = listener },
      stop: () => {},
    })
    this.sources.dispose$ = this._dispose$

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
    // Tear down streams on next microtask to allow DISPOSE/cleanup actions to process
    setTimeout(() => {
      // Complete the action$ stream to stop the entire component cycle
      if (this.action$ && typeof this.action$.shamefullySendComplete === 'function') {
        try { this.action$.shamefullySendComplete() } catch (_) {}
      }
      // Complete the vdom$ stream to stop rendering
      if (this.vdom$ && typeof this.vdom$.shamefullySendComplete === 'function') {
        try { this.vdom$.shamefullySendComplete() } catch (_) {}
      }
      // Unsubscribe tracked internal subscriptions
      for (const sub of this._subscriptions) {
        if (sub && typeof sub.unsubscribe === 'function') {
          try { sub.unsubscribe() } catch (_) {}
        }
      }
      this._subscriptions = []
      // Dispose any active sub-components
      this._activeSubComponents.forEach((entry) => {
        if (entry?.sink$?.__dispose) entry.sink$.__dispose()
      })
      this._activeSubComponents.clear()
    }, 0)
  }

  get debug(): boolean {
    return this._debug || (ENVIRONMENT.SYGNAL_DEBUG === 'true' || ENVIRONMENT.SYGNAL_DEBUG === true)
  }

  initIntent$(): void {
    if (!this.intent) {
      return
    }
    if (typeof this.intent != 'function') {
      throw new Error(`[${this.name}] Intent must be a function`)
    }

    this.intent$ = this.intent(this.sources)

    if (!(this.intent$ instanceof Stream) && (!isObj(this.intent$))) {
      throw new Error(`[${this.name}] Intent must return either an action$ stream or map of event streams`)
    }
  }

  initHmrActions(): void {
    if (typeof this.hmrActions === 'undefined') {
      this.hmrAction$ = xs.of().filter((_: any) => false)
      return
    }
    if (typeof this.hmrActions === 'string') {
      this.hmrActions = [this.hmrActions]
    }
    if (!Array.isArray(this.hmrActions)) {
      throw new Error(`[${this.name}] hmrActions must be the name of an action or an array of names of actions to run when a component is hot-reloaded`)
    }
    if (this.hmrActions.some(action => typeof action !== 'string')) {
      throw new Error(`[${this.name}] hmrActions must be the name of an action or an array of names of actions to run when a component is hot-reloaded`)
    }
    this.hmrAction$ = xs.fromArray(this.hmrActions.map(action => ({ type: action })))
  }

  initAction$(): void {
    const requestSource  = (this.sources && this.sources[this.requestSourceName]) || null

    if (!this.intent$) {
      this.action$ = xs.never()
      return
    }

    let runner
    if (this.intent$ instanceof Stream) {
      runner = this.intent$
    } else {
      // Validate that no intent action names contain '|' (reserved for model shorthand)
      for (const key of Object.keys(this.intent$)) {
        if (key.includes('|')) {
          throw new Error(`[${this.name}] Intent action name '${key}' contains '|', which is reserved for the model shorthand syntax (e.g., 'ACTION | DRIVER'). Rename this action.`)
        }
      }
      const mapped = Object.entries(this.intent$)
                           .map(([type, data$]: [string, any]) => data$.map((data: any) => ({type, data})))
      runner = xs.merge(xs.never(), ...mapped)
    }

    const action$    = ((runner instanceof Stream) ? runner : (runner.apply && runner(this.sources) || xs.never()))
    const bootstrap$ = xs.of({ type: BOOTSTRAP_ACTION }).compose(delay(10))
    const _hmrUpdating = typeof window !== 'undefined' && window.__SYGNAL_HMR_UPDATING === true
    const hmrAction$ = _hmrUpdating ? this.hmrAction$ : xs.of().filter((_: any) => false)
    const wrapped$   = (this.model[BOOTSTRAP_ACTION] && !_hmrUpdating) ? concat(bootstrap$, action$) : concat(xs.of().compose(delay(1)).filter((_: any) => false), hmrAction$, action$)


    let initialApiData
    if (!_hmrUpdating && requestSource && typeof requestSource.select == 'function') {
      initialApiData = requestSource.select('initial')
        .flatten()
    } else {
      initialApiData = xs.never()
    }

    const hydrate$ = initialApiData.map((data: any) => ({ type: HYDRATE_ACTION, data }))

    this.action$   = xs.merge(wrapped$, hydrate$)
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
            console.warn(`${INITIALIZE_ACTION} can only be used with the ${this.stateSourceName} source... disregarding ${name}`)
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
      console.error(`[${this.name}] Context must be an object mapping names to values of functions: ignoring provided ${ typeof this.context }`)
    }
    this.context$ = xs.combine(state$, parentContext$)
      .map(([_, parent]: [any, any]) => {
        const _parent = isObj(parent) ? parent : {}
        const context = isObj(this.context) ? this.context : {}
        const state = this.currentState
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
            console.error(`[${this.name}] Invalid context entry '${name}': must be the name of a state property or a function returning a value to use`)
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
    this._subscriptions.push(this.context$.subscribe({ next: (_: any) => _, error: (err: any) => console.error(`[${this.name}] Error in context stream:`, err) }))
  }

  initModel$(): void {
    if (typeof this.model == 'undefined') {
      this.model$ = this.sourceNames.reduce((a: Record<string, any>, s) => {
        a[s] = xs.never()
        return a
      }, {} as Record<string, any>)
      return
    }

    const hmrState = ENVIRONMENT?.__SYGNAL_HMR_STATE
    const effectiveInitialState = (typeof hmrState !== 'undefined') ? hmrState : this.initialState
    const initial  = { type: INITIALIZE_ACTION, data: effectiveInitialState }
    if (this.isSubComponent && this.initialState && !this.isolatedState) {
      console.warn(`[${this.name}] Initial state provided to sub-component. This will overwrite any state provided by the parent component.`)
    }
    const hasInitialState = (typeof effectiveInitialState !== 'undefined')
    const shouldInjectInitialState = hasInitialState && (ENVIRONMENT?.__SYGNAL_HMR_UPDATING !== true || typeof hmrState !== 'undefined')
    const shimmed$ = shouldInjectInitialState ? concat(xs.of(initial), this.action$).compose(delay(0)) : this.action$
    const onState  = () => this.makeOnAction(shimmed$, true, this.action$)
    const onNormal = () => this.makeOnAction(this.action$, false, this.action$)


    const modelEntries = Object.entries(this.model)

    const reducers: Record<string, any[]> = {}
    const seenActionSinks = new Set<string>()

    modelEntries.forEach((entry) => {
      let [action, sinks]: [string, any] = entry

      // ACTION | DRIVER shorthand: 'MY_ACTION | EVENTS': (state) => ({ type: 'foo', data: 'bar' })
      if (action.includes('|')) {
        const parts = action.split('|').map((s: string) => s.trim())
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          throw new Error(`[${this.name}] Invalid shorthand model entry '${action}'. Expected 'ACTION | DRIVER' format.`)
        }
        action = parts[0]
        sinks = { [parts[1]]: sinks }
      }

      if (typeof sinks === 'function') {
        sinks = { [this.stateSourceName]: sinks }
      }

      if (!isObj(sinks)) {
        throw new Error(`[${this.name}] Entry for each action must be an object: ${action}`)
      }

      const sinkEntries = Object.entries(sinks)

      sinkEntries.forEach((entry) => {
        const [sink, reducer] = entry

        const actionSinkKey = `${action}::${sink}`
        if (seenActionSinks.has(actionSinkKey)) {
          console.warn(`[${this.name}] Duplicate model entry for action '${action}' on sink '${sink}'. Only the last definition will take effect.`)
        }
        seenActionSinks.add(actionSinkKey)

        // EFFECT sink: run the reducer for side effects only, no state change or sink output
        if (sink === EFFECT_SINK_NAME) {
          const effect$ = this.makeEffectHandler(this.action$, action, reducer)
          if (Array.isArray(reducers[sink])) {
            reducers[sink].push(effect$)
          } else {
            reducers[sink] = [effect$]
          }
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

        if (Array.isArray(reducers[sink])) {
          reducers[sink].push(wrapped$)
        } else {
          reducers[sink] = [wrapped$]
        }
      })
    })

    const model$ = Object.entries(reducers).reduce((acc: Record<string, any>, entry: [string, any]) => {
      const [sink, streams] = entry
      acc[sink] = xs.merge(xs.never(), ...streams)
      return acc
    }, {} as Record<string, any>)

    this.model$ = model$
  }

  initPeers$(): void {
    const initial: Record<string, any> = this.sourceNames.reduce((acc: Record<string, any>, name) => {
      if (name == this.DOMSourceName) {
        acc[name] = {}
      } else {
        acc[name] = []
      }
      return acc
    }, {} as Record<string, any>)

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
    this._subscriptions.push(subComponentSink$.subscribe({ next: (_: any) => _, error: (err: any) => console.error(`[${this.name}] Error in sub-component sink stream:`, err) }))
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
          return this.view({ ...sanitizedProps, state, children, slots: slots || {}, context, peers }, state, context, peers)
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          console.error(`[${this.name}] Error in view:`, error)
          if (typeof this.onError === 'function') {
            try {
              return this.onError(error, { componentName: this.name })
            } catch (fallbackErr) {
              console.error(`[${this.name}] Error in onError handler:`, fallbackErr)
            }
          }
          return { sel: 'div', data: { attrs: { 'data-sygnal-error': this.name } }, children: [] }
        }
      })
      .compose(this.log('View rendered'))
      .map((vDom: any) => vDom || { sel: 'div', data: {}, children: [] })
      .map((vdom: any) => processLazy(vdom, this))
      .map(processPortals)
      .map(processTransitions)
      .map(processClientOnly)
      .compose(this.instantiateSubComponents.bind(this))
      .filter((val: any) => val !== undefined)
      .compose(this.renderVdom.bind(this))

  }

  initSinks(): void {
    this.sinks = this.sourceNames.reduce((acc: Record<string, any>, name) => {
      if (name == this.DOMSourceName) return acc
      const subComponentSink$ = (this.subComponentSink$ && name !== PARENT_SINK_NAME) ? this.subComponentSink$.map((sinks: any) => sinks[name]).filter((sink: any) => !!sink).flatten() : xs.never()
      if (name === this.stateSourceName) {
        acc[name] = xs.merge((this.model$[name] || xs.never()), subComponentSink$, this.sources[this.stateSourceName].stream.filter((_: any) => false), ...(this.peers$[name] || []))
      } else {
        acc[name] = xs.merge((this.model$[name] || xs.never()), subComponentSink$, ...(this.peers$[name] || []))
      }
      return acc
    }, {} as Record<string, any>)

    this.sinks[this.DOMSourceName] = this.vdom$
    this.sinks[PARENT_SINK_NAME] = this.model$[PARENT_SINK_NAME] || xs.never()

    // EFFECT sink: subscribe to trigger side effects but don't expose as a driver sink
    if (this.model$[EFFECT_SINK_NAME]) {
      const effectSub = this.model$[EFFECT_SINK_NAME].subscribe({
        next: () => {},
        error: (err: any) => console.error(`[${this.name}] Uncaught error in EFFECT stream:`, err),
      })
      this._subscriptions.push(effectSub)
      delete this.sinks[EFFECT_SINK_NAME]
    }
    // READY sink: if the component explicitly defined READY model entries, use them;
    // otherwise auto-emit true. Check the raw model object, not model$ (which always has keys for all sources).
    const hasExplicitReady = this.model && isObj(this.model) && Object.values(this.model).some(
      (sinks: any) => {
        if (isObj(sinks) && READY_SINK_NAME in sinks) return true
        return false
      }
    )
    if (hasExplicitReady) {
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
            if (typeof delay !== 'number') throw new Error(`[${this.name}] Invalid delay value provided to next() function in model action '${name}'. Must be a number in ms.`)
            // put the "next" action request at the end of the event loop so the "current" action completes first
            setTimeout(() => {
              // push the "next" action request into the action$ stream
              rootAction$.shamefullySendNext({ type, data })
            }, delay)
            this.log(`<${name}> Triggered a next() action: <${type}> ${delay}ms delay`, true)
          }

          const props = { ...this.currentProps, children: this.currentChildren, slots: this.currentSlots || {}, context: this.currentContext }

          let data = action.data
          if (isStateSink) {
            return (state: any) => {
              const _state = this.isSubComponent ? this.currentState : state
              try {
                const enhancedState = this.addCalculated(_state)
                props.state = enhancedState
                const newState = reducer(enhancedState, data, next, props)
                if (isAbort(newState)) return _state
                return this.cleanupCalculated(newState)
              } catch (err) {
                console.error(`[${this.name}] Error in model reducer '${name}':`, err)
                return _state
              }
            }
          } else {
            try {
              const enhancedState = this.addCalculated(this.currentState)
              props.state = enhancedState
              const reduced = reducer(enhancedState, data, next, props)
              const type = typeof reduced
              if (isObj(reduced) || ['string', 'number', 'boolean', 'function'].includes(type)) return reduced
              if (type === 'undefined') {
                console.warn(`[${this.name}] 'undefined' value sent to ${name}`)
                return reduced
              }
              throw new Error(`[${this.name}] Invalid reducer type for action '${name}': ${type}`)
            } catch (err) {
              console.error(`[${this.name}] Error in model reducer '${name}':`, err)
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

  makeEffectHandler(action$: any, name: string, reducer: any): any {
    const filtered$ = action$.filter(({type}: any) => type == name)

    return filtered$.map((action: any) => {
      if (typeof reducer === 'function') {
        const next = (type: any, data: any, delay=10) => {
          if (typeof delay !== 'number') throw new Error(`[${this.name}] Invalid delay value provided to next() function in EFFECT handler '${name}'. Must be a number in ms.`)
          setTimeout(() => {
            action$.shamefullySendNext({ type, data })
          }, delay)
          this.log(`<${name}> EFFECT triggered a next() action: <${type}> ${delay}ms delay`, true)
        }

        try {
          const enhancedState = this.addCalculated(this.currentState)
          const props = { ...this.currentProps, children: this.currentChildren, slots: this.currentSlots || {}, context: this.currentContext, state: enhancedState }
          const result = reducer(enhancedState, action.data, next, props)
          if (result !== undefined) {
            console.warn(`[${this.name}] EFFECT handler '${name}' returned a value. EFFECT handlers are for side effects only — return values are ignored.`)
          }
        } catch (err) {
          console.error(`[${this.name}] Error in EFFECT handler '${name}':`, err)
        }
      }
      return null
    }).filter((_: any) => false)  // EFFECT never emits — stream is consumed but produces no output
  }

  createMemoizedAddCalculated(): (state: any) => any {
    let lastState: any
    let lastResult: any

    return function(this: Component, state: any) {
      if (!this.calculated || !isObj(state) || Array.isArray(state)) return state
      if (state === lastState) {
        return lastResult
      }
      if (!isObj(this.calculated)) throw new Error(`[${this.name}] 'calculated' parameter must be an object mapping calculated state field names to functions`)

      const calculated = this.getCalculatedValues(state)
      if (!calculated) {
        lastState = state
        lastResult = state
        return state
      }

      const newState = { ...state, ...calculated }

      lastState = state
      lastResult = newState

      return newState
    }
  }

  getCalculatedValues(state: any): Record<string, any> | undefined {
    if (!this._calculatedOrder || this._calculatedOrder.length === 0) {
      return
    }

    const mergedState: Record<string, any> = { ...state }
    const computedSoFar: Record<string, any> = {}

    for (const [field, { fn, deps }] of this._calculatedOrder) {
      if (deps !== null && this._calculatedFieldCache) {
        const cache = this._calculatedFieldCache[field]
        const currentDepValues = deps.map(d => mergedState[d])

        if (cache.lastDepValues !== undefined) {
          let unchanged = true
          for (let i = 0; i < currentDepValues.length; i++) {
            if (currentDepValues[i] !== cache.lastDepValues[i]) {
              unchanged = false
              break
            }
          }
          if (unchanged) {
            computedSoFar[field] = cache.lastResult
            mergedState[field] = cache.lastResult
            continue
          }
        }

        try {
          const result = fn(mergedState)
          cache.lastDepValues = currentDepValues
          cache.lastResult = result
          computedSoFar[field] = result
          mergedState[field] = result
        } catch (e: unknown) {
          console.warn(`Calculated field '${field}' threw an error during calculation: ${e instanceof Error ? e.message : e}`)
        }
      } else {
        // No deps declared — always recompute
        try {
          const result = fn(mergedState)
          computedSoFar[field] = result
          mergedState[field] = result
        } catch (e: unknown) {
          console.warn(`Calculated field '${field}' threw an error during calculation: ${e instanceof Error ? e.message : e}`)
        }
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

    if (this.sources.children$) {
      const processedChildren$ = this.sources.children$.map((val: any) => {
        if (!Array.isArray(val)) return { children: val, slots: {} }
        const { slots, defaultChildren } = extractSlots(val)
        return { children: defaultChildren, slots }
      })
      renderParams.children = processedChildren$.map((p: any) => p.children).compose(dropRepeats(objIsEqual))
      renderParams.slots = processedChildren$.map((p: any) => p.slots).compose(dropRepeats(objIsEqual))
    }

    if (this.context$) {
      renderParams.context = this.context$.compose(dropRepeats(objIsEqual))
    }

    const names: string[] = []
    const streams: any[] = []

    Object.entries(renderParams).forEach(([name, stream]: [string, any]) => {
      names.push(name)
      streams.push(stream)
    })

    const combined = xs.combine(...streams)
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

    return combined
  }

  instantiateSubComponents(vDom$: any): any {
    return vDom$.fold((previousComponents: any, vDom: any) => {
      const componentNames  = Object.keys(this.components)
      const foundComponents = getComponents(vDom, componentNames)
      const entries         = Object.entries(foundComponents)

      const rootEntry: Record<string, any> = { '::ROOT::': vDom }

      if (entries.length === 0) {
        // Dispose any previously active sub-components
        this._activeSubComponents.forEach((entry) => {
          if (entry?.sink$?.__dispose) entry.sink$.__dispose()
        })
        this._activeSubComponents.clear()
        return rootEntry
      }

      const sinkArrsByType: Record<string, any[]> = {}
      const childSources: any[] = []
      let newInstanceCount = 0

      const newComponents =  entries.reduce((acc, [id, el]) => {
        const data     = el.data
        const props    = data.props  || {}
        const children = el.children || []

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

        let instantiator

        if (isCollection) {
          instantiator = this.instantiateCollection.bind(this)
        } else if (isSwitchable) {
          instantiator = this.instantiateSwitchable.bind(this)
        } else {
          instantiator = this.instantiateCustomComponent.bind(this)
        }

        newInstanceCount++

        let sink$
        try {
          sink$ = instantiator(el, props$, children$)
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          console.error(`[${this.name}] Error instantiating sub-component:`, error)
          let fallbackVNode = { sel: 'div', data: { attrs: { 'data-sygnal-error': this.name } }, children: [] }
          if (typeof this.onError === 'function') {
            try {
              fallbackVNode = this.onError(error, { componentName: this.name }) || fallbackVNode
            } catch (fallbackErr) {
              console.error(`[${this.name}] Error in onError handler:`, fallbackErr)
            }
          }
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
          if (entry?.sink$?.__dispose) entry.sink$.__dispose()
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
    const remembered$   = domSink$.remember()

    const coordinated = this.sources[this.stateSourceName].stream
      .compose(dropRepeats(objIsEqual))
      .map((state: any) => remembered$)
      .flatten()
      .debug((_: any) => this.triggerSubComponentsRendered())
      .remember()

    return coordinated
  }

  instantiateCollection(el: any, props$: any, children$: any): any {
    const data      = el.data
    const props     = data.props || {}
    let filter      = typeof props.filter === 'function' ? props.filter : undefined
    let sort        = sortFunctionFromProp(props.sort)

    const arrayOperators = {
      filter,
      sort
    }
    
    const state$ = xs.combine(this.sources[this.stateSourceName].stream.startWith(this.currentState), props$.startWith(props))
      // this debounce is important. it forces state and prop updates to happen at the same time
      // without this, changes to sort or filter won't happen properly
      .compose(debounce(1))
      .map(([state, props]: [any, any]) => {
        if (props.filter !== arrayOperators.filter) {
          arrayOperators.filter = typeof props.filter === 'function' ? props.filter : undefined
        }
        if (props.sort !== arrayOperators.sort) {
          arrayOperators.sort = sortFunctionFromProp(props.sort)
        }
        
        return isObj(state) ? this.addCalculated(state) : state
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
        const name = collectionOf.componentName || collectionOf.label || collectionOf.name || 'FUNCTION_COMPONENT'
        const view = collectionOf
        const { model, intent, hmrActions, context, peers, components, initialState, calculated, storeCalculatedInState, DOMSourceName, stateSourceName, onError, debug } = collectionOf
        const options = { name, view, model, intent, hmrActions, context, peers, components, initialState, calculated, storeCalculatedInState, DOMSourceName, stateSourceName, onError, debug }
        factory = component(options)
      }
    } else if (this.components[collectionOf]) {
      factory = this.components[collectionOf]
    } else {
      throw new Error(`[${this.name}] Invalid 'of' property in collection: ${collectionOf}`)
    }

    const fieldLense = {
      get: (state: any) => {
        if (!Array.isArray(state[stateField])) return []
        const items = state[stateField]
        const filtered = typeof arrayOperators.filter === 'function' ? items.filter(arrayOperators.filter) : items
        const sorted = typeof arrayOperators.sort === 'function' ? filtered.sort(arrayOperators.sort) : filtered
        const mapped = sorted.map((item: any, index: any) => {
          return (isObj(item)) ? { ...item, [idField]: item[idField] || index } : { value: item, [idField]: index }
        })

        return mapped
      },
      set: (oldState: any, newState: any) => {
        if (this.calculated && stateField in this.calculated) {
          console.warn(`Collection sub-component of ${this.name} attempted to update state on a calculated field '${stateField}': Update ignored`)
          return oldState
        }
        const updated = []
        for (const oldItem of oldState[stateField].map((item: any, index: any) => (isObj(item) ? { ...item, [idField]: item[idField] || index } : { __primitive: true, value: item, [idField]: index }))) {
          if (typeof arrayOperators.filter === 'function' && !arrayOperators.filter(oldItem)) {
            updated.push(oldItem.__primitive ? oldItem.value : oldItem)
          } else {
            const newItem = newState.find((item: any) => item[idField] === oldItem[idField])
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
      if (isObj(this.currentState)) {
        if(!(this.currentState && stateField in this.currentState) && !(this.calculated && stateField in this.calculated)) {
          console.error(`Collection component in ${this.name} is attempting to use non-existent state property '${stateField}': To fix this error, specify a valid array property on the state.  Attempting to use parent component state.`)
          lense = undefined
        } else if (!Array.isArray(this.currentState[stateField])) {
          console.warn(`[${this.name}] State property '${stateField}' in collection component is not an array: No components will be instantiated in the collection.`)
          lense = fieldLense
        } else {
          lense = fieldLense
        }
      } else {
        if (!Array.isArray(this.currentState[stateField])) {
          console.warn(`[${this.name}] State property '${stateField}' in collection component is not an array: No components will be instantiated in the collection.`)
          lense = fieldLense
        } else {
          lense = fieldLense
        }
      }
    } else if (isObj(stateField)) {
      if (typeof stateField.get !== 'function') {
        console.error(`Collection component in ${this.name} has an invalid 'from' field: Expecting 'undefined', a string indicating an array property in the state, or an object with 'get' and 'set' functions for retrieving and setting child state from the current state. Attempting to use parent component state.`)
        lense = undefined
      } else {
        lense = {
          get: (state: any) => {
            const newState = stateField.get(state)
            if (!Array.isArray(newState)) {
              console.warn(`State getter function in collection component of ${this.name} did not return an array: No components will be instantiated in the collection. Returned value:`, newState)
              return []
            }
            return newState
          },
          set: stateField.set
        }
      }
    } else {
      console.error(`Collection component in ${this.name} has an invalid 'from' field: Expecting 'undefined', a string indicating an array property in the state, or an object with 'get' and 'set' functions for retrieving and setting child state from the current state. Attempting to use parent component state.`)
      lense = undefined
    }

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

    const sources = { ...this.sources, [this.stateSourceName]: stateSource, props$: itemProps$, children$, __parentContext$: this.context$, PARENT: null, __parentComponentNumber: this._componentNumber }
    const sink$   = collection(factory, lense as any, { container: null as any })(sources)
    if (!isObj(sink$)) {
      throw new Error(`[${this.name}] Invalid sinks returned from component factory of collection element`)
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
    let lense

    const fieldLense = {
      get: (state: any) => state[stateField],
      set: (oldState: any, newState: any) => {
        if (this.calculated && stateField in this.calculated) {
          console.warn(`Switchable sub-component of ${this.name} attempted to update state on a calculated field '${stateField}': Update ignored`)
          return oldState
        }
        if (!isObj(newState) || Array.isArray(newState)) return { ...oldState, [stateField]: newState }
        return { ...oldState, [stateField]: newState }
      }
    }

    const baseLense = {
      get: (state: any) => state,
      set: (oldState: any, newState: any) => newState
    }

    if (typeof stateField === 'undefined') {
      lense = baseLense
    } else if (typeof stateField === 'string') {
      lense = fieldLense
    } else if (isObj(stateField)) {
      if (typeof stateField.get !== 'function') {
        console.error(`Switchable component in ${this.name} has an invalid 'state' field: Expecting 'undefined', a string indicating an array property in the state, or an object with 'get' and 'set' functions for retrieving and setting sub-component state from the current state. Attempting to use parent component state.`)
        lense = baseLense
      } else {
        lense = { get: stateField.get, set: stateField.set }
      }
    } else {
      console.error(`Invalid state provided to switchable sub-component of ${this.name}: Expecting string, object, or undefined, but found ${typeof stateField}. Attempting to use parent component state.`)
      lense = baseLense
    }

    const switchableComponents = props.of
    const keys = Object.keys(switchableComponents)
    keys.forEach(key => {
      const current = switchableComponents[key]
      if (!current.isSygnalComponent) {
        const name = current.componentName || current.label || current.name || 'FUNCTION_COMPONENT'
        const view = current
        const { model, intent, hmrActions, context, peers, components, initialState, calculated, storeCalculatedInState, DOMSourceName, stateSourceName, onError, debug } = current
        const options = { name, view, model, intent, hmrActions, context, peers, components, initialState, calculated, storeCalculatedInState, DOMSourceName, stateSourceName, onError, debug }
        switchableComponents[key] = component(options)
      }
    })
    const sources = { ...this.sources, [this.stateSourceName]: stateSource, props$, children$, __parentContext$: this.context$, __parentComponentNumber: this._componentNumber }

    const sink$ = isolate(switchable(switchableComponents, props$.map((props: any) => props.current), ''), { [this.stateSourceName]: lense })(sources)

    if (!isObj(sink$)) {
      throw new Error(`[${this.name}] Invalid sinks returned from component factory of switchable element`)
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

    const stateSource = new StateSource(state$, this.stateSourceName)
    const stateField  = props.state

    if (typeof props.sygnalFactory !== 'function' && isObj(props.sygnalOptions)) {
      props.sygnalFactory = component(props.sygnalOptions)
    }

    const factory   = componentName === 'sygnal-factory' ? props.sygnalFactory : (this.components[componentName] || props.sygnalFactory)
    if (!factory) {
      if (componentName === 'sygnal-factory') throw new Error(`Component not found on element with Capitalized selector and nameless function: JSX transpilation replaces selectors starting with upper case letters with functions in-scope with the same name, Sygnal cannot see the name of the resulting component.`)
      throw new Error(`Component not found: ${componentName}`)
    }

    // Guard against sub-components accidentally overwriting parent state with .initialState
    const subInitialState = props.sygnalOptions?.initialState
    const subIsolatedState = props.sygnalOptions?.isolatedState
    if (subInitialState && !subIsolatedState) {
      const subName = props.sygnalOptions?.name || componentName
      throw new Error(
        `[${subName}] Sub-component has .initialState but no .isolatedState = true. ` +
        `This will overwrite parent state. If this is intentional, add .isolatedState = true to the component.`
      )
    }

    let lense

    const subInitState = subIsolatedState ? subInitialState : undefined
    const fieldLense = {
      get: (state: any) => {
        const slice = state[stateField]
        if (typeof slice === 'undefined' && subInitState) return subInitState
        return slice
      },
      set: (oldState: any, newState: any) => {
        if (this.calculated && stateField in this.calculated) {
          console.warn(`Sub-component of ${this.name} attempted to update state on a calculated field '${stateField}': Update ignored`)
          return oldState
        }
        return { ...oldState, [stateField]: newState }
      }
    }

    const baseLense = {
      get: (state: any) => state,
      set: (oldState: any, newState: any) => newState
    }

    if (typeof stateField === 'undefined') {
      lense = baseLense
    } else if (typeof stateField === 'string') {
      lense = fieldLense
    } else if (isObj(stateField)) {
      if (typeof stateField.get !== 'function') {
        console.error(`Sub-component in ${this.name} has an invalid 'state' field: Expecting 'undefined', a string indicating an array property in the state, or an object with 'get' and 'set' functions for retrieving and setting sub-component state from the current state. Attempting to use parent component state.`)
        lense = baseLense
      } else {
        lense = { get: stateField.get, set: stateField.set }
      }
    } else {
      console.error(`Invalid state provided to sub-component of ${this.name}: Expecting string, object, or undefined, but found ${typeof stateField}. Attempting to use parent component state.`)
      lense = baseLense
    }

    const sources: Record<string, any> = { ...this.sources, [this.stateSourceName]: stateSource, props$, children$, __parentContext$: this.context$, __parentComponentNumber: this._componentNumber }

    // Detect Command objects in props and expose as commands$ source
    for (const key of Object.keys(props)) {
      const val = props[key]
      if (val && val.__sygnalCommand) {
        sources.commands$ = makeCommandSource(val as Command)
        break
      }
    }

    const sink$   = isolate(factory, { [this.stateSourceName]: lense })(sources)

    if (!isObj(sink$)) {
      const name = componentName === 'sygnal-factory' ? 'custom element' : componentName
      throw new Error(`Invalid sinks returned from component factory: ${name}`)
    }

    return sink$
  }

  renderVdom(componentInstances$: any): any {
    return xs.combine(this.subComponentsRendered$, componentInstances$, this._readyChanged$.startWith(null))
      .compose(debounce(1))
      .map(([_, components]: [any, any]) => {
        const componentNames = Object.keys(this.components)

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

        if (vdom$.length === 0) return xs.of(root)

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
                if (wasReady !== !!ready && this._readyChangedListener) {
                  setTimeout(() => {
                    this._readyChangedListener?.next(null)
                  }, 0)
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
          .compose(debounce(1))
          .map((vdoms: any) => {
            const withIds = vdoms.reduce((acc: Record<string, any>, vdom: any, index: any) => {
              acc[ids[index]] = vdom
              return acc
            }, {} as Record<string, any>)
            const rootCopy = deepCopyVdom(root)
            const injected = injectComponents(rootCopy, withIds, componentNames, 'r', undefined, this._childReadyState)
            return processSuspensePost(injected)
          })
      })
      .flatten()
      .filter((val: any) => !!val)
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
    const fixedMsg = (typeof msg === 'function') ? msg : (_: any) => msg
    if (immediate) {
      if (this.debug) {
        const text = `[${context}] ${fixedMsg(msg)}`
        console.log(text)
        if (typeof window !== 'undefined' && window.__SYGNAL_DEVTOOLS__?.connected) {
          window.__SYGNAL_DEVTOOLS__.onDebugLog(this._componentNumber, text)
        }
      }
      return
    } else {
      return (stream: any) => {
        return stream.debug((msg: any) => {
          if (this.debug) {
            const text = `[${context}] ${fixedMsg(msg)}`
            console.log(text)
            if (typeof window !== 'undefined' && window.__SYGNAL_DEVTOOLS__?.connected) {
              window.__SYGNAL_DEVTOOLS__.onDebugLog(this._componentNumber, text)
            }
          }
        })
      }
    }
  }
}



function getComponents(currentElement: any, componentNames: string[], path: string = 'r', parentId?: string): Record<string, any> {
  if (!currentElement) return {}

  if (currentElement.data?.componentsProcessed) return {}
  if (path === 'r') currentElement.data.componentsProcessed = true

  const sel          = currentElement.sel
  const isCollection = sel && sel.toLowerCase() === 'collection'
  const isSwitchable = sel && sel.toLowerCase() === 'switchable'
  const isComponent  = sel && (['collection', 'switchable', 'sygnal-factory', ...componentNames].includes(sel)) || typeof currentElement.data?.props?.sygnalFactory === 'function' || isObj(currentElement.data?.props?.sygnalOptions)
  const props        = (currentElement.data && currentElement.data.props) || {}
  const attrs        = (currentElement.data && currentElement.data.attrs) || {}
  const children     = currentElement.children || []

  let found: Record<string, any>    = {}

  let id = parentId
  if (isComponent) {
    id  = getComponentIdFromElement(currentElement, path, parentId)
    if (isCollection) {
      if (!props.of)   throw new Error(`Collection element missing required 'component' property`)
      if (typeof props.of !== 'string' && typeof props.of !== 'function')         throw new Error(`Invalid 'component' property of collection element: found ${ typeof props.of } requires string or component factory function`)
      if (typeof props.of !== 'function' && !componentNames.includes(props.of))   throw new Error(`Specified component for collection not found: ${props.of}`)
      if (typeof props.from !== 'undefined' && !(typeof props.from === 'string' || Array.isArray(props.from) || typeof props.from.get === 'function')) console.warn(`No valid array found for collection ${ typeof props.of === 'string' ? props.of : 'function component' }: no collection components will be created`, props.from)
      currentElement.data.isCollection = true
      currentElement.data.props ||= {}
    } else if (isSwitchable) {
      if (!props.of)        throw new Error(`Switchable element missing required 'of' property`)
      if (!isObj(props.of)) throw new Error(`Invalid 'of' property of switchable element: found ${ typeof props.of } requires object mapping names to component factories`)
      const switchableComponents = Object.values(props.of)
      if (!switchableComponents.every(comp => typeof comp === 'function')) throw new Error(`One or more components provided to switchable element is not a valid component factory`)
      if (!props.current || (typeof props.current !== 'string' && typeof props.current !== 'function')) throw new Error(`Missing or invalid 'current' property for switchable element: found '${ typeof props.current }' requires string or function`)
      const switchableComponentNames = Object.keys(props.of)
      if (!switchableComponentNames.includes(props.current)) throw new Error(`Component '${props.current}' not found in switchable element`)
      currentElement.data.isSwitchable = true
    } else {

    }
    if (typeof props.key === 'undefined') currentElement.data.props.key = id
    found[id] = currentElement
  }

  if (children.length > 0) {
    children.map((child: any, i: any) => getComponents(child, componentNames, `${path}.${i}`, id))
            .forEach((child: any) => {
              Object.entries(child).forEach(([id, el]: [string, any]) => found[id] = el)
            })
  }

  return found
}

function injectComponents(currentElement: any, components: Record<string, any>, componentNames: string[], path: string = 'r', parentId?: string, readyMap?: Record<string, boolean>): any {
  if (!currentElement) return
  if (currentElement.data?.componentsInjected) return currentElement
  if (path === 'r' && currentElement.data) currentElement.data.componentsInjected = true


  const sel          = currentElement.sel || 'NO SELECTOR'
  const isComponent  = ['collection', 'switchable', 'sygnal-factory', ...componentNames].includes(sel) || typeof currentElement.data?.props?.sygnalFactory === 'function' || isObj(currentElement.data?.props?.sygnalOptions)
  const isCollection = currentElement?.data?.isCollection
  const isSwitchable = currentElement?.data?.isSwitchable
  const props        = (currentElement.data && currentElement.data.props) || {}
  const children     = currentElement.children || []

  let id = parentId
  if (isComponent) {
    id  = getComponentIdFromElement(currentElement, path, parentId)
    let component = components[id]
    // Annotate the injected VNode with its READY state
    if (readyMap && id && component && typeof component === 'object' && component.sel) {
      component.data = component.data || {}
      component.data.attrs = component.data.attrs || {}
      component.data.attrs['data-sygnal-ready'] = readyMap[id] !== false ? 'true' : 'false'
    }
    if (isCollection) {
      currentElement.sel = 'div'
      currentElement.children = Array.isArray(component) ? component : [component]
      return currentElement
    } else if (isSwitchable) {
      return component
    } else {
      return component
    }
  } else if (children.length > 0) {
    currentElement.children = children.map((child: any, i: any) => injectComponents(child, components, componentNames, `${path}.${i}`, id, readyMap)).flat()
    return currentElement
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

    // Check if any child within this boundary is not ready
    const isPending = children.some(hasNotReadyChild)

    if (isPending && fallback) {
      // Render fallback
      if (typeof fallback === 'string') {
        return { sel: 'div', data: { attrs: { 'data-sygnal-suspense': 'pending' } }, children: [{ text: fallback }], text: undefined, elm: undefined, key: undefined }
      }
      return { sel: 'div', data: { attrs: { 'data-sygnal-suspense': 'pending' } }, children: [fallback], text: undefined, elm: undefined, key: undefined }
    }

    // All children ready or no fallback — render children directly
    if (children.length === 1) return processSuspensePost(children[0])
    return { sel: 'div', data: { attrs: { 'data-sygnal-suspense': 'resolved' } }, children: children.map((c: any) => processSuspensePost(c)), text: undefined, elm: undefined, key: undefined }
  }
  if (vnode.children && vnode.children.length > 0) {
    vnode.children = vnode.children.map((c: any) => processSuspensePost(c))
  }
  return vnode
}

const portalPatch = snabbdomInit(defaultModules);

function processPortals(vnode: any): any {
  if (!vnode || !vnode.sel) return vnode
  if (vnode.sel === 'portal') {
    const target = vnode.data?.props?.target
    const children = vnode.children || []
    return createPortalPlaceholder(target, children)
  }
  if (vnode.children && vnode.children.length > 0) {
    vnode.children = vnode.children.map(processPortals)
  }
  return vnode
}

function processTransitions(vnode: any): any {
  if (!vnode || !vnode.sel) return vnode
  if (vnode.sel === 'transition') {
    const props = vnode.data?.props || {}
    const name = props.name || 'v'
    const duration = props.duration
    const children = vnode.children || []
    const child = children[0]
    if (!child || !child.sel) return child || vnode
    return applyTransitionHooks(processTransitions(child), name, duration)
  }
  if (vnode.children && vnode.children.length > 0) {
    vnode.children = vnode.children.map(processTransitions)
  }
  return vnode
}

function processClientOnly(vnode: any): any {
  if (!vnode || !vnode.sel) return vnode
  if (vnode.sel === 'clientonly') {
    // On the client, unwrap to children (render them normally)
    const children = vnode.children || []
    if (children.length === 0) return { sel: 'div', data: {}, children: [] }
    if (children.length === 1) return processClientOnly(children[0])
    // Multiple children: wrap in a div
    return {
      sel: 'div',
      data: {},
      children: children.map(processClientOnly),
      text: undefined,
      elm: undefined,
      key: undefined,
    }
  }
  if (vnode.children && vnode.children.length > 0) {
    vnode.children = vnode.children.map(processClientOnly)
  }
  return vnode
}

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

function processLazy(vnode: any, componentInstance: any): any {
  if (!vnode || !vnode.sel) return vnode

  // Check if this VNode wraps a lazy component via sygnalOptions
  const view = vnode.data?.props?.sygnalOptions?.view
  if (view && view.__sygnalLazy) {
    if (view.__sygnalLazyLoaded()) {
      // Lazy component is loaded — rebuild VNode with loaded component's properties
      const loaded = view.__sygnalLazyLoadedComponent
      if (loaded) {
        const props = vnode.data?.props || {}
        const name = loaded.componentName || loaded.label || loaded.name || 'LazyLoaded'
        const { model, intent, hmrActions, context, peers, components, initialState, isolatedState, calculated, storeCalculatedInState, DOMSourceName, stateSourceName, onError, debug } = loaded
        const options = { name, view: loaded, model, intent, hmrActions, context, peers, components, initialState, isolatedState, calculated, storeCalculatedInState, DOMSourceName, stateSourceName, onError, debug }
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
      // Schedule re-render when lazy promise resolves
      if (!view.__sygnalLazyReRenderScheduled && view.__sygnalLazyPromise && componentInstance) {
        view.__sygnalLazyReRenderScheduled = true
        view.__sygnalLazyPromise.then(() => {
          setTimeout(() => {
            const stateSource = componentInstance.sources?.[componentInstance.stateSourceName]
            if (stateSource && stateSource.stream) {
              // Add a unique token to bypass dropRepeats deep comparison
              const stateCopy = { ...componentInstance.currentState, __sygnalLazyTick: Date.now() }
              stateSource.stream.shamefullySendNext(stateCopy)
            }
          }, 0)
        })
      }
    }
  }

  if (vnode.children && vnode.children.length > 0) {
    vnode.children = vnode.children.map((child: any) => processLazy(child, componentInstance))
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
          const container = document.querySelector(target)
          if (!container) {
            console.warn(`[Portal] Target "${target}" not found in DOM`)
            return
          }
          const anchor = document.createElement('div')
          container.appendChild(anchor)
          vnode.data._portalVnode = portalPatch(anchor, {
            sel: 'div', data: {}, children: portalChildren,
            text: undefined, elm: undefined, key: undefined,
          })
          vnode.data._portalContainer = container
        },
        postpatch: (oldVnode: any, newVnode: any) => {
          const prevPortalVnode = oldVnode.data?._portalVnode
          const container = oldVnode.data?._portalContainer
          if (!prevPortalVnode || !container) return
          const newChildren = newVnode.data?.portalChildren || []
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


function deepCopyVdom(obj: any): any {
  if (typeof obj === 'undefined') return obj
  return { ...obj, children: Array.isArray(obj.children) ? obj.children.map(deepCopyVdom) : undefined, data: obj.data && { ...obj.data, componentsInjected: false } }
}

function propsIsEqual(obj1: any, obj2: any): boolean {
  return objIsEqual(sanitizeObject(obj1), sanitizeObject(obj2))
}

function objIsEqual(obj1: any, obj2?: any, maxDepth: number = 5, depth: number = 0): boolean {
  // Base case: if the current depth exceeds maxDepth, return true
  if (depth > maxDepth) {
      return false;
  }

  // If both are the same object or are both exactly null or undefined
  if (obj1 === obj2) {
      return true;
  }

  // If either is not an object (null, undefined, or primitive), directly compare
  if (typeof obj1 !== 'object' || obj1 === null || typeof obj2 !== 'object' || obj2 === null) {
      return false;
  }

  // Special handling for arrays
  if (Array.isArray(obj1) && Array.isArray(obj2)) {
    if (obj1.length !== obj2.length) {
        return false;
    }
    for (let i = 0; i < obj1.length; i++) {
        if (!objIsEqual(obj1[i], obj2[i], maxDepth, depth + 1)) {
            return false;
        }
    }
    return true;
  }

  // Get keys of both objects
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  // Check if the number of properties is different
  if (keys1.length !== keys2.length) {
      return false;
  }

  // Recursively check each property
  for (const key of keys1) {
      if (!keys2.includes(key)) {
          return false;
      }
      if (!objIsEqual(obj1[key], obj2[key], maxDepth, depth + 1)) {
          return false;
      }
  }

  return true;
}

function sanitizeObject(obj: any): any {
  if (!isObj(obj)) return obj
  const {state, of, from, filter, ...sanitized} = obj
  return sanitized
}

function isObj(obj: any): obj is Record<string, any> {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj)
}

function __baseSort(a: any, b: any, ascending: boolean = true): number {
  const direction = ascending ? 1 : -1
  switch(true) {
    case a > b: return 1 * direction
    case a < b: return -1 * direction
    default: return 0
  }
}

function __sortFunctionFromObj(item: Record<string, any>): ((a: any, b: any) => number) | undefined {
  const entries = Object.entries(item)
  if (entries.length > 1) {
    console.error('Sort objects can only have one key:', item)
    return undefined
  }
  const entry = entries[0]
  const [field, directionRaw] = entry
  if (!['string', 'number'].includes(typeof directionRaw)) {
    console.error('Sort object properties must be a string or number:', item)
    return undefined
  }
  let ascending = true
  if (typeof directionRaw === 'string') {
    if (!['asc', 'desc'].includes(directionRaw.toLowerCase())) {
      console.error('Sort object string values must be asc or desc:', item)
      return undefined
    }
    ascending = directionRaw.toLowerCase() !== 'desc'
  }
  if (typeof directionRaw === 'number') {
    if (directionRaw !== 1 && directionRaw !== -1) {
      console.error('Sort object number values must be 1 or -1:', item)
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
    console.error('Invalid sort option (ignoring):', sortProp)
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
