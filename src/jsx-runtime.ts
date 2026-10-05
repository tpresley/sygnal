// P46-Q (D188): the pragma is the core's. The build makes './pragma/index' the external 'sygnal'
// (the core entry) and keeps snabbdom external, so an app ships one copy of each; the element
// fast path is the core createElement's `.a` (the children as one array)
import { createElement } from './pragma/index'
export { Fragment } from './cycle/dom/fragment'

// G-351: a 'sygnal' without `.a` (an older core next to this runtime): createElement itself
const createTag = (createElement as any).a || ((t: any, p: any, c: any[], k: any) => {
  const { children, ...rest } = p
  if (k !== undefined) rest.key = k
  return createElement(t, rest, ...c)
})

export function jsx(type: any, props: any, key?: any): any {
  if (props == null) return createElement(type, null)
  if (typeof type == 'string') {
    const c = props.children
    return createTag(type, props, c === undefined ? [] : Array.isArray(c) ? c : [c], key)
  }
  const { children, ...rest } = props
  if (key !== undefined) rest.key = key
  if (children === undefined) return createElement(type, rest)
  if (Array.isArray(children)) return createElement(type, rest, ...children)
  return createElement(type, rest, children)
}

export { jsx as jsxs }
export { jsx as jsxDEV }
