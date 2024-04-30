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


const REQUEST_SELECTOR_METHOD = 'request'
const BOOTSTRAP_ACTION        = 'BOOTSTRAP'
const INITIALIZE_ACTION       = 'INITIALIZE'
const HYDRATE_ACTION          = 'HYDRATE'


let COMPONENT_COUNT   = 0


export const ABORT = '~#~#~ABORT~#~#~'

export default function component (opts) {
  const { name, sources, isolateOpts, stateSourceName='STATE' } = opts

  if (sources && typeof sources !== 'object') {
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

  if (typeof fixedIsolateOpts == 'object') {
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
  // request
  // model
  // context
  // response
  // view
  // children
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
  // response$
  // sendResponse$
  // children$
  // vdom$
  // currentState
  // currentContext
  // subComponentSink$
  // unmountRequest$
  // unmount()
  // _debug

  // [ INSTANTIATED STREAM OPERATOR ]
  // log

  // [ OUTPUT ]
  // sinks

  constructor({ name='NO NAME', sources, intent, request, model, context, response, view, children={}, components={}, initialState, calculated, storeCalculatedInState=true, DOMSourceName='DOM', stateSourceName='STATE', requestSourceName='HTTP', debug=false }) {
    if (!sources || typeof sources != 'object') throw new Error('Missing or invalid sources')

    this.name       = name
    this.sources    = sources
    this.intent     = intent
    this.request    = request
    this.model      = model
    this.context    = context
    this.response   = response
    this.view       = view
    this.children   = children
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

    this.initIntent$()
    this.initAction$()
    this.initResponse$()
    this.initState()
    this.initContext()
    this.initModel$()
    this.initSendResponse$()
    this.initChildren$()
    this.initSubComponentSink$()
    this.initSubComponentsRendered$()
    this.initVdom$()
    this.initSinks()

    this.sinks.__index = componentNumber

    this.log(`Instantiated`, true)
  }

  get debug() {
    return this._debug || (ENVIRONMENT.DEBUG === 'true' || ENVIRONMENT.DEBUG === true)
  }

  initIntent$() {
    if (!this.intent) {
      return
    }
    if (typeof this.intent != 'function') {
      throw new Error('Intent must be a function')
    }

    this.intent$ = this.intent(this.sources)

    if (!(this.intent$ instanceof Stream) && (typeof this.intent$ != 'object')) {
      throw new Error('Intent must return either an action$ stream or map of event streams')
    }
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
    const wrapped$   = concat(bootstrap$, action$)


    let initialApiData
    if (requestSource && typeof requestSource.select == 'function') {
      initialApiData = requestSource.select('initial')
        .flatten()
    } else {
      initialApiData = xs.never()
    }

    const hydrate$ = initialApiData.map(data => ({ type: HYDRATE_ACTION, data }))

    this.action$   = xs.merge(wrapped$, hydrate$)
      .compose(this.log(({ type }) => `<${ type }> Action triggered`))
  }

  initResponse$() {
    if (typeof this.request == 'undefined') {
      return
    } else if (typeof this.request != 'object') {
      throw new Error('The request parameter must be an object')
    }

    const router$ = this.sources[this.requestSourceName]
    const methods = Object.entries(this.request)

    const wrapped = methods.reduce((acc, [method, routes]) => {
      const _method = method.toLowerCase()
      if (typeof router$[_method] != 'function') {
        throw new Error('Invalid method in request object:', method)
      }
      const entries = Object.entries(routes)
      const mapped = entries.reduce((acc, [route, action]) => {
        const routeString = `[${_method.toUpperCase()}]:${route || 'none'}`
        const actionType = typeof action
        if (actionType === 'undefined') {
          throw new Error(`Action for '${ route }' route in request object not specified`)
        } else if (actionType !== 'string' && actionType !== 'function') {
          throw new Error(`Invalid action for '${ route }' route: expecting string or function`)
        }
        const actionString = (actionType === 'function') ? '[ FUNCTION ]' : `< ${ action } >`
        console.log(`[${ this.name }] Adding ${ this.requestSourceName } route:`, _method.toUpperCase(), `'${ route }' <${ actionString }>`)
        const route$ = router$[_method](route)
          .compose(dropRepeats((a, b) => a.id == b.id))
          .map(req => {
            if (!req || !req.id) {
              throw new Error(`No id found in request: ${ routeString }`)
            }
            try {
              const _reqId  = req.id
              const params  = req.params
              const body    = req.body
              const cookies = req.cookies
              const type    = (actionType === 'function') ? 'FUNCTION' : action
              const data    = { params, body, cookies, req }
              const obj     = { type, data: body, req, _reqId, _action: type }

              const timestamp = (new Date()).toISOString()
              const ip = req.get ? req.get('host') : '0.0.0.0'

              console.log(`${ timestamp } ${ ip } ${ req.method } ${ req.url }`)

              if (this.debug) {
                this.action$.setDebugListener({next: ({ type }) => this.log(`[${ this.name }] Action from ${ this.requestSourceName } request: <${ type }>`, true)})
              }

              if (actionType === 'function') {
                const enhancedState = this.addCalculated(this.currentState)
                const result = action(enhancedState, req)
                return xs.of({ ...obj, data: result })
              } else {
                this.action$.shamefullySendNext(obj)

                const sourceEntries = Object.entries(this.sources)
                const responses     = sourceEntries.reduce((acc, [name, source]) => {
                  if (!source || typeof source[REQUEST_SELECTOR_METHOD] != 'function') return acc
                  const selected$ = source[REQUEST_SELECTOR_METHOD](_reqId)
                  return [ ...acc, selected$ ]
                }, [])
                return xs.merge(...responses)
              }
            } catch(err) {
              console.error(err)
            }
          }).flatten()
        return [ ...acc, route$ ]
      }, [])
      const mapped$ = xs.merge(...mapped)
      return [ ...acc, mapped$ ]
    }, [])

    this.response$ = xs.merge(...wrapped)
      .compose(this.log(res => {
        if (res._action) return `[${ this.requestSourceName }] response data received for Action: <${ res._action }>`
        return `[${ this.requestSourceName }] response data received from FUNCTION`
      }))

    if (typeof this.response != 'undefined' && typeof this.response$ == 'undefined') {
      throw new Error('Cannot have a response parameter without a request parameter')
    }
  }

  initState() {
    if (this.model != undefined) {
      if (this.model[INITIALIZE_ACTION] === undefined) {
        this.model[INITIALIZE_ACTION] = {
          [this.stateSourceName]: (_, data) => ({ ...this.addCalculated(data) })
        }
      } else {
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
    const repeatChecker = (a, b) => {
      if (a === b) return true
      if (typeof a !== 'object' || typeof b !== 'object') {
        return a === b
      }
      const entriesA = Object.entries(a)
      const entriesB = Object.entries(b)
      if (entriesA.length === 0 && entriesB.length === 0) return true
      if (entriesA.length !== entriesB.length) return false
      return entriesA.every(([name, value]) => {
        return b[name] === value
      })
    }

    const state$ = this.sources[this.stateSourceName]?.stream.startWith({}).compose(dropRepeats(repeatChecker)) || xs.never()
    const parentContext$ = this.sources.__parentContext$.startWith({}).compose(dropRepeats(repeatChecker)) || xs.of({})
    if (this.context && typeof this.context !== 'object') {
      console.error(`[${this.name}] Context must be an object mapping names to values of functions: ignoring provided ${ typeof this.context }`)
    }
    this.context$ = xs.combine(state$, parentContext$)
      .map(([_, parent]) => {
        const _parent = typeof parent === 'object' ? parent : {}
        const context = typeof this.context === 'object' ? this.context : {}
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
      .compose(dropRepeats(repeatChecker))
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
    const shimmed$ = this.initialState ? concat(xs.of(initial), this.action$).compose(delay(0)) : this.action$
    const onState  = () => this.makeOnAction(shimmed$, true, this.action$)
    const onNormal = () => this.makeOnAction(this.action$, false, this.action$)


    const modelEntries = Object.entries(this.model)

    const reducers = {}

    modelEntries.forEach((entry) => {
      let [action, sinks] = entry

      if (typeof sinks === 'function') {
        sinks = { [this.stateSourceName]: sinks }
      }

      if (typeof sinks !== 'object') {
        throw new Error(`Entry for each action must be an object: ${ this.name } ${ action }`)
      }

      const sinkEntries = Object.entries(sinks)

      sinkEntries.forEach((entry) => {
        const [sink, reducer] = entry

        const isStateSink = (sink == this.stateSourceName)

        const on  = isStateSink ? onState() : onNormal()
        const on$ = on(action, reducer)

        const wrapped$ = on$
          .compose(this.log(data => {
            if (isStateSink) {
              return `<${ action }> State reducer added`
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

  initSendResponse$() {
    const responseType = typeof this.response
    if (responseType != 'function' && responseType != 'undefined') {
      throw new Error('The response parameter must be a function')
    }

    if (responseType == 'undefined') {
      if (this.response$) {
        this.response$.subscribe({
          next: this.log(({ _reqId, _action }) => `Unhandled response for request: ${ _action } ${ _reqId }`)
        })
      }
      this.sendResponse$ = xs.never()
      return
    }

    const selectable = {
      select: (actions) => {
        if (typeof actions == 'undefined') return this.response$
        if (!Array.isArray(actions)) actions = [actions]
        return this.response$.filter(({_action}) => (actions.length > 0) ? (_action === 'FUNCTION' || actions.includes(_action)) : true)
      }
    }

    const out = this.response(selectable)
    if (typeof out != 'object') {
      throw new Error('The response function must return an object')
    }

    const entries = Object.entries(out)
    const out$    = entries.reduce((acc, [command, response$]) => {
      const mapped$ = response$.map(({ _reqId, _action, data }) => {
        if (!_reqId) {
          throw new Error(`No request id found for response for: ${ command }`)
        }
        return { _reqId, _action, command, data }
      })
      return [ ...acc, mapped$ ]
    }, [])

    this.sendResponse$ = xs.merge(...out$)
      .compose(this.log(({ _reqId, _action }) => `[${ this.requestSourceName }] response sent for: <${ _action }>`))
  }

  initChildren$() {
    const initial = this.sourceNames.reduce((acc, name) => {
      if (name == this.DOMSourceName) {
        acc[name] = {}
      } else {
        acc[name] = []
      }
      return acc
    }, {})

    this.children$ = Object.entries(this.children).reduce((acc, [childName, childFactory]) => {
      const child$ = childFactory(this.sources)
      this.sourceNames.forEach(source => {
        if (source == this.DOMSourceName) {
          acc[source][childName] = child$[source]
        } else {
          acc[source].push(child$[source])
        }
      })
      return acc
    }, initial)
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
      const subComponentSink$ = this.subComponentSink$ ? this.subComponentSink$.map(sinks => sinks[name]).filter(sink => !!sink).flatten() : xs.never()
      if (name === this.stateSourceName) {
        acc[name] = xs.merge((this.model$[name] || xs.never()), subComponentSink$, this.sources[this.stateSourceName].stream.filter(_ => false), ...this.children$[name])
      } else {
        acc[name] = xs.merge((this.model$[name] || xs.never()), subComponentSink$, ...this.children$[name])
      }
      return acc
    }, {})

    this.sinks[this.DOMSourceName]     = this.vdom$
    this.sinks[this.requestSourceName] = xs.merge(this.sendResponse$ ,this.sinks[this.requestSourceName])
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
            const _reqId = action._reqId || (action.req && action.req.id)
            const _data  = _reqId ? (typeof data == 'object' ? { ...data, _reqId, _action: name } : { data, _reqId, _action: name }) : data
            // put the "next" action request at the end of the event loop so the "current" action completes first
            setTimeout(() => {
              // push the "next" action request into the action$ stream
              rootAction$.shamefullySendNext({ type, data: _data })
            }, delay)
            this.log(`<${ name }> Triggered a next() action: <${ type }> ${ delay }ms delay`, true)
          }

          let data = action.data
          if (data && data.data && data._reqId) data = data.data
          if (isStateSink) {
            return (state) => {
              const _state = this.isSubComponent ? this.currentState : state
              const enhancedState = this.addCalculated(_state)
              const newState = reducer(enhancedState, data, next, action.req)
              if (newState == ABORT) return _state
              return this.cleanupCalculated(newState)
            }
          } else {
            const enhancedState = this.addCalculated(this.currentState)
            const reduced = reducer(enhancedState, data, next, action.req)
            const type = typeof reduced
            const _reqId = action._reqId || (action.req && action.req.id)
            if (['string', 'number', 'boolean', 'function'].includes(type)) return reduced
            if (type == 'object') return { ...reduced, _reqId, _action: name }
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
      if (!this.calculated || typeof state !== 'object' || state instanceof Array) return state
      if (state === lastState) {
        return lastResult
      }
      if (typeof this.calculated !== 'object') throw new Error(`'calculated' parameter must be an object mapping calculated state field named to functions`)
      const entries = Object.entries(this.calculated)
      if (entries.length === 0) {
        lastState = state
        lastResult = state
        return state
      }
      const calculated = entries.reduce((acc, [field, fn]) => {
        if (typeof fn !== 'function') throw new Error(`Missing or invalid calculator function for calculated field '${ field }`)
        try {
          acc[field] = fn(state)
        } catch(e) {
          console.warn(`Calculated field '${ field }' threw an error during calculation: ${ e.message }`)
        }
        return acc
      }, {})

      const newState = { ...state, ...calculated, __context: this.currentContext }

      lastState = state
      lastResult = newState

      return newState
    }
  }

  cleanupCalculated(incomingState) {
    if (!incomingState || typeof incomingState !== 'object' || incomingState instanceof Array) return incomingState
    const state = this.storeCalculatedInState ? this.addCalculated(incomingState) : incomingState
    const { __props, __children, __context, ...sanitized } = state
    const copy  = { ...sanitized }
    if (!this.calculated) return copy
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
    const renderParams = { ...this.children$[this.DOMSourceName] }

    const enhancedState = state && state.isolateSource(state, { get: state => this.addCalculated(state) })
    const stateStream   = (enhancedState && enhancedState.stream) || xs.never()

    
    renderParams.state  = stateStream.compose(dropRepeats(objIsEqual))

    if (this.sources.props$) {
      renderParams.__props = this.sources.props$.compose(dropRepeats(objIsEqual))
    }

    if (this.sources.children$) {
      renderParams.__children = this.sources.children$.compose(dropRepeats(objIsEqual))
    }

    if (this.context$) {
      renderParams.__context = this.context$.compose(dropRepeats(objIsEqual))
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
          if (name === 'state') acc[this.stateSourceName] = arr[index]
          if (name === '__props') acc.props = arr[index]
          if (name === '__children') acc.children = arr[index]
          if (name === '__context') acc.context = arr[index]
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
      let newInstanceCount = 0

      const newComponents =  entries.reduce((acc, [id, el]) => {
        const data     = el.data
        const props    = data.props  || {}
        const children = el.children || []

        const isCollection = data.isCollection || false
        const isSwitchable = data.isSwitchable || false

        const addSinks = (sinks) => {
          Object.entries(sinks).map(([name, stream]) => {
            sinkArrsByType[name] ||= []
            if (name !== this.DOMSourceName) sinkArrsByType[name].push(stream)
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
    const children  = el.children || []

    const combined$ = xs.combine(this.sources[this.stateSourceName].stream.startWith(this.currentState), props$, children$)
      .map(([state, __props, __children]) => {
        return typeof state === 'object' ? { ...this.addCalculated(state), __props, __children, __context: this.currentContext } : { value: state, __props, __children, __context: this.currentContext }
      })

    const stateSource = new StateSource(combined$)
    const stateField  = props.from

    if (typeof props.sygnalFactory !== 'function' && typeof props.sygnalOptions === 'object') {
      props.sygnalFactory = component(props.sygnalOptions)
    }

    const collectionOf = props.of
    let lense
    let factory

    if (typeof collectionOf === 'function') {
      if (collectionOf.isSygnalComponent) {
        factory = collectionOf
      } else {
        const name = (typeof collectionOf.name === 'string') ? collectionOf.name : 'FUNCTION_COMPONENT'
        const view = collectionOf
        const { model, intent, context, children, components, initialState, calculated, storeCalculatedInState, DOMSourceName, stateSourceName, debug } = collectionOf
        const options = { name, view, model, intent, context, children, components, initialState, calculated, storeCalculatedInState, DOMSourceName, stateSourceName, debug }
        factory = component(options)
      }
    } else if (this.components[collectionOf]) {
      factory = this.components[collectionOf]
    } else {
      throw new Error(`[${this.name}] Invalid 'of' propery in collection: ${ collectionOf }`)
    }

    const sanitizeItems = item => {
      if (typeof item === 'object') {
        const { __props, __children, __context, ...sanitized } = item
        return sanitized
      } else {
        return item
      }
    }

    const fieldLense = {
      get: state => {
        const { __props, __children } = state
        if (!Array.isArray(state[stateField])) return []
        return state[stateField].map(item => {
          return typeof item === 'object' ? { ...item, __props, __children, __context: this.currentContext } : { value: item, __props, __children, __context: this.currentContext }
        })
      },
      set: (oldState, newState) => {
        if (this.calculated && stateField in this.calculated) {
          console.warn(`Collection sub-component of ${ this.name } attempted to update state on a calculated field '${ stateField }': Update ignored`)
          return oldState
        }
        return { ...oldState, [stateField]: newState.map(sanitizeItems) }
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
      if (typeof this.currentState === 'object') {
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
    } else if (typeof stateField === 'object') {
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

    const sources = { ...this.sources, [this.stateSourceName]: stateSource, props$, children$, __parentContext$: this.context$ }
    const sink$   = collection(factory, lense, { container: null })(sources)
    if (typeof sink$ !== 'object') {
      throw new Error('Invalid sinks returned from component factory of collection element')
    }
    return sink$
  }

  instantiateSwitchable(el, props$, children$) {
    const data      = el.data
    const props     = data.props  || {}
    const children  = el.children || []

    const combined$ = xs.combine(this.sources[this.stateSourceName].stream.startWith(this.currentState), props$, children$)
      .map(([state, __props, __children]) => {
        return typeof state === 'object' ? { ...this.addCalculated(state), __props, __children, __context: this.currentContext } : { value: state, __props, __children, __context: this.currentContext }
      })

    const stateSource  = new StateSource(combined$)
    const stateField = props.state
    let lense

    const fieldLense = {
      get: state => {
        const { __props, __children } = state
        return (typeof state[stateField] === 'object' && !(state[stateField] instanceof Array)) ? { ...state[stateField], __props, __children, __context: this.currentContext } : { value: state[stateField], __props, __children, __context: this.currentContext }
      },
      set: (oldState, newState) => {
        if (this.calculated && stateField in this.calculated) {
          console.warn(`Switchable sub-component of ${ this.name } attempted to update state on a calculated field '${ stateField }': Update ignored`)
          return oldState
        }
        if (typeof newState !== 'object' || newState instanceof Array) return { ...oldState, [stateField]: newState }
        const { __props, __children, __context, ...sanitized } = newState
        return { ...oldState, [stateField]: sanitized }
      }
    }

    const baseLense = {
      get: state => state,
      set: (oldState, newState) => {
        if (typeof newState !== 'object' || newState instanceof Array) return newState
        const { __props, __children, __context, ...sanitized } = newState
        return sanitized
      }
    }

    if (typeof stateField === 'undefined') {
      lense = baseLense
    } else if (typeof stateField === 'string') {
      lense = fieldLense
    } else if (typeof stateField === 'object') {
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
        const name = (typeof current.name === 'string') ? current.name : 'FUNCTION_COMPONENT'
        const view = current
        const { model, intent, context, children, components, initialState, calculated, storeCalculatedInState, DOMSourceName, stateSourceName, debug } = current
        const options = { name, view, model, intent, context, children, components, initialState, calculated, storeCalculatedInState, DOMSourceName, stateSourceName, debug }
        switchableComponents[key] = component(options)
      }
    })
    const sources = { ...this.sources, [this.stateSourceName]: stateSource, props$, children$, __parentContext$: this.context$ }

    const sink$ = isolate(switchable(switchableComponents, props$.map(props => props.current)), { [this.stateSourceName]: lense })(sources)

    if (typeof sink$ !== 'object') {
      throw new Error('Invalid sinks returned from component factory of switchable element')
    }

    return sink$
  }

  instantiateCustomComponent(el, props$, children$) {
    const componentName = el.sel
    const data      = el.data
    const props     = data.props  || {}
    const children  = el.children || []

    const combined$ = xs.combine(this.sources[this.stateSourceName].stream.startWith(this.currentState), props$, children$)
      .map(([state, __props, __children]) => {
        return typeof state === 'object' ? { ...this.addCalculated(state), __props, __children, __context: this.currentContext } : { value: state, __props, __children, __context: this.currentContext }
      })

    const stateSource = new StateSource(combined$)
    const stateField  = props.state

    if (typeof props.sygnalFactory !== 'function' && typeof props.sygnalOptions === 'object') {
      props.sygnalFactory = component(props.sygnalOptions)
    }

    const factory   = componentName === 'sygnal-factory' ? props.sygnalFactory : (this.components[componentName] || props.sygnalFactory)
    if (!factory) {
      if (componentName === 'sygnal-factory') throw new Error(`Component not found on element with Capitalized selector and nameless function: JSX transpilation replaces selectors starting with upper case letters with functions in-scope with the same name, Sygnal cannot see the name of the resulting component.`)
      throw new Error(`Component not found: ${ componentName }`)
    }

    let lense

    const fieldLense = {
      get: state => {
        const { __props, __children } = state
        return typeof state[stateField] === 'object' ? { ...state[stateField], __props, __children, __context: this.currentContext } : { value: state[stateField], __props, __children, __context: this.currentContext }
      },
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
      set: (oldState, newState) => {
        if (typeof newState !== 'object' || newState instanceof Array) return newState
        const { __props, __children, __context, ...sanitized } = newState
        return sanitized
      }
    }

    if (typeof stateField === 'undefined') {
      lense = baseLense
    } else if (typeof stateField === 'string') {
      lense = fieldLense
    } else if (typeof stateField === 'object') {
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

    if (typeof sink$ !== 'object') {
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
  const isComponent  = sel && (['collection', 'switchable', 'sygnal-factory', ...componentNames].includes(sel)) || typeof currentElement.data?.props?.sygnalFactory === 'function' || typeof currentElement.data?.props?.sygnalOptions === 'object'
  const props        = (currentElement.data && currentElement.data.props) || {}
  const attrs        = (currentElement.data && currentElement.data.attrs) || {}
  const children     = currentElement.children || []

  let found    = {}
  
  let id = parentId
  if (isComponent) {
    id  = getComponentIdFromElement(currentElement, depth, index, parentId)
    if (isCollection) {
      if (!props.of)                            throw new Error(`Collection element missing required 'component' property`)
      if (typeof props.of !== 'string' && typeof props.of !== 'function')         throw new Error(`Invalid 'component' property of collection element: found ${ typeof props.of } requires string or component factory function`)
      if (typeof props.of !== 'function' && !componentNames.includes(props.of))   throw new Error(`Specified component for collection not found: ${ props.of }`)
      if (typeof props.from !== 'undefined' && !(typeof props.from === 'string' || Array.isArray(props.from) || typeof props.from.get === 'function')) console.warn(`No valid array found for collection ${ typeof props.of === 'string' ? props.of : 'function component' }: no collection components will be created`, props.from)
      currentElement.data.isCollection = true
      currentElement.data.props ||= {}
    } else if (isSwitchable) {
      if (!props.of)                    throw new Error(`Switchable element missing required 'of' property`)
      if (typeof props.of !== 'object') throw new Error(`Invalid 'of' property of switchable element: found ${ typeof props.of } requires object mapping names to component factories`)
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
  const isComponent  = ['collection', 'switchable', 'sygnal-factory', ...componentNames].includes(sel) || typeof currentElement.data?.props?.sygnalFactory === 'function' || typeof currentElement.data?.props?.sygnalOptions === 'object'
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

function objIsEqual(objA, objB, maxDepth = 5, depth = 0) {
  const obj1 = sanitizeObject(objA)
  const obj2 = sanitizeObject(objB)
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
  if (typeof obj !== 'object' || obj === null) return obj
  const {state, of, from, _reqId, _action, __props, __children, __context, ...sanitized} = obj
  return sanitized
}