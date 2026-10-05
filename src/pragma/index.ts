
import * as is from './is'

// P45-B: a vnode this pragma made whose subtree has no component (or other marker the view
// walk handles), no form field and no vnode from elsewhere. component.ts's view walk skips it
// (and, at the root, the whole walk). The flag is on the prototype, not enumerable, so the
// vnode's own fields are snabbdom's six. Checked by name (`$p`), not by class: the JSX runtime
// entries carry their own copy of this file.
function Plain(this: any, sel: any, data: any, children: any, text: any, key: any) {
  this.sel = sel
  this.data = data
  this.children = children
  this.text = text
  this.elm = undefined
  this.key = key
}
Object.defineProperty(Plain.prototype, '$p', { value: 1 })

const createTextElement = (text: any): any => is.text(text) ? new (Plain as any)(undefined, undefined, undefined, text, undefined) : undefined
// A tag the view walk has to see: a form field (G-146 stamp; a superset of isField) or a
// component name it knows as a string
const SPECIAL = /^(input|textarea|select|collection$|switchable$|sygnal-factory$)/i

// Mutates the vnode (and its SVG children, not below a foreignObject: that contains HTML):
// the props become attributes (className as class, attrs win), and the SVG namespace is set
const applySvg = (vnode: any): void => {
  // Skip text vnodes (sel is undefined) and nullish values; a vnode this pragma made in the
  // SVG namespace was done, with its subtree, when it was made
  if (!vnode || vnode.sel === undefined || (vnode.$p && vnode.data.ns)) return
  const data = vnode.data || {}
  const props = data.props || {}
  const attrs: any = {}
  for (const k in props) if (k != 'className' && props[k] !== undefined) attrs[k] = props[k]
  if (props.className !== undefined) attrs.class = props.className
  for (const k in data.attrs) if (data.attrs[k] !== undefined) attrs[k] = data.attrs[k]
  const svgData = { ...data, ns: 'http://www.w3.org/2000/svg', attrs }
  delete svgData.props
  vnode.data = svgData
  if (Array.isArray(vnode.children) && vnode.sel !== 'foreignObject') vnode.children.forEach(applySvg)
}

const svgTags: Record<string, number> = {
  // Container / structural
  svg: 1, g: 1, defs: 1, symbol: 1, use: 1,
  // Shape
  circle: 1, ellipse: 1, line: 1, path: 1, polygon: 1, polyline: 1, rect: 1,
  // Text  (no HTML collision: HTML has no <text>, <tspan>, or <textPath>)
  text: 1, tspan: 1, textPath: 1,
  // Gradient / paint
  linearGradient: 1, radialGradient: 1, stop: 1, pattern: 1,
  // Clipping / masking
  clipPath: 1, mask: 1,
  // Marker
  marker: 1,
  // Filter primitives
  filter: 1, feBlend: 1, feColorMatrix: 1, feComponentTransfer: 1,
  feComposite: 1, feConvolveMatrix: 1, feDiffuseLighting: 1,
  feDisplacementMap: 1, feDropShadow: 1, feFlood: 1, feGaussianBlur: 1,
  feImage: 1, feMerge: 1, feMergeNode: 1, feMorphology: 1, feOffset: 1,
  fePointLight: 1, feSpecularLighting: 1, feSpotLight: 1, feTile: 1,
  feTurbulence: 1, feFuncR: 1, feFuncG: 1, feFuncB: 1, feFuncA: 1,
  // Descriptive  (excluding 'title' — collides with HTML <title>)
  desc: 1, metadata: 1,
  // Other  (excluding 'a', 'image', 'style', 'script' — collide with HTML)
  foreignObject: 1, switch: 1,
  // Animation
  animate: 1, animateMotion: 1, animateTransform: 1, set: 1, mpath: 1,
}

// Adds snabbdom hooks to data.hook (a copy); a hook already there runs first
const chainHooks = (data: any, hooks: Record<string, (...args: any[]) => void>): void => {
  const existing = data.hook || {}
  const hook = { ...existing }
  for (const name in hooks) {
    hook[name] = (...args: any[]) => {
      if (existing[name]) existing[name](...args)
      hooks[name](...args)
    }
  }
  data.hook = hook
}

const applyFocusProps = (data: any): void => {
  const { autoFocus, autoSelect, ...rest } = data.props

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

  chainHooks(data, {
    insert: (vnode: any) => doFocus(vnode.elm),
    postpatch: (oldVnode: any, vnode: any) => {
      const wasFocused = oldVnode.data?._autoFocus
      const isFocused = vnode.data?._autoFocus
      if (!wasFocused && isFocused) doFocus(vnode.elm)
    },
  })
}

