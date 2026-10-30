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
 * the app listens to clicks on; Enter / Space activate; typing edits a text field; ← / → change
 * a <select>; F2 is a double click; every key is a keydown / keyup on the focused element (or the
 * root), so DOM.select('document').events('keydown') shortcuts work. Separate entry: './index'
 * and './host' become the external 'sygnal' and 'sygnal/host'.
 */
import {run} from './index'
import type {HostElement} from './host'
import {HostDocument, makeHostDriver, moveFocus, pressKey, typeText, activate, doubleClick, focusableElements} from './host'
import type {KeyInit} from './host/actions'
import {paint, Frame, TerminalStyleRule} from './terminal/paint'

export {paint, defaultTerminalStyles} from './terminal/paint'
export type {Frame, TerminalStyle, TerminalStyleRule, PaintOptions} from './terminal/paint'

export interface TerminalOptions {
  /** the app's terminal stylesheet (after defaultTerminalStyles) */
  styles?: readonly TerminalStyleRule[]
  /** columns (default 80; runTerminal follows the TTY) */
  width?: number
  /** a link's default action: an <a href> activated and not prevented (a router driver's go) */
  onNavigate?: (href: string, el: HostElement) => void
  /** after each change, with the new frame */
  onFrame?: (frame: Frame) => void
  /** the host document (default: a new one) */
  document?: HostDocument
}

export interface Terminal {
  /** the host document the app renders into */
  readonly doc: HostDocument
  /** the DOM driver: run(App, { DOM: terminal.driver }) */
  readonly driver: ReturnType<typeof makeHostDriver>
  /** the current frame as plain text (lines joined by \n) */
  frame(): string
  /** the current frame: plain and ANSI lines, the focused line */
  render(): Frame
  /** a key press (DOM key names: 'Enter', 'Tab', 'ArrowDown', 'Escape', 'F2', ' ', 'a', …) */
  press(key: string, init?: KeyInit): void
  /** type text into the focused field (a press per character) */
  type(text: string): void
  /** focus the first element matching a selector (or a control) */
  focus(selector: unknown): boolean
  /** the elements Tab moves through */
  focusables(): HostElement[]
  /** columns */
  width: number
}

