/**
 * sygnal/terminal: the painter. A line-flow layout of the host tree (block elements start lines,
 * inline content flows and wraps at the width, lists indent with bullets or numbers), form
 * widgets drawn as text, and the focused element marked. Boxes (TUI spike): an element whose
 * terminal style has a width, height, border, padding or overflow is laid out in a rectangle of
 * its own (a flex row of sized children side by side, a flex column sharing a height, a
 * scrolling region with a scrollbar that keeps the focus in view). Open modal dialogs, open
 * popovers and a <select>'s open option list are drawn over the page (the top layer). Widths are
 * terminal cells: graphemes, with wide (CJK, emoji) ones two cells. Two outputs from one pass:
 * plain text (tests, logs, snapshots) and ANSI-styled lines (a TTY), plus where each element is
 * (hit regions: a mouse click) and the caret.
 */
import type {HostDocument, HostElement, HostNode, HostStyle} from '../host'
import {computeStyle, matches, isTextField, isCheckable, optionValue, closedByHost} from '../host'

export interface TerminalStyle extends HostStyle {
  /** 'none' hides; 'block' / 'inline' override the tag's default; 'flex' with flexDirection */
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
  /** the background, the same colors */
  background?: string
  /** the element's text in upper case */
  upper?: boolean
  /** a box's width in cells, or a percentage of the space it is in ('30%') */
  width?: number | string
  /** a box's height in rows, or a percentage of its parent box's (the screen's for the root) */
  height?: number | string
  /** in a flex row or column: the share of the space left (1, 2, …) */
  flex?: number
  /** a box's border: true / 'single', 'round', 'double', 'heavy' */
  border?: boolean | 'single' | 'round' | 'double' | 'heavy'
  borderColor?: string
  /** cells inside the border: n (all sides) or [vertical, horizontal] */
  padding?: number | [number, number]
  /** a box with a height: 'auto' / 'scroll' scroll (a scrollbar; the focus kept in view), 'hidden' crops; default: the content's height */
  overflow?: 'visible' | 'hidden' | 'auto' | 'scroll'
  /** between the items of a flex row (cells, default 1) */
  gap?: number
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
  ['dialog', {border: 'round', padding: [0, 1]}],
]

const BLOCK = /^(root|div|section|header|footer|main|nav|article|aside|ul|ol|li|form|fieldset|h[1-6]|p|pre|table|tr|details|summary|dialog|blockquote|figure|figcaption|address|dl|dt|dd|hr|menu|search)$/
const COLORS: Record<string, number> = {black: 30, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37, gray: 90, grey: 90}
const colorCode = (name: string, bg: boolean) => {
  const m = /^bright(\w+)$/.exec(name), base = COLORS[(m ? m[1] : name).toLowerCase()]
  return base ? (m ? base + 60 : base) + (bg ? 10 : 0) : 0
}
const sgrOf = (st: TerminalStyle): number[] => {
  const c: number[] = []
  if (st.bold) c.push(1)
  if (st.dim) c.push(2)
  if (st.italic) c.push(3)
  if (st.underline) c.push(4)
  if (st.inverse) c.push(7)
  if (st.color && colorCode(st.color, false)) c.push(colorCode(st.color, false))
  if (st.background && colorCode(st.background, true)) c.push(colorCode(st.background, true))
  return c
}

// ── cells: graphemes and their widths ────────────────────────────────
const segmenter: any = typeof Intl != 'undefined' && (Intl as any).Segmenter ? new (Intl as any).Segmenter() : null
/** a string's graphemes (user-perceived characters) */
export const graphemes = (s: string): string[] => segmenter ? Array.from(segmenter.segment(s), (g: any) => g.segment) : [...s]
const WIDE: [number, number][] = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf],
  [0xa960, 0xa97f], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60],
  [0xffe0, 0xffe6], [0x1f300, 0x1f64f], [0x1f900, 0x1f9ff], [0x20000, 0x2fffd], [0x30000, 0x3fffd],
]
const ZERO = /^[\p{Mn}\p{Me}\p{Cf}​⁠﻿]+$/u
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️|\p{Regional_Indicator}/u
/** a grapheme's width in terminal cells: 0 (combining, controls), 1, or 2 (CJK, fullwidth, emoji) */
export function charWidth(g: string): number {
  const c = g.codePointAt(0) || 0
  if (c < 32 || (c >= 0x7f && c < 0xa0) || ZERO.test(g)) return 0
  if (c < 0x1100) return 1
  if (EMOJI.test(g)) return 2
  for (const [a, b] of WIDE) if (c >= a && c <= b) return 2
  return 1
}
/** a string's width in terminal cells */
export const stringWidth = (s: string): number => {
  // (ASCII: one cell a character)
  if (/^[\x20-\x7e]*$/.test(s)) return s.length
  let n = 0
  for (const g of graphemes(s)) n += charWidth(g)
  return n
}

// ── lines of styled segments ─────────────────────────────────────────
/** a run of text with its styles; `el` the element it belongs to (hit regions), `caret` the caret cell */
type Seg = {text: string, sgr: number[], el?: HostElement, caret?: boolean}
type Line = Seg[]
/** where an element is drawn: a run of cells on one line */
export interface Hit {line: number, col: number, width: number, el: HostElement}
interface Block {lines: Line[]}

