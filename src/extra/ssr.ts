/**
 * Server-Side Rendering utilities for Sygnal components.
 *
 * Renders Sygnal component trees to HTML strings without a browser DOM.
 * Handles sub-components, Collections, Suspense boundaries, and Portals.
 */

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

function escapeHtml(str: string): string {
  return String(str).replace(/[&<>"']/g, (ch) => ESC_MAP[ch])
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
 * // → '<div><h1>Count: 0</h1></div>'
 * ```
 */
export function renderToString(
  componentDef: any,
  options: RenderToStringOptions = {}
): string {
  const {state, props = {}, context = {}, hydrateState} = options

  const resolvedState = state !== undefined ? state : componentDef.initialState

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
      peers: {},
    }, resolvedState, mergedContext, {})
  } catch (err: any) {
    // Error boundary
    if (typeof componentDef.onError === 'function') {
      const name = componentDef.componentName || componentDef.name || 'Component'
      try {
        vnode = componentDef.onError(err, {componentName: name})
      } catch (_) {
        vnode = {sel: 'div', data: {attrs: {'data-sygnal-error': ''}}, children: [], text: undefined, elm: undefined, key: undefined}
      }
    } else {
      vnode = {sel: 'div', data: {attrs: {'data-sygnal-error': ''}}, children: [], text: undefined, elm: undefined, key: undefined}
    }
  }

  if (!vnode) {
    vnode = {sel: 'div', data: {}, children: [], text: undefined, elm: undefined, key: undefined}
  }

  // Process special components in the VNode tree
  vnode = processSSRTree(vnode, mergedContext, resolvedState)

  // Serialize to HTML
  let html = vnodeToHtml(vnode)

  // Optionally embed state for hydration
  if (hydrateState && resolvedState != null) {
    const varName = typeof hydrateState === 'string' ? hydrateState : '__SYGNAL_STATE__'
    const serialized = escapeHtml(JSON.stringify(resolvedState))
    html += `<script>window.${varName}=${JSON.stringify(resolvedState)}</script>`
  }

  return html
}

/**
 * Walk the VNode tree and recursively render sub-components,
 * handle Suspense/Portal/Transition markers, and process Collections.
 */
function processSSRTree(vnode: any, context: Record<string, any>, parentState?: any): any {
  if (!vnode) return vnode
  if (typeof vnode === 'string' || vnode.text != null) return vnode

  const sel = vnode.sel

  // Portal: render children inline (no target container on server)
  if (sel === 'portal') {
    const children = vnode.children || []
    if (children.length === 0) return null
    if (children.length === 1) return processSSRTree(children[0], context, parentState)
    return {
      sel: 'div',
      data: {attrs: {'data-sygnal-portal': ''}},
      children: children.map((c: any) => processSSRTree(c, context, parentState)),
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
    return processSSRTree(child, context, parentState)
  }

  // Suspense: render children (SSR always shows content, not fallback)
  if (sel === 'suspense') {
    const children = vnode.children || []
    if (children.length === 0) return null
    if (children.length === 1) return processSSRTree(children[0], context, parentState)
    return {
      sel: 'div',
      data: {attrs: {'data-sygnal-suspense': 'resolved'}},
      children: children.map((c: any) => processSSRTree(c, context, parentState)),
      text: undefined,
      elm: undefined,
      key: undefined,
    }
  }

  // Slot: unwrap to children
  if (sel === 'slot') {
    const children = vnode.children || []
    if (children.length === 0) return null
    if (children.length === 1) return processSSRTree(children[0], context, parentState)
    return {
      sel: 'div',
      data: {},
      children: children.map((c: any) => processSSRTree(c, context, parentState)),
      text: undefined,
      elm: undefined,
      key: undefined,
    }
  }

  // Sub-component: render recursively
  const props = vnode.data?.props || {}
  if (props.sygnalOptions || typeof props.sygnalFactory === 'function') {
    return renderSubComponent(vnode, context, parentState)
  }

  // Collection: render each item
  if (sel === 'collection') {
    return renderCollection(vnode, context, parentState)
  }

  // Switchable: render the active component
  if (sel === 'switchable') {
    return renderSwitchable(vnode, context, parentState)
  }

  // Regular element: recurse into children
  if (vnode.children) {
    if (Array.isArray(vnode.children)) {
      if (vnode.children.length > 0) {
        vnode.children = vnode.children
          .map((c: any) => processSSRTree(c, context, parentState))
          .filter((c: any) => c != null)
      }
    } else if (vnode.children && typeof vnode.children === 'object') {
      // Single child object (text element)
      vnode.children = processSSRTree(vnode.children, context, parentState)
    }
  }

  return vnode
}

/**
 * Render a sub-component (identified by sygnalOptions or sygnalFactory in props).
 */
function renderSubComponent(vnode: any, context: Record<string, any>, parentState?: any): any {
  const props = vnode.data?.props || {}
  const {sygnalOptions, sygnalFactory, ...childProps} = props

  // Get the component definition (view function with static properties)
  let componentDef: any
  if (sygnalOptions) {
    componentDef = sygnalOptions.view
    // Copy static properties
    if (!componentDef.initialState && sygnalOptions.initialState) {
      componentDef = Object.assign(componentDef, {
        initialState: sygnalOptions.initialState,
        model: sygnalOptions.model,
        intent: sygnalOptions.intent,
        context: sygnalOptions.context,
        onError: sygnalOptions.onError,
        calculated: sygnalOptions.calculated,
      })
    }
  } else if (sygnalFactory && sygnalFactory.componentName) {
    // Factory-created component — we can't easily extract the view from an already-wrapped factory.
    // Return a placeholder.
    return {
      sel: 'div',
      data: {attrs: {'data-sygnal-ssr': vnode.sel || 'component'}},
      children: vnode.children || [],
      text: undefined,
      elm: undefined,
      key: undefined,
    }
  }

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

  // Call the view function
  let result: any
  try {
    result = componentDef({
      ...childProps,
      state: childState,
      children: slots.default || vnodeChildren,
      slots,
      context: childContext,
      peers: {},
    }, childState, childContext, {})
  } catch (err: any) {
    if (typeof componentDef.onError === 'function') {
      const name = componentDef.componentName || componentDef.name || 'Component'
      try {
        result = componentDef.onError(err, {componentName: name})
      } catch (_) {
        result = {sel: 'div', data: {attrs: {'data-sygnal-error': ''}}, children: [], text: undefined, elm: undefined, key: undefined}
      }
    } else {
      result = {sel: 'div', data: {attrs: {'data-sygnal-error': ''}}, children: [], text: undefined, elm: undefined, key: undefined}
    }
  }

  if (!result) {
    result = {sel: 'div', data: {}, children: [], text: undefined, elm: undefined, key: undefined}
  }

  // Recursively process the rendered sub-tree
  return processSSRTree(result, childContext, childState)
}

/**
 * Render a Collection by iterating over the state array.
 */
function renderCollection(vnode: any, context: Record<string, any>, parentState?: any): any {
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
        peers: {},
      }, itemState, itemContext, {})
    } catch (err: any) {
      if (typeof itemComponent.onError === 'function') {
        try {
          itemVnode = itemComponent.onError(err, {componentName: itemComponent.name || 'CollectionItem'})
        } catch (_) {
          itemVnode = {sel: 'div', data: {attrs: {'data-sygnal-error': ''}}, children: [], text: undefined, elm: undefined, key: undefined}
        }
      } else {
        itemVnode = {sel: 'div', data: {attrs: {'data-sygnal-error': ''}}, children: [], text: undefined, elm: undefined, key: undefined}
      }
    }

    return processSSRTree(itemVnode, itemContext, itemState)
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
function renderSwitchable(vnode: any, context: Record<string, any>, parentState?: any): any {
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

  return renderToStringInternal(activeComponent, parentState, context)
}

/**
 * Internal helper: render a component def to a VNode (not HTML string).
 */
function renderToStringInternal(componentDef: any, state: any, context: Record<string, any>): any {
  const resolvedState = state !== undefined ? state : componentDef.initialState

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

  let vnode: any
  try {
    vnode = componentDef({
      state: resolvedState,
      children: [],
      slots: {},
      context: mergedContext,
      peers: {},
    }, resolvedState, mergedContext, {})
  } catch (err: any) {
    if (typeof componentDef.onError === 'function') {
      try {
        vnode = componentDef.onError(err, {componentName: componentDef.name || 'Component'})
      } catch (_) {
        vnode = {sel: 'div', data: {attrs: {'data-sygnal-error': ''}}, children: [], text: undefined, elm: undefined, key: undefined}
      }
    } else {
      vnode = {sel: 'div', data: {attrs: {'data-sygnal-error': ''}}, children: [], text: undefined, elm: undefined, key: undefined}
    }
  }

  if (!vnode) {
    vnode = {sel: 'div', data: {}, children: [], text: undefined, elm: undefined, key: undefined}
  }

  return processSSRTree(vnode, mergedContext, resolvedState)
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
      html += ` ${key}="${escapeHtml(String(val))}"`
    }
  }
  html += '>'

  // Void elements
  if (VOID_ELEMENTS.has(tag)) {
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
      } else if (key === 'sygnalOptions' || key === 'sygnalFactory') {
        // Internal — skip
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
