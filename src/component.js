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


// import syntax has bugs for xstream in Node context
// this attempts to normalize to work in both Node and browser
// if (!xs.never && xs.default && xs.default.never) {
//   xs.never = xs.default.never
//   xs.merge = xs.default.merge
//   xs.of    = xs.default.of
// }
// const concat = (Concat && Concat.default) ? Concat.default : Concat
// const delay  = (Delay && Delay.default) ? Delay.default : Delay
// const dropRepeats = (DropRepeats && DropRepeats.default) ? DropRepeats.default : DropRepeats

const ENVIRONMENT = ((typeof window != 'undefined' && window) || (process && process.env)) || {}


const REQUEST_SELECTOR_METHOD = 'request'
const BOOTSTRAP_ACTION        = 'BOOTSTRAP'
const INITIALIZE_ACTION       = 'INITIALIZE'
const HYDRATE_ACTION          = 'HYDRATE'


let IS_ROOT_COMPONENT = true


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

  if (typeof fixedIsolateOpts == 'object') {
    const wrapped = (sources) => {
      const fixedOpts = { ...opts, sources }
      return (new Component(fixedOpts)).sinks
    }
    return currySources ? isolate(wrapped, fixedIsolateOpts) : isolate(wrapped, fixedIsolateOpts)(sources)
  } else {
    return currySources ? (sources) => (new Component({ ...opts, sources })).sinks : (new Component(opts)).sinks
  }
}





class Component {
  // [ PASSED PARAMETERS ]
  // name
  // sources
  // intent
  // request
  // model
  // response
  // view
  // children
  // initialState
  // calculated
  // storeCalculatedInState
  // DOMSourceName
  // stateSourceName
  // requestSourceName

  // [ PRIVATE / CALCULATED VALUES ]
  // sourceNames
  // intent$
  // action$
  // model$
  // response$
  // sendResponse$
  // children$
  // vdom$
  // subComponentSink$

  // [ INSTANTIATED STREAM OPERATOR ]
  // log

  // [ OUTPUT ]
  // sinks

