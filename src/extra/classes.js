'use strict'

/**
 * return a validated and properly separated string of CSS class names from any number of strings, arrays, and objects
 *
 * @param  { ...String | Array | Object } args any number of strings or arrays with valid CSS class names, or objects where the keys are valid class names and the values evaluate to true or false
 * @return { String } list of `active` classes separated by spaces
 *
 * any `string` or `array` arguments are simply validated and appended to the result
 * `objects` will evaluate the values (which can be booleans or functions), and the keys with `thruthy` values will be validated and appended to the result
 * this function makes it easier to set dynamic classes on HTML elements
 */
export default function classes(...args) {
  return args.reduce((acc, arg) => {
    if (typeof arg === 'string' && !acc.includes(arg)) {
      acc.push(...classes_processString(arg))
    } else if (Array.isArray(arg)) {
      acc.push(...classes_processArray(arg))
    } else if (typeof arg === 'object') {
      acc.push(...classes_processObject(arg))
    }
    return acc
  }, []).join(' ')
}



/**
 * validate a string as a CSS class name
 *
 * @param {String} className CSS class name to validate
 * @return {Boolean} true if the name is a valid CSS class, false otherwise
 */
function isValidClassName (className) {
  return /^[a-zA-Z0-9-_]+$/.test(className)
}

/**
 * find and validate CSS class names in a string
 *
 * @param {String} str string containing one or more CSS class names
 * @return {Array} valid CSS classnames from the provided string
 */
function classes_processString(str) {
  if (typeof str !== 'string') throw new Error('Class name must be a string')
  return str.trim().split(' ').reduce((acc, item) => {
    if (item.trim().length === 0) return acc
    if (!isValidClassName(item)) throw new Error(`${item} is not a valid CSS class name`)
    acc.push(item)
    return acc
  }, [])
}

/**
 * find and validate CSS class names in an array of strings
 *
 * @param {Array} arr array containing one or more strings with valid CSS class names
 * @return {Array} valid CSS class names from the provided array
 */
function classes_processArray(arr) {
  return arr.map(classes_processString).flat()
}

/**
 * find and validate CSS class names in an object, and exclude keys whose value evaluates to `false`
 *
 * @param {Object} obj object with keys as CSS class names and values which if `truthy` cause the associated key to be returned
 * @return {Array} valid CSS class names from the keys of the provided object where the associated value evaluated to `true`
 *
 * the value for each key can be either a value that evaluates to a boolean or a function that returns a boolean
 * if the value is a function, it will be run and the returned value will be used
 */
function classes_processObject(obj) {
  const ret =  Object.entries(obj)
                      .filter(([key, predicate]) => (typeof predicate === 'function') ? predicate() : !!predicate)
                      .map(([key, _]) => {
                        const trimmed = key.trim()
                        if (!isValidClassName(trimmed)) throw new Error (`${trimmed} is not a valid CSS class name`)
                        return trimmed
                      })
  return ret
}
