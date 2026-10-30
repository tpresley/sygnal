// 'sygnal/terminal': a Sygnal app in a terminal, on 'sygnal/host'. Guide: https://sygnal.js.org/renderers/terminal
import type { HostDocument, HostElement, HostSource, HostStyle, KeyInit } from 'sygnal/host'

export interface TerminalStyle extends HostStyle {
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
  upper?: boolean
}
export type TerminalStyleRule = [selector: string, style: TerminalStyle]
/** applied before an app's own rules */
export const defaultTerminalStyles: TerminalStyleRule[]

export interface Frame {
  plain: string[]
  ansi: string[]
  /** the focused element's line (-1: none) */
  focusLine: number
}
export interface PaintOptions {
  rules?: readonly TerminalStyleRule[]
  width?: number
}
/** paint a host document as text */
export function paint(doc: HostDocument, options?: PaintOptions): Frame

export interface TerminalOptions {
  styles?: readonly TerminalStyleRule[]
  /** columns (default 80) */
  width?: number
  /** a link's default action (a router driver's go) */
  onNavigate?: (href: string, el: HostElement) => void
  /** after each change */
  onFrame?: (frame: Frame) => void
  document?: HostDocument
}

export interface Terminal {
  readonly doc: HostDocument
  /** run(App, { DOM: terminal.driver }) */
  readonly driver: (vnode$: any, name?: string) => HostSource
  /** plain text of the current frame */
  frame(): string
  render(): Frame
  /** a key press, by DOM key name ('Enter', 'Tab', 'ArrowDown', 'Escape', 'F2', ' ', 'a') */
  press(key: string, init?: KeyInit): void
  /** type into the focused field */
  type(text: string): void
  /** focus the first element matching a selector or control */
  focus(selector: unknown): boolean
  /** the elements Tab moves through */
  focusables(): HostElement[]
  width: number
}
export function createTerminal(options?: TerminalOptions): Terminal

export interface TerminalKey extends KeyInit { key: string }
/** raw TTY input → keys */
export function parseKeys(chunk: string): TerminalKey[]

export interface RunTerminalOptions extends Omit<TerminalOptions, 'onFrame' | 'width' | 'document'> {
  /** the app's other drivers */
  drivers?: Record<string, any>
  /** run() options */
  runOptions?: Record<string, any>
  stdin?: any
  stdout?: any
  /** the line under the app (default: key help; false: none) */
  footer?: string | false
  color?: boolean
  alternateScreen?: boolean
  onExit?: () => void
}
export interface RunningTerminal {
  app: any
  terminal: Terminal
  stop(): void
}
/** run an app full-screen in a TTY; Ctrl+C stops it */
export function runTerminal(App: any, options?: RunTerminalOptions): RunningTerminal
