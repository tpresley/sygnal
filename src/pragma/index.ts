
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

// Adds snabbdom hooks to data.hook; a hook already there runs first
const chainHooks = (data: any, hooks: Record<string, (...args: any[]) => void>): any => {
  const existing = data.hook || {}
  const hook = { ...existing }
  for (const name in hooks) {
    hook[name] = (...args: any[]) => {
      if (existing[name]) existing[name](...args)
      hooks[name](...args)
    }
  }
  data.hook = hook
  return data
}

const applyFocusProps = (data: any): any => {
  if (!data.props) return data
  const { autoFocus, autoSelect, ...rest } = data.props
  if (!autoFocus && !autoSelect) return data

  data.props = rest
  data._autoFocus = !!autoFocus
  data._autoSelect = !!autoSelect

  const doFocus = (elm: any) => {
    if (elm && typeof elm.focus === 'function') {
      requestAnimationFrame(() => {
        elm.focus()
        if (autoSelect && typeof elm.select === 'function') {
          elm.select()
        }
      })
    }
  }

  return chainHooks(data, {
    insert: (vnode: any) => doFocus(vnode.elm),
    postpatch: (oldVnode: any, vnode: any) => {
      const wasFocused = oldVnode.data?._autoFocus
      const isFocused = vnode.data?._autoFocus
      if (!wasFocused && isFocused) doFocus(vnode.elm)
    },
  })
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

  return chainHooks(data, {
    insert: (vnode: any) => setRef(vnode.elm),
    postpatch: (_oldVnode: any, vnode: any) => setRef(vnode.elm),
    destroy: () => setRef(null),
  })
}

// B-014: snabbdom's classModule wants a { name: boolean } map. A string ("a b") or an
// array (['a', cond && 'b']) would be iterated by index, adding the classes "0", "1", ...
// G-096: clsx-style: strings, nested arrays, objects (truthy keys); falsy entries skipped
const addClasses = (map: Record<string, boolean>, klass: any): any => {
  if (klass && typeof klass === 'object') for (const k in klass) Array.isArray(klass) ? addClasses(map, klass[k as any]) : klass[k] && addClasses(map, k)
  else if (klass) for (const name of String(klass).split(/\s+/)) if (name) map[name] = true
  return map
}

const toClassMap = (klass: any): any =>
  typeof klass !== 'string' && !Array.isArray(klass) ? klass : addClasses({}, klass)

const sanitizeData = (data: any, modules: Record<string, any>): any => {
  const { ref, ...rest } = data
  if (modules.class !== undefined && 'class' in rest) rest.class = toClassMap(rest.class)
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
  const ce = (sel: any, data: any, ...children: any[]): any => {
    if (typeof sel === 'undefined') {
      sel = 'UNDEFINED'
      // The JSX runtime entries bundle this file standalone and must not carry a second
      // diagnostics core, so it goes through the core's bridge (G-044: collected like the
      // other codes), or, without a core, prints the same pre-formatted text.
      const msg = 'A JSX tag is undefined, so <UNDEFINED> is rendered instead', fix = 'Import or define the component in this file'
      const core = (globalThis as any).__SYGNAL_DIAGNOSTICS__
      if (core && core.error) core.error('SYG420', 'JSX', msg, fix)
      else console.error(`[Sygnal SYG420] JSX: ${msg}. ${fix}. https://sygnal.js.org/reference/errors#syg420`)
    }
    // CT-1: a control (src/extra/controls.ts) renders its element itself and stamps its marker.
    // It gets this createElement: the JSX runtime entries carry their own copy of the pragma.
    if (sel?.__sygnalControl) return sel.__sygnalControl(data, children, ce)
    const isComponent = is.fun(sel)
    if (isComponent) {
      if ((sel as any).__sygnalFragment || sel.name === 'Fragment') {
        return sel(data || {}, children)
      }
      data ||= {}
      if (!(sel as any).isSygnalComponent) {
        const name = (sel as any).componentName || (sel as any).label || sel.name || 'FUNCTION_COMPONENT'
        const view = sel
        const { model, intent, hmrActions, context, peers, components, initialState, isolatedState, calculated, storeCalculatedInState, DOMSourceName, stateSourceName, onError, debug, preventInstantiation } = sel as any
        // preventInstantiation (Portal/Suspense/...): a marker vnode without sygnalOptions; its
        // children stay an array (they read vnode.children), as for every component below
        if (!preventInstantiation) {
          data.sygnalOptions = { name, view, model, intent, hmrActions, context, peers, components, initialState, isolatedState, calculated, storeCalculatedInState, DOMSourceName, stateSourceName, onError, debug }
        }
        sel = name
      } else {
        const factory = sel
        sel = (sel as any).componentName || (sel as any).label || sel.name || 'sygnal-factory'
        data.sygnalFactory = factory
      }
    }
    // B-011: a vnode is either text-only (`text`, no children) or has a children array,
    // never both; snabbdom's diff mishandles a vnode with both. A component placeholder
    // keeps an array so the component receives its text child via `children`.
    const text = isComponent ? undefined : sanitizeText(children)
    return considerSvg({
      sel,
      data: data ? sanitizeData(data, modules) : {},
      children: typeof text !== 'undefined' ? undefined : sanitizeChildren(children),
      text,
      elm: undefined,
      key: data ? data.key : undefined
    })
  }
  return ce
}

export const createElement = createElementWithModules(defaultModules)

export default {
  createElement,
  createElementWithModules
}
