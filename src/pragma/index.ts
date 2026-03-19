
import * as is from './is'
import * as fn from './fn'

const createTextElement = (text: any): any => !is.text(text) ? undefined : {
  text,
  sel: undefined,
  data: undefined,
  children: undefined,
  elm: undefined,
  key: undefined
}

const applySvg = (vnode: any): any => {
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
      : vnode.children.map((child: any) => applySvg(child))
    }
  )
}

const considerSvg = (vnode: any): any => !is.svg(vnode) ? vnode : applySvg(vnode)

const rewrites: Record<string, string | null> = {
  for: 'attrs',
  role: 'attrs',
  tabindex: 'attrs',
  'aria-*': 'attrs',
  key: null
}

const rewriteModules = (data: any, modules: Record<string, any>): any => fn.mapObject(data, (key: string, val: any) => {
  const inner = { [key]: val }
  if (rewrites[key] && modules[rewrites[key] as string] !== undefined) {
    return { [rewrites[key] as string]: inner }
  }
  if (rewrites[key] === null) {
    return {}
  }
  const keys = Object.keys(rewrites)
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    if (k.charAt(k.length - 1) === '*' && key.indexOf(k.slice(0, -1)) === 0 && modules[rewrites[k] as string] !== undefined) {
      return { [rewrites[k] as string]: inner }
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

const applyFocusProps = (data: any): any => {
  if (!data.props) return data
  const { autoFocus, autoSelect, ...rest } = data.props
  if (!autoFocus && !autoSelect) return data

  data.props = rest
  const existingInsert = data.hook?.insert
  data.hook = {
    ...data.hook,
    insert: (vnode: any) => {
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

const applyRefProps = (data: any, ref: any): any => {
  if (!ref) return data

  const setRef = (elm: any) => {
    if (typeof ref === 'function') {
      ref(elm)
    } else if (ref && typeof ref === 'object' && 'current' in ref) {
      ref.current = elm
    }
  }

  const existingInsert = data.hook?.insert
  const existingDestroy = data.hook?.destroy
  const existingPostpatch = data.hook?.postpatch
  data.hook = {
    ...data.hook,
    insert: (vnode: any) => {
      if (existingInsert) existingInsert(vnode)
      setRef(vnode.elm)
    },
    postpatch: (_oldVnode: any, vnode: any) => {
      if (existingPostpatch) existingPostpatch(_oldVnode, vnode)
      setRef(vnode.elm)
    },
    destroy: (vnode: any) => {
      if (existingDestroy) existingDestroy(vnode)
      setRef(null)
    },
  }
  return data
}

const sanitizeData = (data: any, modules: Record<string, any>): any => {
  const { ref, ...rest } = data
  const sanitized = applyFocusProps(rewriteModules(fn.deepifyKeys(rest, modules), modules))
  return applyRefProps(sanitized, ref)
}

const sanitizeText = (children: any[]): string | undefined => children.length > 1 || !is.text(children[0]) ? undefined : children[0].toString()

const sanitizeChildren = (children: any[]): any[] => fn.reduceDeep(children, (acc: any[], child: any) => {
  const vnode = is.vnode(child) ? child : createTextElement(child)
  acc.push(vnode)
  return acc
}
, [])

const defaultModules: Record<string, string> = {
  attrs: '',
  props: '',
  class: '',
  data: 'dataset',
  style: '',
  hook: '',
  on: ''
}

export const createElementWithModules = (modules: Record<string, any>) => {
  return (sel: any, data: any, ...children: any[]) => {
    if (typeof sel === 'undefined') {
      sel = 'UNDEFINED'
      console.error('JSX Error: Capitalized HTML element without corresponding factory function.  Components with names where the first letter is capital MUST be defined or included at the parent component\'s file scope.')
    }
    if (is.fun(sel)) {
      if (sel.name === 'Fragment') {
        return sel(data || {}, children)
      }
      data ||= {}
      if (!(sel as any).isSygnalComponent) {
        const name = (sel as any).componentName || (sel as any).label || sel.name || 'FUNCTION_COMPONENT'
        const view = sel
        const { model, intent, hmrActions, context, peers, components, initialState, isolatedState, calculated, storeCalculatedInState, DOMSourceName, stateSourceName, onError, debug, preventInstantiation } = sel as any
        if (preventInstantiation) {
          const text = sanitizeText(children)
          const sanitized = data ? sanitizeData(data, modules) : {}
          return considerSvg({
            sel: name,
            data: sanitized,
            children: typeof text !== 'undefined' ? createTextElement(text) : sanitizeChildren(children),
            text,
            elm: undefined,
            key: data ? data.key : undefined
          })
        }
        const options = { name, view, model, intent, hmrActions, context, peers, components, initialState, isolatedState, calculated, storeCalculatedInState, DOMSourceName, stateSourceName, onError, debug }
        data.sygnalOptions = options
        sel = name
      } else {
        const factory = sel
        sel = (sel as any).componentName || (sel as any).label || sel.name || 'sygnal-factory'
        data.sygnalFactory = factory
      }
    }
    const text = sanitizeText(children)
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
