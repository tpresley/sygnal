// 'sygnal/host': the renderer kit (research: dev-plans/research/alt-renderers). A host tree with
// the DOM subset Sygnal's renderer path uses, the DOM driver contract on it, and the user-agent
// actions a target maps its input to. Guide: https://sygnal.js.org/renderers/custom-targets
import type { Stream } from 'xstream'

export type HostListener = (e: HostEvent) => void

/** A dispatched event, with the DOM's fields intents read */
export class HostEvent {
  constructor(type: string, init?: Record<string, any>)
  type: string
  bubbles: boolean
  target: HostElement | null
  currentTarget: HostElement | null
  defaultPrevented: boolean
  cancelBubble: boolean
  timeStamp: number
  readonly srcElement: HostElement | null
  preventDefault(): void
  stopPropagation(): void
  stopImmediatePropagation(): void
  /** key, keyCode, shiftKey, detail, data, inputType, … as given in `init` */
  [key: string]: any
}

/** A root delegate: a host driver source listening for one event type */
export interface HostDelegate {
  (e: HostEvent): void
  type: string
  /** whether it would deliver an event dispatched on `el` */
  accepts(el: HostElement): boolean
  /** a DOM.select('document' | 'body') source */
  global?: boolean
}

/** A node's stable id while it lives (snapshot refs, op logs) */
export function nodeId(node: object): number

export class HostDocument {
  constructor()
  /** the root element (tag 'root') the app renders into */
  body: HostElement
  documentElement: HostElement
  activeElement: HostElement | null
  /** called once per microtask after any change to the tree */
  onChange: (() => void) | null
  /** the host driver's root delegates (they see every dispatched event first) */
  delegates: Set<HostDelegate>
  defaultView: { Event: typeof HostEvent }
  createElement(tag: string): HostElement
  createTextNode(text: unknown): HostText
  getElementById(id: string): HostElement | null
  querySelector(selector: string): HostElement | null
  querySelectorAll(selector: string): HostElement[]
  /** the event types the app's intents listen for on `el` */
  listenedTypes(el: HostElement): string[]
  /** the event types app-wide listeners (DOM.select('document')) take */
  globalTypes(): string[]
  /** a mutation: `node`'s revision and its ancestors' move (attrRevision too with `attr`); schedules onChange */
  changed(node?: HostNode, attr?: boolean): void
}

export abstract class HostNode {
  ownerDocument: HostDocument
  /** moves on any change to the node or below it (doc.changed) */
  revision: number
  /** moves on a change of its own attributes, classes, style or dataset */
  attrRevision: number
  parentNode: HostElement | null
  readonly parentElement: HostElement | null
  readonly nextSibling: HostNode | null
  readonly previousSibling: HostNode | null
  readonly isConnected: boolean
  abstract nodeType: number
  remove(): void
}

export class HostText extends HostNode {
  nodeType: 3
  data: string
  textContent: string
  readonly nodeValue: string
}

export class HostElement extends HostNode {
  nodeType: 1
  /** the tag, lower case */
  localName: string
  readonly tagName: string
  childNodes: HostNode[]
  readonly children: HostElement[]
  readonly firstChild: HostNode | null
  readonly lastChild: HostNode | null
  readonly firstElementChild: HostElement | null
  attributes: Map<string, string>
  classList: { add(...n: string[]): void, remove(...n: string[]): void, contains(n: string): boolean, toggle(n: string, force?: boolean): boolean, readonly length: number, [Symbol.iterator](): Iterator<string> }
  /** inline styles (style={{…}}); renderers read display and their own keys */
  style: Record<string, any>
  dataset: Record<string, string>
  textContent: string
  value: string
  checked: boolean
  selected: boolean
  readonly options: HostElement[]
  // reflected to attributes, as the DOM's
  id: string; className: string; type: string; name: string; placeholder: string; href: string
  title: string; src: string; alt: string; role: string; htmlFor: string; tabIndex: number
  disabled: boolean; hidden: boolean; required: boolean; readOnly: boolean; multiple: boolean
  getAttribute(name: string): string | null
  hasAttribute(name: string): boolean
  setAttribute(name: string, value: unknown): void
  removeAttribute(name: string): void
  toggleAttribute(name: string, force?: boolean): boolean
  insertBefore<N extends HostNode>(node: N, ref: HostNode | null): N
  appendChild<N extends HostNode>(node: N): N
  append(...nodes: (HostNode | string)[]): void
  removeChild<N extends HostNode>(node: N): N
  contains(node: HostNode | null): boolean
  matches(selector: string): boolean
  closest(selector: string): HostElement | null
  querySelector(selector: string): HostElement | null
  querySelectorAll(selector: string): HostElement[]
  focus(): void
  blur(): void
  click(): void
  addEventListener(type: string, listener: HostListener): void
  removeEventListener(type: string, listener: HostListener): void
  /** root delegates, then the target and (bubbling) its ancestors; false when prevented */
  dispatchEvent(event: HostEvent | { type: string, bubbles?: boolean }): boolean
  /** a form's named, enabled fields (processForm reads it) */
  toFormData(): { entries(): IterableIterator<[string, string]>, get(name: string): string | null }
}

