'use strict'

import isolate from '@cycle/isolate'
import collection from './collection.js'
import switchable from './switchable.js'
import { StateSource } from '@cycle/state'

import { default as xs, Stream } from 'xstream'
import { default as delay } from 'xstream/extra/delay.js'
import { default as concat } from 'xstream/extra/concat.js'
import debounce from 'xstream/extra/debounce.js'
import { default as dropRepeats } from 'xstream/extra/dropRepeats.js'


const ENVIRONMENT = ((typeof window != 'undefined' && window) || (process && process.env)) || {}


const BOOTSTRAP_ACTION  = 'BOOTSTRAP'
const INITIALIZE_ACTION = 'INITIALIZE'
const HYDRATE_ACTION    = 'HYDRATE'
const PARENT_SINK_NAME  = 'PARENT'
const CHILD_SOURCE_NAME = 'CHILD'


let COMPONENT_COUNT   = 0


export const ABORT = '~#~#~ABORT~#~#~'

export default function component (opts) {
  const { name, sources, isolateOpts, stateSourceName='STATE' } = opts

  if (sources && !isObj(sources)) {
    throw new Error('Sources must be a Cycle.js sources object:', name)
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
    const wrapped = (sources) => {
      const fixedOpts = { ...opts, sources }
      return (new Component(fixedOpts)).sinks
    }
    returnFunction = currySources ? isolate(wrapped, fixedIsolateOpts) : isolate(wrapped, fixedIsolateOpts)(sources)
  } else {
    returnFunction = currySources ? (sources) => (new Component({ ...opts, sources })).sinks : (new Component(opts)).sinks
  }

  returnFunction.componentName = name
  returnFunction.isSygnalComponent = true

  return returnFunction
}





class Component {
  // [ PASSED PARAMETERS ]
  // name
  // sources
  // intent
  // model
  // context
  // view
  // peers
  // components
  // initialState
  // calculated
  // storeCalculatedInState
  // DOMSourceName
  // stateSourceName
  // requestSourceName
  // debug

  // [ PRIVATE / CALCULATED VALUES ]
  // sourceNames
  // intent$
  // action$
  // model$
  // context$
  // peers$
  // childSources
  // vdom$
  // currentState
  // currentProps
  // currentChildren
  // currentContext
  // subComponentSink$
  // unmountRequest$ <- TODO
  // unmount() <- TODO
  // _debug

  // [ INSTANTIATED STREAM OPERATOR ]
  // log

  // [ OUTPUT ]
  // sinks

  constructor({ name='NO NAME', sources, intent, model, hmrActions, context, response, view, peers={}, components={}, initialState, calculated, storeCalculatedInState=true, DOMSourceName='DOM', stateSourceName='STATE', requestSourceName='HTTP', debug=false }) {
    if (!sources || !isObj(sources)) throw new Error('Missing or invalid sources')

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
    this._debug            = debug

    this.isSubComponent = this.sourceNames.includes('props$')

    const state$ = sources[stateSourceName] && sources[stateSourceName].stream

    if (state$) {
      this.currentState = initialState || {}
      this.sources[stateSourceName] = new StateSource(state$.map(val => {
        this.currentState = val
        return val
      }))
    }

    const props$ = sources.props$
    if (props$) {
      this.sources.props$ = props$.map(val => {
        this.currentProps = val
        return val
      })
    }

    const children$ = sources.children$
    if (children$) {
      this.sources.children$ = children$.map(val => {
        this.currentChildren = val
        return val
      })
    }


    // Ensure that the root component has an intent and model
    // This is necessary to ensure that the component tree's state sink is subscribed to
    if (!this.isSubComponent && typeof this.intent === 'undefined' && typeof this.model === 'undefined') {
      this.initialState = initialState || true
      this.intent = _ => ({__NOOP_ACTION__:xs.never()})
      this.model = {
        __NOOP_ACTION__: state => state
      }
    }

    const componentNumber = COMPONENT_COUNT++

    this.addCalculated = this.createMemoizedAddCalculated()
    this.log = makeLog(`${componentNumber} | ${name}`)

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

    this.sinks.__index = componentNumber

    this.log(`Instantiated`, true)
  }

  get debug() {
    return this._debug || (ENVIRONMENT.SYGNAL_DEBUG === 'true' || ENVIRONMENT.SYGNAL_DEBUG === true)
  }

  initIntent$() {
    if (!this.intent) {
      return
    }
    if (typeof this.intent != 'function') {
      throw new Error('Intent must be a function')
    }

    this.intent$ = this.intent(this.sources)

    if (!(this.intent$ instanceof Stream) && (!isObj(this.intent$))) {
      throw new Error('Intent must return either an action$ stream or map of event streams')
    }
  }

