/**
 * sygnal/host: a retained host tree implementing the DOM subset Sygnal's renderer path touches:
 * snabbdom's DOMAPI (create, insert, remove, text), the snabbdom modules' element properties
 * (classList, setAttribute, style, dataset, value, checked), refs, autoFocus (focus()), Transition
 * (classList, parentNode, dispatchEvent) and processForm (toFormData, querySelector). A renderer
 * target reads this tree to paint it and dispatches DOM-shaped events into it (research:
 * dev-plans/research/alt-renderers).
 *
 * The same strategy NativeScript's DOMiNATIVE / undom use: give the framework a small DOM, and
 * translate that DOM to the platform. Nothing here is a browser API: it runs in Node, a worker,
 * Hermes or a test.
 */
import {matches, querySelectorAll} from './selector'
import {DelegateSet} from './delegation'

export type HostListener = (e: HostEvent) => void

/** A dispatched event: the DOM's fields intents read (type, target, currentTarget, key, …) */
export class HostEvent {
  type: string
  bubbles: boolean
  target: any = null
  currentTarget: any = null
  defaultPrevented = false
  cancelBubble = false
  timeStamp = Date.now();
  [k: string]: any
  constructor(type: string, init: Record<string, any> = {}) {
    this.type = type
    this.bubbles = init.bubbles !== false
    for (const k in init) if (k != 'bubbles') this[k] = init[k]
  }
  get srcElement() { return this.target }
  preventDefault() { this.defaultPrevented = true }
  stopPropagation() { this.cancelBubble = true }
  stopImmediatePropagation() { this.cancelBubble = true }
}

/** A root delegate (a renderer driver's source listening for one event type) */
export interface HostDelegate {
  (e: HostEvent): void
  type: string
  /** whether this delegate would deliver an event dispatched on `el` (agent UIs list them) */
  accepts(el: HostElement): boolean
  /** a DOM.select('document' | 'body') source: it hears every event of its type */
  global?: boolean
  /** the default action it cancels (events(type, { preventDefault })): true, or a pattern of event fields */
  preventDefault?: boolean | Record<string, unknown> | ((e: HostEvent) => boolean)
  /** a selector source's selector (scope-relative; '' for the scope's root) */
  selector?: string
  /**
   * indexed delegation (the host driver's own delegates, src/host/delegation.ts): the isolation
   * scope's key, whether it accepts `el` (scope root `sr`), and delivery of the event as `el`
   */
  scope?: string
  at?(el: HostElement, sr: HostElement | null): boolean
  deliver?(e: HostEvent, el: HostElement): void
}

let ids = 0
const idOf = new WeakMap<object, number>()
/** a node's stable id for as long as the node lives (snapshot refs, op logs) */
export const nodeId = (n: object): number => idOf.get(n) ?? (idOf.set(n, ++ids), ids)

/**
 * An element's style or dataset object: a write is a change of the element (its attributes). The
 * dataset reflects to data-* attributes, as the DOM's does (selectors match [data-id="3"])
 */
function tracked(el: HostElement, methods: Record<string, any>, data = false): any {
  const target: any = {}
  for (const k in methods) Object.defineProperty(target, k, {value: methods[k], enumerable: false})
  const attr = (k: string | symbol) => 'data-' + String(k).replace(/[A-Z]/g, c => '-' + c.toLowerCase())
  return new Proxy(target, {
    set(t, k, v) {
      if (t[k] === v) return true
      t[k] = v
      data ? el.attributes.set(attr(k), String(v)) : 0
      el.ownerDocument.changed(el, true)
      return true
    },
    deleteProperty(t, k) {
      if (!(k in t)) return true
      delete t[k]
      data ? el.attributes.delete(attr(k)) : 0
      el.ownerDocument.changed(el, true)
      return true
    },
  })
}

