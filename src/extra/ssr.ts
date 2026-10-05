/**
 * Server-Side Rendering utilities for Sygnal components.
 *
 * Renders Sygnal component trees to HTML strings without a browser DOM.
 * Handles sub-components, Collections, Suspense boundaries, and Portals.
 */
import {uidPart} from '../shared'

/** PLAN-4.6 R1-R4 (deleted at R5): renderToString matches the next core's client where they differ */

// Void elements that must not have closing tags
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

// Characters that need escaping in HTML text and attribute values
const ESC_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

// 4-F: renderComponent's t.html() serialises like the browser's innerHTML: text escapes only
// & < >, attribute values only & and " (SSR output keeps escaping all five)
let innerHtmlMode = false

function escapeHtml(str: string, attr?: boolean): string {
  return String(str).replace(innerHtmlMode ? (attr ? /[&"]/g : /[&<>]/g) : /[&<>"']/g, (ch) => ESC_MAP[ch])
}

/** @internal renderToString serialised like innerHTML (for renderComponent's t.html()) */
export function renderToInnerHtml(componentDef: any): string {
  innerHtmlMode = true
  try {
    return renderToString(componentDef)
  } finally {
    innerHtmlMode = false
  }
}

/**
 * Convert a CSS property name from camelCase to kebab-case.
 * E.g. "backgroundColor" → "background-color"
 * Handles vendor prefixes: "WebkitTransform" → "-webkit-transform"
 */
function camelToKebab(str: string): string {
  return str
    .replace(/^(Webkit|Moz|Ms|O)/, (m) => '-' + m.toLowerCase())
    .replace(/([A-Z])/g, '-$1')
    .toLowerCase()
}

/**
 * Serialize an inline style object to a CSS string.
 */
function serializeStyle(style: Record<string, any>): string {
  const parts: string[] = []
  for (const key of Object.keys(style)) {
    const val = style[key]
    if (val == null || val === '') continue
    // Skip snabbdom's delayed/remove/destroy style hooks
    if (key === 'delayed' || key === 'remove' || key === 'destroy') continue
    const cssKey = camelToKebab(key)
    parts.push(`${cssKey}: ${val}`)
  }
  return parts.join('; ')
}

export interface RenderToStringOptions {
  /** Initial state for the root component */
  state?: any
  /** Props to pass to the root component */
  props?: Record<string, any>
  /** Context from a parent (for nested rendering) */
  context?: Record<string, any>
  /**
   * Embed serialized state in a <script> tag for client hydration.
   * When true, appends `<script>window.__SYGNAL_STATE__=...</script>`.
   * When a string, uses that as the variable name instead.
   */
  hydrateState?: boolean | string
  /**
   * PLAN-3 (HEAD driver): an array that receives each rendered component's `head` static
   * value (in render order); `renderHead(list)` turns it into tags.
   */
  head?: any[]
  /**
   * PLAN-3 5-5 (H-7): a queryCache() the components' `resources` render from: a cached entry
   * renders as `{ status: 'success', data }`, any other request as `{ status: 'loading' }`.
   * Nothing is fetched during SSR; seed the cache in a loader (`cache.set(request, data)`)
   */
  cache?: any
  /**
   * PLAN-4 GS-11: the app-level error hook, as run()'s `onError`: called with phase 'view' after
   * the component's onError boundary chose the fallback. Reporting only
   */
  onError?: (error: any, info: {componentName?: string; action?: string; phase: string}) => void
  /**
   * PLAN-4 G-206: the root of the uid() strings (default 'u'), as run()'s `uid` option: pass the
   * same value to both so the hydrated ids match
   */
  uid?: string
}

// the `onError` option of the outermost renderToString call that has one (GS-11)
let ssrOnError: any

// the `head` option of the outermost renderToString call that has one
let heads: any[] | undefined
// 5-5: the `cache` option of the outermost renderToString call that has one
let ssrCache: any

/**
 * PLAN-4 GS-1: a host's behaviors: each `uses` key missing from the state is the slice the
 * behavior starts with (its initialState, the options naming its keys, its calculated fields: the
 * factory's precomputed `state`), as the client's merge gives it (behaviors.ts). A host with no
 * state gets an object with just its slices
 */
function withUses(def: any, state: any): any {
  const uses = def && def.uses
  if (!uses || typeof uses !== 'object') return state
  if (state == null) state = {}
  if (typeof state !== 'object' || Array.isArray(state)) return state
  let out = state
  for (const k in uses) {
    if (out[k] === undefined && uses[k] && uses[k].state !== undefined) {
      if (out === state) out = {...state}
      out[k] = uses[k].state
    }
  }
  return out
}

/**
 * 5-5 (H-7): the state a component's view renders with: each `resources` entry missing from the
 * state reads from the cache ('success' with the cached data), else 'loading' ('idle' for a
 * falsy request), as the client's first paint does with the same (hydrated) cache
 */
function withResources(def: any, state: any): any {
  state = withUses(def, state)
  const res = def && def.resources
  if (!res || !state || typeof state !== 'object' || Array.isArray(state)) return state
  const out = {...state}
  for (const n of Object.keys(res)) {
    if (out[n] !== undefined) continue
    let q: any
    try { q = typeof res[n] === 'function' ? res[n](state) : res[n] } catch (_) {}
    const E = q && ssrCache ? ssrCache.get(ssrCache.key(q, 1)) : undefined
    out[n] = E && E.at > 0 ? {status: 'success', data: E.v} : {status: q ? 'loading' : 'idle'}
  }
  return out
}

// PLAN-4 GS-9: uid(name?) as on the client: the root is 'u'; a child component adds its path in
// the parent's view (or its `id` prop), as getComponentIdFromElement and instantiateSubComponents
// in component.ts do; a Collection item adds its key, a Switchable page its name; anything but
// each part encoded by uidPart (G-214); in the root option anything but [A-Za-z0-9_-] becomes '_'
// (as run() does). SSR ids = hydration ids
const makeUid = (base: string) => (n?: string) => n ? base + '-' + n : base
function childUid(uid: string, vnode: any, path: string): string {
  const id = vnode.data?.props?.id
  return uid + '-' + uidPart(('::' + ((id && JSON.stringify(id).replaceAll('"', '')) || path)).replace(/.*::(r\.)?/, ''))
}

const errorDiv = (): any => ({sel: 'div', data: {attrs: {'data-sygnal-error': ''}}, children: [], text: undefined, elm: undefined, key: undefined})

/**
 * A view threw: the component's onError boundary picks the fallback (the error <div> without
 * one, or when it throws), then the app's onError hook is told (GS-11)
 */
function viewFailed(def: any, err: any, name: string): any {
  let vnode: any = errorDiv()
  if (typeof def.onError === 'function') {
    try {
      vnode = def.onError(err, {componentName: name})
    } catch (_) {
      vnode = errorDiv()
    }
  }
  // reporting only: a throwing hook is logged and swallowed (no diagnostics import: the Astro and
  // Vike server bundles carry this file without the core)
  try { ssrOnError && ssrOnError(err, {componentName: name, phase: 'view'}) } catch (e) { console.error(e) }
  return vnode
}

function collectHead(def: any, state: any): void {
  const h = def && def.head
  if (!heads || !h) return
  try { heads.push(typeof h === 'function' ? h(state) : h) } catch (_) {}
}

/**
 * Render a Sygnal component to an HTML string.
 *
 * Calls the component's view function with the provided (or initial) state,
 * recursively renders sub-components, and serializes the VNode tree to HTML.
 *
 * ```ts
 * import { renderToString } from 'sygnal'
 *
 * const html = renderToString(App, { state: { count: 0 } })
 * // → '<div data-sygnal-ssr=""><h1>Count: 0</h1></div>'
 * ```
 *
 * The root element (a fragment's first element) carries an empty `data-sygnal-ssr` attribute,
 * which marks the markup as Sygnal's server HTML (persist() under plain run() then restores after
 * the first render); the first client render removes it.
 */
export function renderToString(
  componentDef: any,
  options: RenderToStringOptions = {}
): string {
  const prevHeads = heads, prevCache = ssrCache, prevOnError = ssrOnError
  if (options.head) heads = options.head
  if (options.cache) ssrCache = options.cache
  if (options.onError) ssrOnError = options.onError
  try {
    return renderRoot(componentDef, options)
  } finally {
    heads = prevHeads
    ssrCache = prevCache
    ssrOnError = prevOnError
  }
}

function renderRoot(componentDef: any, options: RenderToStringOptions): string {
  const {state, props = {}, context = {}, hydrateState} = options
  // G-206: the uid root (sanitized as run() does)
  const uid = (options.uid || 'u').replace(/[^\w-]+/g, '_')

  const ownState = state !== undefined ? state : componentDef.initialState
  // 5-5: the view sees its resources; the hydration script keeps the state as it was given
  const resolvedState = withResources(componentDef, ownState)
  collectHead(componentDef, resolvedState)

  // Build context: merge parent context with component's own context definitions
  const componentContext = componentDef.context || {}
  const mergedContext: Record<string, any> = {...context}
  for (const key of Object.keys(componentContext)) {
    const contextFn = componentContext[key]
    if (typeof contextFn === 'function' && resolvedState != null) {
      try {
        mergedContext[key] = contextFn(resolvedState)
      } catch (_) {}
    }
  }

  // Call the view function
  let vnode: any
  try {
    vnode = componentDef({
      ...props,
      state: resolvedState,
      children: props.children || [],
      slots: props.slots || {},
      context: mergedContext,
      uid: makeUid(uid),
    })
  } catch (err: any) {
    // Error boundary
    vnode = viewFailed(componentDef, err, componentDef.componentName || componentDef.name || 'Component')
  }

  if (!vnode) {
    vnode = {sel: 'div', data: {}, children: [], text: undefined, elm: undefined, key: undefined}
  }

  // Process special components in the VNode tree
  vnode = processSSRTree(vnode, mergedContext, resolvedState, uid, 'r')

  // PLAN-4 3-R: mark the root element (a fragment's first element) as Sygnal's server markup, so
  // persist() under plain run() can tell it from a client-only app's loading placeholder. The
  // first client render drops the attribute (the new vnode doesn't have it)
  const first = vnode?.sel ? vnode : Array.isArray(vnode?.children) && vnode.children.find((c: any) => c?.sel && c.sel !== '!')
  if (first && !innerHtmlMode) first.data = {...first.data, attrs: {'data-sygnal-ssr': '', ...first.data?.attrs}}

  // Serialize to HTML
  let html = vnodeToHtml(vnode)

  // Optionally embed state for hydration
  if (hydrateState && ownState != null) {
    const varName = typeof hydrateState === 'string' ? hydrateState : '__SYGNAL_STATE__'
    const serialized = escapeHtml(JSON.stringify(ownState))
    html += `<script>window.${varName}=${JSON.stringify(ownState)}</script>`
  }

  return html
}

/**
 * Walk the VNode tree and recursively render sub-components,
 * handle Suspense/Portal/Transition markers, and process Collections.
 */
function processSSRTree(vnode: any, context: Record<string, any>, parentState: any, uid: string, path: string): any {
  if (!vnode) return vnode
  if (typeof vnode === 'string' || vnode.text != null) return vnode

  const sel = vnode.sel

  // Fragment: no selector, recurse into children
  if (!sel && vnode.children && Array.isArray(vnode.children)) {
    vnode.children = vnode.children
      .map((c: any, i: number) => processSSRTree(c, context, parentState, uid, `${path}.${i}`))
      .filter((c: any) => c != null)
    return vnode
  }

  // Portal: render children inline (no target container on server)
  if (sel === 'portal') {
    const children = vnode.children || []
    if (children.length === 0) return null
    if (children.length === 1) return processSSRTree(children[0], context, parentState, uid, `${path}.0`)
    return {
      sel: 'div',
      data: {attrs: {'data-sygnal-portal': ''}},
      children: children.map((c: any, i: number) => processSSRTree(c, context, parentState, uid, `${path}.${i}`)),
      text: undefined,
      elm: undefined,
      key: undefined,
    }
  }

  // Transition: unwrap to child (no animation on server)
  if (sel === 'transition') {
    const children = vnode.children || []
    const child = children[0]
    if (!child) return null
    return processSSRTree(child, context, parentState, uid, path)
  }

  // Suspense: render children (SSR always shows content, not fallback)
  if (sel === 'suspense') {
    const children = vnode.children || []
    if (children.length === 0) return null
    if (children.length === 1) return processSSRTree(children[0], context, parentState, uid, `${path}.0`)
    return {
      sel: 'div',
      data: {attrs: {'data-sygnal-suspense': 'resolved'}},
      children: children.map((c: any, i: number) => processSSRTree(c, context, parentState, uid, `${path}.${i}`)),
      text: undefined,
      elm: undefined,
      key: undefined,
    }
  }

  // ClientOnly: render fallback during SSR, skip children (they need a browser)
  if (sel === 'clientonly') {
    const props = vnode.data?.props || {}
    const fallback = props.fallback
    if (fallback) {
      // fallback can be a VNode or a string
      return processSSRTree(fallback, context, parentState, uid, path)
    }
    // No fallback — render an empty placeholder div
    return {
      sel: 'div',
      data: {attrs: {'data-sygnal-clientonly': ''}},
      children: [],
      text: undefined,
      elm: undefined,
      key: undefined,
    }
  }

  // Slot: unwrap to children
  if (sel === 'slot') {
    const children = vnode.children || []
    if (children.length === 0) return null
    if (children.length === 1) return processSSRTree(children[0], context, parentState, uid, `${path}.0`)
    return {
      sel: 'div',
      data: {},
      children: children.map((c: any, i: number) => processSSRTree(c, context, parentState, uid, `${path}.${i}`)),
      text: undefined,
      elm: undefined,
      key: undefined,
    }
  }

  // Sub-component: render recursively
  const props = vnode.data?.props || {}
  // (PLAN-4.6: the pragma's `data.c`, the component function)
  if (typeof vnode.data?.c === 'function') {
    return renderSubComponent(vnode, context, parentState, childUid(uid, vnode, path))
  }

  // Collection: render each item
  if (sel === 'collection') {
    return renderCollection(vnode, context, parentState, childUid(uid, vnode, path))
  }

  // Switchable: render the active component
  if (sel === 'switchable') {
    return renderSwitchable(vnode, context, parentState, childUid(uid, vnode, path))
  }

  // Regular element: recurse into children
  if (vnode.children) {
    if (Array.isArray(vnode.children)) {
      if (vnode.children.length > 0) {
        vnode.children = vnode.children
          .map((c: any, i: number) => processSSRTree(c, context, parentState, uid, `${path}.${i}`))
          .filter((c: any) => c != null)
      }
    } else if (vnode.children && typeof vnode.children === 'object') {
      // Single child object (text element)
      vnode.children = processSSRTree(vnode.children, context, parentState, uid, `${path}.0`)
    }
  }

  return vnode
}

/**
 * Render a sub-component (the pragma's `data.c`: the component function, with its statics).
 */
function renderSubComponent(vnode: any, context: Record<string, any>, parentState: any, uid: string): any {
  const childProps = vnode.data?.props || {}
  const componentDef: any = vnode.data?.c

  if (!componentDef || typeof componentDef !== 'function') {
    // Can't render — return children or empty div
    return {
      sel: 'div',
      data: {attrs: {'data-sygnal-ssr': vnode.sel || 'component'}},
      children: vnode.children || [],
      text: undefined,
      elm: undefined,
      key: undefined,
    }
  }

  // Determine child state via state lens
  let childState = componentDef.initialState
  const stateProp = childProps.state
  if (typeof stateProp === 'string' && parentState != null && parentState[stateProp] != null) {
    childState = parentState[stateProp]
  } else if (stateProp != null && typeof stateProp !== 'string') {
    // State passed directly
    childState = stateProp
  }
  childState = withResources(componentDef, childState)

  // Build child context
  const childContext: Record<string, any> = {...context}
  const componentContext = componentDef.context || {}
  for (const key of Object.keys(componentContext)) {
    const contextFn = componentContext[key]
    if (typeof contextFn === 'function' && childState != null) {
      try {
        childContext[key] = contextFn(childState)
      } catch (_) {}
    }
  }

  // Extract slots from children
  const slots: Record<string, any[]> = {}
  const defaultSlotChildren: any[] = []
  const vnodeChildren = vnode.children || []
  for (const child of vnodeChildren) {
    if (child && child.sel === 'slot') {
      const slotName = child.data?.props?.name || 'default'
      if (!slots[slotName]) slots[slotName] = []
      const slotChildren = child.children || []
      slots[slotName].push(...slotChildren)
    } else {
      defaultSlotChildren.push(child)
    }
  }
  if (defaultSlotChildren.length > 0) {
    if (!slots.default) slots.default = []
    slots.default.push(...defaultSlotChildren)
  }

  collectHead(componentDef, childState)

  // Call the view function
  let result: any
  try {
    result = componentDef({
      ...childProps,
      state: childState,
      children: slots.default || vnodeChildren,
      slots,
      context: childContext,
      uid: makeUid(uid),
    })
  } catch (err: any) {
    result = viewFailed(componentDef, err, componentDef.componentName || componentDef.name || 'Component')
  }

  if (!result) {
    result = {sel: 'div', data: {}, children: [], text: undefined, elm: undefined, key: undefined}
  }

  // Recursively process the rendered sub-tree
  return processSSRTree(result, childContext, childState, uid, 'r')
}

/**
 * Render a Collection by iterating over the state array.
 */
function renderCollection(vnode: any, context: Record<string, any>, parentState: any, uid: string): any {
  const props = vnode.data?.props || {}
  const {of: itemComponent, from, className} = props

  if (!itemComponent || !from || !parentState) {
    return {sel: 'div', data: {}, children: [], text: undefined, elm: undefined, key: undefined}
  }

  const items = parentState[from]
  if (!Array.isArray(items)) {
    return {sel: 'div', data: {}, children: [], text: undefined, elm: undefined, key: undefined}
  }

  const renderedItems = items.map((itemState: any, index: number) => {
    // GS-9: the key the client's Collection gives this item
    const isItemObj = itemState && typeof itemState === 'object' && !Array.isArray(itemState)
    // PLAN-4.6 G-322: an id-less item's uid part is `_i<index>` (core/cell.ts keyName)
    const itemUid = uid + '-' + (isItemObj && itemState.id != null ? uidPart(itemState.id) : '_i' + index)
    // GS-1: an item host's behavior slices (the client reads them as defaults, behaviors.ts)
    itemState = withUses(itemComponent, itemState)
    // Build context for this item
    const itemContext: Record<string, any> = {...context}
    const componentContext = itemComponent.context || {}
    for (const key of Object.keys(componentContext)) {
      const contextFn = componentContext[key]
      if (typeof contextFn === 'function') {
        try {
          itemContext[key] = contextFn(itemState)
        } catch (_) {}
      }
    }

    let itemVnode: any
    try {
      itemVnode = itemComponent({
        state: itemState,
        children: [],
        slots: {},
        context: itemContext,
        uid: makeUid(itemUid),
      })
    } catch (err: any) {
      itemVnode = viewFailed(itemComponent, err, itemComponent.name || 'CollectionItem')
    }

    return processSSRTree(itemVnode, itemContext, itemState, itemUid, 'r')
  }).filter((v: any) => v != null)

  const containerData: any = {}
  if (className) {
    containerData.props = {className}
  }

  return {
    sel: 'div',
    data: containerData,
    children: renderedItems,
    text: undefined,
    elm: undefined,
    key: undefined,
  }
}

/**
 * Render a Switchable by determining the active component from state.
 */
function renderSwitchable(vnode: any, context: Record<string, any>, parentState: any, uid: string): any {
  const props = vnode.data?.props || {}
  const {components, active, initial} = props

  if (!components) {
    return {sel: 'div', data: {}, children: [], text: undefined, elm: undefined, key: undefined}
  }

  // Determine which component to render
  let activeName: string | undefined
  if (typeof active === 'string') {
    // Direct name or state property
    if (components[active]) {
      activeName = active
    } else if (parentState && typeof parentState[active] === 'string') {
      activeName = parentState[active]
    }
  }
  if (!activeName && initial) {
    activeName = initial
  }
  if (!activeName) {
    activeName = Object.keys(components)[0]
  }

  const activeComponent = components[activeName]
  if (!activeComponent || typeof activeComponent !== 'function') {
    return {sel: 'div', data: {}, children: [], text: undefined, elm: undefined, key: undefined}
  }

  return renderToStringInternal(activeComponent, parentState, context, uid + '-' + uidPart(activeName))
}

/**
 * Internal helper: render a component def to a VNode (not HTML string).
 */
function renderToStringInternal(componentDef: any, state: any, context: Record<string, any>, uid: string): any {
  const resolvedState = withResources(componentDef, state !== undefined ? state : componentDef.initialState)

  const componentContext = componentDef.context || {}
  const mergedContext: Record<string, any> = {...context}
  for (const key of Object.keys(componentContext)) {
    const contextFn = componentContext[key]
    if (typeof contextFn === 'function' && resolvedState != null) {
      try {
        mergedContext[key] = contextFn(resolvedState)
      } catch (_) {}
    }
  }

  collectHead(componentDef, resolvedState)
  let vnode: any
  try {
    vnode = componentDef({
      state: resolvedState,
      children: [],
      slots: {},
      context: mergedContext,
      uid: makeUid(uid),
    })
  } catch (err: any) {
    vnode = viewFailed(componentDef, err, componentDef.name || 'Component')
  }

  if (!vnode) {
    vnode = {sel: 'div', data: {}, children: [], text: undefined, elm: undefined, key: undefined}
  }

  return processSSRTree(vnode, mergedContext, resolvedState, uid, 'r')
}

/**
 * Serialize a VNode tree to an HTML string.
 */
function vnodeToHtml(vnode: any): string {
  if (vnode == null) return ''

  // Text node
  if (typeof vnode === 'string') return escapeHtml(vnode)
  if (vnode.text != null && !vnode.sel) return escapeHtml(String(vnode.text))

  // VNode with text content and a selector
  const sel = vnode.sel
  if (!sel) {
    if (vnode.text != null) return escapeHtml(String(vnode.text))
    // Fragment: no selector, but has children — concatenate child HTML
    if (vnode.children && Array.isArray(vnode.children)) {
      return vnode.children.map((c: any) => vnodeToHtml(c)).join('')
    }
    return ''
  }

  // Parse selector: tag#id.class1.class2
  const {tag, id, selectorClasses} = parseSelector(sel)

  // Build attributes from VNode data
  const attrs = buildAttributes(vnode.data || {}, id, selectorClasses)

  // Opening tag
  let html = `<${tag}`
  for (const [key, val] of attrs) {
    if (val === true) {
      html += ` ${key}`
    } else if (val !== false && val != null) {
      html += ` ${key}="${escapeHtml(String(val), true)}"`
    }
  }
  html += '>'

  // Void elements
  if (VOID_ELEMENTS.has(tag)) {
    return html
  }

  // If innerHTML is set via props, use it as raw content (no escaping)
  if (vnode.data?.props?.innerHTML != null) {
    html += String(vnode.data.props.innerHTML)
    html += `</${tag}>`
    return html
  }

  // Children — snabbdom uses `text` for single text children (even when
  // `children` holds a text element object). Prioritize `text` when set.
  if (vnode.text != null) {
    html += escapeHtml(String(vnode.text))
  } else if (vnode.children) {
    // children can be an array or a single text element object
    const kids = Array.isArray(vnode.children) ? vnode.children : [vnode.children]
    for (const child of kids) {
      html += vnodeToHtml(child)
    }
  }

  html += `</${tag}>`
  return html
}

/**
 * Parse a snabbdom selector string like "div#myId.foo.bar" into parts.
 */
function parseSelector(sel: string): {tag: string; id: string | null; selectorClasses: string[]} {
  let tag = sel
  let id: string | null = null
  const selectorClasses: string[] = []

  // Extract id
  const hashIdx = sel.indexOf('#')
  if (hashIdx !== -1) {
    const rest = sel.slice(hashIdx + 1)
    const dotIdx = rest.indexOf('.')
    if (dotIdx !== -1) {
      id = rest.slice(0, dotIdx)
      tag = sel.slice(0, hashIdx)
      // Classes after #id
      const classStr = rest.slice(dotIdx + 1)
      if (classStr) selectorClasses.push(...classStr.split('.'))
    } else {
      id = rest
      tag = sel.slice(0, hashIdx)
    }
  } else {
    // Extract classes from selector
    const dotIdx = sel.indexOf('.')
    if (dotIdx !== -1) {
      tag = sel.slice(0, dotIdx)
      const classStr = sel.slice(dotIdx + 1)
      if (classStr) selectorClasses.push(...classStr.split('.'))
    }
  }

  if (!tag) tag = 'div'

  return {tag, id, selectorClasses}
}

/**
 * Build an ordered list of [attrName, attrValue] from VNode data.
 */
function buildAttributes(
  data: any,
  selectorId: string | null,
  selectorClasses: string[]
): Array<[string, any]> {
  const result: Array<[string, any]> = []
  const classNames: string[] = [...selectorClasses]

  // From data.props (DOM properties like className, htmlFor, etc.)
  if (data.props) {
    for (const [key, val] of Object.entries(data.props)) {
      if (key === 'className') {
        if (typeof val === 'string' && val) classNames.push(val)
      } else if (key === 'htmlFor') {
        result.push(['for', val])
      } else if (key === 'innerHTML' || key === 'textContent') {
        // Skip — handled separately if needed
      } else if (typeof val === 'boolean') {
        if (val) result.push([key, true])
      } else if (val != null) {
        result.push([key, val])
      }
    }
  }

  // From data.attrs (HTML attributes)
  if (data.attrs) {
    for (const [key, val] of Object.entries(data.attrs)) {
      if (key === 'class') {
        if (typeof val === 'string' && val) classNames.push(val)
      } else if (typeof val === 'boolean') {
        if (val) result.push([key, true])
      } else if (val != null) {
        result.push([key, val])
      }
    }
  }

  // From data.class (conditional class map: { active: true, disabled: false })
  if (data.class) {
    for (const [key, val] of Object.entries(data.class)) {
      if (val) classNames.push(key)
    }
  }

  // From data.dataset (data-* attributes)
  if (data.dataset) {
    for (const [key, val] of Object.entries(data.dataset)) {
      if (val != null) {
        result.push([`data-${camelToKebab(key)}`, val])
      }
    }
  }

  // ID (selector id takes precedence, then props/attrs)
  if (selectorId) {
    result.unshift(['id', selectorId])
  }

  // Class attribute
  if (classNames.length > 0) {
    const unique = [...new Set(classNames)]
    result.unshift(['class', unique.join(' ')])
  }

  // Style
  if (data.style && typeof data.style === 'object') {
    const styleStr = serializeStyle(data.style)
    if (styleStr) {
      result.push(['style', styleStr])
    }
  }

  return result
}
