// 'sygnal/worker' (experimental): a whole Sygnal app in a Web Worker, rendered into a sygnal/host
// tree whose changes go to the page ('sygnal/worker/page') as patch ops. Guide:
// https://sygnal.js.org/renderers/off-main-thread
import type { HostDocument, HostDriverOptions, HostSource } from 'sygnal/host'
import type { Stream } from 'xstream'

/** The worker side of a channel: `self` in a dedicated worker, or a MessagePort */
export interface WorkerPort {
  postMessage(message: any): void
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void
  start?(): void
}

export interface WorkerTargetOptions {
  /** the shortest gap between two messages while the app is busy, in ms (default 16: a frame) */
  frame?: number
  /** the host driver's options (extra snabbdom modules, onPatch, onError) */
  driver?: HostDriverOptions
}

export interface WorkerTargetStats {
  /** messages of ops sent to the page */
  messages: number
  ops: number
  /** page events received */
  events: number
}

export interface WorkerTarget {
  /** the DOM driver: pass it as `DOM` to run() */
  driver: (vnode$: any, name?: string) => HostSource
  /**
   * A driver that stays on the page (startBridge's `drivers`): its sink's values are posted to the
   * page driver of the same name; its source is a stream, or with `methods` an object whose
   * methods return streams (`remote('STORE', ['get'])`). Values must be structured-cloneable.
   */
  remote(name: string): (sink$: Stream<any>) => Stream<any>
  remote<M extends string>(name: string, methods: M[]): (sink$: Stream<any>) => { [K in M]: (...args: any[]) => Stream<any> }
  /** send the pending changes now (they otherwise go out after the current task) */
  flush(): void
  /** the host tree the app renders into */
  doc: HostDocument
  stats: WorkerTargetStats
}

/** Render an app in this worker for the page's startBridge(): `run(App, { DOM: target.driver })` */
export function createWorkerTarget(port: WorkerPort, options?: WorkerTargetOptions): WorkerTarget

/** the patch op codes (the wire format: dev-plans/research/web-worker §2.1) */
export const OP: {
  readonly EL: 0, readonly TEXT: 1, readonly KIDS: 2, readonly ATTR: 3, readonly PROP: 4,
  readonly DATA: 5, readonly STYLE: 6, readonly FOCUS: 7, readonly FREE: 8, readonly SCOPE: 9,
}

/** a page event as it crosses the channel */
export interface PageEvent {
  seq: number
  type: string
  id: number
  init: Record<string, any>
  state?: { value?: string, checked?: boolean, scrollTop?: number, scrollLeft?: number }
}

/** an intent's declared preventDefault, as the page applies it: [type, selector, global, scope key, true | pattern] */
export type Prevent = [type: string, selector: string, global: boolean, scope: string, pattern: true | Record<string, unknown>]
