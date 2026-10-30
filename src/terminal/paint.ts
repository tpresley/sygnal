/**
 * sygnal/terminal: the painter. A line-flow layout of the host tree (block elements start lines,
 * inline content flows and wraps at the width, lists indent with bullets or numbers), form
 * widgets drawn as text, and the focused element marked. Two outputs from one pass: plain text
 * (tests, logs, snapshots) and ANSI-styled lines (a TTY).
 */
import type {HostDocument, HostElement, HostNode, HostStyle} from '../host'
import {computeStyle, isTextField, isCheckable, optionValue} from '../host'

export interface TerminalStyle extends HostStyle {
  /** 'none' hides; 'block' / 'inline' override the tag's default */
  display?: string
  /** text added before / after the element's content */
  before?: string
  after?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  inverse?: boolean
  /** an ANSI color: black red green yellow blue magenta cyan white gray (bright: brightRed, …) */
  color?: string
  /** the element's text in upper case */
  upper?: boolean
}
export type TerminalStyleRule = [selector: string, style: TerminalStyle]

/** applied before an app's own rules */
export const defaultTerminalStyles: TerminalStyleRule[] = [
  ['h1, h2, h3, h4, h5, h6, th, strong, b, legend', {bold: true}],
  ['em, i, cite', {italic: true}],
  ['a[href]', {underline: true, color: 'cyan'}],
  ['code, kbd', {color: 'yellow'}],
  ['script, style, template, head, title, noscript', {display: 'none'}],
  ['input[type="hidden"]', {display: 'none'}],
  ['[disabled]', {dim: true}],
]

const BLOCK = /^(root|div|section|header|footer|main|nav|article|aside|ul|ol|li|form|fieldset|h[1-6]|p|pre|table|tr|details|summary|dialog|blockquote|figure|figcaption|address|dl|dt|dd|hr|menu|search)$/
const COLORS: Record<string, number> = {black: 30, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37, gray: 90, grey: 90}
const sgrOf = (st: TerminalStyle): number[] => {
  const c: number[] = []
  if (st.bold) c.push(1)
  if (st.dim) c.push(2)
  if (st.italic) c.push(3)
  if (st.underline) c.push(4)
  if (st.inverse) c.push(7)
  if (st.color) {
    const m = /^bright(\w+)$/.exec(st.color), base = COLORS[(m ? m[1] : st.color).toLowerCase()]
    if (base) c.push(m ? base + 60 : base)
  }
  return c
}

type Seg = {text: string, sgr: number[]}
export interface Frame {
  /** plain text, one string per line */
  plain: string[]
  /** the same lines with ANSI styles */
  ansi: string[]
  /** the line the focused element is on (-1: none) */
  focusLine: number
}
export interface PaintOptions {
  rules?: readonly TerminalStyleRule[]
  width?: number
}

const visible = (segs: Seg[]) => segs.reduce((n, s) => n + [...s.text].length, 0)
function wrap(segs: Seg[], width: number): Seg[][] {
  if (width <= 0 || visible(segs) <= width) return [segs]
  // words with their styles; a word longer than the width is cut
  const words: Seg[][] = [[]]
  for (const s of segs) for (const part of s.text.split(/( )/)) {
    if (part == ' ') words.push([{text: ' ', sgr: s.sgr}], [])
    else if (part) words[words.length - 1].push({text: part, sgr: s.sgr})
  }
  const lines: Seg[][] = [[]]
  let n = 0
  for (const w of words) {
    const len = visible(w)
    if (!len) continue
    const space = w.length == 1 && w[0].text == ' '
    if (n + len > width && n > 0 && !space) { lines.push([]); n = 0 }
    if (space && n == 0) continue
    for (const s of w) {
      let t = [...s.text]
      while (n + t.length > width && width > 0) {
        const take = Math.max(1, width - n)
        lines[lines.length - 1].push({text: t.slice(0, take).join(''), sgr: s.sgr})
        t = t.slice(take); lines.push([]); n = 0
      }
      if (t.length) { lines[lines.length - 1].push({text: t.join(''), sgr: s.sgr}); n += t.length }
    }
  }
  return lines
}

