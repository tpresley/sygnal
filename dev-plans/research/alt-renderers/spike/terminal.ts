/**
 * A terminal renderer over the host tree: layout + paint to lines of text, a focus ring, and the
 * keyboard turned into the DOM-shaped events intents already listen for (click, input, keydown,
 * keyup, submit, change, focus, blur, dblclick). No dependency: plain text frames, so tests can
 * compare them; demo.ts writes them to a TTY.
 *
 * Platform styling lives here, as CSS does on the web: `styles` is a tiny stylesheet of selector →
 * {display, before, after, upper} rules (todomvc's CSS hides `.edit` unless `.editing`; the
 * terminal sheet says the same).
 */
import {HostDocument, HostElement, HostEvent, HostNode, HostText} from './host'
import {makeHostDriver} from './hostDriver'
import {matches} from './selector'

export type TermStyle = {display?: 'none' | 'block' | 'inline', before?: string, after?: string, upper?: boolean}
export type TermRule = [selector: string, style: TermStyle]

const BLOCK = /^(root|div|section|header|footer|main|nav|ul|ol|li|form|h[1-6]|p|view|box|column|row|screen)$/
const FOCUSABLE = 'input, button, a, label, pressable, textinput, toggle, [tabindex]'

export interface TerminalOptions {
  styles?: TermRule[]
  /** a link's default action (an <a href> activated and not prevented) */
  onNavigate?: (href: string) => void
  onFrame?: (frame: string) => void
}

// autoFocus and Transition schedule with requestAnimationFrame (src/pragma, markers/transition):
// a host without frames gets a timer (README §1, coupling C9)
if (typeof (globalThis as any).requestAnimationFrame != 'function') {
  ;(globalThis as any).requestAnimationFrame = (f: () => void) => setTimeout(f, 0)
}

