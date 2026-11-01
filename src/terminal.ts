/*
 * 'sygnal/terminal': a Sygnal app in a terminal. The app renders into a sygnal/host tree; this
 * target paints it as text (sygnal/terminal/paint) and turns key presses into the DOM events
 * intents already listen for (sygnal/host actions), so the same components, intents and models
 * run in a browser and in a terminal. Platform styling is a small stylesheet of selector rules,
 * as CSS is on the web.
 *
 *   runTerminal(App, { styles: [['.done', { dim: true }]] })      // a TTY app (Ctrl+C quits)
 *   const t = createTerminal(); run(App, { DOM: t.driver })      // tests: t.frame(), t.press('Tab')
 *
 * Keys: Tab / Shift+Tab (and ↑ / ↓) move the focus through the focusable elements and the ones
 * the app listens to clicks on; Enter / Space activate; typing edits a text field at its caret
 * (← → Home End, Shift selects, the readline keys Ctrl+A E B F D K U W, Alt+B F D); a <select>
 * opens with Enter / Space (↑ ↓ choose, Enter picks, Escape closes; ← / → change it closed); F2
 * is a double click; every key is a keydown / keyup on the focused element (or the root), so
 * DOM.select('document').events('keydown') shortcuts work. A mouse (runTerminal({ mouse: true }))
 * clicks, double clicks and scrolls. The app's TERMINAL sink: 'exit', { title }, 'bell'.
 * Separate entry: './index' and './host' become the external 'sygnal' and 'sygnal/host'.
 */
import {run} from './index'
import type {HostElement} from './host'
import {HostDocument, makeHostDriver, moveFocus, pressKey, typeText, activate, doubleClick, focusableElements, isInteractive, isInert, isTextField, isCheckable, editText, moveCaret, paste, computeStyle} from './host'
import type {KeyInit} from './host/actions'
import {paint, hitTest, graphemes, charWidth, Frame, TerminalStyleRule} from './terminal/paint'

export {paint, hitTest, stringWidth, charWidth, graphemes, defaultTerminalStyles} from './terminal/paint'
export type {Frame, Hit, TerminalStyle, TerminalStyleRule, PaintOptions} from './terminal/paint'

/** what an app's TERMINAL sink sends: 'exit' (or { exit: code }), { title }, 'bell' */
export type TerminalCommand = 'exit' | 'bell' | {exit?: true | number, title?: string, bell?: boolean}

export interface TerminalOptions {
  /** the app's terminal stylesheet (after defaultTerminalStyles) */
  styles?: readonly TerminalStyleRule[]
  /** columns (default 80; runTerminal follows the TTY) */
  width?: number
  /** rows: percentages, flex columns and a centered dialog use it (default: none, the content's height; runTerminal: the TTY's) */
  height?: number
  /** the cells the terminal draws an emoji in: 2 (default) or 1 (older width tables: xterm.js by default); runTerminal asks the terminal */
  emojiWidth?: 1 | 2
  /** a link's default action: an <a href> activated and not prevented (a router driver's go) */
  onNavigate?: (href: string, el: HostElement) => void
  /** after each change, with the new frame */
  onFrame?: (frame: Frame) => void
  /** a command from the app's TERMINAL sink (runTerminal: exit, title, bell) */
  onCommand?: (command: TerminalCommand) => void
  /** the host document (default: a new one) */
  document?: HostDocument
}

export interface Terminal {
  /** the host document the app renders into */
  readonly doc: HostDocument
  /** the DOM driver: run(App, { DOM: terminal.driver }) */
  readonly driver: ReturnType<typeof makeHostDriver>
  /** the TERMINAL driver: run(App, { DOM: t.driver, TERMINAL: t.control }) (runTerminal adds it) */
  readonly control: (command$: any) => void
  /** the commands the app sent its TERMINAL sink, in order */
  readonly commands: TerminalCommand[]
  /** the current frame as plain text (lines joined by \n) */
  frame(): string
  /** the current frame: plain and ANSI lines, the focused line, the caret, hit regions */
  render(): Frame
  /** a key press (DOM key names: 'Enter', 'Tab', 'ArrowDown', 'Escape', 'F2', ' ', 'a', …) */
  press(key: string, init?: KeyInit): void
  /** type text into the focused field (a press per character) */
  type(text: string): void
  /** a paste into the focused element (one paste event, then one insertion) */
  paste(text: string): void
  /** a mouse click at a cell of the current frame (0-based); `detail: 2` a double click */
  click(line: number, col: number, init?: KeyInit & {detail?: number}): HostElement | null
  /** the mouse wheel at a cell: `rows` > 0 scrolls down; false when no box there scrolls */
  wheel(line: number, col: number, rows: number): boolean
  /** focus the first element matching a selector (or a control) */
  focus(selector: unknown): boolean
  /** the elements Tab moves through */
  focusables(): HostElement[]
  /** what the keys do on the focused element, for a footer ('Enter open list · ←/→ change · …') */
  keyHint(): string
  /** columns */
  width: number
  /** rows (undefined: the content's height) */
  height: number | undefined
  /** the cells an emoji takes (1 or 2) */
  emojiWidth: 1 | 2
}