export class HostDocument {
  /** called once per microtask after any change to the tree (a renderer repaints) */
  onChange: (() => void) | null = null
  activeElement: HostElement | null = null
  /** the renderer driver's root delegates: they see every dispatched event first (indexed by type and scope) */
  delegates: Set<HostDelegate> = new DelegateSet()
  /** pokeDOM (Transition, Portal) builds its event from defaultView.Event */
  defaultView = {Event: HostEvent}
  body: HostElement
  documentElement: HostElement
  private dirty = false
  constructor() {
    this.body = this.documentElement = this.createElement('root')
  }
  createElement(tag: string) { return new HostElement(this, tag) }
  createTextNode(text: any) { return new HostText(this, text) }
  getElementById(id: string) { return this.body.querySelector('#' + id) }
  querySelector(sel: string) { return this.body.querySelector(sel) }
  querySelectorAll(sel: string) { return this.body.querySelectorAll(sel) }
  /** the event types the app listens for on `el` (through its intents' selectors) */
  listenedTypes(el: HostElement): string[] {
    const out = new Set<string>()
    for (const d of this.delegates) if (!out.has(d.type) && d.accepts(el)) out.add(d.type)
    return [...out]
  }
  /** the event types app-wide listeners (DOM.select('document')) take, from any element */
  globalTypes(): string[] {
    return [...new Set([...this.delegates].filter(d => d.global).map(d => d.type))]
  }
  /**
   * Called by every mutation. `node`: what changed; its `revision` and every ancestor's go up (a
   * renderer re-renders only a subtree whose revision moved: sygnal/react-native). `attr`: an
   * attribute, class, style or dataset change (`attrRevision`: a stylesheet's descendant
   * selectors may now match differently below it)
   */
  changed(node?: HostNode, attr = false) {
    if (node) {
      if (attr) node.attrRevision++
      for (let n: HostNode | null = node; n; n = n.parentNode) n.revision++
    }
    if (this.dirty || !this.onChange) return
    this.dirty = true
    queueMicrotask(() => { this.dirty = false; this.onChange?.() })
  }
}

export abstract class HostNode {
  parentNode: HostElement | null = null
  /** moves on any change to the node or below it (doc.changed) */
  revision = 0
  /** moves on a change of the node's own attributes, classes, style or dataset */
  attrRevision = 0
  abstract nodeType: number
  constructor(public ownerDocument: HostDocument) {}
  get parentElement() { return this.parentNode }
  get nextSibling(): HostNode | null {
    const p = this.parentNode
    return p ? p.childNodes[p.childNodes.indexOf(this) + 1] || null : null
  }
  get previousSibling(): HostNode | null {
    const p = this.parentNode
    return p ? p.childNodes[p.childNodes.indexOf(this) - 1] || null : null
  }
  get isConnected(): boolean {
    let n: HostNode = this
    while (n.parentNode) n = n.parentNode
    return n === this.ownerDocument.body
  }
  remove() { this.parentNode?.removeChild(this) }
}

export class HostText extends HostNode {
  nodeType = 3
  nodeName = '#text'
  private _data: string
  constructor(doc: HostDocument, data: any) { super(doc); this._data = String(data) }
  get data() { return this._data }
  set data(v: any) { this._data = String(v); this.ownerDocument.changed(this) }
  get textContent() { return this._data }
  set textContent(v: any) { this.data = v ?? '' }
  get nodeValue() { return this._data }
}

class ClassList {
  constructor(private el: HostElement) {}
  private get set() { return new Set((this.el.getAttribute('class') || '').split(/\s+/).filter(Boolean)) }
  private write(s: Set<string>) { s.size ? this.el.setAttribute('class', [...s].join(' ')) : this.el.removeAttribute('class') }
  add(...names: string[]) { const s = this.set; for (const n of names) s.add(n); this.write(s) }
  remove(...names: string[]) { const s = this.set; for (const n of names) s.delete(n); this.write(s) }
  contains(n: string) { return this.set.has(n) }
  toggle(n: string, force?: boolean) { const on = force ?? !this.contains(n); on ? this.add(n) : this.remove(n); return on }
  get length() { return this.set.size }
  [Symbol.iterator]() { return this.set[Symbol.iterator]() }
}

export class HostElement extends HostNode {
  nodeType = 1
  childNodes: HostNode[] = []
  attributes = new Map<string, string>()
  classList = new ClassList(this)
  /** inline styles (`style={{...}}` through the style module); renderers read display and their own keys */
  style: Record<string, any> = tracked(this, {setProperty(k: string, v: any) { this[k] = v }, removeProperty(k: string) { delete this[k] }, getPropertyValue(k: string) { return this[k] ?? '' }})
  dataset: Record<string, string> = tracked(this, {}, true)
  /** the isolation scope of a component's root element (set by the driver's scope module) */
  __isolate?: any[]
  private listeners = new Map<string, Set<HostListener>>()
  private _value = ''
  // element state a platform edits (the DOM's properties, not attributes)
  private _checked = false
  private _selected = false
  get checked() { return this._checked }
  set checked(v: boolean) { if (this._checked !== !!v) { this._checked = !!v; this.ownerDocument.changed(this) } }
  get selected() { return this._selected }
  set selected(v: boolean) { if (this._selected !== !!v) { this._selected = !!v; this.ownerDocument.changed(this) } }
  constructor(doc: HostDocument, public localName: string) { super(doc) }

