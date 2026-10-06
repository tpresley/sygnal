
import * as is from './is'

// P45-B: a vnode this pragma made whose subtree has no component (or other marker the view
// walk handles), no form field and no vnode from elsewhere. the core's view walk skips it
// (and, at the root, the whole walk). The flag is on the prototype, not enumerable, so the
// vnode's own fields are snabbdom's six. Checked by name (`$p`), not by class (a second copy of
// the core, e.g. Astro's SSR bundle, makes its own).
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
// A tag whose tree isn't plain: a form field (a superset of isField: a re-run view with the same
// output keeps its last vnode (P46-P sameTree), which would skip the controlled-input module's
// re-sync of the DOM value) or a host the view walk knows by its string tag (<collection>,
// <switchable>). D196: a custom element (a hyphenated tag) may be a form-associated field
const FIELD = /^(input|textarea|select)|-/i
// P46-P: by tag: 1 a form field (FIELD: a prefix), 4 a host (<collection>, <switchable>), 2 an SVG
// tag. G-350: keyed by the tag part of the selector (before its first '#' or '.'), so dynamic
// selectors (`li#row-${id}`) don't grow it. A selector with an id or class keeps only bit 1, as
// P46-P's full-selector tests did (the host and SVG tags match the whole selector)
const tags: Record<string, number> = Object.create(null)
const bits = (tag: string): number => tags[tag] = +FIELD.test(tag) | (/^(collection|switchable)$/i.test(tag) ? 4 : 0) | (tag in svgTags ? 2 : 0) | (/-/.test(tag) ? 8 : 0)
const tagBits = (sel: string): number => {
  const t = tags[sel]
  if (t !== undefined) return t
  let i = 0
  for (let c; i < sel.length && (c = sel.charCodeAt(i)) != 35 && c != 46; i++);
  if (i == sel.length) return bits(sel)
  const tag = sel.slice(0, i)
  return (tags[tag] ?? bits(tag)) & 9
}

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

