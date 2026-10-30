/**
 * sygnal/worker's wire format (research: dev-plans/research/web-worker §2), shared by the worker
 * target (src/worker/target.ts) and the page bridge (src/worker/page.ts). Messages are plain,
 * structured-cloneable objects; node ids are sygnal/host nodeId()s (the host body is the mount).
 *
 * worker → page
 *   {root}                         the host body's id (the page maps it to its mount element)
 *   {ops, ack, listen?, prevent?}  one per flush: flat op tuples; the last page event handled
 *                                  before they were made; the event types intents listen for and
 *                                  the intents' declared preventDefaults, each when it changed
 *   {drv, sink}                    a value for the page driver `drv`'s sink
 *   {sub, drv, method?, args} / {unsub}   open / close a page driver source subscription
 * page → worker
 *   {ev: [PageEvent]}              events, in dispatch order (a field value the page rebased
 *                                  crosses as an input event, inputType 'insertReplacementText')
 *   {ping: true}                   answer with a flush, even an empty one (a held submit waits for its ack)
 *   {emit, v}                      a value from a page driver source subscription
 */
export const OP = {
  EL: 0,       // [0, id, tag]
  TEXT: 1,     // [1, id, data]
  KIDS: 2,     // [2, parentId, childIds]
  ATTR: 3,     // [3, id, name, value | null]
  PROP: 4,     // [4, id, 'value' | 'checked' | 'selected', value]
  DATA: 5,     // [5, id, data]
  STYLE: 6,    // [6, id, key, value | null]
  FOCUS: 7,    // [7, id | 0]
  FREE: 8,     // [8, ids]
  SCOPE: 9,    // [9, id, scopeKey | null]: an isolation scope's root element (declared preventDefaults are scoped)
} as const

/** an op's tuple width, by opcode */
export const WIDTH = [3, 3, 3, 4, 4, 3, 4, 2, 2, 3]

/** a page event as it crosses: no DOM objects */
export interface PageEvent {
  seq: number
  type: string
  /** the nearest bridged element's id (the event's target, or its ancestor the page created) */
  id: number
  /** the event's plain fields (key, modifiers, pointer coordinates, deltas, inputType, data, …) */
  init: Record<string, any>
  /** the target's state on the page when it fired: a field's value / checked, a scroll position */
  state?: {value?: string, checked?: boolean, scrollTop?: number, scrollLeft?: number}
}

/** an intent's declared preventDefault: [type, selector, global, scope key, true | pattern] */
export type Prevent = [type: string, selector: string, global: boolean, scope: string, pattern: true | Record<string, unknown>]
