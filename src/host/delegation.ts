/**
 * sygnal/host: event delegation indexed by event type and isolation scope (research:
 * dev-plans/research/sandbox §6.2). The document keeps its delegates in a DelegateSet: a Set (the
 * public `doc.delegates`) that also indexes them by type. An event walks from its target up once;
 * at each element only the host driver's delegates of that element's scope are tested, so a
 * click in a 1,000-row Collection no longer runs every row's selector at every level.
 *
 * A delegate the host driver made carries `scope` (its isolation scope's key), `at(el, sr)` (does
 * it accept `el`, whose scope root is `sr`) and `deliver(e, el)`. Any other delegate (a target's
 * own) is called as before, with the event. Delivery keeps the order the delegates were added in.
 */
import type {HostDelegate, HostElement, HostEvent} from './dom'

/** a scope's key: its scope names (src/cycle/dom/isolate's {type, scope} list) */
const keys = new WeakMap<object, string>()
export const scopeKey = (ns: {scope: string}[] | undefined): string => {
  if (!ns || !ns.length) return ''
  let k = keys.get(ns)
  if (k === undefined) keys.set(ns, k = ns.map(s => s.scope).join('\u0001'))
  return k
}
/** the element carrying an element's innermost scope (null: the root component's own) */
const scopeRoot = (el: HostElement | null): HostElement | null => {
  for (let e = el; e; e = e.parentNode) if (e.__isolate) return e
  return null
}

export type PreventDefault = boolean | Record<string, unknown> | ((e: any) => boolean)

/** a pattern's fields all equal the event's (nested objects compared the same way), as src/cycle/dom/fromEvent's */
export function matchPattern(pattern: Record<string, unknown>, obj: any): boolean {
  for (const k in pattern) {
    const p = pattern[k], v = obj?.[k]
    if (p && typeof p == 'object' && v && typeof v == 'object' ? !matchPattern(p as Record<string, unknown>, v) : p !== v) return false
  }
  return true
}
/** the DOM driver's preventDefault option: true, a pattern of event fields, or a predicate */
export function preventIf(e: {preventDefault(): void}, pd: PreventDefault | undefined) {
  if (pd === true || (typeof pd == 'function' ? pd(e) : pd && typeof pd == 'object' && matchPattern(pd, e))) e.preventDefault()
}

type Indexed = HostDelegate & {scope: string, at(el: HostElement, sr: HostElement | null): boolean, deliver(e: HostEvent, el: HostElement): void}
type Entry = {order: Map<HostDelegate, number>, plain: HostDelegate[], global: Indexed[], byScope: Map<string, Indexed[]>}

const indexed = (d: HostDelegate): d is Indexed => typeof (d as any).deliver == 'function' && typeof (d as any).at == 'function'

export class DelegateSet extends Set<HostDelegate> {
  private index?: Map<string, Entry | null>
  add(d: HostDelegate) {
    if (!this.has(d)) { super.add(d); this.index?.delete(d.type) }
    return this
  }
  delete(d: HostDelegate) {
    const r = super.delete(d)
    if (r) this.index?.delete(d.type)
    return r
  }
  clear() { super.clear(); this.index?.clear() }

  private entry(type: string): Entry | null {
    const index = this.index ??= new Map()
    let e = index.get(type)
    if (e !== undefined) return e
    e = null
    let i = 0
    for (const d of this) {
      if (d.type !== type) continue
      e ??= {order: new Map(), plain: [], global: [], byScope: new Map()}
      e.order.set(d, i++)
      if (!indexed(d)) e.plain.push(d)
      else if (d.global) e.global.push(d)
      else {
        const list = e.byScope.get(d.scope)
        list ? list.push(d) : e.byScope.set(d.scope, [d])
      }
    }
    index.set(type, e)
    return e
  }

  /** the delegates' part of a dispatch: one walk up from the target, then delivery in order */
  dispatch(ev: HostEvent) {
    const e = this.entry(ev.type)
    if (!e) return
    const hits: [number, HostDelegate, HostElement | null][] = []
    for (const d of e.plain) hits.push([e.order.get(d)!, d, null])
    const done = new Set<HostDelegate>()
    let sr = scopeRoot(ev.target)
    for (let el: HostElement | null = ev.target; el; el = el.parentNode) {
      for (const d of e.global) if (!done.has(d) && d.at(el, sr)) { done.add(d); hits.push([e.order.get(d)!, d, el]) }
      const scoped = e.byScope.get(sr ? scopeKey(sr.__isolate) : '')
      if (scoped) for (const d of scoped) if (!done.has(d) && d.at(el, sr)) { done.add(d); hits.push([e.order.get(d)!, d, el]) }
      if (!ev.bubbles) break
      // leaving a scope root: the next scope out
      if (el === sr) sr = scopeRoot(el.parentNode)
    }
    if (hits.length > 1) hits.sort((a, b) => a[0] - b[0])
    for (const [, d, el] of hits) el ? (d as Indexed).deliver(ev, el) : d(ev)
  }
}