  get tagName() { return this.localName.toUpperCase() }
  get nodeName() { return this.tagName }
  get value() { return this._value }
  set value(v: any) { const x = v == null ? '' : String(v); if (x !== this._value) { this._value = x; this.ownerDocument.changed(this) } }
  get children(): HostElement[] { return this.childNodes.filter((n): n is HostElement => n.nodeType === 1) }
  get firstChild() { return this.childNodes[0] || null }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null }
  get firstElementChild() { return this.children[0] || null }
  get textContent(): string { return this.childNodes.map(n => (n as any).textContent).join('') }
  set textContent(v: any) {
    for (const n of this.childNodes) n.parentNode = null
    this.childNodes = v != null && v !== '' ? [Object.assign(this.ownerDocument.createTextNode(v), {parentNode: this})] : []
    this.ownerDocument.changed(this)
  }
  /** a <select>'s options */
  get options(): HostElement[] { return this.querySelectorAll('option') }

  getAttribute(n: string) { return this.attributes.has(n) ? this.attributes.get(n)! : null }
  hasAttribute(n: string) { return this.attributes.has(n) }
  setAttribute(n: string, v: any) { const x = String(v); if (this.attributes.get(n) !== x) { this.attributes.set(n, x); this.ownerDocument.changed(this, true) } }
  removeAttribute(n: string) { if (this.attributes.delete(n)) this.ownerDocument.changed(this, true) }
  toggleAttribute(n: string, force?: boolean) {
    const on = force ?? !this.hasAttribute(n)
    on ? this.setAttribute(n, '') : this.removeAttribute(n)
    return on
  }

  insertBefore(node: HostNode, ref: HostNode | null) {
    node.parentNode?.removeChild(node)
    const i = ref ? this.childNodes.indexOf(ref) : -1
    i < 0 ? this.childNodes.push(node) : this.childNodes.splice(i, 0, node)
    node.parentNode = this
    this.ownerDocument.changed(this)
    return node
  }
  appendChild(node: HostNode) { return this.insertBefore(node, null) }
  append(...nodes: (HostNode | string)[]) { for (const n of nodes) this.appendChild(typeof n == 'string' ? this.ownerDocument.createTextNode(n) : n) }
  removeChild(node: HostNode) {
    const i = this.childNodes.indexOf(node)
    if (i >= 0) this.childNodes.splice(i, 1)
    node.parentNode = null
    const d = this.ownerDocument, a = d.activeElement
    if (a && !a.isConnected) d.activeElement = null
    d.changed(this)
    return node
  }
  contains(n: HostNode | null): boolean {
    for (let e = n; e; e = e.parentNode) if (e === this) return true
    return false
  }

  matches(sel: string) { return matches(this, sel) }
  closest(sel: string): HostElement | null {
    for (let e: HostElement | null = this; e; e = e.parentNode) if (e.matches(sel)) return e
    return null
  }
  querySelectorAll(sel: string): HostElement[] { return querySelectorAll(this, sel) }
  querySelector(sel: string): HostElement | null { return this.querySelectorAll(sel)[0] || null }

  /** focus moves in the document; the renderer decides what focus looks like */
  focus() {
    const d = this.ownerDocument, prev = d.activeElement
    if (prev === this || !this.isConnected) return
    d.activeElement = this
    if (prev) { prev.dispatchEvent(new HostEvent('blur', {bubbles: false})); prev.dispatchEvent(new HostEvent('focusout')) }
    this.dispatchEvent(new HostEvent('focus', {bubbles: false}))
    this.dispatchEvent(new HostEvent('focusin'))
    d.changed()
  }
  blur() {
    const d = this.ownerDocument
    if (d.activeElement !== this) return
    d.activeElement = null
    this.dispatchEvent(new HostEvent('blur', {bubbles: false}))
    this.dispatchEvent(new HostEvent('focusout'))
    d.changed()
  }
  select() {}
  click() { this.dispatchEvent(new HostEvent('click')) }

  addEventListener(t: string, f: HostListener) {
    let s = this.listeners.get(t)
    if (!s) this.listeners.set(t, s = new Set())
    s.add(f)
  }
  removeEventListener(t: string, f: HostListener) { this.listeners.get(t)?.delete(f) }
  /**
   * The root delegates first (the renderer driver's sources, as the DOM driver's delegation at
   * the root), then the target and, when it bubbles, its ancestors. Returns false when prevented.
   */
  dispatchEvent(e: any): boolean {
    const ev: HostEvent = e instanceof HostEvent ? e : new HostEvent(e.type, {bubbles: e.bubbles})
    ev.target = this
    const ds = this.ownerDocument.delegates
    if (ds instanceof DelegateSet) ds.dispatch(ev)
    else for (const d of [...ds]) if (d.type === ev.type) d(ev)
    for (let n: HostElement | null = this; n && !ev.cancelBubble; n = ev.bubbles ? n.parentNode : null) {
      ev.currentTarget = n
      const s = n.listeners.get(ev.type)
      if (s) for (const f of [...s]) f(ev)
    }
    ev.currentTarget = null
    return !ev.defaultPrevented
  }

  /** processForm's form data on a host form (named, enabled fields; checked boxes only) */
  toFormData() {
    const out: [string, string][] = []
    for (const el of this.querySelectorAll('input, textarea, select')) {
      if (!el.name || el.disabled) continue
      if (el.type == 'checkbox' || el.type == 'radio') { if (el.checked) out.push([el.name, el.value || 'on']) }
      else out.push([el.name, el.value])
    }
    return {entries: () => out[Symbol.iterator](), get: (n: string) => out.find(([k]) => k == n)?.[1] ?? null}
  }

  // reflected properties (declared here for types; defined below)
  declare id: string; declare className: string; declare type: string; declare name: string
  declare placeholder: string; declare href: string; declare title: string; declare src: string
  declare alt: string; declare role: string; declare htmlFor: string; declare tabIndex: number
  declare disabled: boolean; declare hidden: boolean; declare required: boolean; declare readOnly: boolean
  declare multiple: boolean
}