// Adds snabbdom hooks to data.hook (a copy); a hook already there runs first (also PLAN-5
// widget hosts: extra/widget.ts)
export const chainHooks = (data: any, hooks: Record<string, (...args: any[]) => void>): void => {
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
// - on an element tag, for, role, tabindex, aria-*, form and list (G-463: getter-only DOM
//   properties, which the props module would throw on) and the popover / invoker / anchor attributes
//   (ATTRS) go to attrs (G-370: a component placeholder keeps them as props); an aria-* true is
//   written as "true" (D196: snabbdom writes true as "", which ARIA doesn't read as true), false
//   as "false" for a state whose values include false (G-372: ARIA_FALSE), else (an IDREF, a
//   string, a number) it removes the attribute, as null does; key is dropped; anything else is a
//   prop
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
// P46-P: where a key goes, by key (per modules map; 0: skipped): [bucket, name, kind]. kind 1: a
// `<module>-<name>` key (its bucket is made even for undefined); 2: a module's own object
// (3: `class`, made a map first); else the bucket's `name` (no bucket: the data's own key; 4:
// aria-*, a boolean stringified)
const ATTRS = /^(for|form|list|role|tabindex|popovertarget(action)?|command(for)?|closedby|interestfor|anchor|aria-.*)$/
// G-372: the WAI-ARIA 1.2 states and properties whose value set includes "false" (true/false,
// tristate, and the tokens aria-current / aria-invalid / aria-haspopup), by a prefix no other
// ARIA 1.2/1.3 attribute has: atomic, busy, checked, current, disabled, expanded, grabbed,
// haspopup, hidden, invalid, modal, multiline, multiselectable, pressed, readonly, required,
// selected (sel: not setsize)
const ARIA_FALSE = /^aria-(at|bu|ch|cu|di|ex|gr|ha|hi|in|mo|mu|pr|re[aq]|sel)/
// `c`: a component placeholder (G-370: ATTRS stay props)
const route = (key: string, modules: Record<string, any>, c?: any): any => {
  if (key == 'ref' || key == 'key' || key == 'children') return 0
  const dash = key.indexOf('-')
  const prefix = dash > -1 && key.slice(0, dash)
  // G-152: data-task-id → dataset key taskId (a hyphenated dataset key makes the DOM throw)
  if (prefix && modules[prefix] !== undefined) return [modules[prefix] || prefix, prefix == 'data' ? key.slice(dash + 1).replace(/-([a-z])/g, (_, c) => c.toUpperCase()) : key.slice(dash + 1), 1]
  // G-492: on a custom element (c 2), list is its own property (Lit, sygnal/element). G-519: form
  // stays an attribute (a form-associated element's `form` is a getter; the attribute links it)
  if (c != 1 && modules.attrs !== undefined && ATTRS.test(key) && !(c && key == 'list')) return ['attrs', key, prefix == 'aria' && 4]
  if (modules[key] !== undefined) return [modules[key] || key, 0, key == 'class' && modules.class !== undefined ? 3 : 2]
  return [modules.props !== undefined && 'props', key]
}
const own = Object.prototype.hasOwnProperty
const sanitizeData = (data: any, modules: Record<string, any>, routes: Map<string, any>, c?: any): any => {
  const out: any = {}
  lent = null
  for (const key in data) {
    // G-354: own properties only, as the rest-spread copy had (about 1 ns a call)
    if (!own.call(data, key)) continue
    const val = data[key]
    let r = routes.get(key)
    // G-350: capped (data-dependent keys, e.g. `data-${id}`, are routed but not kept)
    if (r === undefined && (r = route(key, modules, c), routes.size < 1024)) routes.set(key, r)
    if (!r) continue
    const [b, name, kind] = r
    if (kind == 1) {
      const o = bucket(out, b)
      if (val !== undefined) o[name] = val
    } else if (val === undefined) continue
    else if (kind & 2) add(out, b, kind == 3 ? toClassMap(val) : val)
    else if (b) bucket(out, b)[name] = kind ? val === !!val ? (val || ARIA_FALSE.test(key)) && '' + val : val ?? false : val
    else out[key] = val
  }
  // G-485 / G-521: `u`, the user's own insert hook (hydration makes its element again so it runs;
  // Sygnal's ref / autoFocus hooks, chained after it, keep the copy's flag)
  if (out.hook?.insert) out.hook = { ...out.hook, u: 1 }
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
  // G-370: a component placeholder's keys route without ATTRS, so in their own cache
  const routes = new Map<string, any>(), croutes = new Map<string, any>(), xroutes = new Map<string, any>()
  // the children as one array (`k`: a key that wins over data.key: the JSX runtime's own)
  const ca = (sel: any, data: any, children: any[], k?: any): any => {
    if (typeof sel === 'undefined') {
      sel = 'UNDEFINED'
      // Through the diagnostics bridge (G-044: collected like the other codes), or, with
      // diagnostics not loaded, the same pre-formatted text.
      const msg = 'A JSX tag is undefined, so <UNDEFINED> is rendered instead', fix = 'Import or define the component in this file'
      const core = (globalThis as any).__SYGNAL_DIAGNOSTICS__
      if (core && core.error) core.error('SYG420', 'JSX', msg, fix)
      else console.error(`[Sygnal SYG420] JSX: ${msg}. ${fix}. https://sygnal.js.org/reference/errors#syg420`)
    }
    // CT-1: a control (src/extra/controls.ts) renders its element itself and stamps its marker.
    // It gets this createElement (the JSX runtime entries use the core's, D188).
    const isComponent = is.fun(sel)
    if (isComponent && (sel as any).__sygnalControl) return (sel as any).__sygnalControl(data, children, ce)
    // the core instantiates a component from the vnode's `data.c` (the component function, with
    // its statics); `sel` is its name
    let fn: any
    if (isComponent) {
      if ((sel as any).__sygnalFragment || sel.name === 'Fragment') {
        return sel(data || {}, children)
      }
      data ||= {}
      // preventInstantiation (Portal/Suspense/...): a marker vnode, its function in `data.m` (G-470:
      // how a check tells it from a plain element of that tag), not `data.c`; its children
      // stay an array (they read vnode.children), as for every component below
      fn = sel
      sel = (sel as any).componentName || sel.name || 'FUNCTION_COMPONENT'
    }
    // B-011: a vnode is either text-only (`text`, no children) or has a children array,
    // never both; snabbdom's diff mishandles a vnode with both. A component placeholder
    // keeps an array so the component receives its text child via `children`.
    const text = isComponent ? undefined : sanitizeText(children)
    let kids: any
    const t = tagBits(sel)
    let plain = !isComponent && is.string(sel) && !(t & 5)
    if (typeof text === 'undefined') plain = !!(flatten(children, kids = []) & +plain)
    // G-492: a custom element (bit 8) routes list as a prop, in its own cache
    const d = data ? sanitizeData(data, modules, isComponent ? croutes : t & 8 ? xroutes : routes, isComponent || t & 8 && 2) : {}
    if (fn) d[fn.preventInstantiation ? 'm' : 'c'] = fn
    const key = k !== undefined ? k : data ? data.key : undefined
    const vnode = plain ? new (Plain as any)(sel, d, kids, text, key) : { sel, data: d, children: kids, text, elm: undefined, key }
    if (t & 2) applySvg(vnode)
    return vnode
  }
  const ce = (sel: any, data: any, ...children: any[]): any => ca(sel, data, children)
  // P46-P: the JSX runtime's element path (its props object is the data as is: sanitizeData
  // skips `children`)
  ;(ce as any).a = ca
  ;(ce as any).$r = routes
  return ce
}

export const createElement = createElementWithModules(defaultModules)
/** G-350 (tests): the sizes of the tag cache and of a createElement's route cache */
export const __cacheSizes = (ce: any) => ({ tags: Object.keys(tags).length, routes: ce.$r.size })

export default {
  createElement,
  createElementWithModules
}
