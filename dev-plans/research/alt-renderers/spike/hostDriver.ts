/**
 * A renderer driver for any HostDocument: the "DOM" driver contract the Sygnal core actually uses,
 * with no browser in it.
 *
 * What the core needs from the driver it calls DOM (measured in src/core, see README §1):
 *   sink   a stream of vnodes (one per flush), snabbdom-shaped, fragments flattened by the driver
 *   source select(sel) → source, events(type) → stream, isolateSource(src, scope) → source,
 *          isolateValue(vnode, scope) → vnode (or isolateSink), elements()/element(), dispose()
 * Everything else (keyed diff, hooks for refs / autoFocus / Transition) comes from running snabbdom
 * itself on the host tree through a custom DOMAPI, with Sygnal's own modules unchanged.
 */
import xs, {Stream} from 'xstream'
import {init} from '../../../../src/cycle/dom/snabbdom'
import defaultModules from '../../../../src/cycle/dom/modules'
import {flat} from '../../../../src/cycle/dom/utils'
import {makeIsolateSink, makeIsolateValue, getScopeObj} from '../../../../src/cycle/dom/isolate'
import {enrichEventStream} from '../../../../src/cycle/dom/enrichEventStream'
import {HostDocument, HostElement, HostEvent, hostApi} from './host'
import {matches, querySelectorAll} from './selector'

type Scope = {type: string, scope: string}

// the isolation scope travels on the vnode (data.isolate, from makeIsolateValue) to the element
const setScope = (_: any, v: any) => { if (v.data?.isolate) v.elm.__isolate = v.data.isolate }
const scopeModule = {create: setScope, update: setScope}

// the controlled-input re-sync (src/cycle/dom/controlledInputModule) for the neutral field tags too:
// a value the state reset to what it rendered last (typed 'abc', then cleared, in one flush)
const FIELD = /^(input|textarea|select|textinput|toggle)(?![\w-])/
const resync = (_: any, v: any) => {
  const p = v.data?.props, el = v.elm
  if (!p || !el || !FIELD.test(v.sel)) return
  if ('value' in p && el.value !== String(p.value ?? '')) el.value = p.value ?? ''
  if ('checked' in p && el.checked !== !!p.checked) el.checked = !!p.checked
}
const fieldModule = {create: resync, update: resync}

const sameNs = (a: Scope[] = [], b: Scope[]) => a.length === b.length && a.every((s, i) => s.scope === b[i].scope)
/** the element that carries an element's innermost scope (null: the root component's own) */
const scopeRoot = (el: HostElement | null) => {
  for (let e = el; e; e = e.parentNode) if (e.__isolate) return e
  return null
}

export interface HostDriverOptions {
  /** after each patch (a renderer repaints; tests count patches) */
  onPatch?: (root: HostElement) => void
  onError?: (e: unknown) => void
}

export function makeHostDriver(doc: HostDocument, opts: HostDriverOptions = {}) {
  const patch = init([scopeModule as any, ...defaultModules, fieldModule as any], hostApi(doc) as any)
  const patched$ = xs.createWithMemory<HostElement>()
  return function hostDriver(vnode$: Stream<any>, name = 'DOM') {
    const root = doc.body
    let old: any = {sel: 'root', data: {}, children: [], elm: root, key: undefined}
    const listener = {
      next: (v: any) => {
        try {
          old = patch(old, flat({sel: 'root', data: {}, children: v ? [v] : [], text: undefined, elm: undefined, key: undefined}))
          patched$.shamefullySendNext(root)
          opts.onPatch?.(root)
        } catch (e) { (opts.onError || console.error)(e) }
      },
      error: (e: unknown) => (opts.onError || console.error)(e),
      complete: () => {},
    }
    vnode$.addListener(listener)
    const src = new HostSource(doc, patched$, [], [], name)
    ;(src as any).dispose = () => vnode$.removeListener(listener)
    return src
  }
}

export class HostSource {
  isolateValue: (v: any, scope: string) => any
  isolateSink: (s: any, scope: string) => any
  constructor(private doc: HostDocument, private patched$: Stream<HostElement>, private ns: Scope[], private sels: string[], private name: string) {
    this.isolateValue = makeIsolateValue(ns as any)
    this.isolateSink = makeIsolateSink(ns as any) as any
  }

  select(sel: any): HostSource {
    // a control (controls() / a primitive) stringifies to its selector; a component doesn't select
    if (typeof sel == 'function' && !sel.__sygnalControl) throw new Error(`${this.name}.select() expects a selector string or a control`)
    return new HostSource(this.doc, this.patched$, this.ns, this.sels.concat(String(sel)), this.name)
  }

  isolateSource(src: HostSource, scope: string): HostSource {
    return new HostSource(src.doc, src.patched$, src.ns.concat(getScopeObj(scope) as Scope), src.sels, src.name)
  }

  /** the element an event is delivered for: the first in its path in this source's scope that matches */
  private match(e: HostEvent): HostElement | null {
    const sel = this.sels.join(' ')
    for (let el: HostElement | null = e.target; el; el = e.bubbles ? el.parentNode : null) {
      const sr = scopeRoot(el)
      if (!sameNs(sr?.__isolate || [], this.ns)) continue
      if (!sel) return sr || this.doc.body
      if (matches(el, sel, sr ? sr.parentNode : null)) return el
    }
    return null
  }

  events(type: string): any {
    const doc = this.doc
    let f: (e: HostEvent) => void
    const s$ = xs.create<HostEvent>({
      start: (l) => {
        f = (e) => {
          if (e.type !== type) return
          const el = this.match(e)
          if (el) { e.currentTarget = el; l.next(e) }
        }
        doc.delegates.add(f)
      },
      stop: () => { doc.delegates.delete(f) },
    })
    return enrichEventStream(s$)
  }

  elements(): Stream<HostElement[]> {
    const sel = this.sels.join(' ')
    return this.patched$.map((root) => {
      const all = [root, ...querySelectorAll(root, '*')].filter((el) => sameNs(scopeRoot(el)?.__isolate || [], this.ns))
      return sel ? all.filter((el) => matches(el, sel, scopeRoot(el)?.parentNode || null)) : all.filter((el) => el.__isolate === undefined || el === all[0])
    }).remember()
  }
  element(): Stream<HostElement> { return this.elements().filter((a) => a.length > 0).map((a) => a[0]).remember() }
}