const lineWidth = (l: Line) => l.reduce((n, s) => n + stringWidth(s.text), 0)
const blank = (n: number, sgr: number[] = []): Seg => ({text: ' '.repeat(Math.max(0, n)), sgr})
/** the cells [from, to) of a line (a wide grapheme cut in half becomes a space) */
function cut(line: Line, from: number, to = Infinity): Line {
  const out: Line = []
  let col = 0
  for (const s of line) {
    const w = stringWidth(s.text)
    if (col + w <= from || col >= to) { col += w; continue }
    if (col >= from && col + w <= to) { out.push(s); col += w; continue }
    let t = ''
    for (const g of graphemes(s.text)) {
      const gw = charWidth(g)
      if (col >= from && col + gw <= to) t += g
      else if (col < to && col + gw > from) t += ' '.repeat(Math.min(to, col + gw) - Math.max(from, col))
      col += gw
    }
    if (t) out.push({...s, text: t})
  }
  return out
}
const padTo = (l: Line, w: number, sgr: number[] = []): Line => {
  const n = lineWidth(l)
  return n > w ? cut(l, 0, w) : n < w ? [...l, blank(w - n, sgr)] : l
}

const addLine = (b: Block, line: Line) => { b.lines.push(line) }
const empty = (): Block => ({lines: []})
/** where each element is (its segments' cells, merged on a line) and the caret: read off the cells */
function scan(lines: Line[]): {hits: Hit[], caret: {line: number, col: number} | null} {
  const hits: Hit[] = []
  let caret: {line: number, col: number} | null = null
  lines.forEach((line, y) => {
    let col = 0
    for (const s of line) {
      const w = stringWidth(s.text)
      if (s.caret && !caret) caret = {line: y, col}
      if (s.el && w) {
        const h = hits[hits.length - 1]
        if (h && h.el === s.el && h.line === y && h.col + h.width === col) h.width += w
        else hits.push({line: y, col, width: w, el: s.el})
      }
      col += w
    }
  })
  return {hits, caret}
}
/** place `src` into `dst` at (y, x), over dst's cells */
function place(dst: Block, src: Block, y: number, x: number, w?: number) {
  const sw = w ?? Math.max(0, ...src.lines.map(lineWidth))
  src.lines.forEach((l, i) => {
    const row = dst.lines[y + i] || []
    dst.lines[y + i] = [...padTo(cut(row, 0, x), x), ...padTo(l, sw), ...cut(row, x + sw)]
  })
  for (let i = dst.lines.length; i--;) if (!dst.lines[i]) dst.lines[i] = []
}

function wrap(segs: Seg[], width: number): Seg[][] {
  if (width <= 0 || lineWidth(segs) <= width) return [segs]
  // words with their styles; a word longer than the width is cut
  const words: Seg[][] = [[]]
  for (const s of segs) for (const part of s.text.split(/( )/)) {
    if (part == ' ') words.push([{...s, text: ' '}], [])
    else if (part) words[words.length - 1].push({...s, text: part})
  }
  const lines: Seg[][] = [[]]
  let n = 0
  for (const w of words) {
    const len = lineWidth(w)
    if (!len && !w.some(s => s.caret)) continue
    const space = w.length == 1 && w[0].text == ' '
    if (n + len > width && n > 0 && !space) { lines.push([]); n = 0 }
    if (space && n == 0) continue
    // a space that doesn't fit ends the line
    if (space && n + len > width) { lines.push([]); n = 0; continue }
    for (const s of w) {
      let t = graphemes(s.text)
      const tw = () => t.reduce((k, g) => k + charWidth(g), 0)
      while (n + tw() > width && width > 0) {
        let take = 0, cw = 0
        while (take < t.length && n + cw + charWidth(t[take]) <= width) cw += charWidth(t[take++])
        if (!take && !n) cw += charWidth(t[take++])
        if (take) lines[lines.length - 1].push({...s, text: t.slice(0, take).join('')})
        t = t.slice(take); lines.push([]); n = 0
      }
      if (t.length || s.caret) { lines[lines.length - 1].push({...s, text: t.join('')}); n += tw() }
    }
  }
  return lines
}

export interface Frame {
  /** plain text, one string per line */
  plain: string[]
  /** the same lines with ANSI styles */
  ansi: string[]
  /** the line the focused element is on (-1: none) */
  focusLine: number
  /** where the focused element starts (null: none) */
  focus: {line: number, col: number} | null
  /** the caret of the focused text field (null: none) */
  caret: {line: number, col: number} | null
  /** where each element is drawn (innermost elements, top layer last): hitTest(frame, line, col) */
  hits: Hit[]
}
export interface PaintOptions {
  rules?: readonly TerminalStyleRule[]
  width?: number
  /** the screen's rows: the root's height for percentages, flex columns and centering a modal dialog */
  height?: number
}
/** the innermost element drawn at a cell (the top layer first), else null */
export function hitTest(frame: Frame, line: number, col: number): HostElement | null {
  for (let i = frame.hits.length; i--;) {
    const h = frame.hits[i]
    if (h.line === line && col >= h.col && col < h.col + h.width) return h.el
  }
  return null
}

