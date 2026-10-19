/** Internal handler provenance. Schedules are cached by definition and effective app default. */
import type {Handler} from '../core/hooks'
import {fail} from './diagnostics/legacy'

// Snapshot masks: 1 = before, 2 = after, 3 = a mixed EFFECT group; u flags after work.
export type SinkState = 'before' | 'after'
export type TimedHandlers = Handler[] & {u?: number}
export const TIMING = /*#__PURE__*/ Symbol()
// Metadata lives on functions; pre-action props live on objects, so they can share a private key.
export const BEFORE = TIMING

/** A newly-created behavior adapter carries the library's explicit snapshot contract. */
export function withTiming(fn: any, mode?: SinkState) {
  if (mode) fn[TIMING] = () => [fn, mode == 'after' ? 2 : 1]
  return fn
}
const resolve = (fn: any, mode: SinkState): [any, number] => {
  return fn?.[TIMING]?.(mode) || [fn, mode == 'after' ? 2 : 1]
}
const previous = (fn: any) => (s: any, d: any, next: any, p: any) =>
  fn(p.previousState, d, next, {...p, ...p[BEFORE], signal: p.signal})

/** Preserve a sink's provenance when a feature transforms its returned value into an effect. */
export function mapTiming(fn: any, map: (fn: any) => any): any {
  const wrapped = map(fn)
  wrapped[TIMING] = (mode: SinkState) => {
    const [resolved, mask] = resolve(fn, mode)
    return [map(resolved), mask]
  }
  return wrapped
}

/** Preserve one invocation/exception boundary when effects have different origins. */
export function effects(first: any, second: any, keepReturn = false): any {
  const chain = (a: any, b: any) => (...args: any[]) => {
    const r = a?.(...args)
    b?.(...args)
    return keepReturn ? r : undefined
  }
  const fn: any = chain(first, second)
  fn[TIMING] = (mode: SinkState) => {
    const a = first ? resolve(first, mode) : [first, 0], b = second ? resolve(second, mode) : [second, 0], mask = a[1] | b[1]
    return [mask == 3 ? chain(a[1] == 1 ? previous(a[0]) : a[0], b[1] == 1 ? previous(b[0]) : b[0]) : fn, mask]
  }
  return fn
}

export function checkTiming(mode: any): void {
  if (mode !== undefined && mode !== 'before' && mode !== 'after') fail('SYG255', 'sinkState', 'Invalid sinkState')
}
const stateFirst = (a: Handler, b: Handler) => +(a[0] != 'STATE') - +(b[0] != 'STATE')

/** Installed only by behavior composition; apps without behaviors do not ship this compiler. */
export function compileHandlers(handlers: Handler[], mode: SinkState): TimedHandlers {
  const list: TimedHandlers = []
  for (const [sink, fn] of handlers) {
    const [f, mask] = sink == 'STATE' ? [fn, 0] : resolve(fn, mode)
    list.push([sink, f, mask])
    list.u = list.u! | (mask & 2)
  }
  if (list.u) list.sort(stateFirst)
  return list
}

function sorted(handlers: Handler[]): TimedHandlers {
  const list: TimedHandlers = handlers.slice().sort(stateFirst)
  list.u = 2
  return list
}

export function handlersFor(handlers: Handler[], mode: SinkState = 'after'): TimedHandlers {
  const cache = handlers as any
  return cache[mode] ||= cache[TIMING]?.(handlers, mode) || (mode == 'before' ? handlers : sorted(handlers))
}