// the readline / Textual Input keys in a text field (the keydown goes out first: an app's keymap can take them)
const READLINE: Record<string, [string, string?]> = {
  'c-a': ['move', 'lineStart'], 'c-e': ['move', 'lineEnd'], 'c-b': ['move', 'left'], 'c-f': ['move', 'right'],
  'c-d': ['edit', 'deleteContentForward'], 'c-k': ['edit', 'deleteSoftLineForward'], 'c-u': ['edit', 'deleteSoftLineBackward'],
  'c-w': ['edit', 'deleteWordBackward'], 'a-b': ['move', 'wordLeft'], 'a-f': ['move', 'wordRight'], 'a-d': ['edit', 'deleteWordForward'],
}

export function createTerminal(options: TerminalOptions = {}): Terminal {
  const doc = options.document || new HostDocument()
  const rules = options.styles || []
  const ua = {onNavigate: options.onNavigate}
  const listened = {listened: true}
  const commands: TerminalCommand[] = []
  let last: Frame | null = null
  const interactive = (el: HostElement | null): HostElement | null => {
    // (a click reaches a tabindex="-1" element too: focusable, only not a Tab stop, as in a browser)
    for (let e = el; e && e !== doc.body; e = e.parentNode) if (isInteractive(e, rules) || e.localName == 'option' || (e.hasAttribute('tabindex') && !e.disabled)) return e
    return null
  }
  const term: Terminal = {
    doc,
    driver: makeHostDriver(doc),
    control: (command$: any) => {
      command$.addListener({next: (c: TerminalCommand) => { commands.push(c); options.onCommand?.(c) }, error: () => {}, complete: () => {}})
    },
    commands,
    width: options.width ?? 80,
    height: options.height,
    emojiWidth: options.emojiWidth ?? 2,
    render: () => (last = paint(doc, {rules, width: term.width, height: term.height, emojiWidth: term.emojiWidth})),
    frame: () => term.render().plain.join('\n'),
    focusables: () => focusableElements(doc, rules, listened),
    focus(sel) {
      const el = doc.querySelector(String(sel))
      if (el) el.focus()
      return !!el
    },
    press(key, init = {}) {
      const a = doc.activeElement
      const picker = a?.localName == 'select' && a.picker != null
      // ↑ / ↓ move the focus, but not in a textarea, an open option list or a radio group (the host's arrows)
      const arrows = (key == 'ArrowDown' || key == 'ArrowUp') && !init.altKey && !(a && (a.localName == 'textarea' || picker || (a.localName == 'input' && a.type == 'radio')))
      if (key == 'Tab' || arrows) {
        // the keydown still goes out (an app may handle Tab), and moving focus is its default
        const el = a || doc.body
        if (pressKey(el, key, init, ua)) moveFocus(doc, key == 'ArrowUp' || init.shiftKey ? -1 : 1, rules, listened)
        return
      }
      let el = a
      if (!el && (key == 'Enter' || key == ' ')) el = moveFocus(doc, 1, rules, listened)
      el ||= doc.body
      if (key == 'F2' && el !== doc.body) return doubleClick(el, ua)
      const rl = key.length == 1 && (init.ctrlKey || init.altKey) && !(init.ctrlKey && init.altKey) && isTextField(el) ? READLINE[(init.ctrlKey ? 'c-' : 'a-') + key] : undefined
      if (rl) {
        if (pressKey(el, key, init, {...ua, defaultAction: false})) rl[0] == 'move' ? moveCaret(el, rl[1]!) : editText(el, rl[1]!)
        return
      }
      // Enter / Space on an element the app listens to clicks on (not a native control) clicks it
      if ((key == 'Enter' || key == ' ') && el !== doc.body && !isNative(el)) {
        if (pressKey(el, key, init, ua) && !el.hasAttribute('tabindex')) activate(el, ua)
        return
      }
      pressKey(el, key, init, ua)
    },
    type(text) {
      const el = doc.activeElement
      if (el) typeText(el, text, ua)
    },
    paste(text) {
      paste(doc.activeElement || doc.body, text)
    },
    click(line, col, init = {}) {
      const f = last || term.render()
      const hit = hitTest(f, line, col)
      const a = doc.activeElement
      // a click outside an open option list closes it
      if (a?.localName == 'select' && a.picker != null && !(hit && (hit === a || a.contains(hit)))) a.picker = null
      if (!hit || isInert(hit)) return null
      const target = interactive(hit) || hit
      const fire = (type: string) => hit.dispatchEvent(new (doc.defaultView.Event)(type, {button: 0, detail: init.detail || 1, clientX: col, clientY: line, shiftKey: !!init.shiftKey, ctrlKey: !!init.ctrlKey, altKey: !!init.altKey, metaKey: !!init.metaKey}))
      fire('mousedown')
      if (target.localName != 'option' && (isNative(target) || target.hasAttribute('tabindex'))) target.focus()
      fire('mouseup')
      // a text field: the caret at the clicked cell
      if (isTextField(target) && target.localName == 'input' && target.type != 'password') {
        const h = f.hits.find(x => x.el === target && x.line === line)
        if (h) {
          // after '[' (and the focus mark '▸' it had)
          let cells = col - h.col - 1 - (a === target ? 1 : 0), i = 0
          for (const g of graphemes(target.value)) { if (cells <= 0) break; cells -= charWidth(g); i += g.length }
          target.setSelectionRange(i, i)
        }
        return target
      }
      if (target.localName == 'option' || isCheckable(target) || isNative(target) && !isTextField(target) || target === interactive(hit)) {
        init.detail == 2 ? doubleClick(target, ua) : activate(target, ua)
      } else activate(hit, ua)
      return target
    },
    wheel(line, col, rows) {
      const hit = hitTest(last || term.render(), line, col)
      for (let e = hit; e && e !== doc.body; e = e.parentNode) {
        const o = (computeStyle(e, [...rules]) as any).overflow
        if (o == 'auto' || o == 'scroll' || e.localName == 'textarea') { e.scrollTop = Math.max(0, e.scrollTop + rows); return true }
      }
      return false
    },
    keyHint: () => keyHint(doc, rules),
  }
  doc.onChange = () => { last = null; if (options.onFrame) options.onFrame(term.render()) }
  return term
}
const isNative = (el: HostElement) => /^(input|textarea|select|button|a|summary|option)$/.test(el.localName)