export function createTerminal(options: TerminalOptions = {}): Terminal {
  const doc = options.document || new HostDocument()
  const rules = options.styles || []
  const ua = {onNavigate: options.onNavigate}
  const listened = {listened: true}
  const term: Terminal = {
    doc,
    driver: makeHostDriver(doc),
    width: options.width ?? 80,
    render: () => paint(doc, {rules, width: term.width}),
    frame: () => term.render().plain.join('\n'),
    focusables: () => focusableElements(doc, rules, listened),
    focus(sel) {
      const el = doc.querySelector(String(sel))
      if (el) el.focus()
      return !!el
    },
    press(key, init = {}) {
      if (key == 'Tab' || ((key == 'ArrowDown' || key == 'ArrowUp') && !isMultiline(doc.activeElement))) {
        // the keydown still goes out (an app may handle Tab), and moving focus is its default
        const el = doc.activeElement || doc.body
        if (pressKey(el, key, init, ua)) moveFocus(doc, key == 'ArrowUp' || init.shiftKey ? -1 : 1, rules, listened)
        return
      }
      let el = doc.activeElement
      if (!el && (key == 'Enter' || key == ' ')) el = moveFocus(doc, 1, rules, listened)
      el ||= doc.body
      if (key == 'F2' && el !== doc.body) return doubleClick(el, ua)
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
  }
  if (options.onFrame) doc.onChange = () => options.onFrame!(term.render())
  return term
}
const isMultiline = (el: HostElement | null) => el?.localName == 'textarea'
const isNative = (el: HostElement) => /^(input|textarea|select|button|a|summary)$/.test(el.localName)

/** A key from a TTY's raw input */
export interface TerminalKey extends KeyInit {
  key: string
}
const SEQ: Record<string, TerminalKey> = {
  '\x1b[A': {key: 'ArrowUp'}, '\x1b[B': {key: 'ArrowDown'}, '\x1b[C': {key: 'ArrowRight'}, '\x1b[D': {key: 'ArrowLeft'},
  '\x1bOA': {key: 'ArrowUp'}, '\x1bOB': {key: 'ArrowDown'}, '\x1bOC': {key: 'ArrowRight'}, '\x1bOD': {key: 'ArrowLeft'},
  '\x1b[H': {key: 'Home'}, '\x1b[F': {key: 'End'}, '\x1b[1~': {key: 'Home'}, '\x1b[4~': {key: 'End'},
  '\x1b[3~': {key: 'Delete'}, '\x1b[5~': {key: 'PageUp'}, '\x1b[6~': {key: 'PageDown'}, '\x1b[Z': {key: 'Tab', shiftKey: true},
  '\x1bOP': {key: 'F1'}, '\x1bOQ': {key: 'F2'}, '\x1bOR': {key: 'F3'}, '\x1bOS': {key: 'F4'},
  '\x1b[11~': {key: 'F1'}, '\x1b[12~': {key: 'F2'}, '\x1b[13~': {key: 'F3'}, '\x1b[14~': {key: 'F4'},
}
/** split a chunk of raw TTY input into keys (DOM key names) */
export function parseKeys(chunk: string): TerminalKey[] {
  const out: TerminalKey[] = []
  for (let i = 0; i < chunk.length;) {
    const rest = chunk.slice(i)
    const seq = Object.keys(SEQ).find(s => rest.startsWith(s))
    if (seq) { out.push({...SEQ[seq]}); i += seq.length; continue }
    if (rest[0] == '\x1b' && rest.length > 1 && rest[1] != '\x1b' && rest[1] != '[' && rest[1] != 'O') {
      out.push({key: rest[1], altKey: true}); i += 2; continue
    }
    const ch = String.fromCodePoint(rest.codePointAt(0)!)
    i += ch.length
    const c = ch.charCodeAt(0)
    if (ch == '\r' || ch == '\n') out.push({key: 'Enter'})
    else if (ch == '\t') out.push({key: 'Tab'})
    else if (ch == '\x7f' || ch == '\b') out.push({key: 'Backspace'})
    else if (ch == '\x1b') out.push({key: 'Escape'})
    else if (c < 32) out.push({key: String.fromCharCode(c + 96), ctrlKey: true})
    else out.push({key: ch})
  }
  return out
}

export interface RunTerminalOptions extends Omit<TerminalOptions, 'onFrame' | 'width' | 'document'> {
  /** the app's other drivers (DOM is the terminal's) */
  drivers?: Record<string, any>
  /** run() options (onError, diagnostics, …) */
  runOptions?: Record<string, any>
  /** default: process.stdin / process.stdout */
  stdin?: any
  stdout?: any
  /** a line under the app (default: the key help; false: none) */
  footer?: string | false
  /** ANSI styles (default: when stdout is a TTY) */
  color?: boolean
  /** use the terminal's alternate screen, restored on exit (default: when stdout is a TTY) */
  alternateScreen?: boolean
  /** called after Ctrl+C or stop(), with the app disposed and the terminal restored */
  onExit?: () => void
}

export interface RunningTerminal {
  app: any
  terminal: Terminal
  /** dispose the app and restore the terminal */
  stop(): void
}

const FOOTER = 'Tab move · Enter/Space activate · F2 double click · Ctrl+C quit'

/** run an app full-screen in a TTY (Node): raw keys in, frames out; Ctrl+C stops it */
export function runTerminal(App: any, options: RunTerminalOptions = {}): RunningTerminal {
  const proc: any = (globalThis as any).process
  const stdin = options.stdin || proc?.stdin, stdout = options.stdout || proc?.stdout
  if (!stdin || !stdout) throw new Error('runTerminal: no stdin / stdout (pass them in options)')
  const tty = !!stdout.isTTY
  const color = options.color ?? tty
  const alt = options.alternateScreen ?? tty
  const footer = options.footer === false ? '' : options.footer ?? FOOTER
  let scroll = 0
  const draw = () => {
    const f = term.render(), lines = color ? f.ansi : f.plain
    const rows = Math.max(3, (stdout.rows || 24) - (footer ? 2 : 0))
    // keep the focused line in view
    if (f.focusLine >= 0) {
      if (f.focusLine < scroll) scroll = f.focusLine
      if (f.focusLine >= scroll + rows) scroll = f.focusLine - rows + 1
    }
    scroll = Math.max(0, Math.min(scroll, Math.max(0, lines.length - rows)))
    const shown = lines.slice(scroll, scroll + rows)
    const foot = footer ? '\n' + (color ? `\x1b[2m${footer}\x1b[0m` : footer) : ''
    stdout.write((tty ? '\x1b[H\x1b[2J' : '') + shown.join('\n') + '\n' + foot + (tty ? '' : '\n'))
  }
  const term = createTerminal({...options, width: stdout.columns || 80, onFrame: draw})
  let stopped = false
  const onData = (chunk: any) => {
    for (const k of parseKeys(String(chunk))) {
      if (k.ctrlKey && (k.key == 'c' || k.key == 'd')) return stop()
      term.press(k.key, k)
    }
  }
  const onResize = () => { term.width = stdout.columns || 80; draw() }
  function stop() {
    if (stopped) return
    stopped = true
    stdin.off?.('data', onData)
    stdout.off?.('resize', onResize)
    try { app.dispose() } finally {
      if (stdin.isTTY) stdin.setRawMode?.(false)
      stdin.pause?.()
      if (tty) stdout.write('\x1b[?25h' + (alt ? '\x1b[?1049l' : ''))
      options.onExit?.()
    }
  }
  if (tty) stdout.write((alt ? '\x1b[?1049h' : '') + '\x1b[?25l')
  if (stdin.isTTY) stdin.setRawMode?.(true)
  stdin.setEncoding?.('utf8')
  stdin.on('data', onData)
  stdin.resume?.()
  stdout.on?.('resize', onResize)
  const app: any = run(App, {...options.drivers, DOM: term.driver}, options.runOptions)
  return {app, terminal: term, stop}
}
