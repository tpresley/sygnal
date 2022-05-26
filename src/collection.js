'use strict'

import isolate from '@cycle/isolate'
import { makeCollection } from '@cycle/state'



export default function collection(component, stateLense, combineList=['DOM'], globalList=['EVENTS'], stateSourceName='STATE') {
  return (sources) => {
    const collectionOpts = {
      item:         component,
      itemKey:      state => state.id,
      itemScope:    key => key,
      channel:      stateSourceName,
      collectSinks: instances => {
        return Object.entries(sources).reduce((acc, [name, stream]) => {
          if (combineList.includes(name)) {
            acc[name] = instances.pickCombine(name)
          } else {
            acc[name] = instances.pickMerge(name)
          }
          return acc
        }, {})
      }
    }

    const isolateOpts = {[stateSourceName]: stateLense}

    globalList.forEach(global => isolateOpts[global] = null)
    combineList.forEach(combine => isolateOpts[combine] = null)

    return makeIsolatedCollection(collectionOpts, isolateOpts, sources)
  }
}

/**
 * instantiate a cycle collection and isolate
 * (makes the code for doing isolated collections more readable)
 *
 * @param {Object} collectionOpts options for the makeCollection function (see cycle/state documentation)
 * @param {String|Object} isolateOpts options for the isolate function (see cycle/isolate documentation)
 * @param {Object} sources object of cycle style sources to use for the created collection
 * @return {Object} collection of component sinks
 */
 function makeIsolatedCollection (collectionOpts, isolateOpts, sources) {
  return isolate(makeCollection(collectionOpts), isolateOpts)(sources)
}