const applyRefProps = (data: any, ref: any): void => {
  const setRef = (elm: any) => {
    if (typeof ref === 'function') {
      ref(elm)
    } else if (ref && typeof ref === 'object' && 'current' in ref) {
      ref.current = elm
    }
  }

  chainHooks(data, {
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

const isObject = (v: any): boolean => is.object(v) && !Array.isArray(v)

// P45-B (D146): nested objects are passed by reference. An object with an undefined entry is
// copied without it (the DOM modules would write "undefined"; the old deep copy dropped it)
const clean = (obj: any): any => {
  if (isObject(obj)) for (const k in obj) if (obj[k] === undefined) {
    const out: any = {}
    for (const j in obj) if (obj[j] !== undefined) out[j] = obj[j]
    return out
  }
  return obj
}

// One pass over the JSX props into snabbdom's module buckets (audit rec 6):
// - `<module>-<name>` (on-click, attrs-href, data-task-id → dataset.taskId) and `<module>={...}`
//   go to that module's bucket (`data` is snabbdom's `dataset`)
// - for, role, tabindex and aria-* go to attrs; key is dropped; anything else is a prop
// - an undefined value is skipped (a `<module>-<name>` one still makes its bucket)
// A bucket is the object passed (`lent`) until a second source adds to it; then it is a copy.
// sanitizeData doesn't re-enter, so `lent` is per call (null until a bucket is lent).
let lent: any
const bucket = (out: any, b: string): any => {
  const o = out[b]
  if (is.object(o) && !lent?.[b]) return o
  if (lent) lent[b] = 0
  return out[b] = is.object(o) ? { ...o } : {}
}
const add = (out: any, b: string, v: any): void => {
  if (isObject(out[b]) && isObject(v)) {
    const o = bucket(out, b)
    for (const k in v) if (v[k] !== undefined) o[k] = v[k]
  } else {
    out[b] = clean(v);
    (lent ||= {})[b] = 1
  }
}
const sanitizeData = (data: any, modules: Record<string, any>): any => {
  const out: any = {}
  lent = null
  const hasAttrs = modules.attrs !== undefined
  for (const key in data) {
    let val = data[key]
    if (key == 'ref' || key == 'key') continue
    if (key == 'class' && modules.class !== undefined) val = toClassMap(val)
    const dash = key.indexOf('-')
    const prefix = dash > -1 && key.slice(0, dash)
    if (prefix && modules[prefix] !== undefined) {
      let sub = key.slice(dash + 1)
      // G-152: data-task-id → dataset key taskId (a hyphenated dataset key makes the DOM throw)
      if (prefix == 'data') sub = sub.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      const o = bucket(out, modules[prefix] || prefix)
      if (val !== undefined) o[sub] = val
    } else if (val === undefined) {
      continue
    } else if (hasAttrs && (key == 'for' || key == 'role' || key == 'tabindex' || prefix == 'aria')) {
      bucket(out, 'attrs')[key] = val
    } else if (modules[key] !== undefined) {
      add(out, modules[key] || key, val)
    } else if (modules.props !== undefined) {
      bucket(out, 'props')[key] = val
    } else {
      out[key] = val
    }
  }
  const props = out.props
  if (props && (props.autoFocus || props.autoSelect)) applyFocusProps(out)
  if (data.ref) applyRefProps(out, data.ref)
  return out
}

const sanitizeText = (children: any[]): string | undefined => children.length > 1 || !is.text(children[0]) ? undefined : children[0].toString()

// Flattens the children into `out` (a non-vnode child becomes a text vnode, or undefined);
// 1 when every child is plain: none, text, or a plain vnode
const flatten = (children: any[], out: any[]): number => {
  let plain = 1
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (is.array(child)) plain &= flatten(child, out)
    else if (is.vnode(child)) {
      out.push(child)
      if (!child.$p && (child.sel !== undefined || child.children)) plain = 0
    } else out.push(createTextElement(child))
  }
  return plain
}

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
    // PLAN-4.6 (R1-R4): the next core instantiates a component from the vnode's `data.c` (the
    // component function); the current core reads `sygnalOptions`. Both, until R5
    let fn: any
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
          fn = sel
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
    let kids: any
    let plain = !isComponent && is.string(sel) && !SPECIAL.test(sel)
    if (typeof text === 'undefined') plain = !!(flatten(children, kids = []) & +plain)
    const d = data ? sanitizeData(data, modules) : {}
    if (fn) d.c = fn
    const key = data ? data.key : undefined
    const vnode = plain ? new (Plain as any)(sel, d, kids, text, key) : { sel, data: d, children: kids, text, elm: undefined, key }
    if (sel in svgTags) applySvg(vnode)
    return vnode
  }
  return ce
}

export const createElement = createElementWithModules(defaultModules)

export default {
  createElement,
  createElementWithModules
}