export function createTerminal(opts: TerminalOptions = {}) {
  const doc = new HostDocument()
  const styles = opts.styles || []
  let patches = 0
  const styleOf = (el: HostElement): TermStyle => {
    const out: TermStyle = {}
    for (const [sel, s] of styles) if (matches(el, sel)) Object.assign(out, s)
    if (el.hasAttribute('hidden')) out.display = 'none'
    return out
  }
  const visible = (el: HostElement): boolean => {
    for (let e: HostElement | null = el; e; e = e.parentNode) if (styleOf(e).display == 'none') return false
    return true
  }
  const focusables = (): HostElement[] => [...doc.body.querySelectorAll(FOCUSABLE)].filter((e) => visible(e) && !e.disabled)

  // ------------------------------------------------------------------ paint
  function frame(): string {
    const lines: string[] = []
    let cur = ''
    // a pending bullet stays for the first line of the item's content
    const flush = (indent: string) => { if (/^\s*(• )?$/.test(cur)) return; lines.push(indent + cur.replace(/\s+/g, ' ').trim()); cur = '' }
    const label = (el: HostElement) => el.textContent.trim() || el.getAttribute('aria-label') || ''
    const walk = (n: HostNode, indent: string) => {
      if (n instanceof HostText) { cur += n.data.replace(/\s+/g, ' '); return }
      const el = n as HostElement, st = styleOf(el)
      if (st.display == 'none') return
      const block = st.display ? st.display == 'block' : BLOCK.test(el.localName)
      const focused = doc.activeElement === el
      const mark = focused ? '▸' : ''
      if (block) flush(indent)
      // lists indent; other blocks only break lines
      const inner = el.localName == 'ul' || el.localName == 'ol' ? indent + '  ' : indent
      let text = st.before || ''
      const tag = el.localName
      if (tag == 'li' && block) text = '• ' + text
      if (tag == 'input' || tag == 'textinput' || tag == 'toggle') {
        if (el.type == 'checkbox' || tag == 'toggle') text += mark + (el.checked ? '[x]' : '[ ]')
        else text += mark + '[' + (el.value || (focused ? '' : el.placeholder)) + (focused ? '_' : '') + ']'
        cur += text + (st.after || '') + ' '
        return
      }
      if (tag == 'button' || tag == 'pressable') { cur += mark + '[' + label(el) + ']' + (st.after || '') + ' '; return }
      cur += mark + text
      const start = lines.length, at = cur.length
      for (const c of el.childNodes) walk(c, inner)
      if (st.upper && lines.length == start) cur = cur.slice(0, at) + cur.slice(at).toUpperCase()
      cur += st.after || ''
      if (block) flush(indent)
      else cur += ' '
    }
    walk(doc.body, '')
    flush('')
    return lines.join('\n')
  }

  doc.onChange = () => opts.onFrame?.(frame())

  // ------------------------------------------------------------------ input
  const fire = (el: HostElement, type: string, init: Record<string, any> = {}) => el.dispatchEvent(new HostEvent(type, init))
  const formOf = (el: HostElement) => el.closest('form')
  const KEYS: Record<string, [string, number]> = {enter: ['Enter', 13], escape: ['Escape', 27], backspace: ['Backspace', 8], space: [' ', 32]}

  function moveFocus(d: 1 | -1) {
    const list = focusables()
    if (!list.length) return
    const i = doc.activeElement ? list.indexOf(doc.activeElement) : -1
    list[(i + d + list.length) % list.length].focus()
  }
  function focused(): HostElement | null {
    if (!doc.activeElement) moveFocus(1)
    return doc.activeElement
  }
  /** a click and its default action (a checkbox toggles, a label clicks its control, a link navigates, a submit button submits) */
  function activate(el: HostElement) {
    const box = el.localName == 'toggle' || (el.localName == 'input' && el.type == 'checkbox')
    if (box) el.checked = !el.checked
    const ok = fire(el, 'click')
    if (box) { if (!ok) el.checked = !el.checked; else { fire(el, 'input'); fire(el, 'change') } return }
    if (!ok) return
    if (el.localName == 'label') {
      const f = el.getAttribute('for'), t = f ? doc.body.querySelector('#' + f) : el.querySelector('input')
      if (t) activate(t)
    } else if (el.localName == 'a' && el.getAttribute('href')) opts.onNavigate?.(el.getAttribute('href')!)
    else if (el.localName == 'button' && (el.type || 'submit') == 'submit' && formOf(el)) fire(formOf(el)!, 'submit')
  }

  function press(key: string) {
    if (key == 'tab' || key == 'down') return moveFocus(1)
    if (key == 'shift-tab' || key == 'up') return moveFocus(-1)
    const el = focused()
    if (!el) return
    if (key == 'f2') return void fire(el, 'dblclick')
    const textual = (el.localName == 'input' && el.type != 'checkbox') || el.localName == 'textinput'
    const [k, code] = KEYS[key] || [key, key.length == 1 ? key.toUpperCase().charCodeAt(0) : 0]
    if (!fire(el, 'keydown', {key: k, keyCode: code})) return
    if (textual && key == 'backspace') { el.value = el.value.slice(0, -1); fire(el, 'input') }
    else if (textual && (key.length == 1 || key == 'space')) { el.value += key == 'space' ? ' ' : key; fire(el, 'input') }
    else if (textual && key == 'enter') { const f = formOf(el); if (f) fire(f, 'submit') }
    else if (!textual && (key == 'enter' || key == 'space')) activate(el)
    fire(el, 'keyup', {key: k, keyCode: code})
  }
  const type = (text: string) => { for (const c of text) press(c == ' ' ? 'space' : c) }

  const driver = makeHostDriver(doc, {onPatch: () => { patches++ }})
  return {
    doc, driver, frame, press, type, focusables,
    focus: (sel: string) => doc.body.querySelector(sel)?.focus(),
    get patches() { return patches },
  }
}

export type Terminal = ReturnType<typeof createTerminal>
