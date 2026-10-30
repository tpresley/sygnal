/**
 * sygnal/agent-ui: the accessibility snapshot. The host tree as an LLM agent reads a page: roles,
 * accessible names, states and values, with a ref on each element it can act on. The format is
 * the YAML-like aria snapshot browser agents already know (Playwright's, Claude in Chrome's
 * read_page):
 *
 *   - heading "todos" [level=1]
 *   - textbox "What needs to be done?" [ref=e4]
 *   - list:
 *     - listitem:
 *       - checkbox "Toggle" [checked] [ref=e9]
 *       - generic "Write the spike" [ref=e10] [on=dblclick]
 *       - button "Delete" [ref=e11]
 *   - text: 1 item left
 *
 * What a browser can't give an agent: `on=…` lists the events the app's intents listen for on an
 * element that isn't a native control (Sygnal's intents are selectors, so the renderer knows
 * exactly which elements are interactive).
 */
import type {HostDocument, HostElement, HostNode, HostStyleRule} from '../host'
import {computeStyle, isInteractive, isTextField, labelTarget, nodeId, optionValue} from '../host'

export interface AgentNode {
  role: string
  name?: string
  /** `e<id>`: the element tools act on */
  ref?: string
  value?: string
  /** checked, disabled, expanded, pressed, selected, focused, required, level=n */
  states?: string[]
  /** events the app listens for on a non-native element */
  on?: string[]
  /** a text node's text */
  text?: string
  children?: AgentNode[]
}

const BLOCK = /^(root|div|section|header|footer|main|nav|article|aside|ul|ol|li|form|fieldset|h[1-6]|p|pre|table|tr|td|th|details|summary|dialog|blockquote|figure|figcaption|dl|dt|dd|hr|br|menu|search|label)$/
const NATIVE = /^(input|textarea|select|button|a|summary|option)$/
const LANDMARKS: Record<string, string> = {nav: 'navigation', main: 'main', aside: 'complementary', search: 'search', dialog: 'dialog'}