  constructor({ name='NO NAME', sources, intent, request, model, response, view, children={}, components={}, initialState, calculated, storeCalculatedInState=true, DOMSourceName='DOM', stateSourceName='STATE', requestSourceName='HTTP' }) {
    if (!sources || typeof sources != 'object') throw new Error('Missing or invalid sources')

    this.name       = name
    this.sources    = sources
    this.intent     = intent
    this.request    = request
    this.model      = model
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

    this.isSubComponent = this.sourceNames.includes('props$')

    const state$ = sources[stateSourceName] && sources[stateSourceName].stream

    if (state$) {
      this.currentState = initialState || {}
      this.sources[this.stateSourceName] = new StateSource(state$.map(val => {
        this.currentState = val
        return val
      }))
    }

    if (IS_ROOT_COMPONENT && typeof this.intent === 'undefined' && typeof this.model === 'undefined') {
      this.initialState = initialState || true
      this.intent = _ => ({__NOOP_ACTION__:xs.never()})
      this.model = {
        __NOOP_ACTION__: state => state
      }
    }
    IS_ROOT_COMPONENT = false

    this.log = makeLog(name)

    this.initIntent$()
    this.initAction$()
    this.initResponse$()
    this.initState()
    this.initModel$()
    this.initSendResponse$()
    this.initChildren$()
    this.initSubComponentSink$()
    this.initVdom$()
    this.initSinks()
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

    const action$  = ((runner instanceof Stream) ? runner : (runner.apply && runner(this.sources) || xs.never()))
    const wrapped$ = concat(xs.of({ type: BOOTSTRAP_ACTION }), action$)
      .compose(delay(10))

    let initialApiData
    if (requestSource && typeof requestSource.select == 'function') {
      initialApiData = requestSource.select('initial')
        .flatten()
    } else {
      initialApiData = xs.never()
    }

    const hydrate$ = initialApiData.map(data => ({ type: HYDRATE_ACTION, data }))

    this.action$   = xs.merge(wrapped$, hydrate$)
      .compose(this.log(({ type }) => `Action triggered: <${ type }>`))
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

              if (ENVIRONMENT.DEBUG) {
                this.action$.setDebugListener({next: ({ type }) => console.log(`[${ this.name }] Action from ${ this.requestSourceName } request: <${ type }>`)})
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

  initModel$() {
    if (typeof this.model == 'undefined') {
      this.model$ = this.sourceNames.reduce((a,s) => {
        a[s] = xs.never()
        return a
      }, {})
      return
    }

    const initial  = { type: INITIALIZE_ACTION, data: this.initialState }
    const shimmed$ = this.initialState ? concat(xs.of(initial), this.action$).compose(delay(0)) : this.action$
    const onState  = this.makeOnAction(shimmed$, true, this.action$)
    const onNormal = this.makeOnAction(this.action$, false, this.action$)


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

        const on = isStateSink ? onState : onNormal
        const onned = on(action, reducer)

        const wrapped = onned.compose(this.log(data => {
            if (isStateSink) {
              return `State reducer added: <${ action }>`
            } else {
              const extra = data && (data.type || data.command || data.name || data.key || (Array.isArray(data) && 'Array') || data)
              return `Data sent to [${ sink }]: <${ action }> ${ extra }`
            }
          }))

        if (Array.isArray(reducers[sink])) {
          reducers[sink].push(wrapped)
        } else {
          reducers[sink] = [wrapped]
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

  initVdom$() {
    if (typeof this.view != 'function') {
      this.vdom$ = xs.of(null)
      return
    }

    const state        = this.sources[this.stateSourceName]
    const renderParams = { ...this.children$[this.DOMSourceName] }

    const enhancedState = state && state.isolateSource(state, { get: state => this.addCalculated(state) })
    const stateStream   = (enhancedState && enhancedState.stream) || xs.never()

    renderParams.state                 = stateStream
    renderParams[this.stateSourceName] = stateStream

    if (this.sources.props$) {
      renderParams.props = this.sources.props$
    }

    if (this.sources.children$) {
      renderParams.children = this.sources.children$
    }

    const pulled = Object.entries(renderParams).reduce((acc, [name, stream]) => {
      acc.names.push(name)
      acc.streams.push(stream)
      return acc
    }, {names: [], streams: []})

    const merged = xs.combine(...pulled.streams)

    const throttled = merged
      .compose(debounce(5))
      .map(arr => {
        return pulled.names.reduce((acc, name, index) => {
          acc[name] = arr[index]
          return acc
        }, {})
      })

    const componentNames = Object.keys(this.components)

    const subComponentRenderedProxy$ = xs.create()
    const vDom$ = throttled.map((params) => params).map(this.view).map(vDom => vDom || { sel: 'div', data: {}, children: [] })


    const componentInstances$ = vDom$
      .fold((previousComponents, vDom) => {
        const foundComponents = getComponents(vDom, componentNames)
        const entries = Object.entries(foundComponents)

        const rootEntry = { '::ROOT::': vDom }

        if (entries.length === 0) {
          return rootEntry
        }

        const sinkArrsByType = {}

        const newComponents =  entries.reduce((acc, [id, el]) => {
          const componentName = el.sel
          const data  = el.data
          const props = data.props || {}
          const children = el.children || []
          const isCollection = data.isCollection || false
          const isSwitchable = data.isSwitchable || false

          if (previousComponents[id]) {
            const entry = previousComponents[id]
            acc[id] = entry
            entry.props$.shamefullySendNext(props)
            entry.children$.shamefullySendNext(children)
            return acc
          }

          const factory   = componentName === 'sygnal-factory' ? props.sygnalFactory : (this.components[componentName] || props.sygnalFactory)
          if (!factory && !isCollection && !isSwitchable) {
            if (componentName === 'sygnal-factory') throw new Error(`Component not found on element with Capitalized selector and nameless function: JSX transpilation replaces selectors starting with upper case letters with functions in-scope with the same name, Sygnal cannot see the name of the resulting component.`)
            throw new Error(`Component not found: ${ componentName }`)
          }

          const props$    = xs.create().startWith(props)
          const children$ = xs.create().startWith(children)
          let stateSource = new StateSource(this.sources[this.stateSourceName].stream.startWith(this.currentState))
          let sink$
          let preventStateUpdates = true

          if (isCollection) {
            let field, lense

            const stateGetter = state => {
              const arr = state[field]
              if (typeof arr === 'undefined') return
              if (!Array.isArray(arr)) {
                const label = typeof data.props.of === 'string' ? data.props.of : 'components'
                console.warn(`Collection of ${ label } does not have a valid array in the 'for' property: expects either an array or a string of the name of an array property on the state`)
                return []
              }
              return arr
            }

            if (typeof props.for === 'undefined') {
              lense = {
                get: state => {
                  if (!Array.isArray(state)) {
                    console.warn(`Collection sub-component of ${ this.name } has no 'for' attribute and the parent state is not an array: Provide a 'for' attribute with either an array or the name of a state property containing an array`)
                    return []
                  }
                  return state
                },
                set: (oldState, newState) => newState
              }
              preventStateUpdates = false
            } else if (typeof props.for === 'string') {
              field  = props.for
              lense = {
                get: stateGetter,
                set: (state, arr) => {
                  if (this.calculated && field in this.calculated) {
                    console.warn(`Collection sub-component of ${ this.name } attempted to update state on a calculated field '${ field }': Update ignored`)
                    return state
                  }
                  return { ...state, [field]: arr }
                }
              }
              preventStateUpdates = false
            } else {
              field  = 'for'
              stateSource = new StateSource(props$.remember())
              lense = {
                get: stateGetter,
                set: (state, arr) => state
              }
            }
            const sources   = { ...this.sources, [this.stateSourceName]: stateSource, props$, children$ }
            const factory   = typeof data.props.of === 'function' ? data.props.of : this.components[data.props.of]
            sink$ = collection(factory, lense, { container: null })(sources)
            if (typeof sink$ !== 'object') {
              throw new Error('Invalid sinks returned from component factory of collection element')
            }
          } else if (isSwitchable) {
            const stateField = data.props.state
            let isolateSwitchable = false
            let lense
            if (typeof stateField === 'string') {
              isolateSwitchable = true
              lense = {
                get: state => {
                  return state[stateField]
                },
                set: (oldState, newState) => {
                  if (this.calculated && stateField in this.calculated) {
                    console.warn(`Switchable sub-component of ${ this.name } attempted to update state on a calculated field '${ stateField }': Update ignored`)
                    return oldState
                  }
                  return { ...oldState, [stateField]: newState }
                }
              }
              preventStateUpdates = false
            } else if (typeof stateField === 'undefined') {
              isolateSwitchable = true
              lense = {
                get: state => state,
                set: (oldState, newState) => newState
              }
              preventStateUpdates = false
            } else if (typeof stateField === 'object') {
              stateSource = new StateSource(props$.map(props => props.state))
            } else {
              throw new Error(`Invalid state provided to collection sub-component of ${ this.name }: Expecting string, object, or none, but found ${ typeof stateField }`)
            }
            const switchableComponents = data.props.of
            const sources = { ...this.sources, [this.stateSourceName]: stateSource, props$, children$ }
            if (isolateSwitchable) {
              sink$ = isolate(switchable(switchableComponents, props$.map(props => props.current)), { [this.stateSourceName]: lense })(sources)
            } else {
              sink$ = switchable(switchableComponents, props$.map(props => props.current))(sources)
            }
            if (typeof sink$ !== 'object') {
              throw new Error('Invalid sinks returned from component factory of switchable element')
            }
          } else {
            const { state: stateProp, sygnalFactory, id, ...sanitizedProps } = props
            if (typeof stateProp === 'undefined' && (typeof sanitizedProps !== 'object' || Object.keys(sanitizedProps).length === 0)) {
              const sources = { ...this.sources, [this.stateSourceName]: stateSource, props$: xs.never().startWith(null), children$ }
              sink$ = factory(sources)
              preventStateUpdates = false
            } else {
              const lense = (props) => {
                const state = props.state
                if (typeof state === 'undefined') return props
                if (typeof state !== 'object')    return state

                const copy = { ...props }
                delete copy.state
                return { ...copy, ...state }
              }
              stateSource = new StateSource(props$.map(lense))
              const sources   = { ...this.sources, [this.stateSourceName]: stateSource, props$, children$ }
              sink$ = factory(sources)
            }
            if (typeof sink$ !== 'object') {
              const name = componentName === 'sygnal-factory' ? 'custom element' : componentName
              throw new Error('Invalid sinks returned from component factory:', name)
            }
          }

          if (preventStateUpdates) {
            const originalStateSink = sink$[this.stateSourceName]
            sink$[this.stateSourceName] = originalStateSink.filter(state => {
              console.warn('State update attempt from component with inderect link to state: Components with state set through HTML properties/attributes cannot update application state directly')
              return false
            })
          }

          const originalDOMSink = sink$[this.DOMSourceName].remember()
          const repeatChecker = (a, b) => {
            const aa = JSON.stringify(a)
            const bb = JSON.stringify(b)
            return aa === bb
          }
          sink$[this.DOMSourceName] = stateSource.stream.compose(dropRepeats(repeatChecker)).map(state => {
            subComponentRenderedProxy$.shamefullySendNext(null)
            return originalDOMSink
          }).compose(debounce(10)).flatten().remember()
          acc[id] = { sink$, props$, children$ }

          Object.entries(sink$).map(([name, stream]) => {
            sinkArrsByType[name] ||= []
            if (name !== this.DOMSourceName) sinkArrsByType[name].push(stream)
          })

          return acc
        }, rootEntry)

        const mergedSinksByType = Object.entries(sinkArrsByType).reduce((acc, [name, streamArr]) => {
          if (streamArr.length === 0) return acc
          acc[name] = streamArr.length === 1 ? streamArr[0] : xs.merge(...streamArr)
          return acc
        }, {})

        this.newSubComponentSinks(mergedSinksByType)

        // subComponentRenderedProxy$.shamefullySendNext(null)
        return newComponents
      }, {})


    this.vdom$ = xs.combine(subComponentRenderedProxy$.startWith(null), componentInstances$).map(([_, components]) => {

        const root  = components['::ROOT::']
        let ids = []
        const entries = Object.entries(components).filter(([id]) => id !== '::ROOT::')

        if (entries.length === 0) {
          return xs.of(root)
        }

        const vdom$ = entries
          .map(([id, val]) => {
            ids.push(id)
            return val.sink$[this.DOMSourceName].startWith(undefined)
          })

        if (vdom$.length === 0) return xs.of(root)

        return xs.combine(...vdom$).compose(debounce(5)).map(vdoms => {
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
      .compose(debounce(5))
      .remember()
      .compose(this.log('View Rendered'))
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
          const next = (type, data) => {
            const _reqId = action._reqId || (action.req && action.req.id)
            const _data  = _reqId ? (typeof data == 'object' ? { ...data, _reqId, _action: name } : { data, _reqId, _action: name }) : data
            // put the "next" action request at the end of the event loop so the "current" action completes first
            setTimeout(() => {
              // push the "next" action request into the action$ stream
              rootAction$.shamefullySendNext({ type, data: _data })
            }, 10)
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

  addCalculated(state) {
    if (!this.calculated || typeof state !== 'object') return state
    if (typeof this.calculated !== 'object') throw new Error(`'calculated' parameter must be an object mapping calculated state field named to functions`)
    const entries = Object.entries(this.calculated)
    const calculated = entries.reduce((acc, [field, fn]) => {
      if (typeof fn !== 'function') throw new Error(`Missing or invalid calculator function for calculated field '${ field }`)
      try {
        acc[field] = fn(state)
      } catch(e) {
        console.warn(`Calculated field '${ field }' threw an error during calculation: ${ e.message }`)
      }
      return acc
    }, {})
    return { ...state, ...calculated }
  }

  cleanupCalculated(state) {
    if (this.storeCalculatedInState) return this.addCalculated(state)
    if (!this.calculated || !state || typeof state !== 'object') return state
    const keys = Object.keys(this.calculated)
    const copy = { ...state }
    keys.forEach(key => {
      if (this.initialState && typeof this.initialState[key] !== 'undefined') {
        copy[key] = this.initialState[key]
      } else {
        delete copy[key]
      }
    })
    return copy
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
  return function (msg) {
    const fixedMsg = (typeof msg === 'function') ? msg : _ => msg
    return stream => {
      return stream.debug(msg => {
        if (ENVIRONMENT.DEBUG == 'true' || ENVIRONMENT.DEBUG === true) {
          console.log(`[${context}] ${fixedMsg(msg)}`)
        }
      })
    }
  }
}



function getComponents(currentElement, componentNames, depth=0, index=0) {
  if (!currentElement) return {}

  if (currentElement.data?.componentsProcessed) return {}
  if (depth === 0) currentElement.data.componentsProcessed = true

  const sel          = currentElement.sel
  const isCollection = sel && sel.toLowerCase() === 'collection'
  const isSwitchable = sel && sel.toLowerCase() === 'switchable'
  const isComponent  = sel && (['collection', 'switchable', 'sygnal-factory', ...componentNames].includes(currentElement.sel)) || typeof currentElement.data?.props?.sygnalFactory === 'function'
  const props        = (currentElement.data && currentElement.data.props) || {}
  const attrs        = (currentElement.data && currentElement.data.attrs) || {}
  const children     = currentElement.children || []

  let found    = {}

  if (isComponent) {
    const id  = getComponentIdFromElement(currentElement, depth, index)
    if (isCollection) {
      if (!props.of)                            throw new Error(`Collection element missing required 'component' property`)
      if (typeof props.of !== 'string' && typeof props.of !== 'function')         throw new Error(`Invalid 'component' property of collection element: found ${ typeof props.of } requires string or component factory function`)
      if (typeof props.of !== 'function' && !componentNames.includes(props.of))   throw new Error(`Specified component for collection not found: ${ props.of }`)
      if (typeof attrs.for !== 'undefined' && !(typeof attrs.for === 'string' || Array.isArray(attrs.for))) console.warn(`No valid array found in the 'value' property of collection ${ typeof props.of === 'string' ? props.of : 'function component' }: no collection components will be created`)
      currentElement.data.isCollection = true
      currentElement.data.props ||= {}
      currentElement.data.props.for = attrs.for
      currentElement.data.attrs = undefined
    } else if (isSwitchable) {
      if (!props.of)                    throw new Error(`Switchable element missing required 'of' property`)
      if (typeof props.of !== 'object') throw new Error(`Invalid 'components' property of switchable element: found ${ typeof props.of } requires object mapping names to component factories`)
      const switchableComponents = Object.values(props.of)
      if (!switchableComponents.every(comp => typeof comp === 'function')) throw new Error(`One or more components provided to switchable element is not a valid component factory`)
      if (!props.current || (typeof props.current !== 'string' && typeof props.current !== 'function')) throw new Error(`Missing or invalid 'current' property for switchable element: found '${ typeof props.current }' requires string or function`)
      const switchableComponentNames = Object.keys(props.of)
      if (!switchableComponentNames.includes(props.current)) throw new Error(`Component '${ props.current }' not found in switchable element`)
      currentElement.data.isSwitchable = true
    } else {

    }
    found[id] = currentElement
  }

  if (children.length > 0) {
    children.map((child, i) => getComponents(child, componentNames, depth + 1, i))
            .forEach((child) => {
              Object.entries(child).forEach(([id, el]) => found[id] = el)
            })
  }

  return found
}

function injectComponents(currentElement, components, componentNames, depth=0, index) {
  if (!currentElement) return
  if (currentElement.data?.componentsInjected) return currentElement
  if (depth === 0 && currentElement.data) currentElement.data.componentsInjected = true


  const sel          = currentElement.sel || 'NO SELECTOR'
  const isComponent  = ['collection', 'switchable', 'sygnal-factory', ...componentNames].includes(sel) || typeof currentElement.data?.props?.sygnalFactory === 'function'
  const isCollection = currentElement?.data?.isCollection
  const isSwitchable = currentElement?.data?.isSwitchable
  const props        = (currentElement.data && currentElement.data.props) || {}
  const children     = currentElement.children || []

  if (isComponent) {
    const id  = getComponentIdFromElement(currentElement, depth, index)
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
    currentElement.children = children.map((child, i) => injectComponents(child, components, componentNames, depth + 1, i)).flat()
    return currentElement
  } else {
    return currentElement
  }
}

const selMap = new Map()
function getComponentIdFromElement(el, depth, index) {
  const sel  = el.sel
  const name = typeof sel === 'string' ? sel : 'functionComponent'
  let base = selMap.get(sel)
  if (!base) {
    const date = Date.now()
    const rand = Math.floor(Math.random() * 10000)
    base = `${date}-${rand}`
    selMap.set(sel, base)
  }
  const uid = `${base}-${depth}-${index}`
  const props   = (el.data && el.data.props) || {}
  const id      = (props.id && JSON.stringify(props.id)) || uid
  const fullId = `${ name }::${ id }`
  return fullId
}


function deepCopyVdom(obj) {
  if (typeof obj === 'undefined') return obj
  return { ...obj, children: Array.isArray(obj.children) ? obj.children.map(deepCopyVdom) : undefined, data: obj.data && { ...obj.data, componentsInjected: false } }
}