
import * as is from './is'
import * as fn from './fn'

// Const fnName = (...params) => guard ? default : ...

const createTextElement = (text) => !is.text(text) ? undefined : {
  text,
  sel: undefined,
  data: undefined,
  children: undefined,
  elm: undefined,
  key: undefined
}

const applySvg = (vnode) => {
  // Skip text vnodes (sel is undefined) and nullish values
  if (!vnode || is.undefinedv(vnode.sel)) return vnode

  const data = vnode.data || {}
  const props = data.props || {}
  const propsWithoutClassName = fn.omit('className', props)
  const classAttr = props.className !== undefined ? { class: props.className } : {}
  const mergedAttrs = fn.assign({}, propsWithoutClassName, classAttr, data.attrs || {})

  return fn.assign(vnode,
    { data: fn.omit('props', fn.assign({}, data,
      { ns: 'http://www.w3.org/2000/svg', attrs: mergedAttrs }
    )) },
    // foreignObject contains HTML, not SVG — do not recurse into its children
    { children: (!Array.isArray(vnode.children) || vnode.sel === 'foreignObject')
      ? vnode.children
      : vnode.children.map((child) => applySvg(child))
    }
  )
}

const considerSvg = (vnode) => !is.svg(vnode) ? vnode : applySvg(vnode)

const rewrites = {
  for: 'attrs',
  role: 'attrs',
  tabindex: 'attrs',
  'aria-*': 'attrs',
  key: null
}

const rewriteModules = (data, modules) => fn.mapObject(data, (key, val) => {
  const inner = { [key]: val }
  if (rewrites[key] && modules[rewrites[key]] !== undefined) {
    return { [rewrites[key]]: inner }
  }
  if (rewrites[key] === null) {
    return {}
  }
  const keys = Object.keys(rewrites)
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    if (k.charAt(k.length - 1) === '*' && key.indexOf(k.slice(0, -1)) === 0 && modules[rewrites[k]] !== undefined) {
      return { [rewrites[k]]: inner }
    }
  }
  if (modules[key] !== undefined) {
    return { [modules[key] ? modules[key] : key]: val }
  }
  if (modules.props !== undefined) {
    return { props: inner }
  }
  return inner
})

const applyFocusProps = (data) => {
  if (!data.props) return data
  const { autoFocus, autoSelect, ...rest } = data.props
  if (!autoFocus && !autoSelect) return data

  data.props = rest
  const existingInsert = data.hook?.insert
  data.hook = {
    ...data.hook,
    insert: (vnode) => {
      if (existingInsert) existingInsert(vnode)
      if (vnode.elm && typeof vnode.elm.focus === 'function') {
        vnode.elm.focus()
        if (autoSelect && typeof vnode.elm.select === 'function') {
          vnode.elm.select()
        }
      }
    },
  }
  return data
}

const sanitizeData = (data, modules) => applyFocusProps(rewriteModules(fn.deepifyKeys(data, modules), modules))

const sanitizeText = (children) => children.length > 1 || !is.text(children[0]) ? undefined : children[0].toString()

const sanitizeChildren = (children) => fn.reduceDeep(children, (acc, child) => {
  const vnode = is.vnode(child) ? child : createTextElement(child)
  acc.push(vnode)
  return acc
}
, [])

const defaultModules = {
  attrs: '',
  props: '',
  class: '',
  data: 'dataset',
  style: '',
  hook: '',
  on: ''
}

export const createElementWithModules = (modules) => {
  return (sel, data, ...children) => {
    if (typeof sel === 'undefined') {
      sel = 'UNDEFINED'
      console.error('JSX Error: Capitalized HTML element without corresponding factory function.  Components with names where the first letter is capital MUST be defined or included at the parent component\'s file scope.')
    }
    if (is.fun(sel)) {
      if (sel.name === 'Fragment') {
        return sel(data || {}, children)
      }
      data ||= {}
      if (!sel.isSygnalComponent) {
        const name = sel.componentName || sel.label || sel.name || 'FUNCTION_COMPONENT'
        const view = sel
        const { model, intent, hmrActions, context, peers, components, initialState, calculated, storeCalculatedInState, DOMSourceName, stateSourceName, debug, preventInstantiation } = sel
        if (preventInstantiation) {
          const text = sanitizeText(children, modules)
          return considerSvg({
            sel: name,
            data: data ? sanitizeData(data, modules) : {},
            children: typeof text !== 'undefined' ? createTextElement(text) : sanitizeChildren(children),
            text,
            elm: undefined,
            key: data ? data.key : undefined
          })
        }
        const options = { name, view, model, intent, hmrActions, context, peers, components, initialState, calculated, storeCalculatedInState, DOMSourceName, stateSourceName, debug }
        data.sygnalOptions = options
        sel = name
      } else {
        const factory = sel
        sel = sel.componentName || sel.label || sel.name || 'sygnal-factory'
        data.sygnalFactory = factory
      }
    }
    const text = sanitizeText(children, modules)
    return considerSvg({
      sel,
      data: data ? sanitizeData(data, modules) : {},
      children: typeof text !== 'undefined' ? createTextElement(text) : sanitizeChildren(children),
      text,
      elm: undefined,
      key: data ? data.key : undefined
    })
  }
}

export const createElement = createElementWithModules(defaultModules)

export default {
  createElement,
  createElementWithModules
}
