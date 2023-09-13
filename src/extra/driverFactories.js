'use strict'

import xs from 'xstream'

function driverFromAsync(promiseReturningFunction, opts = {}) {
  const {
    selector: selectorProperty = 'category',
    args:     functionArgs     = 'value',
    return:   returnProperty   = 'value',
    pre:      preFunction      = (val) => val,
    post:     postFunction     = (val) => val
  } = opts

  const functionName = promiseReturningFunction.name || '[anonymous function]'
  const functionArgsType = typeof functionArgs
  if (functionArgsType !== 'string' && functionArgsType !== 'function' && !(Array.isArray(functionArgs) && functionArgs.every((arg) => typeof arg === 'string'))) {
    throw new Error(`The 'args' option for driverFromAsync(${ functionName }) must be a string, array of strings, or a function.  Received ${functionArgsType}`)
  }

  if (typeof selectorProperty !== 'string') {
    throw new Error(`The 'selector' option for driverFromAsync(${ functionName }) must be a string.  Received ${typeof selectorProperty}`)
  }

  return (fromApp$) => {
    let sendFn = null

    const toApp$ = xs.create({
      start: (listener) => {
        sendFn = listener.next.bind(listener)
      },
      stop: () => {}
    })

    fromApp$.addListener({
      next: (incoming) => {
        const preProcessed = preFunction(incoming)
        let argArr = []
        if (typeof preProcessed === 'object' && preProcessed !== null) {
          if (typeof functionArgs === 'function') {
            const extractedArgs = functionArgs(preProcessed)
            argArr = Array.isArray(extractedArgs) ? extractedArgs : [extractedArgs]
          }
          if (typeof functionArgs === 'string') {
            argArr = [preProcessed[functionArgs]]
          }
          if (Array.isArray(functionArgs)) {
            argArr = functionArgs.map((arg) => preProcessed[arg])
          }
        }
        const errMsg = `Error in driver created using driverFromAsync(${ functionName })`
        promiseReturningFunction(...argArr)
          .then((innerVal) => {
            const constructReply = (rawVal) => {
              let outgoing
              if (returnProperty === undefined) {
                outgoing = rawVal
                if (typeof outgoing === 'object' && outgoing !== null) {
                  outgoing[selectorProperty] = incoming[selectorProperty]
                } else {
                  console.warn(`The 'return' option for driverFromAsync(${ functionName }) was not set, but the promise returned an non-object.  The result will be returned as-is, but the '${selectorProperty}' property will not be set, so will not be filtered by the 'select' method of the driver.`)
                }
              } else if (typeof returnProperty === 'string') {
                outgoing = {
                  [returnProperty]: rawVal,
                  [selectorProperty]: incoming[selectorProperty]
                }
              } else {
                throw new Error(`The 'return' option for driverFromAsync(${ functionName }) must be a string.  Received ${typeof returnProperty}`)
              }
              return outgoing
            }


            // handle nested promises and promises returned by postFunction
            if (typeof innerVal.then === 'function') {
              innerVal
                .then((innerOutgoing) => {
                  const processedOutgoing = postFunction(innerOutgoing, incoming)
                  if (typeof processedOutgoing.then === 'function') {
                    processedOutgoing
                      .then((innerProcessedOutgoing) => {
                        sendFn(constructReply(innerProcessedOutgoing))
                      })
                      .catch((err) => console.error(`${ errMsg }: ${ err }`))
                  } else {
                    sendFn(constructReply(rocessedOutgoing))
                  }
                })
                .catch((err) => console.error(`${ errMsg }: ${ err }`))
            } else {
              const processedOutgoing = postFunction(innerVal, incoming)
              if (typeof processedOutgoing.then === 'function') {
                processedOutgoing
                  .then((innerProcessedOutgoing) => {
                    sendFn(constructReply(innerProcessedOutgoing))
                  })
                  .catch((err) => console.error(`${ errMsg }: ${ err }`))
              } else {
                sendFn(constructReply(processedOutgoing))
              }
            }
          })
          .catch((err) => console.error(`${ errMsg }: ${ err }`))
      },
      error: (err) => {
        console.error(`Error recieved from sink stream in driver created using driverFromAsync(${ functionName }): ${ err }`)
      },
      complete: () => {
        console.warn(`Unexpected completion of sink stream to driver created using driverFromAsync(${ functionName })`)
      }
    })

    return {
      select: (selector) => {
        if (selector === undefined) return toApp$
        if (typeof selector === 'function') return toApp$.filter(selector)
        return toApp$.filter((val) => val?.[selectorProperty] === selector)
      }
    }

  }
}

export { driverFromAsync }