export function roleOf(el: HostElement): string | null {
  const r = el.getAttribute('role')
  if (r) return r.split(/\s+/)[0]
  const t = el.localName
  if (t == 'a') return el.hasAttribute('href') ? 'link' : null
  if (t == 'button' || t == 'summary') return 'button'
  if (t == 'input') {
    const ty = el.type || 'text'
    if (/^(button|submit|reset|image)$/.test(ty)) return 'button'
    if (ty == 'checkbox' || ty == 'radio') return ty
    if (ty == 'range') return 'slider'
    if (ty == 'number') return 'spinbutton'
    if (ty == 'search') return 'searchbox'
    if (ty == 'hidden' || ty == 'file') return null
    return 'textbox'
  }
  if (t == 'textarea') return 'textbox'
  if (t == 'select') return el.multiple ? 'listbox' : 'combobox'
  if (t == 'option') return 'option'
  if (/^h[1-6]$/.test(t)) return 'heading'
  if (t == 'ul' || t == 'ol' || t == 'menu') return 'list'
  if (t == 'li') return 'listitem'
  if (t == 'img') return el.getAttribute('alt') === '' ? null : 'img'
  if (t == 'table') return 'table'
  if (t == 'tr') return 'row'
  if (t == 'td') return 'cell'
  if (t == 'th') return 'columnheader'
  if (t == 'progress') return 'progressbar'
  if (t == 'fieldset' || t == 'details') return 'group'
  if (t == 'form') return el.getAttribute('aria-label') || el.getAttribute('name') ? 'form' : null
  if (t == 'section') return el.getAttribute('aria-label') ? 'region' : null
  return LANDMARKS[t] || null
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()
/** visible text, without hidden subtrees */
function textOf(n: HostNode, rules: readonly HostStyleRule[], skip?: HostElement): string {
  if (n.nodeType === 3) return (n as any).data
  const el = n as HostElement
  if (el === skip || computeStyle(el, rules).display == 'none' || el.getAttribute('aria-hidden') == 'true') return ''
  if (el.localName == 'input' || el.localName == 'select' || el.localName == 'textarea') return ''
  return el.childNodes.map(c => textOf(c, rules, skip)).join(BLOCK.test(el.localName) ? ' ' : '')
}

/** the accessible name: aria-label, aria-labelledby, a label, contents, alt / value / placeholder / title */
export function nameOf(el: HostElement, rules: readonly HostStyleRule[] = []): string {
  const a = el.getAttribute('aria-label')
  if (a) return squash(a)
  const by = el.getAttribute('aria-labelledby')
  if (by) return squash(by.split(/\s+/).map(id => { const t = el.ownerDocument.getElementById(id); return t ? textOf(t, rules) : '' }).join(' '))
  const t = el.localName
  if (t == 'input' || t == 'textarea' || t == 'select') {
    const id = el.id
    const lab = (id && el.ownerDocument.querySelector(`label[for="${id}"]`)) || el.closest('label')
    // (a label names its control even when it's visually hidden, as the browser's accessible name)
    const l = lab ? squash(textOf(lab, [], el)) : ''
    if (l) return l
    if (t == 'input' && /^(button|submit|reset)$/.test(el.type)) return el.getAttribute('value') || (el.type == 'reset' ? 'Reset' : 'Submit')
    return squash(el.placeholder || el.title || '')
  }
  if (t == 'img') return squash(el.getAttribute('alt') || el.title || '')
  return squash(textOf(el, rules)) || squash(el.title || '')
}

const CONTENT_NAMED = /^(button|link|heading|checkbox|radio|switch|textbox|searchbox|combobox|listbox|slider|spinbutton|option|img|columnheader|cell|tab|menuitem|treeitem|tooltip|progressbar)$/
const labelOnly = (el: HostElement, rules: readonly HostStyleRule[]) => {
  const a = el.getAttribute('aria-label')
  if (a) return squash(a)
  const by = el.getAttribute('aria-labelledby')
  if (by) return squash(by.split(/\s+/).map(id => { const t = el.ownerDocument.getElementById(id); return t ? textOf(t, rules) : '' }).join(' '))
  return squash(el.title || '')
}

export interface SnapshotOptions {
  rules?: readonly HostStyleRule[]
}

/** the host tree as agent nodes (generic containers flattened, their text merged into text nodes) */
export function snapshotTree(doc: HostDocument, options: SnapshotOptions = {}): AgentNode[] {
  const rules = options.rules || []
  // labels that name a control are read as that control's name, not again as text
  const naming = new Set<HostElement>()
  for (const l of doc.body.querySelectorAll('label')) {
    const t = labelTarget(l)
    if (t && t.localName != 'button') naming.add(l)
  }
  const kids = (el: HostElement): AgentNode[] => {
    const out: AgentNode[] = []
    let text = ''
    const flushText = () => { const t = squash(text); if (t) out.push({role: 'text', text: t}); text = '' }
    const visit = (n: HostNode) => {
      if (n.nodeType === 3) { text += (n as any).data; return }
      const c = n as HostElement
      const st = computeStyle(c, rules)
      if (st.display == 'none' || c.getAttribute('aria-hidden') == 'true') return
      const node = nodeFor(c)
      if (node) { flushText(); out.push(node); return }
      if (naming.has(c)) {
        // the label's own text names its control; any other content stays
        for (const x of c.childNodes) if (x.nodeType === 1) visit(x)
        return
      }
      const block = BLOCK.test(c.localName)
      if (block) flushText()
      for (const x of c.childNodes) visit(x)
      if (block) flushText()
    }
    for (const c of el.childNodes) visit(c)
    flushText()
    return out
  }
  const nodeFor = (el: HostElement): AgentNode | null => {
    const role = roleOf(el)
    const interactive = isInteractive(el, rules)
    const listened = NATIVE.test(el.localName) ? [] : el.ownerDocument.listenedTypes(el).filter(t => !/^(focus|blur|focusin|focusout)$/.test(t))
    if (!role && !(interactive && listened.length)) return null
    const node: AgentNode = {role: role || 'generic'}
    const leaf = /^(textbox|searchbox|checkbox|radio|slider|spinbutton|combobox|listbox|button|link|img|heading|option|progressbar)$/.test(node.role) || !role
    // a name from contents only for the roles that take one (ARIA "name from content"); a
    // landmark, list or group is named by aria-label / aria-labelledby / title only
    const name = !role || CONTENT_NAMED.test(node.role) ? nameOf(el, rules) : labelOnly(el, rules)
    if (name) node.name = name
    if (interactive) node.ref = 'e' + nodeId(el)
    if (listened.length) node.on = listened
    const states: string[] = []
    if (/^(checkbox|radio)$/.test(node.role)) { if (el.localName == 'input' ? el.checked : el.getAttribute('aria-checked') == 'true') states.push('checked') }
    if (el.disabled || el.getAttribute('aria-disabled') == 'true') states.push('disabled')
    for (const s of ['expanded', 'pressed', 'selected']) { const v = el.getAttribute('aria-' + s); if (v) states.push(v == 'true' ? s : `${s}=${v}`) }
    if (node.role == 'option' && el.selected) states.push('selected')
    if (el.required) states.push('required')
    if (node.role == 'heading') states.push('level=' + (+(el.getAttribute('aria-level') || el.localName.slice(1)) || 2))
    if (el.ownerDocument.activeElement === el) states.push('focused')
    if (states.length) node.states = states
    if (isTextField(el)) node.value = el.type == 'password' ? '•'.repeat([...el.value].length) : el.value
    if (el.localName == 'select') {
      const o = el.options.find(x => optionValue(x) == el.value)
      if (o) node.value = squash(o.textContent)
      node.children = el.options.map(x => ({role: 'option', name: squash(x.textContent), ...(x === o ? {states: ['selected']} : {})}))
      return node
    }
    if (!leaf) { const c = kids(el); if (c.length) node.children = c }
    return node
  }
  return kids(doc.body)
}

const q = (s: string) => JSON.stringify(s)
/** agent nodes as the YAML-like text */
export function formatSnapshot(nodes: AgentNode[], indent = ''): string {
  const lines: string[] = []
  for (const n of nodes) {
    if (n.role == 'text') { lines.push(`${indent}- text: ${n.text}`); continue }
    let line = `${indent}- ${n.role}`
    if (n.name) line += ' ' + q(n.name)
    for (const s of n.states || []) line += ` [${s}]`
    if (n.ref) line += ` [ref=${n.ref}]`
    if (n.on?.length) line += ` [on=${n.on.join(',')}]`
    if (n.value !== undefined && n.value !== '') line += ': ' + q(n.value)
    if (n.children?.length) lines.push(line + ':', formatSnapshot(n.children, indent + '  '))
    else lines.push(line)
  }
  return lines.join('\n')
}