/** paint a host document */
export function paint(doc: HostDocument, options: PaintOptions = {}): Frame {
  const rules = [...defaultTerminalStyles, ...(options.rules || [])]
  const width = options.width ?? 80
  const plain: string[] = [], ansi: string[] = []
  let cur: Seg[] = [], focusLine = -1, focusHere = false
  // a list item's marker waits for the item's first line
  let marker = ''

  const push = (text: string, sgr: number[], upper: boolean) => { if (text) cur.push({text: upper ? text.toUpperCase() : text, sgr}) }
  const flush = (indent: string, force = false) => {
    // collapse the whitespace runs across segments; trim the line's ends
    const segs: Seg[] = []
    let prevSpace = true
    for (const s of cur) {
      let t = ''
      for (const ch of s.text.replace(/\s/g, ' ')) { if (ch == ' ' && prevSpace) continue; t += ch; prevSpace = ch == ' ' }
      if (t) segs.push({text: t, sgr: s.sgr})
    }
    while (segs.length && /^ *$/.test(segs[segs.length - 1].text)) segs.pop()
    if (segs.length) segs[segs.length - 1].text = segs[segs.length - 1].text.replace(/ +$/, '')
    cur = []
    if (!segs.length && !force) return
    const lines = wrap(segs, width - indent.length)
    for (const l of lines) if (l.length) l[l.length - 1] = {...l[l.length - 1], text: l[l.length - 1].text.replace(/ +$/, '')}
    lines.forEach((line, i) => {
      const lead = i == 0 && marker ? indent.slice(0, indent.length - marker.length) + marker : indent
      // (\uE000: a <pre>'s kept space)
      plain.push((lead + line.map(s => s.text).join('')).replace(/\uE000/g, ' '))
      ansi.push((lead + line.map(s => s.sgr.length ? `\x1b[${s.sgr.join(';')}m${s.text}\x1b[0m` : s.text).join('')).replace(/\uE000/g, ' '))
    })
    if (lines.length) marker = ''
    if (focusHere) { focusLine = plain.length - lines.length; focusHere = false }
  }
  const label = (el: HostElement) => (el.textContent.trim() || el.getAttribute('value') || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ')

  // flex: a column's children each take their own lines, a row's are separated (their gap)
  const walk = (n: HostNode, indent: string, sgr: number[], upper: boolean, flex: '' | 'column' | 'row' = '') => {
    if (n.nodeType === 3) return push((n as any).data, sgr, upper)
    const el = n as HostElement
    const st0: TerminalStyle = computeStyle(el, rules)
    if (st0.display == 'none') return
    if (flex == 'column') { flush(indent); walkEl(el, indent, sgr, upper, st0); return flush(indent) }
    walkEl(el, indent, sgr, upper, st0)
    if (flex == 'row') push(' ', sgr, false)
  }
  const walkEl = (el: HostElement, indent: string, sgr: number[], upper: boolean, st: TerminalStyle) => {
    const tag = el.localName
    const flexKids: '' | 'column' | 'row' = /flex$/.test(st.display || '') ? (/^column/.test(st.flexDirection || '') ? 'column' : 'row') : ''
    const focused = el.ownerDocument.activeElement === el
    const blockTag = BLOCK.test(tag)
    const block = st.display ? !/^inline/.test(st.display) && st.display != 'contents' : blockTag
    const s = [...sgr, ...sgrOf(st)], up = upper || !!st.upper
    const mark = focused ? s.concat(7) : s
    if (focused) focusHere = true
    // a widget is a box: spaces around it (collapsed with any next to it)
    const widget = (text: string) => { push(' ' + (st.before || ''), s, up); push(focused ? '▸' : '', s, false); push(text, mark, false); push((st.after || '') + ' ', s, up) }
    if (tag == 'br') return flush(indent, true)
    if (tag == 'hr') { flush(indent); push('─'.repeat(Math.max(3, width - indent.length)), [...s, 2], false); return flush(indent) }
    if (tag == 'img') return widget(`[${el.getAttribute('alt') || 'image'}]`)
    if (isCheckable(el)) {
      return widget(el.type == 'radio' ? (el.checked ? '(•)' : '( )') : (el.checked ? '[x]' : '[ ]'))
    }
    if (isTextField(el)) {
      const v = el.type == 'password' ? '•'.repeat([...el.value].length) : el.value.replace(/\n/g, '⏎')
      return widget('[' + (v || (focused ? '' : el.placeholder)) + (focused ? '_' : '') + ']')
    }
    if (tag == 'select') {
      const o = el.options.find(o => optionValue(o) == el.value) || el.options[0]
      return widget(`[${o ? o.textContent.trim() : ''} ▾]`)
    }
    if (tag == 'button' || (tag == 'input' && /^(button|submit|reset)$/.test(el.type))) return widget(`[${label(el) || (el.type == 'submit' ? 'Submit' : '…')}]`)

    if (block) {
      flush(indent)
      let inner = indent
      // a list indents when its items are blocks (a row of inline items, a nav's, doesn't)
      if ((tag == 'ul' || tag == 'ol' || tag == 'menu') && el.children.some(c => c.localName == 'li' && !/^inline/.test(computeStyle(c, rules).display || ''))) inner = indent + '  '
      if (tag == 'li') {
        const p = el.parentNode
        marker = p?.localName == 'ol' ? `${p.children.filter(c => c.localName == 'li').indexOf(el) + 1}. ` : '• '
        inner = indent + ' '.repeat(marker.length)
      }
      if (tag == 'blockquote' || tag == 'dd') inner = indent + '  '
      push(st.before || '', s, up)
      if (tag == 'pre') {
        for (const line of el.textContent.split('\n')) { push(line.replace(/ /g, '\uE000'), s, up); flush(inner, true) }
      } else for (const c of el.childNodes) walk(c, inner, s, up, flexKids)
      push(st.after || '', s, up)
      flush(inner)
      if (tag == 'li') marker = ''
      return
    }
    if (focused) push('▸', s, false)
    push(st.before || '', focused ? mark : s, up)
    for (const c of el.childNodes) walk(c, indent, focused ? mark : s, up, flexKids)
    push(st.after || '', s, up)
    // a block tag shown inline (a nav's <li>s in a row) is separated like a box
    if (blockTag) push(' ', s, false)
  }
  walk(doc.body, '', [], false)
  flush('')
  return {plain, ansi, focusLine}
}
