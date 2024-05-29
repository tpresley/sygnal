'use strict'

import { default as xs, Stream } from 'xstream'
import dropRepeats from 'xstream/extra/dropRepeats'
import { h } from '@cycle/dom'



export default function switchable(factories, name$, initial, opts={}) {
  const {
    switched=['DOM'],
    stateSourceName='STATE'
  } = opts
  const nameType     = typeof name$

  if (!name$) throw new Error(`Missing 'name$' parameter for switchable()`)
  if (!(nameType === 'string' || nameType === 'function' || name$ instanceof Stream)) {
    throw new Error(`Invalid 'name$' parameter for switchable(): expects Stream, String, or Function`)
  }

  if (name$ instanceof Stream) {
    const withInitial$ = name$
      .compose(dropRepeats())
      .startWith(initial)
      .remember()
    return sources => _switchable(factories, sources, withInitial$, switched)
  } else {
    const mapFunction = (nameType === 'function' && name$) || (state => state[name$])
    return sources => {
      const state$ = sources && ((typeof stateSourceName === 'string' && sources[stateSourceName]) || sources.STATE || sources.state).stream
      if (!state$ instanceof Stream) throw new Error(`Could not find the state source: ${ stateSourceName }`)
      const _name$ = state$
        .map(mapFunction)
        .filter(name => typeof name === 'string')
        .compose(dropRepeats())
        .startWith(initial)
        .remember()
      return _switchable(factories, sources, _name$, switched, stateSourceName)
    }
  }
}



/**
 * create a group of components which can be switched between based on a stream of component names
 *
 * @param {Object} factories maps names to component creation functions
 * @param {Object} sources standard cycle sources object provided to each component
 * @param {Observable} name$ stream of names corresponding to the component names
 * @param {Array} switched which cycle sinks from the components should be `switched` when a new `name$` is emitted
 * @return {Object} cycle sinks object where the selected sinks are switched to the last component name emitted to `name$`
 *
 * any component sinks not dsignated in `switched` will be merged across all components
 */
function _switchable (factories, sources, name$, switched=['DOM'], stateSourceName='STATE') {
  if (typeof switched === 'string') switched = [switched]

  const sinks = Object.entries(factories)
    .map(([name, factory]) => {
      if (sources[stateSourceName]) {
        const state$ = sources[stateSourceName].stream
        const switched = xs.combine(name$, state$)
                           .filter(([newComponentName, _]) => newComponentName == name)
                           .map(([_, state]) => state)
                           .remember()

        const state = new sources[stateSourceName].constructor(switched, sources[stateSourceName]._name)
        return [name, factory({ ...sources, state })]
      }
      return [name, factory(sources)]
    })

  const switchedSinks = Object.keys(sources)
    .reduce((obj, sinkName) => {
      if (switched.includes(sinkName)) {
        obj[sinkName] = name$
          .map( newComponentName => {
            const sink = sinks.find(([componentName, _]) => componentName === newComponentName)
            return (sink && sink[1][sinkName]) || xs.never()
          })
          .flatten()
          .remember()
          .startWith(undefined)
      } else {
        const definedSinks = sinks.filter(([_,sink]) => sink[sinkName] !== undefined)
                                  .map(([_,sink]) => sink[sinkName])
        obj[sinkName] = xs.merge(...definedSinks)
      }
      return obj
    }, {})

  return switchedSinks
}

const Switchable = (props) => {
  const { children, ...sanitizedProps } = props
  return h('switchable', { props: sanitizedProps }, children)
}
Switchable.label = 'switchable'
Switchable.preventInstantiation = true;

export { Switchable }