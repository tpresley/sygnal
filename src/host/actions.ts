/**
 * sygnal/host: what a browser does for a user, on a host tree: the events and default actions of
 * a click, typing, a key press, focus order. A target maps its own input (keys in a terminal, an
 * agent's tool call, a native callback) to these, so every target produces the same DOM-shaped
 * events (D-AR-3: DOM event names everywhere) and intents don't change between targets.
 */
import {HostDocument, HostElement, HostEvent} from './dom'
import {HostStyleRule, isHidden} from './style'

export interface UserAgentOptions {
  /** a link's default action (an <a href> clicked and not prevented) */
  onNavigate?: (href: string, el: HostElement) => void
}
export interface KeyInit {
  shiftKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}

const KEY_CODES: Record<string, number> = {
  Enter: 13, Escape: 27, Backspace: 8, Tab: 9, ' ': 32, Delete: 46,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34,
}
const keyCode = (key: string) => KEY_CODES[key] ?? (key.length == 1 ? key.toUpperCase().charCodeAt(0) : /^F(\d+)$/.test(key) ? 111 + +key.slice(1) : 0)

const fire = (el: HostElement, type: string, init?: Record<string, any>) => el.dispatchEvent(new HostEvent(type, init))

/** text-entry fields: typing edits their value */
export const isTextField = (el: HostElement): boolean =>
  el.localName == 'textarea' || (el.localName == 'input' && !/^(checkbox|radio|button|submit|reset|hidden|file|image|range|color)$/.test(el.type))
const isBox = (el: HostElement) => el.localName == 'input' && (el.type == 'checkbox' || el.type == 'radio')
const isButton = (el: HostElement) => el.localName == 'button' || (el.localName == 'input' && /^(button|submit|reset)$/.test(el.type))

/** focusable: form fields, buttons, links with href, [tabindex] ≥ 0; not disabled, not hidden */
export function isFocusable(el: HostElement, rules?: readonly HostStyleRule[]): boolean {
  if (el.disabled || (el.localName == 'input' && el.type == 'hidden')) return false
  const t = el.getAttribute('tabindex')
  const ok = t != null ? +t >= 0
    : /^(input|textarea|select|button|summary)$/.test(el.localName) || (el.localName == 'a' && el.hasAttribute('href'))
  return ok && !isHidden(el, rules)
}

const POINTER = /^(click|dblclick|auxclick|contextmenu|mousedown|mouseup|pointerdown|pointerup)$/
/**
 * Interactive by intent: focusable, or an element the app listens to clicks on (an intent's
 * selector matches it: todomvc's dblclick on a todo's <label>). A target without a pointer (a
 * terminal, an agent) can reach those too; a browser user would click them.
 */
export function isInteractive(el: HostElement, rules?: readonly HostStyleRule[]): boolean {
  return isFocusable(el, rules) || (!el.disabled && el.ownerDocument.listenedTypes(el).some(t => POINTER.test(t)) && !isHidden(el, rules))
}

/**
 * The focusable elements in tab order (document order; positive tabindex first, as the DOM);
 * `listened: true` adds the elements the app listens to clicks on (isInteractive)
 */
export function focusableElements(doc: HostDocument, rules?: readonly HostStyleRule[], options: {listened?: boolean} = {}): HostElement[] {
  const ok = options.listened ? isInteractive : isFocusable
  const all = doc.body.querySelectorAll('*').filter(el => ok(el, rules))
  const pos = all.filter(el => el.tabIndex > 0).sort((a, b) => a.tabIndex - b.tabIndex)
  return [...pos, ...all.filter(el => !(el.tabIndex > 0))]
}

/** move focus to the next (1) or previous (-1) element of focusableElements(), wrapping */
export function moveFocus(doc: HostDocument, step: 1 | -1, rules?: readonly HostStyleRule[], options: {listened?: boolean} = {}): HostElement | null {
  const list = focusableElements(doc, rules, options)
  if (!list.length) return null
  const i = doc.activeElement ? list.indexOf(doc.activeElement) : -1
  const next = list[i < 0 ? (step > 0 ? 0 : list.length - 1) : (i + step + list.length) % list.length]
  next.focus()
  return next
}

/** the control a <label> is for: `for="id"`, else the first field inside it */
export function labelTarget(label: HostElement): HostElement | null {
  const f = label.getAttribute('for')
  return f ? label.ownerDocument.getElementById(f) : label.querySelector('input, textarea, select, button')
}

/**
 * A click and its default actions, as a browser runs them: a checkbox toggles (a radio checks and
 * unchecks its group) before the click and then gets input + change (undone when prevented); a
 * label clicks its control; a link navigates; a submit button submits its form. Returns false when
 * the click was prevented.
 */
