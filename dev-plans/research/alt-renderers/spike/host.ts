/**
 * A retained host tree that implements the DOM subset Sygnal's snabbdom modules, refs, autoFocus,
 * Transition and processForm touch (nothing else). A renderer (terminal, canvas, a native bridge)
 * owns one HostDocument, reads the tree to paint it, and turns its input into HostEvents.
 *
 * This is the "undom" strategy NativeScript-Vue / Svelte Native use: give the framework a small
 * DOM, and translate that DOM to the platform. snabbdom's diff runs on it through a custom DOMAPI
 * (`hostApi`), so keyed reconciliation, hooks and Sygnal's own modules are reused as they are.
 */
import {matches, querySelectorAll} from './selector'

export type Listener = (e: HostEvent) => void

export class HostEvent {
  type: string
  bubbles: boolean
  target: any = null
  currentTarget: any = null
  defaultPrevented = false
  propagationStopped = false
  timeStamp = Date.now();
  [k: string]: any
  constructor(type: string, init: Record<string, any> = {}) {
    this.type = type
    this.bubbles = init.bubbles !== false
    Object.assign(this, init)
  }
  get srcElement() { return this.target }
  preventDefault() { this.defaultPrevented = true }
  stopPropagation() { this.propagationStopped = true }
}

export class HostDocument {
  /** called (once per microtask) after any mutation, so a renderer can repaint */
  onChange: (() => void) | null = null
  activeElement: HostElement | null = null
  /** the renderer driver's root delegates: see every dispatched event first (hostDriver.ts) */
  delegates = new Set<(e: HostEvent) => void>()
  private dirty = false
  body!: HostElement
  constructor() { this.body = this.createElement('root') }
  createElement(tag: string) { return new HostElement(this, tag) }
  createTextNode(text: string) { return new HostText(this, text) }
  changed() {
    if (this.dirty || !this.onChange) return
    this.dirty = true
    queueMicrotask(() => { this.dirty = false; this.onChange?.() })
  }
}

export abstract class HostNode {
  parentNode: HostElement | null = null
  constructor(public ownerDocument: HostDocument) {}
  abstract nodeType: number
  get nextSibling(): HostNode | null {
    const p = this.parentNode
    if (!p) return null
    return p.childNodes[p.childNodes.indexOf(this) + 1] || null
  }
}

export class HostText extends HostNode {
  nodeType = 3
  private _data: string
  constructor(doc: HostDocument, data: any) { super(doc); this._data = String(data) }
  get data() { return this._data }
  set data(v: any) { this._data = String(v); this.ownerDocument.changed() }
  get textContent() { return this._data }
  set textContent(v: string) { this.data = v }
}

class ClassList {
  constructor(private el: HostElement) {}
  private get set() { return new Set((this.el.getAttribute('class') || '').split(/\s+/).filter(Boolean)) }
  private write(s: Set<string>) { s.size ? this.el.setAttribute('class', [...s].join(' ')) : this.el.removeAttribute('class') }
  add(...names: string[]) { const s = this.set; names.forEach(n => s.add(n)); this.write(s) }
  remove(...names: string[]) { const s = this.set; names.forEach(n => s.delete(n)); this.write(s) }
  contains(n: string) { return this.set.has(n) }
  toggle(n: string, force?: boolean) { const on = force ?? !this.contains(n); on ? this.add(n) : this.remove(n); return on }
  [Symbol.iterator]() { return this.set[Symbol.iterator]() }
}

export class HostElement extends HostNode {
  nodeType = 1
  childNodes: HostNode[] = []
  attributes = new Map<string, string>()
  listeners = new Map<string, Set<Listener>>()
  classList = new ClassList(this)
  /** styles the renderer reads (a style={{...}} prop lands here through the style module) */
  style: Record<string, any> = {}
  dataset: Record<string, string> = {}
  /** sygnal isolation namespace, set by the scope module (see hostDriver.ts) */
  __isolate?: any[]
  // form state the renderer edits (as an <input>'s own properties)
  private _value = ''
  checked = false
  disabled = false
  type = ''
  name = ''
  placeholder = ''
  constructor(doc: HostDocument, public localName: string) { super(doc) }

  get tagName() { return this.localName.toUpperCase() }
  get id() { return this.getAttribute('id') || '' }
  set id(v: string) { this.setAttribute('id', v) }
  get className() { return this.getAttribute('class') || '' }
  set className(v: string) { this.setAttribute('class', String(v)) }
  get value() { return this._value }
  set value(v: any) { this._value = v == null ? '' : String(v); this.ownerDocument.changed() }
  get children() { return this.childNodes.filter((n): n is HostElement => n instanceof HostElement) }
  get firstChild() { return this.childNodes[0] || null }
  get textContent(): string { return this.childNodes.map(n => (n as any).textContent).join('') }
  set textContent(v: string) {
    this.childNodes.forEach(n => (n.parentNode = null))
    this.childNodes = v ? [Object.assign(this.ownerDocument.createTextNode(v), {parentNode: this})] : []
    this.ownerDocument.changed()
  }

