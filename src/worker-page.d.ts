// 'sygnal/worker/page' (experimental): the page half of a Sygnal app in a Web Worker
// ('sygnal/worker'). Guide: https://sygnal.js.org/renderers/off-main-thread
import type { Stream } from 'xstream'

/** The page side of the channel: a Worker, or a MessagePort */
export interface BridgePort {
  postMessage(message: any): void
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void
  removeEventListener(type: 'message', listener: (e: MessageEvent) => void): void
  start?(): void
}

export interface BridgeOptions {
  /** drivers that run on the page (localStorage, the router, DOM-only APIs); the worker reaches each with target.remote(name) */
  drivers?: Record<string, (sink$: Stream<any>) => any>
  /**
   * Default actions the page cancels synchronously beyond the intents' own
   * `events(type, { preventDefault })` declarations: [type, selector] pairs, matched with closest()
   * from the target ('*': any). Default [['submit', '*']].
   */
  preventDefault?: [type: string, selector: string][]
  /** event types sent at most once a frame, the latest (wheel: deltas summed). Default ['pointermove', 'mousemove', 'scroll', 'wheel'] */
  coalesce?: string[]
  /** after each batch of ops is applied, with the number of ops */
  onApply?: (ops: number) => void
}

export interface Bridge {
  /** resolves when the app's first render is on the page */
  ready: Promise<void>
  /** stop listening (the worker keeps running: terminate it yourself) */
  stop(): void
  stats: { received: number, sent: number, ops: number, held: number }
}

/** Mirror the worker's app (createWorkerTarget) into `mount`, and send its events back */
export function startBridge(worker: BridgePort, mount: Element, options?: BridgeOptions): Bridge

/** the user's edit of `base` (now `mine`) applied to `theirs` (a field value the worker wrote about older text) */
export function rebase(base: string, mine: string, theirs: string): string
/** a caret at `c` in `old`, mapped into `next` */
export function caret(old: string, next: string, c: number): number