export function activate(el: HostElement, options: UserAgentOptions = {}): boolean {
  if (el.disabled) return false
  const box = isBox(el), was = el.checked
  const group = box && el.type == 'radio' && el.name ? radioGroup(el) : []
  const before = group.map(r => r.checked)
  if (box) el.checked = el.type == 'radio' ? true : !was
  if (box && el.type == 'radio') for (const r of group) if (r !== el) r.checked = false
  const ok = fire(el, 'click', {detail: 1})
  if (box) {
    if (!ok) { el.checked = was; group.forEach((r, i) => r.checked = before[i]) }
    else if (el.checked !== was) { fire(el, 'input'); fire(el, 'change') }
    return ok
  }
  if (!ok) return false
  if (el.localName == 'label') {
    const t = labelTarget(el)
    if (t) { if (isTextField(t) || t.localName == 'select') t.focus(); else activate(t, options) }
  } else if (el.localName == 'a' && el.hasAttribute('href')) options.onNavigate?.(el.getAttribute('href')!, el)
  else if (el.localName == 'button' ? (el.getAttribute('type') || 'submit') == 'submit' : el.localName == 'input' && el.type == 'submit') {
    const f = el.closest('form')
    if (f) submit(f)
  } else if (el.localName == 'summary' && el.parentNode?.localName == 'details') el.parentNode.toggleAttribute('open')
  return true
}
const radioGroup = (el: HostElement) => (el.closest('form') || el.ownerDocument.body).querySelectorAll('input[type="radio"]').filter(r => r.name == el.name)

/** a double click: the two clicks, then dblclick (a terminal key or a tool call stands in for it) */
export function doubleClick(el: HostElement, options: UserAgentOptions = {}): void {
  activate(el, options)
  activate(el, options)
  fire(el, 'dblclick', {detail: 2})
}

/** a form submission (implicit submission, a submit button) */
export function submit(form: HostElement): boolean { return fire(form, 'submit') }

/**
 * A key press on `target` (the focused element, else the document's root): keydown, its default
 * action, keyup. Defaults: a printable key or Backspace edits a text field (input events), Enter
 * in an <input> submits its form, Enter or Space activates a button / link / checkbox, Space
 * toggles a checkbox, ArrowLeft / ArrowRight change a <select>'s option. Returns false when the
 * keydown was prevented.
 */
export function pressKey(target: HostElement, key: string, init: KeyInit = {}, options: UserAgentOptions = {}): boolean {
  const ev = {key, code: key.length == 1 ? '' : key, keyCode: keyCode(key), which: keyCode(key), shiftKey: !!init.shiftKey, ctrlKey: !!init.ctrlKey, altKey: !!init.altKey, metaKey: !!init.metaKey, repeat: false}
  if (!fire(target, 'keydown', ev)) return fire(target, 'keyup', ev), false
  const plain = !ev.ctrlKey && !ev.altKey && !ev.metaKey
  if (isTextField(target) && !target.readOnly && plain) {
    if (key.length == 1 || (key == 'Enter' && target.localName == 'textarea')) {
      fire(target, 'beforeinput', {data: key == 'Enter' ? '\n' : key, inputType: 'insertText'})
      target.value += key == 'Enter' ? '\n' : key
      fire(target, 'input', {data: key, inputType: 'insertText'})
    } else if (key == 'Backspace' && target.value) {
      target.value = [...target.value].slice(0, -1).join('')
      fire(target, 'input', {inputType: 'deleteContentBackward'})
    } else if (key == 'Enter') {
      const f = target.closest('form')
      if (f) submit(f)
    }
  } else if (target.localName == 'select' && (key == 'ArrowRight' || key == 'ArrowLeft')) {
    const opts = target.options, i = opts.findIndex(o => o.value == target.value || o.getAttribute('value') == target.value)
    const next = opts[Math.max(0, Math.min(opts.length - 1, i + (key == 'ArrowRight' ? 1 : -1)))]
    if (next && optionValue(next) !== target.value) chooseOption(target, optionValue(next))
  } else if (plain && (key == 'Enter' && !isBox(target) || key == ' ') && (isButton(target) || isBox(target) || target.localName == 'a' || target.localName == 'summary' || target.hasAttribute('tabindex'))) {
    if (!(key == ' ' && target.localName == 'a')) activate(target, options)
  }
  fire(target, 'keyup', ev)
  return true
}

/** type text into a field, one key press per character (keydown, input, keyup each) */
export function typeText(el: HostElement, text: string, options: UserAgentOptions = {}): void {
  if (el.ownerDocument.activeElement !== el) el.focus()
  for (const ch of text) pressKey(el, ch == '\n' ? 'Enter' : ch, {}, options)
}

/** replace a field's value in one step (an input event, then change), as a paste or an autofill */
export function fill(el: HostElement, value: string): void {
  if (el.ownerDocument.activeElement !== el) el.focus()
  el.value = value
  fire(el, 'input', {inputType: 'insertReplacementText', data: value})
  fire(el, 'change')
}

/** an <option>'s value: its value property or attribute, else its text */
export const optionValue = (o: HostElement): string => o.value || (o.getAttribute('value') ?? o.textContent.trim())
/** pick a <select>'s option by value or label: the value, then input and change */
export function chooseOption(select: HostElement, valueOrLabel: string): boolean {
  const o = select.options.find(o => optionValue(o) == valueOrLabel) || select.options.find(o => o.textContent.trim() == valueOrLabel)
  if (!o) return false
  select.value = optionValue(o)
  for (const x of select.options) x.selected = x === o
  fire(select, 'input')
  fire(select, 'change')
  return true
}