/** what the keys do on the focused element */
function keyHint(doc: HostDocument, rules: readonly TerminalStyleRule[]): string {
  const el = doc.activeElement, out: string[] = []
  if (el?.localName == 'select' && el.picker != null) out.push('↑↓ highlight', 'Enter choose', 'Esc close')
  else if (el?.localName == 'select') out.push('Enter open list', '←/→ change')
  else if (el?.localName == 'textarea') out.push('type', 'arrows move', 'Tab next')
  else if (el && isTextField(el)) out.push('type', ...(el.closest('form') ? ['Enter submit'] : []), 'Tab next')
  else if (el && isCheckable(el)) out.push(el.type == 'radio' ? '←/→ choose' : 'Space toggle', 'Tab next')
  else if (el && (isNative(el) || doc.listenedTypes(el).some(t => /click|key/.test(t)))) out.push('Enter activate', 'Tab next')
  else if (el) out.push('Tab next')
  else out.push('Tab move')
  if (el && el.localName != 'select' && doc.listenedTypes(el).includes('dblclick')) out.push('F2 double click')
  if (doc.topModal) out.push('Esc close')
  out.push('Ctrl+C quit')
  return out.join(' · ')
}

/** A key from a TTY's raw input: a key press, a paste, or a mouse event */
export interface TerminalKey extends KeyInit {
  key: string
  /** key 'Paste': the pasted text (bracketed paste) */
  text?: string
  /** key 'Mouse': 0-based cell, button (0 left, 1 middle, 2 right; wheel: 'up' / 'down'), press or release, a drag */
  x?: number
  y?: number
  button?: number | 'up' | 'down'
  release?: boolean
  drag?: boolean
}
const SEQ: Record<string, TerminalKey> = {
  '\x1b[A': {key: 'ArrowUp'}, '\x1b[B': {key: 'ArrowDown'}, '\x1b[C': {key: 'ArrowRight'}, '\x1b[D': {key: 'ArrowLeft'},
  '\x1bOA': {key: 'ArrowUp'}, '\x1bOB': {key: 'ArrowDown'}, '\x1bOC': {key: 'ArrowRight'}, '\x1bOD': {key: 'ArrowLeft'},
  '\x1b[H': {key: 'Home'}, '\x1b[F': {key: 'End'}, '\x1bOH': {key: 'Home'}, '\x1bOF': {key: 'End'}, '\x1b[1~': {key: 'Home'}, '\x1b[4~': {key: 'End'},
  '\x1b[7~': {key: 'Home'}, '\x1b[8~': {key: 'End'}, '\x1b[2~': {key: 'Insert'},
  '\x1b[3~': {key: 'Delete'}, '\x1b[5~': {key: 'PageUp'}, '\x1b[6~': {key: 'PageDown'}, '\x1b[Z': {key: 'Tab', shiftKey: true},
  '\x1bOP': {key: 'F1'}, '\x1bOQ': {key: 'F2'}, '\x1bOR': {key: 'F3'}, '\x1bOS': {key: 'F4'},
  '\x1b[11~': {key: 'F1'}, '\x1b[12~': {key: 'F2'}, '\x1b[13~': {key: 'F3'}, '\x1b[14~': {key: 'F4'},
  '\x1b[15~': {key: 'F5'}, '\x1b[17~': {key: 'F6'}, '\x1b[18~': {key: 'F7'}, '\x1b[19~': {key: 'F8'},
  '\x1b[20~': {key: 'F9'}, '\x1b[21~': {key: 'F10'}, '\x1b[23~': {key: 'F11'}, '\x1b[24~': {key: 'F12'},
  '\x1b\x7f': {key: 'Backspace', altKey: true}, '\x1b\x1b': {key: 'Escape', altKey: true},
}
const SEQS = Object.keys(SEQ).sort((a, b) => b.length - a.length)
const FINAL: Record<string, string> = {A: 'ArrowUp', B: 'ArrowDown', C: 'ArrowRight', D: 'ArrowLeft', H: 'Home', F: 'End', P: 'F1', Q: 'F2', R: 'F3', S: 'F4'}
const TILDE: Record<string, string> = {1: 'Home', 2: 'Insert', 3: 'Delete', 4: 'End', 5: 'PageUp', 6: 'PageDown', 7: 'Home', 8: 'End', 15: 'F5', 17: 'F6', 18: 'F7', 19: 'F8', 20: 'F9', 21: 'F10', 23: 'F11', 24: 'F12'}
// xterm's modifier parameter: 1 + (shift 1, alt 2, ctrl 4, meta 8)
const mods = (m: number): KeyInit => ({...(m - 1 & 1 && {shiftKey: true}), ...(m - 1 & 2 && {altKey: true}), ...(m - 1 & 4 && {ctrlKey: true}), ...(m - 1 & 8 && {metaKey: true})})
const PASTE_START = '\x1b[200~', PASTE_END = '\x1b[201~'

