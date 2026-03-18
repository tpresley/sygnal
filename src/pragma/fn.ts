// TODO: stop using extend here
// @ts-ignore — no type declarations for 'extend'
import _extend from 'extend'

import * as is from './is'

export const extend = (...objs: any[]): any => _extend(true, ...objs)

export const assign = (...objs: any[]): any => _extend(false, ...objs)

export const reduceDeep = <T>(arr: any[], fn: (acc: T, value: any) => T, initial: T): T => {
  let result = initial
  for (let i = 0; i < arr.length; i++) {
    const value = arr[i]
    if (is.array(value)) {
      result = reduceDeep(value, fn, result)
    } else {
      result = fn(result, value)
    }
  }
  return result
}

export const mapObject = (obj: Record<string, any>, fn: (key: string, val: any) => any): any => Object.keys(obj).map(
  (key) => fn(key, obj[key])
).reduce(
  (acc: any, curr: any) => extend(acc, curr),
  {}
)

export const deepifyKeys = (obj: Record<string, any>, modules: Record<string, any>): any => mapObject(obj,
  (key: string, val: any) => {
    const dashIndex = key.indexOf('-')
    if (dashIndex > -1 && modules[key.slice(0, dashIndex)] !== undefined) {
      const moduleData = {
        [key.slice(dashIndex + 1)]: val
      }
      return {
        [key.slice(0, dashIndex)]: moduleData
      }
    }
    return { [key]: val }
  }
)

export const flatifyKeys = (obj: Record<string, any>): any => mapObject(obj,
  (mod: string, data: any) => !is.object(data) ? ({ [mod]: data }) : mapObject(
    flatifyKeys(data),
    (key: string, val: any) => ({ [`${mod}-${key}`]: val })
  )
)

export const omit = (key: string, obj: Record<string, any>): any => mapObject(obj,
  (mod: string, data: any) => mod !== key ? ({ [mod]: data }) : {}
)
