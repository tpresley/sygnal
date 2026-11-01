/**
 * sygnal/host: what a browser does for a user, on a host tree: the events and default actions of
 * a click, typing, a key press, focus order. A target maps its own input (keys in a terminal, an
 * agent's tool call, a native callback) to these, so every target produces the same DOM-shaped
 * events (D-AR-3: DOM event names everywhere) and intents don't change between targets.
 */
import {HostDocument, HostElement, HostEvent, optionValue} from './dom'
import {HostStyleRule, isHidden, isInert} from './style'

export {optionValue}

export interface UserAgentOptions {
  /** a link's default action (an <a href> clicked and not prevented) */
  onNavigate?: (href: string, el: HostElement) => void
  /** pressKey: false sends the keydown / keyup only (the target runs its own default action) */
  defaultAction?: boolean
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

/** a target's own field tags by kind (registerFieldTags): typed into, or toggled as a checkbox */
export const fieldKinds = new Map<string, 'text' | 'checkbox'>()

/** text-entry fields: typing edits their value */
export const isTextField = (el: HostElement): boolean =>
  el.localName == 'textarea' || fieldKinds.get(el.localName) == 'text' || (el.localName == 'input' && !/^(checkbox|radio|button|submit|reset|hidden|file|image|range|color)$/.test(el.type))
/** a checkbox or radio: an <input>'s, or a registered checkbox-kind tag (a switch) */
export const isCheckable = (el: HostElement): boolean =>
  fieldKinds.get(el.localName) == 'checkbox' || (el.localName == 'input' && (el.type == 'checkbox' || el.type == 'radio'))
const isBox = isCheckable
const isButton = (el: HostElement) => el.localName == 'button' || (el.localName == 'input' && /^(button|submit|reset)$/.test(el.type))

/** focusable: form fields, buttons, links with href, [tabindex] ≥ 0; not disabled, hidden or inert */
export function isFocusable(el: HostElement, rules?: readonly HostStyleRule[]): boolean {
  if (el.disabled || (el.localName == 'input' && el.type == 'hidden')) return false
  const t = el.getAttribute('tabindex')
  const ok = t != null ? +t >= 0
    : /^(input|textarea|select|button)$/.test(el.localName) || fieldKinds.has(el.localName) || (el.localName == 'a' && el.hasAttribute('href'))
      || (el.localName == 'summary' && el.parentNode?.localName == 'details')
  return ok && !isHidden(el, rules) && !isInert(el)
}

const POINTER = /^(click|dblclick|auxclick|contextmenu|mousedown|mouseup|pointerdown|pointerup)$/
/**
 * Interactive by intent: focusable, or an element the app listens to clicks on (an intent's
 * selector matches it: todomvc's dblclick on a todo's <label>). A target without a pointer (a
 * terminal, an agent) can reach those too; a browser user would click them.
 */
export function isInteractive(el: HostElement, rules?: readonly HostStyleRule[]): boolean {
  // an explicit tabindex="-1" takes it out (a roving tabindex: the tabs of a tablist other than the selected one)
  return isFocusable(el, rules) || (!el.disabled && !(+(el.getAttribute('tabindex') ?? 0) < 0) && el.ownerDocument.listenedTypes(el).some(t => POINTER.test(t)) && !isHidden(el, rules) && !isInert(el))
}

/**
 * The focusable elements in tab order (document order; positive tabindex first, as the DOM);
 * `listened: true` adds the elements the app listens to clicks on (isInteractive). While a modal
 * dialog is open, only its elements. A radio group is one stop: its checked radio (else its first)
 */
export function focusableElements(doc: HostDocument, rules?: readonly HostStyleRule[], options: {listened?: boolean} = {}): HostElement[] {
  const ok = options.listened ? isInteractive : isFocusable
  const all = (doc.topModal || doc.body).querySelectorAll('*').filter(el => ok(el, rules) && (!isRadio(el) || radioStop(el)))
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
  if (el.disabled || isInert(el)) return false
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
  else if ((el.localName == 'button' ? (el.getAttribute('type') || 'submit') == 'submit' : el.localName == 'input' && el.type == 'submit') && el.closest('form')) {
    submit(el.closest('form')!)
  } else if (isButton(el) && el.hasAttribute('commandfor')) invoke(el)
  else if (isButton(el) && el.hasAttribute('popovertarget')) {
    // a popover invoker: toggle (or show / hide) its popover; the focus goes back to it when the popover hides
    const p = el.ownerDocument.getElementById(el.getAttribute('popovertarget')!), act = el.getAttribute('popovertargetaction') || 'toggle'
    if (p && p.popover != null) act == 'show' ? p.showPopover() : act == 'hide' ? p.hidePopover() : p.togglePopover()
  } else if (el.localName == 'summary' && el.parentNode?.localName == 'details') el.parentNode.toggleAttribute('open')
  else if (el.localName == 'select') el.picker == null ? el.showPicker() : (el.picker = null)
  else if (el.localName == 'option') {
    const s = el.closest('select')
    if (s) { s.picker = null; chooseOption(s, optionValue(el)) }
  }
  return true
}
/**
 * An invoker button (commandfor + command): a cancelable command event on its target, then the
 * built-in command: show-modal, close, request-close, toggle-popover, show-popover, hide-popover
 * (a custom --command only sends the event)
 */
function invoke(el: HostElement) {
  const t = el.ownerDocument.getElementById(el.getAttribute('commandfor')!), command = el.getAttribute('command') || ''
  if (!t || !fire(t, 'command', {command, source: el, bubbles: false, cancelable: true})) return
  // (the button's value: its attribute, or the property the props module set)
  const v = el.getAttribute('value') ?? el.value
  if (command == 'show-modal' && t.localName == 'dialog' && !t.open) t.showModal()
  else if (command == 'close' && t.localName == 'dialog') t.close(v)
  else if (command == 'request-close' && t.localName == 'dialog') t.requestClose(v)
  else if (/^(toggle|show|hide)-popover$/.test(command) && t.popover != null) command[0] == 't' ? t.togglePopover() : command[0] == 's' ? t.showPopover() : t.hidePopover()
}
const isRadio = (el: HostElement) => el.localName == 'input' && el.type == 'radio' && !!el.name
const radioStop = (el: HostElement) => {
  const g = radioGroup(el).filter(r => !r.disabled)
  return el.checked || !g.some(r => r.checked) && g[0] === el || el.ownerDocument.activeElement === el
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
 * action, keyup. Defaults, as a browser's:
 * - a text field: a printable key inserts at the caret (replacing a selection), Backspace / Delete
 *   delete (with Alt or Ctrl: a word), ← / → / Home / End move the caret (Shift: select; Alt or
 *   Ctrl: by word), ↑ / ↓ move between a <textarea>'s lines, Enter submits an <input>'s form and
 *   breaks a <textarea>'s line; beforeinput (cancelable) and input events with their inputType;
 * - a <select>: Enter / Space / Alt+↓ / F4 open its option list (showPicker()); while open, ↑ / ↓
 *   / Home / End / PageUp / PageDown move the highlight, a letter jumps to an option, Enter /
 *   Space choose (input + change), Escape and Tab close it; closed, ← / → and a letter change it;
 * - a radio: the arrows check the next / previous radio of its group and focus it;
 * - Enter or Space activates a button / link / checkbox / [tabindex] element (Space toggles a
 *   checkbox);
 * - Escape: a modal dialog's close request (cancel, then close) unless it has closedby="none",
 *   else the last open auto popover hides.
 * Returns false when the keydown was prevented.
 */
export function pressKey(target: HostElement, key: string, init: KeyInit = {}, options: UserAgentOptions = {}): boolean {
  const ev = {key, code: key.length == 1 ? '' : key, keyCode: keyCode(key), which: keyCode(key), shiftKey: !!init.shiftKey, ctrlKey: !!init.ctrlKey, altKey: !!init.altKey, metaKey: !!init.metaKey, repeat: false}
  if (!fire(target, 'keydown', ev)) return fire(target, 'keyup', ev), false
  const plain = !ev.ctrlKey && !ev.altKey && !ev.metaKey
  if (options.defaultAction === false) {
    // the caller's own default action
  } else if (target.localName == 'select' && selectKey(target, key, ev)) {
    // handled by the option list
  } else if (isTextField(target) && (plain || /^(Backspace|Delete|Arrow|Home|End)/.test(key) || (ev.ctrlKey || ev.metaKey) && !ev.altKey && key == 'a')) {
    textKey(target, key, ev, plain)
  } else if (isRadio(target) && plain && /^Arrow/.test(key)) {
    const g = radioGroup(target).filter(r => !r.disabled && !isInert(r)), i = g.indexOf(target)
    const to = g[(i + (key == 'ArrowDown' || key == 'ArrowRight' ? 1 : -1) + g.length) % g.length]
    if (to && to !== target) { to.focus(); if (!to.checked) activate(to, options) }
  } else if (plain && (key == 'Enter' && !isBox(target) || key == ' ') && (isButton(target) || isBox(target) || target.localName == 'a' || target.localName == 'summary' || target.hasAttribute('tabindex'))) {
    if (!(key == ' ' && target.localName == 'a')) activate(target, options)
  } else if (key == 'Escape') {
    const d = target.ownerDocument, m = d.topModal, pop = [...d.popovers].reverse().find(p => p.popover == 'auto')
    if (pop) pop.hidePopover()
    else if (m && !/^none$/i.test(m.getAttribute('closedby') || '')) m.requestClose()
  }
  fire(target, 'keyup', ev)
  return true
}

// ── text fields ──────────────────────────────────────────────────────
const seg: any = typeof Intl != 'undefined' && (Intl as any).Segmenter ? new (Intl as any).Segmenter() : null
/** the grapheme boundaries of a string (UTF-16 offsets, 0 and its length included) */
const bounds = (s: string): number[] => {
  const out = [0]
  if (seg) for (const g of seg.segment(s)) { if (g.index) out.push(g.index) }
  else for (let i = 0, c: number; i < s.length; i += c > 0xffff ? 2 : 1) { c = s.codePointAt(i)!; if (i) out.push(i) }
  out.push(s.length)
  return out
}
const prevB = (s: string, i: number) => [...bounds(s)].reverse().find(b => b < i) ?? 0
const nextB = (s: string, i: number) => bounds(s).find(b => b > i) ?? s.length
const isWord = (c: string) => /[\p{L}\p{N}_]/u.test(c)
const wordLeft = (s: string, i: number) => { while (i > 0 && !isWord(s[i - 1])) i--; while (i > 0 && isWord(s[i - 1])) i--; return i }
const wordRight = (s: string, i: number) => { while (i < s.length && !isWord(s[i])) i++; while (i < s.length && isWord(s[i])) i++; return i }
const lineStart = (s: string, i: number) => s.lastIndexOf('\n', i - 1) + 1
const lineEnd = (s: string, i: number) => { const j = s.indexOf('\n', i); return j < 0 ? s.length : j }
const multiline = (el: HostElement) => el.localName == 'textarea'

/** replace the value's [start, end) with `text` as an edit: beforeinput (cancelable), the value and caret, input */
function edit(el: HostElement, start: number, end: number, text: string, inputType: string): boolean {
  if (el.readOnly || el.disabled) return false
  if (!multiline(el)) text = text.replace(/\r?\n/g, ' ')
  const max = el.getAttribute('maxlength')
  if (max != null && +max >= 0) text = text.slice(0, Math.max(0, +max - (el.value.length - (end - start))))
  if (!text && start == end) return false
  if (!fire(el, 'beforeinput', {data: text || null, inputType, cancelable: true})) return false
  const v = el.value
  el.value = v.slice(0, start) + text + v.slice(end)
  el.setSelectionRange(start + text.length, start + text.length)
  fire(el, 'input', {data: text || null, inputType})
  return true
}
const DELETE: Record<string, (s: string, i: number) => number> = {
  deleteContentBackward: prevB, deleteContentForward: nextB, deleteWordBackward: wordLeft, deleteWordForward: wordRight,
  deleteSoftLineBackward: lineStart, deleteSoftLineForward: lineEnd,
}
/**
 * An editing command on a text field, by its Input Events inputType: 'insertText' (with `data`),
 * 'insertLineBreak', 'insertFromPaste' (with `data`), 'deleteContentBackward' / 'Forward',
 * 'deleteWordBackward' / 'Forward', 'deleteSoftLineBackward' / 'Forward' (to the line's start /
 * end). A selection is replaced or deleted first. Returns whether the value changed.
 */
export function editText(el: HostElement, inputType: string, data = ''): boolean {
  const v = el.value, s = el.selectionStart, e = el.selectionEnd
  if (/^insert/.test(inputType)) return edit(el, s, e, inputType == 'insertLineBreak' ? '\n' : data, inputType)
  if (s != e) return edit(el, s, e, '', inputType)
  const to = DELETE[inputType]?.(v, s)
  if (to == null || to == s) return false
  return edit(el, Math.min(s, to), Math.max(s, to), '', inputType)
}
/**
 * Move a text field's caret: 'left' 'right' 'wordLeft' 'wordRight' 'lineStart' 'lineEnd' 'start'
 * 'end' 'up' 'down' (a textarea's lines; the first / last line goes to the start / end); `extend`
 * moves the selection's focus end instead (Shift)
 */
export function moveCaret(el: HostElement, to: string, extend = false): void {
  const v = el.value, s = el.selectionStart, e = el.selectionEnd
  // the selection's moving end, and its anchor
  const back = el.selectionDirection == 'backward', head = back ? s : e, anchor = back ? e : s
  if (!extend && s != e && (to == 'left' || to == 'right')) return el.setSelectionRange(to == 'left' ? s : e, to == 'left' ? s : e)
  let i = head
  if (to == 'left') i = prevB(v, head)
  else if (to == 'right') i = nextB(v, head)
  else if (to == 'wordLeft') i = wordLeft(v, head)
  else if (to == 'wordRight') i = wordRight(v, head)
  else if (to == 'lineStart') i = multiline(el) ? lineStart(v, head) : 0
  else if (to == 'lineEnd') i = multiline(el) ? lineEnd(v, head) : v.length
  else if (to == 'start') i = 0
  else if (to == 'end') i = v.length
  else if (to == 'up' || to == 'down') {
    const ls = lineStart(v, head), col = [...v.slice(ls, head)].length
    if (to == 'up') i = ls == 0 ? 0 : (() => { const ps = lineStart(v, ls - 1); return ps + Math.min(col, ls - 1 - ps) })()
    else { const le = lineEnd(v, head); i = le == v.length ? v.length : (() => { const ns = le + 1, ne = lineEnd(v, ns); return ns + Math.min(col, ne - ns) })() }
  }
  if (!extend) return el.setSelectionRange(i, i)
  el.setSelectionRange(Math.min(anchor, i), Math.max(anchor, i), i < anchor ? 'backward' : 'forward')
}
function textKey(el: HostElement, key: string, ev: KeyInit, plain: boolean) {
  const word = ev.altKey || ev.ctrlKey, x = !!ev.shiftKey
  if (key == 'a' && !plain) return el.select()
  if (key.length == 1 || (key == 'Enter' && multiline(el))) return editText(el, key == 'Enter' ? 'insertLineBreak' : 'insertText', key)
  if (key == 'Enter') { const f = el.closest('form'); if (f) submit(f); return }
  if (key == 'Backspace') return editText(el, word ? 'deleteWordBackward' : 'deleteContentBackward')
  if (key == 'Delete') return editText(el, word ? 'deleteWordForward' : 'deleteContentForward')
  if (key == 'ArrowLeft' || key == 'ArrowRight') return moveCaret(el, (word ? 'word' + key.slice(5) : key.slice(5).toLowerCase()), x)
  if (key == 'Home' || key == 'End') return moveCaret(el, ev.ctrlKey || ev.metaKey ? (key == 'Home' ? 'start' : 'end') : (key == 'Home' ? 'lineStart' : 'lineEnd'), x)
  if ((key == 'ArrowUp' || key == 'ArrowDown') && multiline(el)) return moveCaret(el, key == 'ArrowUp' ? 'up' : 'down', x)
}

/** a paste into the focused field: a paste event (cancelable), then the text inserted at the caret */
export function paste(el: HostElement, text: string): boolean {
  const data = {getData: (t: string) => (/^text(\/plain)?$/i.test(t) ? text : ''), types: ['text/plain']}
  if (!fire(el, 'paste', {clipboardData: data, cancelable: true})) return false
  return isTextField(el) && editText(el, 'insertFromPaste', text)
}

// ── a <select>'s option list ─────────────────────────────────────────
const usable = (o: HostElement) => !o.disabled && !(o.parentNode?.localName == 'optgroup' && o.parentNode.disabled)
/** the next usable option from `i` in direction `d` (1 / -1), staying put at the ends */
const stepOption = (opts: HostElement[], i: number, d: number, n = 1) => {
  let j = i
  for (let k = i + d; k >= 0 && k < opts.length && n > 0; k += d) if (usable(opts[k])) { j = k; n-- }
  return j
}
// a letter jumps to the next option whose label starts with it
const typeAhead = (opts: HostElement[], from: number, ch: string) => {
  for (let k = 1; k <= opts.length; k++) {
    const o = opts[(from + k) % opts.length]
    if (usable(o) && o.textContent.trim().toLowerCase().startsWith(ch.toLowerCase())) return (from + k) % opts.length
  }
  return -1
}
function selectKey(el: HostElement, key: string, ev: KeyInit): boolean {
  const opts = el.options, open = el.picker != null, plain = !ev.ctrlKey && !ev.altKey && !ev.metaKey
  if (!open) {
    if (el.disabled) return false
    if ((plain && (key == 'Enter' || key == ' ')) || key == 'F4' || (ev.altKey && (key == 'ArrowDown' || key == 'ArrowUp'))) { el.showPicker(); return true }
    const i = el.selectedIndex
    let j = -1
    if (plain && (key == 'ArrowRight' || key == 'ArrowLeft')) j = stepOption(opts, i, key == 'ArrowRight' ? 1 : -1)
    else if (plain && key.length == 1 && key != ' ') j = typeAhead(opts, i, key)
    else return false
    if (j >= 0 && j != i) chooseOption(el, optionValue(opts[j]))
    return true
  }
  const i = el.picker!
  if (key == 'Escape' || key == 'Tab') el.picker = null
  else if (key == 'Enter' || key == ' ') {
    el.picker = null
    const o = opts[i]
    if (o && usable(o) && optionValue(o) !== el.value) chooseOption(el, optionValue(o))
  } else if (key == 'ArrowDown' || key == 'ArrowUp') el.picker = stepOption(opts, i, key == 'ArrowDown' ? 1 : -1)
  else if (key == 'PageDown' || key == 'PageUp') el.picker = stepOption(opts, i, key == 'PageDown' ? 1 : -1, 8)
  else if (key == 'Home') el.picker = stepOption(opts, -1, 1)
  else if (key == 'End') el.picker = stepOption(opts, opts.length, -1)
  else if (plain && key.length == 1) { const j = typeAhead(opts, i, key); if (j >= 0) el.picker = j }
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
