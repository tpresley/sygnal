// 'sygnal/terminal': a Sygnal app in a terminal, on 'sygnal/host'. Guide: https://sygnal.js.org/renderers/terminal
import type { HostDocument, HostElement, HostSource, HostStyle, KeyInit } from 'sygnal/host'

export interface TerminalStyle extends HostStyle {
  /** 'none' hides; 'block' / 'inline' override the tag's default; 'flex' (with flexDirection) */
  display?: string
  before?: string
  after?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  inverse?: boolean
  /** black red green yellow blue magenta cyan white gray, or bright<Color> */
  color?: string
  /** the background: the same colors */
  background?: string
  upper?: boolean
  /** a box's width: cells, or a percentage of the space it is in ('30%') */
  width?: number | string
  /** a box's height: rows, or a percentage of its parent box's (the screen's for the root) */
  height?: number | string
  /** in a flex row or column: its share of the space left */
  flex?: number
  /** a box's border; a title from the element's aria-label / title */
  border?: boolean | 'single' | 'round' | 'double' | 'heavy'
  borderColor?: string
  /** cells inside the border: n, or [vertical, horizontal] */
  padding?: number | [number, number]
  /** with a height: 'auto' / 'scroll' scroll (a scrollbar, the focus kept in view), 'hidden' crops */
  overflow?: 'visible' | 'hidden' | 'auto' | 'scroll'
  /** between a flex row's items (cells, default 1) */
  gap?: number
}
export type TerminalStyleRule = [selector: string, style: TerminalStyle]
/** applied before an app's own rules */
export const defaultTerminalStyles: TerminalStyleRule[]

/** where an element is drawn: a run of cells on a line */
export interface Hit { line: number, col: number, width: number, el: HostElement }
export interface Frame {
  plain: string[]
  ansi: string[]
  /** the focused element's line (-1: none) */
  focusLine: number
  /** where the focused element starts */
  focus: { line: number, col: number } | null
  /** the focused text field's caret */
  caret: { line: number, col: number } | null
  /** the innermost element at each run of cells (top layer last) */
  hits: Hit[]
}
export interface PaintOptions {
  rules?: readonly TerminalStyleRule[]
  width?: number
  /** the screen's rows: percentages, flex columns, a centered modal dialog */
  height?: number
}
/** paint a host document as text */
export function paint(doc: HostDocument, options?: PaintOptions): Frame
/** the innermost element drawn at a cell, else null */
export function hitTest(frame: Frame, line: number, col: number): HostElement | null
/** a string's width in terminal cells (graphemes; CJK and emoji 2, combining marks 0) */
export function stringWidth(text: string): number
/** a grapheme's width in cells */
export function charWidth(grapheme: string): number
/** a string's graphemes */
export function graphemes(text: string): string[]

/** what an app's TERMINAL sink sends */
export type TerminalCommand = 'exit' | 'bell' | { exit?: true | number, title?: string, bell?: boolean }

export interface TerminalOptions {
  styles?: readonly TerminalStyleRule[]
  /** columns (default 80) */
  width?: number
  /** rows (default: none, the content's height) */
  height?: number
  /** a link's default action (a router driver's go) */
  onNavigate?: (href: string, el: HostElement) => void
  /** after each change */
  onFrame?: (frame: Frame) => void
  /** a command from the app's TERMINAL sink */
  onCommand?: (command: TerminalCommand) => void
  document?: HostDocument
}

export interface Terminal {
  readonly doc: HostDocument
  /** run(App, { DOM: terminal.driver }) */
  readonly driver: (vnode$: any, name?: string) => HostSource
  /** run(App, { DOM: t.driver, TERMINAL: t.control }) (runTerminal adds it) */
  readonly control: (command$: any) => void
  /** what the app sent its TERMINAL sink */
  readonly commands: TerminalCommand[]
  /** plain text of the current frame */
  frame(): string
  render(): Frame
  /** a key press, by DOM key name ('Enter', 'Tab', 'ArrowDown', 'Escape', 'F2', ' ', 'a') */
  press(key: string, init?: KeyInit): void
  /** type into the focused field */
  type(text: string): void
  /** a paste into the focused element */
  paste(text: string): void
  /** a mouse click at a cell of the frame (0-based); detail: 2 a double click */
  click(line: number, col: number, init?: KeyInit & { detail?: number }): HostElement | null
  /** the wheel at a cell (rows > 0: down); false when no scrolling box is there */
  wheel(line: number, col: number, rows: number): boolean
  /** focus the first element matching a selector or control */
  focus(selector: unknown): boolean
  /** the elements Tab moves through */
  focusables(): HostElement[]
  /** what the keys do on the focused element */
  keyHint(): string
  width: number
  height: number | undefined
}
export function createTerminal(options?: TerminalOptions): Terminal

export interface TerminalKey extends KeyInit {
  key: string
  /** key 'Paste' */
  text?: string
  /** key 'Mouse' */
  x?: number
  y?: number
  button?: number | 'up' | 'down'
  release?: boolean
  drag?: boolean
}
/** raw TTY input → keys, pastes, mouse events */
export function parseKeys(chunk: string): TerminalKey[]

export interface RunTerminalOptions extends Omit<TerminalOptions, 'onFrame' | 'width' | 'height' | 'document' | 'onCommand'> {
  /** the app's other drivers */
  drivers?: Record<string, any>
  /** run() options */
  runOptions?: Record<string, any>
  stdin?: any
  stdout?: any
  /** the line under the app (default: what the keys do on the focused element; false: none) */
  footer?: string | false | ((terminal: Terminal) => string)
  color?: boolean
  alternateScreen?: boolean
  /** mouse input: clicks, double clicks, the wheel (default false) */
  mouse?: boolean
  /** console output while running: 'buffer' (default on a TTY: written after the restore) or 'pass' */
  console?: 'buffer' | 'pass'
  onExit?: (code?: number) => void
}
export interface RunningTerminal {
  app: any
  terminal: Terminal
  stop(code?: number): void
}
/** run an app full-screen in a TTY; Ctrl+C or a TERMINAL 'exit' stops it */
export function runTerminal(App: any, options?: RunTerminalOptions): RunningTerminal