/** snabbdom's DOMAPI over a host document */
export function hostApi(doc: HostDocument): Record<string, (...args: any[]) => any>

export interface HostDriverOptions {
  /** extra snabbdom modules, after Sygnal's own */
  modules?: any[]
  /** after each patch, with the root element */
  onPatch?: (root: HostElement) => void
  /** a patch that threw (default: run()'s onError with phase 'patch', else console.error) */
  onError?: (error: unknown) => void
}

/** The DOM driver source on a host tree: select / events as on the web, isolation by component */
export interface HostSource {
  readonly doc: HostDocument
  select(selector: string | Function): HostSource
  events(type: string, options?: unknown): Stream<HostEvent> & { value(): Stream<string>, checked(): Stream<boolean>, key(): Stream<string>, data(name: string): Stream<string | undefined>, target(): Stream<HostElement>, detail(): Stream<any> }
  elements(): Stream<HostElement[]>
  element(): Stream<HostElement>
  /** whether this source delivers an event with `el` as its current target */
  accepts(el: HostElement): boolean
  isolateSource(source: HostSource, scope: string): HostSource
  isolateValue(vnode: any, scope: string): any
  isolateSink(sink: any, scope: string): any
}

/** A DOM driver rendering into a host document: run(App, { DOM: makeHostDriver(doc) }) */
export function makeHostDriver(doc?: HostDocument, options?: HostDriverOptions): (vnode$: any, name?: string) => HostSource

/**
 * Form-field tags of a target's own vocabulary, beyond input / textarea / select (call before the
 * first render): a name (a text field) or `{ tag, kind: 'checkbox' }` (toggled by a click)
 */
export function registerFieldTags(...tags: (string | { tag: string, kind?: 'text' | 'checkbox' })[]): void

export function matches(el: HostElement, selector: string, stop?: HostElement | null): boolean
export function querySelectorAll(root: HostElement, selector: string): HostElement[]

export interface HostStyle {
  /** 'none' hides the element and its subtree */
  display?: string
  [key: string]: any
}
export type HostStyleRule = [selector: string, style: HostStyle]
/** matching rules in order, then the inline style; `hidden` → display none */
export function computeStyle(el: HostElement, rules?: readonly HostStyleRule[]): HostStyle
/** hidden by itself or an ancestor (display none, hidden, aria-hidden="true") */
export function isHidden(el: HostElement, rules?: readonly HostStyleRule[]): boolean

export interface UserAgentOptions {
  /** a link's default action: an <a href> clicked and not prevented */
  onNavigate?: (href: string, el: HostElement) => void
}
export interface KeyInit { shiftKey?: boolean, ctrlKey?: boolean, altKey?: boolean, metaKey?: boolean }
/** a click and its default actions (checkbox, radio, label, link, submit button, summary); false when prevented */
export function activate(el: HostElement, options?: UserAgentOptions): boolean
/** two clicks, then dblclick */
export function doubleClick(el: HostElement, options?: UserAgentOptions): void
/** keydown, its default action (typing, Enter submits, Space / Enter activate, ← → on a select), keyup */
export function pressKey(target: HostElement, key: string, init?: KeyInit, options?: UserAgentOptions): boolean
/** a key press per character */
export function typeText(el: HostElement, text: string, options?: UserAgentOptions): void
/** replace a field's value: input, then change */
export function fill(el: HostElement, value: string): void
/** pick a <select> option by value or label: input, then change */
export function chooseOption(select: HostElement, valueOrLabel: string): boolean
export function submit(form: HostElement): boolean
export function isFocusable(el: HostElement, rules?: readonly HostStyleRule[]): boolean
/** focusable, or an element the app's intents listen to clicks on */
export function isInteractive(el: HostElement, rules?: readonly HostStyleRule[]): boolean
export function isTextField(el: HostElement): boolean
/** a checkbox or radio <input>, or a registered checkbox-kind tag */
export function isCheckable(el: HostElement): boolean
export function focusableElements(doc: HostDocument, rules?: readonly HostStyleRule[], options?: { listened?: boolean }): HostElement[]
export function moveFocus(doc: HostDocument, step: 1 | -1, rules?: readonly HostStyleRule[], options?: { listened?: boolean }): HostElement | null
export function labelTarget(label: HostElement): HostElement | null
/** an <option>'s value: its value property or attribute, else its text */
export function optionValue(option: HostElement): string
