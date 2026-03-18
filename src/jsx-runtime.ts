import { createElement } from './pragma/index'
export { Fragment } from 'snabbdom'

export function jsx(type: any, props: any, key?: any): any {
  if (props == null) return createElement(type, null)
  const { children, ...rest } = props
  if (key !== undefined) rest.key = key
  if (children === undefined) return createElement(type, rest)
  if (Array.isArray(children)) return createElement(type, rest, ...children)
  return createElement(type, rest, children)
}

export { jsx as jsxs }
export { jsx as jsxDEV }