/** split a chunk of raw TTY input into keys (DOM key names), pastes (bracketed paste) and mouse events (SGR) */
export function parseKeys(chunk: string): TerminalKey[] {
  const out: TerminalKey[] = []
  for (let i = 0; i < chunk.length;) {
    const rest = chunk.slice(i)
    if (rest.startsWith(PASTE_START)) {
      const end = rest.indexOf(PASTE_END)
      const text = rest.slice(PASTE_START.length, end < 0 ? undefined : end)
      out.push({key: 'Paste', text: text.replace(/\r\n?/g, '\n')})
      i += end < 0 ? rest.length : end + PASTE_END.length
      continue
    }
    // SGR mouse: ESC [ < b ; x ; y M (press, motion) / m (release)
    let m = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(rest)
    if (m) {
      const b = +m[1], base = b & 3, wheel = b & 64
      out.push({key: 'Mouse', x: +m[2] - 1, y: +m[3] - 1, button: wheel ? (base ? 'down' : 'up') : base, release: m[4] == 'm',
        ...(b & 32 && {drag: true}), ...(b & 4 && {shiftKey: true}), ...(b & 8 && {altKey: true}), ...(b & 16 && {ctrlKey: true})})
      i += m[0].length; continue
    }
    // a modified key: ESC [ 1 ; m X, ESC [ n ; m ~
    m = /^\x1b\[(\d+);(\d+)([A-Z~])/.exec(rest)
    if (m && (m[3] == '~' ? TILDE[m[1]] : FINAL[m[3]])) {
      out.push({key: m[3] == '~' ? TILDE[m[1]] : FINAL[m[3]], ...mods(+m[2])}); i += m[0].length; continue
    }
    const seq = SEQS.find(s => rest.startsWith(s))
    if (seq) { out.push({...SEQ[seq]}); i += seq.length; continue }
    if (rest[0] == '\x1b' && rest.length > 1 && rest[1] != '[' && rest[1] != 'O') {
      const k = parseKeys(String.fromCodePoint(rest.codePointAt(1)!))[0]
      out.push({...k, altKey: true}); i += 1 + String.fromCodePoint(rest.codePointAt(1)!).length; continue
    }
    const ch = String.fromCodePoint(rest.codePointAt(0)!)
    i += ch.length
    const c = ch.charCodeAt(0)
    if (ch == '\r' || ch == '\n') out.push({key: 'Enter'})
    else if (ch == '\t') out.push({key: 'Tab'})
    else if (ch == '\x7f' || ch == '\b') out.push({key: 'Backspace'})
    else if (ch == '\x1b') out.push({key: 'Escape'})
    else if (ch == '\0') out.push({key: ' ', ctrlKey: true})
    else if (c < 32) out.push({key: String.fromCharCode(c + 96), ctrlKey: true})
    else out.push({key: ch})
  }
  return out
}

export interface RunTerminalOptions extends Omit<TerminalOptions, 'onFrame' | 'width' | 'height' | 'document' | 'onCommand' | 'emojiWidth'> {
  /** the app's other drivers (DOM is the terminal's; TERMINAL too unless given) */
  drivers?: Record<string, any>
  /** run() options (onError, diagnostics, …) */
  runOptions?: Record<string, any>
  /** default: process.stdin / process.stdout */
  stdin?: any
  stdout?: any
  /** a line under the app (default: what the keys do on the focused element; false: none; a function of the terminal) */
  footer?: string | false | ((terminal: Terminal) => string)
  /** ANSI styles (default: when stdout is a TTY) */
  color?: boolean
  /** use the terminal's alternate screen, restored on exit (default: when stdout is a TTY) */
  alternateScreen?: boolean
  /** mouse input: clicks, double clicks, the wheel (default false: the terminal keeps its own text selection) */
  mouse?: boolean
  /**
   * the cells the terminal draws an emoji in: 'auto' (default on a TTY: an emoji is printed and the
   * terminal asked where its cursor went, a cursor position report), 1 or 2
   */
  emojiWidth?: 1 | 2 | 'auto'
  /**
   * console output while the app runs: 'buffer' (default on a TTY: kept, and written after the
   * terminal is restored; the footer counts it) or 'pass' (written at once, over the frame)
   */
  console?: 'buffer' | 'pass'
  /** called after Ctrl+C, a TERMINAL 'exit' or stop(), with the app disposed and the terminal restored (an exit code from { exit: n }) */
  onExit?: (code?: number) => void
}

export interface RunningTerminal {
  app: any
  terminal: Terminal
  /** dispose the app and restore the terminal */
  stop(code?: number): void
}

const CONSOLE = ['log', 'info', 'warn', 'error', 'debug'] as const

/** run an app full-screen in a TTY (Node): raw keys in, frames out; Ctrl+C stops it */
export function runTerminal(App: any, options: RunTerminalOptions = {}): RunningTerminal {
  const proc: any = (globalThis as any).process
  const stdin = options.stdin || proc?.stdin, stdout = options.stdout || proc?.stdout
  if (!stdin || !stdout) throw new Error('runTerminal: no stdin / stdout (pass them in options)')
  const tty = !!stdout.isTTY
  const color = options.color ?? tty
  const alt = options.alternateScreen ?? tty
  const mouse = !!options.mouse && tty
  const footerOpt = options.footer
  const footerText = () => footerOpt === false ? '' : typeof footerOpt == 'function' ? footerOpt(term) : footerOpt ?? term.keyHint()
  const footerRows = footerOpt === false ? 0 : 1
  // console output while running: kept for after the restore (it would be drawn over, then wiped)
  const buffered: [string, any[]][] = []
  const original: Record<string, any> = {}
  const capture = (options.console ?? (tty ? 'buffer' : 'pass')) == 'buffer' && typeof console != 'undefined'
  let scroll = 0, shown = '', pending = false, stopped = false
  if (capture) for (const k of CONSOLE) { original[k] = console[k]; console[k] = (...a: any[]) => { buffered.push([k, a]); schedule() } }
  const schedule = () => { if (!pending && !stopped) { pending = true; queueMicrotask(() => { pending = false; if (!stopped) draw(term.render()) }) } }
  const draw = (f: Frame) => {
    if (stopped) return
    const lines = color ? f.ansi : f.plain
    const rows = Math.max(3, (stdout.rows || 24) - footerRows)
    // a frame taller than the screen (no fixed layout): keep the focused line in view
    if (f.focusLine >= 0) {
      if (f.focusLine < scroll) scroll = f.focusLine
      if (f.focusLine >= scroll + rows) scroll = f.focusLine - rows + 1
    }
    scroll = Math.max(0, Math.min(scroll, Math.max(0, lines.length - rows)))
    const view = lines.slice(scroll, scroll + rows)
    let foot = footerText()
    if (buffered.length) foot = `${buffered.length} console message${buffered.length > 1 ? 's' : ''} (shown on exit)` + (foot ? ' · ' + foot : '')
    foot = foot && (color ? `\x1b[2m${foot}\x1b[0m` : foot)
    let out: string
    // redraw in place: home, each line cleared to its end, the rest cleared (no full-screen clear: no flicker), as one synchronized update
    if (tty) {
      const screen = [...view, ...Array(Math.max(0, rows - view.length)).fill(''), ...(footerRows ? [foot] : [])]
      out = '\x1b[?2026h\x1b[H' + screen.map(l => l + '\x1b[K').join('\r\n') + '\x1b[J\x1b[?2026l'
    }
    else out = view.join('\n') + '\n' + (foot ? foot + '\n' : '')
    if (out === shown) return
    shown = out
    stdout.write(out)
  }
  const term = createTerminal({
    ...options, width: stdout.columns || 80, height: tty ? Math.max(3, (stdout.rows || 24) - footerRows) : undefined,
    emojiWidth: options.emojiWidth == 1 ? 1 : 2,
    onFrame: draw,
    onCommand: (c) => {
      if (c == 'exit' || (typeof c == 'object' && c.exit != null)) return queueMicrotask(() => stop(typeof c == 'object' && typeof c.exit == 'number' ? c.exit : 0))
      if (!tty) return
      if (c == 'bell' || (typeof c == 'object' && c.bell)) stdout.write('\x07')
      if (typeof c == 'object' && c.title != null) stdout.write(`\x1b]0;${String(c.title).replace(/[\x00-\x1f]/g, '')}\x07`)
    },
  })
  let partial = '', lastClick = {t: 0, x: -1, y: -1}
  // the emoji probe's answer: ESC [ row ; col R (read before the keys: Shift+F3 has the same shape)
  let probing = false
  const onData = (chunk: any) => {
    let s = partial + String(chunk)
    partial = ''
    if (probing) {
      const m = /\x1b\[\d+;(\d+)R/.exec(s)
      if (m) {
        probing = false
        s = s.slice(0, m.index) + s.slice(m.index + m[0].length)
        const w = +m[1] - 1 == 1 ? 1 : 2
        if (w !== term.emojiWidth) { term.emojiWidth = w; shown = ''; draw(term.render()) }
      }
    }
    // a paste split across chunks: wait for its end
    const ps = s.lastIndexOf(PASTE_START)
    if (ps >= 0 && s.indexOf(PASTE_END, ps) < 0) { partial = s.slice(ps); s = s.slice(0, ps) }
    for (const k of parseKeys(s)) {
      if (stopped) return
      if (k.ctrlKey && k.key == 'c') return stop(130)
      if (k.key == 'Paste') term.paste(k.text || '')
      else if (k.key == 'Mouse') {
        const y = k.y! + scroll, x = k.x!
        if (k.button == 'up' || k.button == 'down') { if (!term.wheel(y, x, k.button == 'down' ? 3 : -3)) { scroll = Math.max(0, scroll + (k.button == 'down' ? 3 : -3)); draw(term.render()) } }
        else if (k.button === 0 && !k.release && !k.drag) {
          const now = Date.now(), dbl = now - lastClick.t < 400 && lastClick.x == x && lastClick.y == y
          lastClick = dbl ? {t: 0, x: -1, y: -1} : {t: now, x, y}
          term.click(y, x, {...k, detail: dbl ? 2 : 1})
        }
      } else term.press(k.key, k)
    }
  }
  const onResize = () => {
    term.width = stdout.columns || 80
    if (tty) term.height = Math.max(3, (stdout.rows || 24) - footerRows)
    shown = ''
    draw(term.render())
  }
  // the terminal back as it was: raw mode off, the cursor, the main screen, mouse and paste modes off
  const restore = () => {
    if (stdin.isTTY) stdin.setRawMode?.(false)
    if (tty) stdout.write((mouse ? '\x1b[?1006l\x1b[?1002l\x1b[?1000l' : '') + '\x1b[?2004l\x1b[?25h' + (alt ? '\x1b[?1049l' : '\r\n'))
    if (capture) {
      for (const k of CONSOLE) console[k] = original[k]
      for (const [k, a] of buffered.splice(0)) original[k](...a)
    }
  }
  // a crash or a signal still restores the terminal (then the error prints, or the signal does its default)
  const onCrash = (e: any) => {
    if (stopped) throw e
    stopped = true
    detach()
    try { app?.dispose() } catch (_) {}
    restore()
    console.error(e)
    proc.exit(1)
  }
  const onSignal = (sig: string) => {
    stop(128 + (sig == 'SIGINT' ? 2 : sig == 'SIGHUP' ? 1 : 15))
    if (!options.onExit) proc.kill(proc.pid, sig)
  }
  const onProcessExit = () => { if (!stopped) { stopped = true; detach(); restore() } }
  const signals = ['SIGTERM', 'SIGHUP', 'SIGINT']
  const onSig = signals.map(s => () => onSignal(s))
  const detach = () => {
    stdin.off?.('data', onData)
    stdout.off?.('resize', onResize)
    if (proc?.off && stdin === proc.stdin) {
      proc.off('uncaughtException', onCrash)
      proc.off('unhandledRejection', onCrash)
      proc.off('exit', onProcessExit)
      signals.forEach((s, i) => proc.off(s, onSig[i]))
    }
  }
  function stop(code?: number) {
    if (stopped) return
    stopped = true
    detach()
    try { app.dispose() } finally {
      restore()
      stdin.pause?.()
      options.onExit?.(code)
    }
  }
  if (tty) stdout.write((alt ? '\x1b[?1049h' : '') + '\x1b[?25l\x1b[?2004h' + (mouse ? '\x1b[?1000h\x1b[?1002h\x1b[?1006h' : ''))
  if (stdin.isTTY) stdin.setRawMode?.(true)
  stdin.setEncoding?.('utf8')
  stdin.on('data', onData)
  stdin.resume?.()
  stdout.on?.('resize', onResize)
  // how wide does this terminal draw an emoji? print one at the top left, ask where the cursor is
  // (the first frame draws over it; no answer in 1 s: the default)
  if (tty && stdin.isTTY && (options.emojiWidth ?? 'auto') == 'auto') {
    probing = true
    stdout.write('\x1b[H\u{1F41B}\x1b[6n')
    const t = setTimeout(() => { probing = false }, 1000)
    ;(t as any).unref?.()
  }
  // (process-wide handlers only for the real process streams, not a test's fakes)
  if (proc?.on && stdin === proc.stdin) {
    proc.on('uncaughtException', onCrash)
    proc.on('unhandledRejection', onCrash)
    proc.on('exit', onProcessExit)
    signals.forEach((s, i) => proc.on(s, onSig[i]))
  }
  let app: any
  try {
    app = run(App, {TERMINAL: term.control, ...options.drivers, DOM: term.driver}, options.runOptions)
  } catch (e) { stopped = true; detach(); restore(); throw e }
  return {app, terminal: term, stop}
}