interface Ctx {rules: TerminalStyleRule[], doc: HostDocument, focus: HostElement | null, sheet: Map<HostElement, TerminalStyle>}
// the box keys come from the terminal stylesheet only: an inline style is the web's CSS (a React
// Native style object's flex: 1 or gap: 12 through sygnal/primitives isn't a terminal layout)
const BOX_KEYS = ['width', 'height', 'flex', 'border', 'borderColor', 'padding', 'overflow', 'gap', 'background']
const styleOf = (ctx: Ctx, el: HostElement): TerminalStyle => {
  let st = ctx.sheet.get(el)
  if (!st) {
    st = computeStyle(el, ctx.rules)
    if (BOX_KEYS.some(k => el.style[k] != null && el.style[k] !== '')) {
      const sheet: TerminalStyle = {}
      for (const [sel, x] of ctx.rules) if (matches(el, sel)) Object.assign(sheet, x)
      for (const k of BOX_KEYS) k in sheet ? (st[k] = sheet[k]) : delete st[k]
    }
    ctx.sheet.set(el, st)
  }
  return st
}
// the box keys take terminal values only: cells (numbers) and percentages. A web style's CSS
// lengths ('8px', '1rem': an inline style={{ padding: 8 }} of sygnal/primitives) aren't cells
const cells = (v: unknown) => typeof v == 'number' || (typeof v == 'string' && /^\s*\d+(\.\d+)?%\s*$/.test(v))
const size = (v: unknown, of: number | undefined): number | undefined => {
  if (typeof v == 'number') return Math.max(0, Math.floor(v))
  if (!cells(v)) return undefined
  return of == null ? undefined : Math.floor(of * parseFloat(v as string) / 100)
}
const pads = (p: unknown): [number, number] => typeof p == 'number' ? [p | 0, p | 0] : Array.isArray(p) && typeof p[0] == 'number' ? [p[0] | 0, p[1] | 0] : [0, 0]
const borderOf = (b: unknown): string => (b === true ? 'single' : typeof b == 'string' && b in BORDERS ? b : '')
const isBox = (st: TerminalStyle) => cells(st.width) || cells(st.height) || !!borderOf(st.border) || pads(st.padding).some(Boolean)
const flexOf = (st: TerminalStyle): number | undefined => (typeof st.flex == 'number' ? st.flex : undefined)
const flexDir = (st: TerminalStyle): '' | 'row' | 'column' => /flex$/.test(st.display || '') ? (/^column/.test(st.flexDirection || '') ? 'column' : 'row') : ''
const shown = (ctx: Ctx, n: HostNode): boolean => {
  if (n.nodeType === 3) return !!(n as any).data.trim()
  const el = n as HostElement
  return !closedByHost(el) && styleOf(ctx, el).display != 'none' && !el.modal && !el.popoverOpen
}
/** a flex row laid out as columns: one of its items has a width, a flex share or a border */
const columns = (ctx: Ctx, el: HostElement, st: TerminalStyle) => flexDir(st) == 'row' &&
  el.children.some(c => { const s = styleOf(ctx, c); return cells(s.width) || flexOf(s) != null || !!borderOf(s.border) })

const BORDERS: Record<string, string> = {single: '┌┐└┘─│', round: '╭╮╰╯─│', double: '╔╗╚╝═║', heavy: '┏┓┗┛━┃'}
// each box remembers what it last kept in view, so a box the user scrolled stays where it is
const followed = new WeakMap<HostElement, HostElement | null>()


/**
 * The flow of `root`'s children at `width`: block elements start lines, inline content wraps.
 * `sgr` / `upper` are inherited; `availH` the height percentages resolve against.
 */