  getAttribute(n: string) { return this.attributes.has(n) ? this.attributes.get(n)! : null }
  hasAttribute(n: string) { return this.attributes.has(n) }
  setAttribute(n: string, v: any) {
    this.attributes.set(n, String(v))
    if (n == 'type' || n == 'name' || n == 'placeholder') (this as any)[n] = String(v)
    this.ownerDocument.changed()
  }
  removeAttribute(n: string) { this.attributes.delete(n); this.ownerDocument.changed() }

  insertBefore(node: HostNode, ref: HostNode | null) {
    node.parentNode?.removeChild(node)
    const i = ref ? this.childNodes.indexOf(ref) : -1
    i < 0 ? this.childNodes.push(node) : this.childNodes.splice(i, 0, node)
    node.parentNode = this
    this.ownerDocument.changed()
  }
  appendChild(node: HostNode) { this.insertBefore(node, null) }
  removeChild(node: HostNode) {
    const i = this.childNodes.indexOf(node)
    if (i >= 0) this.childNodes.splice(i, 1)
    node.parentNode = null
    if (this.ownerDocument.activeElement && !isConnected(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = null
    this.ownerDocument.changed()
  }
  remove() { this.parentNode?.removeChild(this) }

  matches(sel: string) { return matches(this, sel) }
  closest(sel: string): HostElement | null {
    for (let e: HostElement | null = this; e; e = e.parentNode) if (e.matches(sel)) return e
    return null
  }
  querySelectorAll(sel: string) { return querySelectorAll(this, sel) }
  querySelector(sel: string) { return this.querySelectorAll(sel)[0] || null }

  // focus: the renderer decides what focus looks like; the document only tracks it
  focus() {
    const d = this.ownerDocument, prev = d.activeElement
    if (prev === this) return
    d.activeElement = this
    prev?.dispatchEvent(new HostEvent('blur', {bubbles: false}))
    this.dispatchEvent(new HostEvent('focus', {bubbles: false}))
    d.changed()
  }
  blur() { if (this.ownerDocument.activeElement === this) { this.ownerDocument.activeElement = null; this.dispatchEvent(new HostEvent('blur', {bubbles: false})) } }
  select() {}

  addEventListener(t: string, f: Listener) { (this.listeners.get(t) || this.listeners.set(t, new Set()).get(t)!).add(f) }
  removeEventListener(t: string, f: Listener) { this.listeners.get(t)?.delete(f) }
  /** target, then the ancestors when it bubbles (no capture phase: nothing here needs one) */
  dispatchEvent(e: any): boolean {
    const ev: HostEvent = e instanceof HostEvent ? e : new HostEvent(e.type, {bubbles: e.bubbles})
    ev.target = this
    for (const f of [...this.ownerDocument.delegates]) f(ev)
    for (let n: HostElement | null = this; n && !ev.propagationStopped; n = ev.bubbles ? n.parentNode : null) {
      ev.currentTarget = n
      n.listeners.get(ev.type)?.forEach(f => f(ev))
    }
    return !ev.defaultPrevented
  }

  /** processForm's FormData (D-AR-2: the DOM-free path the spike adds to processForm) */
  toFormData() {
    const out: [string, string][] = []
    for (const el of this.querySelectorAll('input')) {
      if (!el.name || el.disabled) continue
      if (el.type == 'checkbox' || el.type == 'radio') { if (el.checked) out.push([el.name, el.value || 'on']) }
      else out.push([el.name, el.value])
    }
    return {entries: () => out[Symbol.iterator]()}
  }
}

// properties that reflect to attributes, as the DOM's do (the props module writes `href`, a
// selector reads [href]); type / name / placeholder are mirrored the other way in setAttribute
for (const k of ['href', 'title', 'src', 'alt', 'role', 'htmlFor']) {
  const a = k == 'htmlFor' ? 'for' : k
  Object.defineProperty(HostElement.prototype, k, {
    get(this: HostElement) { return this.getAttribute(a) ?? '' },
    set(this: HostElement, v: any) { v == null ? this.removeAttribute(a) : this.setAttribute(a, v) },
  })
}

export const isConnected = (n: HostNode | null): boolean => {
  while (n && n.parentNode) n = n.parentNode
  return !!n && n === n.ownerDocument.body
}

/** snabbdom's DOMAPI over the host tree */
export const hostApi = (doc: HostDocument): any => ({
  createElement: (tag: string) => doc.createElement(tag),
  createElementNS: (_ns: string, tag: string) => doc.createElement(tag),
  createTextNode: (t: string) => doc.createTextNode(t),
  createComment: (t: string) => doc.createTextNode(''),
  insertBefore: (p: HostElement, n: HostNode, r: HostNode | null) => p.insertBefore(n, r),
  removeChild: (p: HostElement, n: HostNode) => p.removeChild(n),
  appendChild: (p: HostElement, n: HostNode) => p.appendChild(n),
  parentNode: (n: HostNode) => n.parentNode,
  nextSibling: (n: HostNode) => n.nextSibling,
  tagName: (e: HostElement) => e.tagName,
  setTextContent: (n: any, t: string | null) => { n.textContent = t ?? '' },
  getTextContent: (n: any) => n.textContent,
  isElement: (n: HostNode) => n.nodeType === 1,
  isText: (n: HostNode) => n.nodeType === 3,
  isComment: () => false,
  isDocumentFragment: () => false,
})