  initHmrActions() {
    if (typeof this.hmrActions === 'undefined') {
      this.hmrAction$ = xs.of().filter(_ => false)
      return
    }
    if (typeof this.hmrActions === 'string') {
      this.hmrActions = [this.hmrActions]
    }
    if (!Array.isArray(this.hmrActions)) {
      throw new Error(`[${ this.name }] hmrActions must be the name of an action or an array of names of actions to run when a component is hot-reloaded`)
    }
    if (this.hmrActions.some(action => typeof action !== 'string')) {
      throw new Error(`[${ this.name }] hmrActions must be the name of an action or an array of names of actions to run when a component is hot-reloaded`)
    }
    this.hmrAction$ = xs.fromArray(this.hmrActions.map(action => ({ type: action })))
  }

  initAction$() {
    const requestSource  = (this.sources && this.sources[this.requestSourceName]) || null

    if (!this.intent$) {
      this.action$ = xs.never()
      return
    }

    let runner
    if (this.intent$ instanceof Stream) {
      runner = this.intent$
    } else {
      const mapped = Object.entries(this.intent$)
                           .map(([type, data$]) => data$.map(data => ({type, data})))
      runner = xs.merge(xs.never(), ...mapped)
    }

    const action$    = ((runner instanceof Stream) ? runner : (runner.apply && runner(this.sources) || xs.never()))
    const bootstrap$ = xs.of({ type: BOOTSTRAP_ACTION }).compose(delay(10))
    const hmrAction$ = window?.__SYGNAL_HMR_UPDATING === true ? this.hmrAction$ : xs.of().filter(_ => false)
    const wrapped$   = (this.model[BOOTSTRAP_ACTION] && window?.__SYGNAL_HMR_UPDATING !== true) ? concat(bootstrap$, action$) : concat(xs.of().compose(delay(1)).filter(_ => false), hmrAction$, action$)


    let initialApiData
    if (window?.__SYGNAL_HMR_UPDATING !== true && requestSource && typeof requestSource.select == 'function') {
      initialApiData = requestSource.select('initial')
        .flatten()
    } else {
      initialApiData = xs.never()
    }

    const hydrate$ = initialApiData.map(data => ({ type: HYDRATE_ACTION, data }))

    this.action$   = xs.merge(wrapped$, hydrate$)
      .compose(this.log(({ type }) => `<${ type }> Action triggered`))
  }

  initState() {
    if (this.model !== undefined) {
      if (this.model[INITIALIZE_ACTION] === undefined) {
        this.model[INITIALIZE_ACTION] = {
          [this.stateSourceName]: (_, data) => ({ ...this.addCalculated(data) })
        }
      } else if (isObj(this.model[INITIALIZE_ACTION])) {
        Object.keys(this.model[INITIALIZE_ACTION]).forEach(name => {
          if (name !== this.stateSourceName) {
            console.warn(`${ INITIALIZE_ACTION } can only be used with the ${ this.stateSourceName } source... disregarding ${ name }`)
            delete this.model[INITIALIZE_ACTION][name]
          }
        })
      }
    }
  }