// properties that reflect to attributes, as the DOM's do: the props module writes `type`, `href`,
// `className`; selectors read [type=checkbox], [href], .class
const P = HostElement.prototype
for (const [k, a] of [['id', 'id'], ['className', 'class'], ['type', 'type'], ['name', 'name'], ['placeholder', 'placeholder'],
  ['href', 'href'], ['title', 'title'], ['src', 'src'], ['alt', 'alt'], ['role', 'role'], ['htmlFor', 'for'], ['lang', 'lang'], ['dir', 'dir']]) {
  Object.defineProperty(P, k, {
    get(this: HostElement) { return this.getAttribute(a) ?? '' },
    set(this: HostElement, v: any) { v == null ? this.removeAttribute(a) : this.setAttribute(a, v) },
    configurable: true,
  })
}
Object.defineProperty(P, 'tabIndex', {
  get(this: HostElement) { const t = this.getAttribute('tabindex'); return t == null ? -1 : +t },
  set(this: HostElement, v: any) { v == null ? this.removeAttribute('tabindex') : this.setAttribute('tabindex', v) },
  configurable: true,
})
for (const [k, a] of [['disabled', 'disabled'], ['hidden', 'hidden'], ['required', 'required'], ['readOnly', 'readonly'], ['multiple', 'multiple']]) {
  Object.defineProperty(P, k, {
    get(this: HostElement) { return this.hasAttribute(a) },
    set(this: HostElement, v: any) { this.toggleAttribute(a, !!v) },
    configurable: true,
  })
}

/** snabbdom's DOMAPI over a host document */
export const hostApi = (doc: HostDocument) => ({
  createElement: (tag: string) => doc.createElement(tag),
  createElementNS: (_ns: string, tag: string) => doc.createElement(tag),
  createTextNode: (t: string) => doc.createTextNode(t),
  createComment: () => doc.createTextNode(''),
  insertBefore: (p: HostElement, n: HostNode, r: HostNode | null) => { p.insertBefore(n, r) },
  removeChild: (p: HostElement, n: HostNode) => { p.removeChild(n) },
  appendChild: (p: HostElement, n: HostNode) => { p.appendChild(n) },
  parentNode: (n: HostNode) => n.parentNode,
  nextSibling: (n: HostNode) => n.nextSibling,
  tagName: (e: HostElement) => e.tagName,
  setTextContent: (n: any, t: string | null) => { n.textContent = t ?? '' },
  getTextContent: (n: any) => n.textContent,
  isElement: (n: HostNode): n is HostElement => n.nodeType === 1,
  isText: (n: HostNode): n is HostText => n.nodeType === 3,
  isComment: () => false,
  isDocumentFragment: () => false,
})