function flowBlock(root: HostElement, width: number, ctx: Ctx, sgr: number[], upper: boolean, availH: number | undefined, own?: TerminalStyle): Block {
  const out = empty()
  let cur: Seg[] = []
  // a list item's marker waits for the item's first line
  let marker = ''

  const push = (text: string, sgr: number[], upper: boolean, el?: HostElement, caret?: boolean) => {
    if (text || caret) cur.push({text: upper ? text.toUpperCase() : text, sgr, el, caret})
  }
  const lead = (indent: string, first: boolean): Seg => ({text: first && marker ? indent.slice(0, indent.length - marker.length) + marker : indent, sgr: []})
  const flush = (indent: string, force = false) => {
    // collapse the whitespace runs across segments; trim the line's ends
    const segs: Seg[] = []
    let prevSpace = true
    for (const s of cur) {
      let t = ''
      for (const ch of s.text.replace(/\s/g, ' ')) { if (ch == ' ' && prevSpace) continue; t += ch; prevSpace = ch == ' ' }
      if (t || s.caret) segs.push({...s, text: t})
    }
    while (segs.length && /^ *$/.test(segs[segs.length - 1].text) && !segs[segs.length - 1].caret) segs.pop()
    if (segs.length) segs[segs.length - 1] = {...segs[segs.length - 1], text: segs[segs.length - 1].text.replace(/ +$/, '')}
    cur = []
    if (!segs.length && !force) return
    const lines = wrap(segs, width - indent.length)
    for (const l of lines) if (l.length) l[l.length - 1] = {...l[l.length - 1], text: l[l.length - 1].text.replace(/ +$/, '')}
    lines.forEach((line, i) => addLine(out, [lead(indent, i == 0), ...line]))
    if (lines.length) marker = ''
  }
  /** a laid-out box in the flow, at the indent */
  const box = (b: Block, indent: string) => {
    flush(indent)
    b.lines.forEach((l, i) => addLine(out, [lead(indent, i == 0), ...l]))
    if (b.lines.length) marker = ''
  }
  const label = (el: HostElement) => (el.textContent.trim() || el.getAttribute('value') || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ')

  // flex: a column's children each take their own lines, a row's are separated (their gap)
  const walk = (n: HostNode, indent: string, sgr: number[], upper: boolean, flex: '' | 'column' | 'row' = '') => {
    if (n.nodeType === 3) return push((n as any).data, sgr, upper, n.parentNode || undefined)
    const el = n as HostElement
    if (!shown(ctx, el)) return
    const st0 = styleOf(ctx, el)
    if (flex == 'column') { flush(indent); walkEl(el, indent, sgr, upper, st0); return flush(indent) }
    walkEl(el, indent, sgr, upper, st0)
    if (flex == 'row') push(' ', sgr, false)
  }
  const walkEl = (el: HostElement, indent: string, sgr: number[], upper: boolean, st: TerminalStyle) => {
    const tag = el.localName
    const flexKids = flexDir(st)
    const focused = ctx.focus === el
    const blockTag = BLOCK.test(tag)
    const block = st.display ? !/^inline/.test(st.display) && st.display != 'contents' : blockTag
    const s = [...sgr, ...sgrOf(st)], up = upper || !!st.upper
    const mark = focused ? s.concat(7) : s
    // a widget is a box: spaces around it (collapsed with any next to it)
    // (the spaces in the parent's style: an underlined tab's isn't underlined past its text)
    const widget = (text: string) => { push(' ', sgr, false); push(st.before || '', s, up); push(focused ? '▸' : '', s, false, el); push(text, mark, false, el); push(st.after || '', s, up); push(' ', sgr, false) }
    if (tag == 'br') return flush(indent, true)
    if (tag == 'hr') { flush(indent); push('─'.repeat(Math.max(3, width - indent.length)), [...s, 2], false); return flush(indent) }
    if (tag == 'img') return widget(`[${el.getAttribute('alt') || 'image'}]`)
    if (tag == 'textarea' || isBox(st) || columns(ctx, el, st)) {
      return box(layoutBox(el, width - indent.length, availH, ctx, sgr, upper), indent)
    }
    if (isCheckable(el)) {
      return widget(el.type == 'radio' ? (el.checked ? '(•)' : '( )') : (el.checked ? '[x]' : '[ ]'))
    }
    if (isTextField(el)) {
      push(' ', sgr, false)
      push(st.before || '', s, up)
      if (focused) push('▸', s, false, el)
      fieldSegs(el, focused, s).forEach(x => cur.push(x))
      push(st.after || '', s, up)
      return push(' ', sgr, false)
    }
    if (tag == 'select') {
      const o = el.options.find(o => optionValue(o) == el.value) || el.options[0]
      return widget(`[${o ? o.textContent.trim() : ''} ${el.picker != null ? '▴' : '▾'}]`)
    }
    if (tag == 'progress' || tag == 'meter') {
      const max = +(el.getAttribute('max') || 1) || 1, v = el.getAttribute('value')
      if (v == null) return widget('[' + '░'.repeat(10) + ']')
      const f = Math.max(0, Math.min(1, +v / max)), n = Math.round(f * 10)
      return widget('[' + '█'.repeat(n) + '░'.repeat(10 - n) + '] ' + Math.round(f * 100) + '%')
    }
    if (tag == 'button' || (tag == 'input' && /^(button|submit|reset)$/.test(el.type))) return widget(`[${label(el) || (el.type == 'submit' ? 'Submit' : '…')}]`)

    if (block) {
      flush(indent)
      let inner = indent
      // a list indents when its items are blocks (a row of inline items, a nav's, doesn't)
      if ((tag == 'ul' || tag == 'ol' || tag == 'menu') && el.children.some(c => c.localName == 'li' && !/^inline/.test(styleOf(ctx, c).display || ''))) inner = indent + '  '
      if (tag == 'li') {
        const p = el.parentNode
        marker = p?.localName == 'ol' ? `${p.children.filter(c => c.localName == 'li').indexOf(el) + 1}. ` : '• '
        inner = indent + ' '.repeat(marker.length)
      }
      if (tag == 'blockquote' || tag == 'dd') inner = indent + '  '
      if (focused) push('▸', s, false, el)
      // a <details>' disclosure triangle on its summary
      if (tag == 'summary' && el.parentNode?.localName == 'details') push(el.parentNode.open ? '▾ ' : '▸ ', s, false, el)
      push(st.before || '', focused ? mark : s, up, el)
      if (tag == 'pre') {
        for (const line of el.textContent.split('\n')) { push(line.replace(/ /g, ''), focused ? mark : s, up, el); flush(inner, true) }
      } else for (const c of el.childNodes) walk(c, inner, focused ? mark : s, up, flexKids)
      push(st.after || '', s, up, el)
      flush(inner)
      if (tag == 'li') marker = ''
      return
    }
    if (focused) push('▸', s, false, el)
    push(st.before || '', focused ? mark : s, up, el)
    for (const c of el.childNodes) walk(c, indent, focused ? mark : s, up, flexKids)
    push(st.after || '', s, up, el)
    // a block tag shown inline (a nav's <li>s in a row) is separated like a box
    if (blockTag) push(' ', s, false)
  }
  if (own) {
    const s = [...sgr, ...sgrOf(own)], up = upper || !!own.upper, flexKids = flexDir(own)
    push(own.before || '', s, up, root)
    for (const c of root.childNodes) walk(c, '', s, up, flexKids)
    push(own.after || '', s, up, root)
  } else for (const c of root.childNodes) walk(c, '', sgr, upper)
  flush('')
  return out
}

/** a text field's segments: [value] with the caret and the selection (inverse); the placeholder when empty */
function fieldSegs(el: HostElement, focused: boolean, s: number[]): Seg[] {
  const pw = el.type == 'password'
  const v = el.value, a = el.selectionStart, b = el.selectionEnd, inv = s.concat(7), fs = focused ? s.concat(4) : s
  if (!v) return focused ? [{text: '[', sgr: s, el}, {text: '_', sgr: inv, el, caret: true}, {text: ']', sgr: s, el}]
    : [{text: '[' + el.placeholder + ']', sgr: s, el}]
  const show = (t: string) => (pw ? '•'.repeat(graphemes(t).length) : t.replace(/\n/g, '⏎'))
  const out: Seg[] = [{text: '[', sgr: s, el}]
  if (!focused) out.push({text: show(v), sgr: s, el})
  else {
    out.push({text: show(v.slice(0, a)), sgr: fs, el})
    if (a < b) out.push({text: show(v.slice(a, b)), sgr: inv, el, caret: el.selectionDirection == 'backward'})
    // the caret cell: the grapheme after the caret, inverse (after the end: '_')
    const rest = v.slice(b), g = graphemes(rest)[0]
    if (a == b) out.push({text: g ? show(g) : '_', sgr: inv, el, caret: true})
    else if (el.selectionDirection != 'backward') out.push({text: '', sgr: fs, el, caret: true})
    out.push({text: show(a == b && g ? rest.slice(g.length) : rest), sgr: fs, el})
  }
  out.push({text: ']', sgr: s, el})
  return out.filter(x => x.text || x.caret)
}

/** a <textarea>'s content: its lines hard-wrapped at `w` cells, the caret and selection marked */
function textareaBlock(el: HostElement, w: number, focused: boolean, s: number[]): Block {
  const out = empty(), v = el.value, a = el.selectionStart, b = el.selectionEnd, inv = s.concat(7)
  if (!v && !focused) { addLine(out, [{text: el.placeholder, sgr: s.concat(2), el}]); return out }
  let line: Line = [], col = 0, i = 0
  const nl = () => { addLine(out, line.length ? line : [{text: '', sgr: s, el}]); line = []; col = 0 }
  const caretHere = (at: number) => focused && a == b && at == a
  for (const g of graphemes(v)) {
    if (g == '\n' || g == '\r\n') {
      if (caretHere(i)) line.push({text: ' ', sgr: inv, el, caret: true})
      nl(); i += g.length; continue
    }
    const gw = charWidth(g)
    if (col + gw > w && col > 0) nl()
    const sel = focused && i >= a && i < b
    line.push({text: g, sgr: sel || caretHere(i) ? inv : s, el, caret: caretHere(i) || (focused && a < b && i == b)})
    col += gw; i += g.length
  }
  if (caretHere(v.length)) { if (col + 1 > w && col > 0) nl(); line.push({text: ' ', sgr: inv, el, caret: true}) }
  nl()
  return out
}

/**
 * A box: `el` laid out in its own rectangle, `availW` wide at most. Its width (style, else all of
 * availW), its content (a flex row's columns, a flex column's shares, else the flow; a textarea's
 * text), then its height (style, `forcedH` from a parent flex, else the content's), scrolled to
 * keep the focus in view, a scrollbar when it scrolls, its padding and its border.
 */
function layoutBox(el: HostElement, availW: number, availH: number | undefined, ctx: Ctx, sgr: number[], upper: boolean, forcedH?: number, natural = false, forcedW?: number): Block {
  const st = styleOf(ctx, el), tag = el.localName, focused = ctx.focus === el
  const ta = tag == 'textarea'
  const bstyle = st.border === false ? '' : borderOf(st.border) || (ta ? 'single' : '')
  const B = bstyle ? 1 : 0, [pv, ph] = pads(st.padding)
  const s = [...sgr, ...sgrOf(st)], up = upper || !!st.upper
  // (rows / cols: the attribute, or the property the props module set)
  const cols = ta ? +(el.getAttribute('cols') || (el as any).cols || 0) : 0, trows = ta ? +(el.getAttribute('rows') || (el as any).rows || 2) || 2 : 0
  let W = forcedW ?? Math.min(availW, size(st.width, availW) ?? (cols ? cols + 2 * B + 2 * ph : availW))
  let H = forcedH ?? size(st.height, availH) ?? (ta ? trows + 2 * B + 2 * pv : undefined)
  const ih = H == null ? undefined : Math.max(0, H - 2 * B - 2 * pv)
  const scrolls = ta || st.overflow == 'auto' || st.overflow == 'scroll'
  const content = (iw: number): Block => {
    if (ta) return textareaBlock(el, iw, focused, s)
    const dir = flexDir(st)
    if (dir == 'row' && columns(ctx, el, st)) return rowBlock(el, iw, ih, ctx, s, up, st)
    if (dir == 'column' && ih != null && el.children.some(c => flexOf(styleOf(ctx, c)) != null)) return columnBlock(el, iw, ih, ctx, s, up)
    return flowBlock(el, iw, ctx, sgr, upper, ih ?? availH, st)
  }
  let iw = Math.max(1, W - 2 * B - 2 * ph)
  let c = content(iw)
  if (natural && forcedW == null && !cells(st.width) && !cols) {
    // shrink to the content (a dialog, a popover): its widest line, or its title on the border
    const t = B ? (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim() : ''
    const nw = Math.max(1, ...c.lines.map(lineWidth), t ? stringWidth(t) + 4 - 2 * ph : 0)
    if (nw < iw) { iw = nw; W = iw + 2 * B + 2 * ph; c = content(iw) }
  }
  let bar = false
  if (ih != null && scrolls && c.lines.length > ih && iw > 1) { bar = true; iw -= 1; c = content(iw) }
  // a focused box without a border (a border shows the focus heavy): the mark before its first line
  if (focused && !B && !ta) c.lines[0] = cut([{text: '▸', sgr: s, el}, ...(c.lines[0] || [])], 0, iw)
  // the rows in view
  let top = 0
  if (ih != null && c.lines.length > ih && (/^(auto|scroll|hidden)$/.test(st.overflow || '') || ta)) {
    top = el.scrollTop
    const focus = ctx.focus, target = ctx.doc.scrollTarget && el.contains(ctx.doc.scrollTarget) ? ctx.doc.scrollTarget : null
    const follow = target || (focus && el.contains(focus) && followed.get(el) !== focus ? focus : null)
    const show = (from: number, to: number) => {
      if (to - from >= ih) top = from
      else if (from < top) top = from
      else if (to > top + ih) top = to - ih
    }
    const at = scan(c.lines)
    if (follow) {
      const rows = at.hits.filter(h => follow.contains(h.el)).map(h => h.line)
      if (rows.length) show(Math.min(...rows), Math.max(...rows) + 1)
    }
    // the caret of a field in this box stays in view while typing
    if (at.caret && focus && el.contains(focus)) show(at.caret.line, at.caret.line + 1)
    top = Math.max(0, Math.min(top, c.lines.length - ih))
    if (top !== el.scrollTop) el.scrollTop = top
  }
  if (ctx.focus === null || el.contains(ctx.focus)) followed.set(el, ctx.focus)
  const rows = ih ?? c.lines.length, total = c.lines.length
  const out = empty()
  const fill = s.filter(x => (x >= 40 && x <= 47) || (x >= 100 && x <= 107) || x == 7)
  const bs = [...(st.borderColor ? [colorCode(st.borderColor, false)] : sgr.filter(x => x >= 30 && x <= 37 || x >= 90 && x <= 97)), ...(focused || (ta && ctx.focus === el) ? [1] : [])]
  const ch = BORDERS[focused ? 'heavy' : bstyle] || BORDERS.single
  const innerW = iw + (bar ? 1 : 0) + 2 * ph
  if (B) {
    // a title from aria-label / title on the top border
    const t = (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim()
    const tt = t && innerW > 4 ? cut([{text: ' ' + t + ' ', sgr: bs.concat(1)}], 0, innerW - 2) : []
    const tw = tt.reduce((n, x) => n + stringWidth(x.text), 0)
    addLine(out, [{text: ch[0] + (tw ? ch[4] : ''), sgr: bs, el}, ...tt, {text: ch[4].repeat(Math.max(0, innerW - tw - (tw ? 1 : 0))) + ch[1], sgr: bs, el}])
  }
  for (let i = 0; i < pv; i++) addLine(out, [...(B ? [{text: ch[5], sgr: bs, el}] : []), blank(innerW, fill), ...(B ? [{text: ch[5], sgr: bs, el}] : [])])
  // the scrollbar's thumb
  const thumb = bar ? Math.max(1, Math.round(rows * rows / total)) : 0
  const tpos = bar ? Math.round(top * (rows - thumb) / Math.max(1, total - rows)) : 0
  for (let i = 0; i < rows; i++) {
    const l = padTo(c.lines[top + i] || [], iw, fill)
    const sb: Seg[] = bar ? [{text: i >= tpos && i < tpos + thumb ? '█' : '│', sgr: i >= tpos && i < tpos + thumb ? [] : [2], el}] : []
    addLine(out, [...(B ? [{text: ch[5], sgr: bs, el}] : []), blank(ph, fill), ...l, blank(ph, fill), ...sb, ...(B ? [{text: ch[5], sgr: bs, el}] : [])])
  }
  for (let i = 0; i < pv; i++) addLine(out, [...(B ? [{text: ch[5], sgr: bs, el}] : []), blank(innerW, fill), ...(B ? [{text: ch[5], sgr: bs, el}] : [])])
  if (B) addLine(out, [{text: ch[2] + ch[4].repeat(innerW) + ch[3], sgr: bs, el}])
  return out
}

/** a flex row as columns: fixed widths, natural widths, then the flex shares of what is left; all as tall as the tallest */
function rowBlock(el: HostElement, w: number, h: number | undefined, ctx: Ctx, sgr: number[], upper: boolean, st: TerminalStyle): Block {
  const items = el.childNodes.filter(n => shown(ctx, n))
  const gap = Math.max(0, st.gap ?? 1)
  const avail = Math.max(0, w - gap * Math.max(0, items.length - 1))
  const lay = (n: HostNode, cw: number, ch?: number): Block => {
    if (n.nodeType === 3) {
      const b = empty()
      addLine(b, [{text: (n as any).data.trim(), sgr, el: n.parentNode || undefined}])
      return b
    }
    const c = n as HostElement, cs = styleOf(ctx, c)
    if (isBox(cs) || c.localName == 'textarea' || flexOf(cs) != null || columns(ctx, c, cs)) return layoutBox(c, cw, h, ctx, sgr, upper, ch, false, cw)
    // an item without a box of its own: its own flow (wrapped in a throwaway parent)
    return flowBlock({childNodes: [c], children: [c]} as any, cw, ctx, sgr, upper, h)
  }
  const widths = items.map(n => n.nodeType === 1 ? size(styleOf(ctx, n as HostElement).width, avail) : undefined)
  const flexes = items.map(n => n.nodeType === 1 ? flexOf(styleOf(ctx, n as HostElement)) : undefined)
  // natural widths for the items with neither
  items.forEach((n, i) => {
    if (widths[i] == null && flexes[i] == null) widths[i] = Math.min(avail, Math.max(0, ...lay(n, avail).lines.map(lineWidth)))
  })
  const used = widths.reduce((a: number, x) => a + (x ?? 0), 0)
  const shares = flexes.reduce((a: number, f, i) => a + (widths[i] == null ? (f || 1) : 0), 0)
  let left = Math.max(0, avail - used)
  items.forEach((_, i) => {
    if (widths[i] != null) return
    const take = Math.floor(left * (flexes[i] || 1) / shares)
    widths[i] = take
  })
  // what the floors left over goes to the last flex item; too wide: the widest shrink
  const sum = () => widths.reduce((a: number, x) => a + (x as number), 0)
  const lastFlex = widths.map((_, i) => i).filter(i => flexes[i] != null).pop()
  if (lastFlex != null && sum() < avail) widths[lastFlex]! += avail - sum()
  while (sum() > avail) { const i = widths.indexOf(Math.max(...(widths as number[]))); if (!widths[i]) break; widths[i]!-- }
  let blocks = items.map((n, i) => lay(n, widths[i]!, h))
  const rows = h ?? Math.max(0, ...blocks.map(b => b.lines.length))
  // stretch: the boxes as tall as the row
  if (h == null) blocks = items.map((n, i) => (n.nodeType === 1 && blocks[i].lines.length < rows && isBox(styleOf(ctx, n as HostElement)) ? lay(n, widths[i]!, rows) : blocks[i]))
  const out = empty()
  for (let y = 0; y < rows; y++) out.lines.push([])
  let x = 0
  blocks.forEach((b, i) => {
    place(out, {...b, lines: b.lines.slice(0, rows)}, 0, x, widths[i]!)
    x += widths[i]! + gap
  })
  return out
}

/** a flex column with a height: the items' own heights, then the flex items share the rows left */
function columnBlock(el: HostElement, w: number, h: number, ctx: Ctx, sgr: number[], upper: boolean): Block {
  const items = el.children.filter(c => shown(ctx, c))
  const fixed = items.map(c => { const cs = styleOf(ctx, c); return flexOf(cs) != null ? null : layoutBox(c, w, h, ctx, sgr, upper, size(cs.height, h)) })
  // an item without a box style is still laid out as one (its own lines), at its content's height
  const used = fixed.reduce((a, b) => a + (b ? b.lines.length : 0), 0)
  const shares = items.reduce((a, c) => a + (flexOf(styleOf(ctx, c)) ?? 0), 0) || 1
  let left = Math.max(0, h - used)
  const flexIdx = items.map((c, i) => (flexOf(styleOf(ctx, c)) != null ? i : -1)).filter(i => i >= 0)
  const out = empty()
  items.forEach((c, i) => {
    let b = fixed[i]
    if (!b) {
      const share = i === flexIdx[flexIdx.length - 1] ? left : Math.floor(Math.max(0, h - used) * (flexOf(styleOf(ctx, c)) || 0) / shares)
      left -= share
      b = layoutBox(c, w, h, ctx, sgr, upper, share)
    }
    place(out, b, out.lines.length, 0, w)
  })
  if (out.lines.length > h) out.lines.length = h
  while (out.lines.length < h) out.lines.push([])
  return out
}

/** a <select>'s open option list: a bordered list, the highlighted option inverse with ▸, the chosen one ✓ */
function pickerBlock(sel: HostElement, maxRows: number): Block {
  const opts = sel.options, i = sel.picker ?? 0
  const labels = opts.map(o => o.textContent.trim())
  const iw = Math.max(4, ...labels.map(stringWidth)) + 3
  const rows = Math.max(1, Math.min(opts.length, maxRows))
  let top = Math.max(0, Math.min(sel.scrollTop, opts.length - rows))
  if (i < top) top = i
  if (i >= top + rows) top = i - rows + 1
  if (top !== sel.scrollTop) sel.scrollTop = top
  const out = empty()
  addLine(out, [{text: '┌' + '─'.repeat(iw) + '┐', sgr: [], el: sel}])
  for (let k = top; k < top + rows; k++) {
    const o = opts[k], on = k === i, dis = o.disabled
    const text = (on ? '▸' : ' ') + labels[k] + ' '.repeat(iw - 2 - stringWidth(labels[k])) + (optionValue(o) === sel.value ? '✓' : ' ')
    addLine(out, [{text: '│', sgr: [], el: sel}, {text, sgr: on ? [7] : dis ? [2] : [], el: o}, {text: '│', sgr: [], el: sel}])
  }
  addLine(out, [{text: '└' + '─'.repeat(iw) + '┘', sgr: [], el: sel}])
  return out
}

/** the element a popover is anchored to: its invoker (popovertarget), else what describes or controls it */
const anchorOf = (doc: HostDocument, p: HostElement): HostElement | null => {
  const id = p.getAttribute('id')
  if (!id) return null
  return doc.body.querySelectorAll('[popovertarget], [aria-describedby], [aria-controls], [aria-details]').find(e =>
    ['popovertarget', 'aria-describedby', 'aria-controls', 'aria-details'].some(a => (e.getAttribute(a) || '').split(/\s+/).includes(id))) || null
}

/** paint a host document */
export function paint(doc: HostDocument, options: PaintOptions = {}): Frame {
  const rules = [...defaultTerminalStyles, ...(options.rules || [])]
  const width = options.width ?? 80, height = options.height
  const ctx: Ctx = {rules, doc, focus: doc.activeElement, sheet: new Map()}
  const b = flowBlock(doc.body, width, ctx, [], false, height)
  if (height != null) while (b.lines.length < height) b.lines.push([])
  const H = Math.max(b.lines.length, height ?? 0)
  const pos = (el: HostElement) => scan(b.lines).hits.find(h => h.el === el || el.contains(h.el))
  // the top layer: popovers, then modal dialogs (the page under a modal dimmed), then an open <select>'s list
  for (const p of doc.popovers) {
    if (!p.isConnected || styleOf(ctx, p).display == 'none') continue
    const ov = layoutBox(p, Math.max(1, width - 2), height, ctx, [], false, undefined, true)
    const ow = Math.max(0, ...ov.lines.map(lineWidth)), a = anchorOf(doc, p), at = a && pos(a)
    const y = at ? (at.line + 1 + ov.lines.length <= H || at.line < ov.lines.length ? at.line + 1 : at.line - ov.lines.length) : 0
    place(b, ov, y, at ? Math.max(0, Math.min(at.col, width - ow)) : Math.max(0, width - ow), ow)
  }
  for (const m of doc.modals) {
    if (!m.isConnected || styleOf(ctx, m).display == 'none') continue
    for (const l of b.lines) for (let i = 0; i < l.length; i++) l[i] = {...l[i], sgr: [...l[i].sgr.filter(x => x != 1), 2]}
    const ov = layoutBox(m, Math.max(1, width - 4), height, ctx, [], false, undefined, true)
    const ow = Math.max(0, ...ov.lines.map(lineWidth))
    place(b, ov, Math.max(0, Math.floor((H - ov.lines.length) / 2)), Math.max(0, Math.floor((width - ow) / 2)), ow)
  }
  const sel = doc.activeElement
  if (sel?.localName == 'select' && sel.picker != null) {
    const at = scan(b.lines).hits.find(h => h.el === sel)
    if (at) {
      const below = H - at.line - 1, above = at.line
      const room = Math.max(below, above) - 2
      const ov = pickerBlock(sel, Math.max(1, Math.min(8, room > 0 ? room : 8)))
      const y = ov.lines.length <= below || below >= above ? at.line + 1 : at.line - ov.lines.length
      const ow = lineWidth(ov.lines[0])
      place(b, ov, Math.max(0, y), Math.max(0, Math.min(at.col, width - ow)), ow)
    }
  }
  if (doc.scrollTarget) doc.scrollTarget = null
  // the output: (: a <pre>'s kept space)
  const plain = b.lines.map(l => l.map(s => s.text).join('').replace(//g, ' ').replace(/ +$/, ''))
  const ansi = b.lines.map(l => {
    let end = l.length
    while (end > 0 && !l[end - 1].sgr.length && /^ *$/.test(l[end - 1].text)) end--
    return l.slice(0, end).map(s => s.sgr.length && s.text ? `\x1b[${s.sgr.join(';')}m${s.text}\x1b[0m` : s.text).join('').replace(//g, ' ')
  })
  const {hits, caret} = scan(b.lines)
  const f = ctx.focus, fh = f ? hits.find(h => h.el === f || f.contains(h.el)) : undefined
  return {plain, ansi, focusLine: fh ? fh.line : -1, focus: fh ? {line: fh.line, col: fh.col} : null, caret: f ? caret : null, hits}
}