  initContext() {
    if (!this.context && !this.sources.__parentContext$) {
      this.context$ = xs.of({})
      return
    }

    const state$ = this.sources[this.stateSourceName]?.stream.startWith({}).compose(dropRepeats(objIsEqual)) || xs.never()
    const parentContext$ = this.sources.__parentContext$.startWith({}).compose(dropRepeats(objIsEqual)) || xs.of({})
    if (this.context && !isObj(this.context)) {
      console.error(`[${this.name}] Context must be an object mapping names to values of functions: ignoring provided ${ typeof this.context }`)
    }
    this.context$ = xs.combine(state$, parentContext$)
      .map(([_, parent]) => {
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
            console.error(`[${ this.name }] Invalid context entry '${ name }': must be the name of a state property or a function returning a value to use`)
            return acc
          }
          acc[name] = _value
          return acc
        }, {})
        const newContext = { ..._parent, ...values }
        this.currentContext = newContext
        return newContext
      })
      .compose(dropRepeats(objIsEqual))
      .startWith({})
    this.context$.subscribe({ next: _ => _ })
  }

  initModel$() {
    if (typeof this.model == 'undefined') {
      this.model$ = this.sourceNames.reduce((a,s) => {
        a[s] = xs.never()
        return a
      }, {})
      return
    }

    const initial  = { type: INITIALIZE_ACTION, data: this.initialState }
    if (this.isSubComponent && this.initialState) {
      console.warn(`[${ this.name }] Initial state provided to sub-component. This will overwrite any state provided by the parent component.`)
    }
    const shimmed$ = (this.initialState && window?.__SYGNAL_HMR_UPDATING !== true) ? concat(xs.of(initial), this.action$).compose(delay(0)) : this.action$
    const onState  = () => this.makeOnAction(shimmed$, true, this.action$)
    const onNormal = () => this.makeOnAction(this.action$, false, this.action$)


    const modelEntries = Object.entries(this.model)

    const reducers = {}

    modelEntries.forEach((entry) => {
      let [action, sinks] = entry

      if (typeof sinks === 'function') {
        sinks = { [this.stateSourceName]: sinks }
      }

      if (!isObj(sinks)) {
        throw new Error(`Entry for each action must be an object: ${ this.name } ${ action }`)
      }

      const sinkEntries = Object.entries(sinks)

      sinkEntries.forEach((entry) => {
        const [sink, reducer] = entry

        const isStateSink  = (sink === this.stateSourceName)
        const isParentSink = (sink === PARENT_SINK_NAME)

        const on  = isStateSink ? onState() : onNormal()
        const on$ = isParentSink ? on(action, reducer).map(value => ({ name: this.name, value })) : on(action, reducer)

        const wrapped$ = on$
          .compose(this.log(data => {
            if (isStateSink) {
              return `<${ action }> State reducer added`
            } else if (isParentSink) {
              return `<${ action }> Data sent to parent component: ${ JSON.stringify(data.value).replaceAll('"', '') }`
            } else {
              const extra = data && (data.type || data.command || data.name || data.key || (Array.isArray(data) && 'Array') || data)
              return `<${ action }> Data sent to [${ sink }]: ${ JSON.stringify(extra).replaceAll('"', '') }`
            }
          }))

        if (Array.isArray(reducers[sink])) {
          reducers[sink].push(wrapped$)
        } else {
          reducers[sink] = [wrapped$]
        }
      })
    })

    const model$ = Object.entries(reducers).reduce((acc, entry) => {
      const [sink, streams] = entry
      acc[sink] = xs.merge(xs.never(), ...streams)
      return acc
    }, {})

    this.model$ = model$
  }

  initPeers$() {
    const initial = this.sourceNames.reduce((acc, name) => {
      if (name == this.DOMSourceName) {
        acc[name] = {}
      } else {
        acc[name] = []
      }
      return acc
    }, {})

    this.peers$ = Object.entries(this.peers).reduce((acc, [peerName, peerFactory]) => {
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

  initChildSources$() {
    let newSourcesNext
    const childSources$ = xs.create({
      start: listener => {
        newSourcesNext = listener.next.bind(listener)
      },
      stop: _ => {

      }
    }).map(sources => xs.merge(...sources)).flatten()

    this.sources[CHILD_SOURCE_NAME] = {
      select: (name) => {
        const all$ = childSources$
        const filtered$ = name ? all$.filter(entry => entry.name === name) : all$
        const unwrapped$ = filtered$.map(entry => entry.value)
        return unwrapped$
      }
    }

    this.newChildSources = (sources) => {
      if (typeof newSourcesNext === 'function') newSourcesNext(sources)
    }
  }

  initSubComponentSink$() {
    const subComponentSink$ = xs.create({
      start: listener => {
        this.newSubComponentSinks = listener.next.bind(listener)
      },
      stop: _ => {

      }
    })
    subComponentSink$.subscribe({ next: _ => _ })
    this.subComponentSink$ = subComponentSink$.filter(sinks => Object.keys(sinks).length > 0)
  }

  initSubComponentsRendered$() {
    const stream = xs.create({
      start: (listener) => {
        this.triggerSubComponentsRendered = listener.next.bind(listener)
      },
      stop: _ => {

      }
    })
    this.subComponentsRendered$ = stream.startWith(null)
  }

  initVdom$() {
    if (typeof this.view != 'function') {
      this.vdom$ = xs.of(null)
      return
    }

    const renderParameters$ = this.collectRenderParameters()

    this.vdom$ = renderParameters$
      .map(this.view)
      .compose(this.log('View rendered'))
      .map(vDom => vDom || { sel: 'div', data: {}, children: [] })
      .compose(this.instantiateSubComponents.bind(this))
      .filter(val => val !== undefined)
      .compose(this.renderVdom.bind(this))

  }

  initSinks() {
    this.sinks = this.sourceNames.reduce((acc, name) => {
      if (name == this.DOMSourceName) return acc
      const subComponentSink$ = (this.subComponentSink$ && name !== PARENT_SINK_NAME) ? this.subComponentSink$.map(sinks => sinks[name]).filter(sink => !!sink).flatten() : xs.never()
      if (name === this.stateSourceName) {
        acc[name] = xs.merge((this.model$[name] || xs.never()), subComponentSink$, this.sources[this.stateSourceName].stream.filter(_ => false), ...(this.peers$[name] || []))
      } else {
        acc[name] = xs.merge((this.model$[name] || xs.never()), subComponentSink$, ...(this.peers$[name] || []))
      }
      return acc
    }, {})

    this.sinks[this.DOMSourceName] = this.vdom$
    this.sinks[PARENT_SINK_NAME] = this.model$[PARENT_SINK_NAME] || xs.never()
  }

  makeOnAction(action$, isStateSink=true, rootAction$) {
    rootAction$ = rootAction$ || action$
    return (name, reducer) => {
      const filtered$ = action$.filter(({type}) => type == name)

      let returnStream$
      if (typeof reducer === 'function') {
        returnStream$ = filtered$.map(action => {
          const next = (type, data, delay=10) => {
            if (typeof delay !== 'number') throw new Error(`[${ this.name } ] Invalid delay value provided to next() function in model action '${ name }'. Must be a number in ms.`)
            // put the "next" action request at the end of the event loop so the "current" action completes first
            setTimeout(() => {
              // push the "next" action request into the action$ stream
              rootAction$.shamefullySendNext({ type, data })
            }, delay)
            this.log(`<${ name }> Triggered a next() action: <${ type }> ${ delay }ms delay`, true)
          }

          const extra = { props: this.currentProps, children: this.currentChildren, context: this.currentContext }

          let data = action.data
          if (isStateSink) {
            return (state) => {
              const _state = this.isSubComponent ? this.currentState : state
              const enhancedState = this.addCalculated(_state)
              const newState = reducer(enhancedState, data, next, extra)
              if (newState == ABORT) return _state
              return this.cleanupCalculated(newState)
            }
          } else {
            const enhancedState = this.addCalculated(this.currentState)
            const reduced = reducer(enhancedState, data, next, extra)
            const type = typeof reduced
            if (isObj(reduced) || ['string', 'number', 'boolean', 'function'].includes(type)) return reduced
            if (type == 'undefined') {
              console.warn(`'undefined' value sent to ${ name }`)
              return reduced
            }
            throw new Error(`Invalid reducer type for ${ name } ${ type }`)
          }
        }).filter(result => result != ABORT)
      } else if (reducer === undefined || reducer === true) {
        returnStream$ = filtered$.map(({data}) => data)
      } else {
        const value = reducer
        returnStream$ = filtered$.mapTo(value)
      }

      return returnStream$
    }
  }

  createMemoizedAddCalculated() {
    let lastState
    let lastResult

    return function(state) {
      if (!this.calculated || !isObj(state) || Array.isArray(state)) return state
      if (state === lastState) {
        return lastResult
      }
      if (!isObj(this.calculated)) throw new Error(`'calculated' parameter must be an object mapping calculated state field named to functions`)

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

  getCalculatedValues(state) {
    const entries = Object.entries(this.calculated || {})
    if (entries.length === 0) {
      return
    }
    return entries.reduce((acc, [field, fn]) => {
      if (typeof fn !== 'function') throw new Error(`Missing or invalid calculator function for calculated field '${ field }`)
      try {
        acc[field] = fn(state)
      } catch(e) {
        console.warn(`Calculated field '${ field }' threw an error during calculation: ${ e.message }`)
      }
      return acc
    }, {})
  }

  cleanupCalculated(incomingState) {
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

  collectRenderParameters() {
    const state        = this.sources[this.stateSourceName]
    const renderParams = { ...this.peers$[this.DOMSourceName] }

    const enhancedState = state && state.isolateSource(state, { get: state => this.addCalculated(state) })
    const stateStream   = (enhancedState && enhancedState.stream) || xs.never()

    
    renderParams.state  = stateStream.compose(dropRepeats(objIsEqual))

    if (this.sources.props$) {
      renderParams.props = this.sources.props$.compose(dropRepeats(propsIsEqual))
    }

    if (this.sources.children$) {
      renderParams.children = this.sources.children$.compose(dropRepeats(objIsEqual))
    }

    if (this.context$) {
      renderParams.context = this.context$.compose(dropRepeats(objIsEqual))
    }

    const names   = []
    const streams = []

    Object.entries(renderParams).forEach(([name, stream]) => {
      names.push(name)
      streams.push(stream)
    })

    const combined = xs.combine(...streams)
      .compose(debounce(1))
      // map the streams from an array back to an object with the render parameter names as the keys
      .map(arr => {
        const params = names.reduce((acc, name, index) => {
          acc[name] = arr[index]
          if (name === 'state') {
            acc[this.stateSourceName] = arr[index]
            acc.calculated = (arr[index] && this.getCalculatedValues(arr[index])) || {}
          }
          return acc
        }, {})
        return params
      })

    return combined
  }

  instantiateSubComponents(vDom$) {
    return vDom$.fold((previousComponents, vDom) => {
      const componentNames  = Object.keys(this.components)
      const foundComponents = getComponents(vDom, componentNames)
      const entries         = Object.entries(foundComponents)

      const rootEntry = { '::ROOT::': vDom }

      if (entries.length === 0) {
        return rootEntry
      }

      const sinkArrsByType = {}
      const childSources = []
      let newInstanceCount = 0

      const newComponents =  entries.reduce((acc, [id, el]) => {
        const data     = el.data
        const props    = data.props  || {}
        const children = el.children || []

        const isCollection = data.isCollection || false
        const isSwitchable = data.isSwitchable || false

        const addSinks = (sinks) => {
          Object.entries(sinks).forEach(([name, stream]) => {
            sinkArrsByType[name] ||= []
            if (name === PARENT_SINK_NAME) {
              childSources.push(stream)
            } else if (name !== this.DOMSourceName) {
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

        const sink$ = instantiator(el, props$, children$)

        sink$[this.DOMSourceName] = sink$[this.DOMSourceName] ? this.makeCoordinatedSubComponentDomSink(sink$[this.DOMSourceName]) : xs.never()

        acc[id] = { sink$, props$, children$ }

        addSinks(sink$)

        return acc
      }, rootEntry)

      const mergedSinksByType = Object.entries(sinkArrsByType).reduce((acc, [name, streamArr]) => {
        if (streamArr.length === 0) return acc
        acc[name] = streamArr.length === 1 ? streamArr[0] : xs.merge(...streamArr)
        return acc
      }, {})

      this.newSubComponentSinks(mergedSinksByType)
      this.newChildSources(childSources)


      if (newInstanceCount > 0) this.log(`New sub components instantiated: ${ newInstanceCount }`, true)

      return newComponents
    }, {})
  }

  makeCoordinatedSubComponentDomSink(domSink$) {
    const remembered$   = domSink$.remember()

    const coordinated = this.sources[this.stateSourceName].stream
      .compose(dropRepeats(objIsEqual))
      .map(state => remembered$)
      .flatten()
      .debug(_ => this.triggerSubComponentsRendered())
      .remember()

    return coordinated
  }

  instantiateCollection(el, props$, children$) {
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
      .map(([state, props]) => {
        if (props.filter !== arrayOperators.filter) {
          arrayOperators.filter = typeof props.filter === 'function' ? props.filter : undefined
        }
        if (props.sort !== arrayOperators.sort) {
          arrayOperators.sort = sortFunctionFromProp(props.sort)
        }
        
        return isObj(state) ? this.addCalculated(state) : state
      })

    const stateSource  = new StateSource(state$)
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
        const { model, intent, hmrActions, context, peers, components, initialState, calculated, storeCalculatedInState, DOMSourceName, stateSourceName, debug } = collectionOf
        const options = { name, view, model, intent, hmrActions, context, peers, components, initialState, calculated, storeCalculatedInState, DOMSourceName, stateSourceName, debug }
        factory = component(options)
      }
    } else if (this.components[collectionOf]) {
      factory = this.components[collectionOf]
    } else {
      throw new Error(`[${this.name}] Invalid 'of' propery in collection: ${ collectionOf }`)
    }

    const fieldLense = {
      get: state => {
        if (!Array.isArray(state[stateField])) return []
        const items = state[stateField]
        const filtered = typeof arrayOperators.filter === 'function' ? items.filter(arrayOperators.filter) : items
        const sorted = typeof arrayOperators.sort ? filtered.sort(arrayOperators.sort) : filtered
        const mapped = sorted.map((item, index) => {
          return (isObj(item)) ? { ...item, [idField]: item[idField] || index } : { value: item, [idField]: index }
        })

        return mapped
      },
      set: (oldState, newState) => {
        if (this.calculated && stateField in this.calculated) {
          console.warn(`Collection sub-component of ${ this.name } attempted to update state on a calculated field '${ stateField }': Update ignored`)
          return oldState
        }
        const updated = []
        for (const oldItem of oldState[stateField].map((item, index) => (isObj(item) ? { ...item, [idField]: item[idField] || index } : { __primitive: true, value: item, [idField]: index }))) {
          if (typeof arrayOperators.filter === 'function' && !arrayOperators.filter(oldItem)) {
            updated.push(oldItem.__primitive ? oldItem.value : oldItem)
          } else {
            const newItem = newState.find(item => item[idField] === oldItem[idField])
            if (typeof newItem !== 'undefined') updated.push(oldItem.__primitive ? newItem.value : newItem)
          }
        }
        return { ...oldState, [stateField]: updated }
      }
    }

    if (stateField === undefined) {
      lense = {
        get: state => {
          if (!(state instanceof Array) && state.value && state.value instanceof Array) return state.value
          return state
        },
        set: (oldState, newState) => {
          return newState
        }
      }
    } else if (typeof stateField === 'string') {
      if (isObj(this.currentState)) {
        if(!(this.currentState && stateField in this.currentState) && !(this.calculated && stateField in this.calculated)) {
          console.error(`Collection component in ${ this.name } is attempting to use non-existent state property '${ stateField }': To fix this error, specify a valid array property on the state.  Attempting to use parent component state.`)
          lense = undefined
        } else if (!Array.isArray(this.currentState[stateField])) {
          console.warn(`State property '${ stateField }' in collection comopnent of ${ this.name } is not an array: No components will be instantiated in the collection.`)
          lense = fieldLense
        } else {
          lense = fieldLense
        }
      } else {
        if (!Array.isArray(this.currentState[stateField])) {
          console.warn(`State property '${ stateField }' in collection component of ${ this.name } is not an array: No components will be instantiated in the collection.`)
          lense = fieldLense
        } else {
          lense = fieldLense
        }
      }
    } else if (isObj(stateField)) {
      if (typeof stateField.get !== 'function') {
        console.error(`Collection component in ${ this.name } has an invalid 'from' field: Expecting 'undefined', a string indicating an array property in the state, or an object with 'get' and 'set' functions for retrieving and setting child state from the current state. Attempting to use parent component state.`)
        lense = undefined
      } else {
        lense = {
          get: (state) => {
            const newState = stateField.get(state)
            if (!Array.isArray(newState)) {
              console.warn(`State getter function in collection component of ${ this.name } did not return an array: No components will be instantiated in the collection. Returned value:`, newState)
              return []
            }
            return newState
          },
          set: stateField.set
        }
      }
    } else {
      console.error(`Collection component in ${ this.name } has an invalid 'from' field: Expecting 'undefined', a string indicating an array property in the state, or an object with 'get' and 'set' functions for retrieving and setting child state from the current state. Attempting to use parent component state.`)
      lense = undefined
    }

    const sources = { ...this.sources, [this.stateSourceName]: stateSource, props$, children$, __parentContext$: this.context$, PARENT: null }
    const sink$   = collection(factory, lense, { container: null })(sources)
    if (!isObj(sink$)) {
      throw new Error('Invalid sinks returned from component factory of collection element')
    }
    return sink$
  }

  instantiateSwitchable(el, props$, children$) {
    const data      = el.data
    const props     = data.props  || {}

    const state$ = this.sources[this.stateSourceName].stream.startWith(this.currentState)
      .map((state) => {
        return isObj(state) ? this.addCalculated(state) : state
      })

    const stateSource = new StateSource(state$)
    const stateField  = props.state
    let lense

    const fieldLense = {
      get: state => state[stateField],
      set: (oldState, newState) => {
        if (this.calculated && stateField in this.calculated) {
          console.warn(`Switchable sub-component of ${ this.name } attempted to update state on a calculated field '${ stateField }': Update ignored`)
          return oldState
        }
        if (!isObj(newState) || Array.isArray(newState)) return { ...oldState, [stateField]: newState }
        return { ...oldState, [stateField]: newState }
      }
    }

    const baseLense = {
      get: state => state,
      set: (oldState, newState) => newState
    }

    if (typeof stateField === 'undefined') {
      lense = baseLense
    } else if (typeof stateField === 'string') {
      lense = fieldLense
    } else if (isObj(stateField)) {
      if (typeof stateField.get !== 'function') {
        console.error(`Switchable component in ${ this.name } has an invalid 'state' field: Expecting 'undefined', a string indicating an array property in the state, or an object with 'get' and 'set' functions for retrieving and setting sub-component state from the current state. Attempting to use parent component state.`)
        lense = baseLense
      } else {
        lense = { get: stateField.get, set: stateField.set }
      }
    } else {
      console.error(`Invalid state provided to switchable sub-component of ${ this.name }: Expecting string, object, or undefined, but found ${ typeof stateField }. Attempting to use parent component state.`)
      lense = baseLense
    }

    const switchableComponents = props.of
    const keys = Object.keys(switchableComponents)
    keys.forEach(key => {
      const current = switchableComponents[key]
      if (!current.isSygnalComponent) {
        const name = current.componentName || current.label || current.name || 'FUNCTION_COMPONENT'
        const view = current
        const { model, intent, hmrActions, context, peers, components, initialState, calculated, storeCalculatedInState, DOMSourceName, stateSourceName, debug } = current
        const options = { name, view, model, intent, hmrActions, context, peers, components, initialState, calculated, storeCalculatedInState, DOMSourceName, stateSourceName, debug }
        switchableComponents[key] = component(options)
      }
    })
    const sources = { ...this.sources, [this.stateSourceName]: stateSource, props$, children$, __parentContext$: this.context$ }

    const sink$ = isolate(switchable(switchableComponents, props$.map(props => props.current)), { [this.stateSourceName]: lense })(sources)

    if (!isObj(sink$)) {
      throw new Error('Invalid sinks returned from component factory of switchable element')
    }

    return sink$
  }

  instantiateCustomComponent(el, props$, children$) {
    const componentName = el.sel
    const data      = el.data
    const props     = data.props  || {}

    const state$ = this.sources[this.stateSourceName].stream.startWith(this.currentState)
      .map((state) => {
        return isObj(state) ? this.addCalculated(state) : state
      })

    const stateSource = new StateSource(state$)
    const stateField  = props.state

    if (typeof props.sygnalFactory !== 'function' && isObj(props.sygnalOptions)) {
      props.sygnalFactory = component(props.sygnalOptions)
    }

    const factory   = componentName === 'sygnal-factory' ? props.sygnalFactory : (this.components[componentName] || props.sygnalFactory)
    if (!factory) {
      if (componentName === 'sygnal-factory') throw new Error(`Component not found on element with Capitalized selector and nameless function: JSX transpilation replaces selectors starting with upper case letters with functions in-scope with the same name, Sygnal cannot see the name of the resulting component.`)
      throw new Error(`Component not found: ${ componentName }`)
    }

    let lense

    const fieldLense = {
      get: state => state[stateField],
      set: (oldState, newState) => {
        if (this.calculated && stateField in this.calculated) {
          console.warn(`Sub-component of ${ this.name } attempted to update state on a calculated field '${ stateField }': Update ignored`)
          return oldState
        }
        return { ...oldState, [stateField]: newState }
      }
    }

    const baseLense = {
      get: state => state,
      set: (oldState, newState) => newState
    }

    if (typeof stateField === 'undefined') {
      lense = baseLense
    } else if (typeof stateField === 'string') {
      lense = fieldLense
    } else if (isObj(stateField)) {
      if (typeof stateField.get !== 'function') {
        console.error(`Sub-component in ${ this.name } has an invalid 'state' field: Expecting 'undefined', a string indicating an array property in the state, or an object with 'get' and 'set' functions for retrieving and setting sub-component state from the current state. Attempting to use parent component state.`)
        lense = baseLense
      } else {
        lense = { get: stateField.get, set: stateField.set }
      }
    } else {
      console.error(`Invalid state provided to sub-component of ${ this.name }: Expecting string, object, or undefined, but found ${ typeof stateField }. Attempting to use parent component state.`)
      lense = baseLense
    }

    const sources = { ...this.sources, [this.stateSourceName]: stateSource, props$, children$, __parentContext$: this.context$ }
    const sink$   = isolate(factory, { [this.stateSourceName]: lense })(sources)

    if (!isObj(sink$)) {
      const name = componentName === 'sygnal-factory' ? 'custom element' : componentName
      throw new Error('Invalid sinks returned from component factory:', name)
    }

    return sink$
  }

  renderVdom(componentInstances$) {
    return xs.combine(this.subComponentsRendered$, componentInstances$)
      .compose(debounce(1))
      .map(([_, components]) => {
        const componentNames = Object.keys(this.components)

        const root  = components['::ROOT::']
        const entries = Object.entries(components).filter(([id]) => id !== '::ROOT::')

        if (entries.length === 0) {
          return xs.of(root)
        }

        const ids = []
        const vdom$ = entries
          .map(([id, val]) => {
            ids.push(id)
            return val.sink$[this.DOMSourceName].startWith(undefined)
          })

        if (vdom$.length === 0) return xs.of(root)

        return xs.combine(...vdom$)
          .compose(debounce(1))
          .map(vdoms => {
            const withIds = vdoms.reduce((acc, vdom, index) => {
              acc[ids[index]] = vdom
              return acc
            }, {})
            const rootCopy = deepCopyVdom(root)
            const injected = injectComponents(rootCopy, withIds, componentNames)
            return injected
          })
      })
      .flatten()
      .filter(val => !!val)
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
 function makeLog (context) {
  return function (msg, immediate=false) {
    const fixedMsg = (typeof msg === 'function') ? msg : _ => msg
    if (immediate) {
      if (this.debug) {
        console.log(`[${context}] ${fixedMsg(msg)}`)
      }
      return
    } else {
      return stream => {
        return stream.debug(msg => {
          if (this.debug) {
            console.log(`[${context}] ${fixedMsg(msg)}`)
          }
        })
      }
    }
  }
}



function getComponents(currentElement, componentNames, depth=0, index=0, parentId) {
  if (!currentElement) return {}

  if (currentElement.data?.componentsProcessed) return {}
  if (depth === 0) currentElement.data.componentsProcessed = true

  const sel          = currentElement.sel
  const isCollection = sel && sel.toLowerCase() === 'collection'
  const isSwitchable = sel && sel.toLowerCase() === 'switchable'
  const isComponent  = sel && (['collection', 'switchable', 'sygnal-factory', ...componentNames].includes(sel)) || typeof currentElement.data?.props?.sygnalFactory === 'function' || isObj(currentElement.data?.props?.sygnalOptions)
  const props        = (currentElement.data && currentElement.data.props) || {}
  const attrs        = (currentElement.data && currentElement.data.attrs) || {}
  const children     = currentElement.children || []

  let found    = {}
  
  let id = parentId
  if (isComponent) {
    id  = getComponentIdFromElement(currentElement, depth, index, parentId)
    if (isCollection) {
      if (!props.of)   throw new Error(`Collection element missing required 'component' property`)
      if (typeof props.of !== 'string' && typeof props.of !== 'function')         throw new Error(`Invalid 'component' property of collection element: found ${ typeof props.of } requires string or component factory function`)
      if (typeof props.of !== 'function' && !componentNames.includes(props.of))   throw new Error(`Specified component for collection not found: ${ props.of }`)
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
      if (!switchableComponentNames.includes(props.current)) throw new Error(`Component '${ props.current }' not found in switchable element`)
      currentElement.data.isSwitchable = true
    } else {

    }
    if (typeof props.key === 'undefined') currentElement.data.props.key = id
    found[id] = currentElement
  }

  if (children.length > 0) {
    children.map((child, i) => getComponents(child, componentNames, depth + 1, index + i, id))
            .forEach((child) => {
              Object.entries(child).forEach(([id, el]) => found[id] = el)
            })
  }

  return found
}

function injectComponents(currentElement, components, componentNames, depth=0, index=0, parentId) {
  if (!currentElement) return
  if (currentElement.data?.componentsInjected) return currentElement
  if (depth === 0 && currentElement.data) currentElement.data.componentsInjected = true


  const sel          = currentElement.sel || 'NO SELECTOR'
  const isComponent  = ['collection', 'switchable', 'sygnal-factory', ...componentNames].includes(sel) || typeof currentElement.data?.props?.sygnalFactory === 'function' || isObj(currentElement.data?.props?.sygnalOptions)
  const isCollection = currentElement?.data?.isCollection
  const isSwitchable = currentElement?.data?.isSwitchable
  const props        = (currentElement.data && currentElement.data.props) || {}
  const children     = currentElement.children || []

  let id = parentId
  if (isComponent) {
    id  = getComponentIdFromElement(currentElement, depth, index, parentId)
    const component = components[id]
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
    currentElement.children = children.map((child, i) => injectComponents(child, components, componentNames, depth + 1, index + i, id)).flat()
    return currentElement
  } else {
    return currentElement
  }
}

function getComponentIdFromElement(el, depth, index, parentId) {
  const sel    = el.sel
  const name   = typeof sel === 'string' ? sel : 'functionComponent'
  const uid    = `${depth}:${index}`
  const props  = el.data?.props || {}
  const id     = (props.id && JSON.stringify(props.id).replaceAll('"', '')) || uid
  const parentString = parentId ? `${ parentId }|` : ''
  const fullId = `${ parentString }${ name }::${ id }`
  return fullId
}


function deepCopyVdom(obj) {
  if (typeof obj === 'undefined') return obj
  return { ...obj, children: Array.isArray(obj.children) ? obj.children.map(deepCopyVdom) : undefined, data: obj.data && { ...obj.data, componentsInjected: false } }
}

function propsIsEqual(obj1, obj2) {
  return objIsEqual(sanitizeObject(obj1, sanitizeObject(obj2)))
}

function objIsEqual(obj1, obj2, maxDepth = 5, depth = 0) {
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

function sanitizeObject(obj) {
  if (!isObj(obj)) return obj
  const {state, of, from, filter, ...sanitized} = obj
  return sanitized
}

function isObj(obj) {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj)
}

function __baseSort(a, b, ascending=true) {
  const direction = ascending ? 1 : -1
  switch(true) {
    case a > b: return 1 * direction
    case a < b: return -1 * direction
    default: return 0
  }
}

function __sortFunctionFromObj(item) {
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
    if (!['asc', 'dec'].includes(directionRaw.toLowerCase())) {
      console.error('Sort object string values must be asc or dec:', item)
      return undefined
    }
    ascending = directionRaw.toLowerCase() === 'asc'
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

function sortFunctionFromProp(sortProp) {
  if (!sortProp) return undefined
  const propType = typeof sortProp
  // if function do nothing
  if (propType === 'function') return sortProp
  if (propType === 'string') {
    // if passed either 'asc' or 'dec' sort on the entire item
    if (sortProp.toLowerCase() === 'asc' || sortProp.toLowerCase() === 'dec') {
      const ascending = sortProp.toLowerCase() === 'asc'
      return (a, b) => __baseSort(a, b, ascending)
    }
    // assume it's a field/property name, and sort it ascending
    const field = sortProp
    return (a, b) => __baseSort(a[field], b[field], true)
  } else if (Array.isArray(sortProp)) {
    const sorters = sortProp.map(item => {
      if (typeof item === 'function') return item
      if (typeof item === 'string' && !['asc', 'dec'].includes(item.toLowerCase())) return (a, b) => __baseSort(a[item], b[item], true)
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
    console.error('Invalid sort option (ignoring):', item)
    return undefined
  }
}