/**
 * sygnal/host: makeHostDriver(doc), the DOM driver contract the core uses, on a host tree.
 *
 * What the core needs from the driver named DOM (src/core/runtime.ts, instance.ts):
 *   sink    a stream of vnodes, one per flush (fragments flattened here, as the DOM driver does)
 *   source  select(sel) → source, events(type) → stream, isolateSource(src, scope),
 *           isolateValue(vnode, scope) / isolateSink, elements(), element(), dispose()
 * Reconciliation, hooks (refs, autoFocus, Transition) and Sygnal's snabbdom modules are snabbdom
 * itself, run on the host tree through a custom DOMAPI. Events: every host event goes through the
 * document's delegates first; a source delivers it when the target, or an ancestor it bubbles
 * through, matches the source's selector inside the source's isolation scope (total isolation:
 * a parent's selector never matches a child component's elements).
 */
import {xs} from '../index'
import {init} from '../cycle/dom/snabbdom'
import defaultModules from '../cycle/dom/modules'
import {flat} from '../cycle/dom/utils'
import {makeIsolateSink, makeIsolateValue, getScopeObj} from '../cycle/dom/isolate'
import {enrichEventStream} from '../cycle/dom/enrichEventStream'
import {HostDocument, HostElement, HostEvent, HostDelegate, hostApi} from './dom'
import {matches} from './selector'

type Scope = {type: string, scope: string}

// the isolation scope travels on the vnode (data.isolate, from makeIsolateValue) to its element
const setScope = (_: any, v: any) => { if (v.data?.isolate) v.elm.__isolate = v.data.isolate }
const scopeModule = {create: setScope, update: setScope}

/** form-field tags beyond input / textarea / select (registerFieldTags) */
export const fieldTags = new Set<string>()
// the controlled-value re-sync of src/cycle/dom/controlledInputModule, for a target's own field
// tags: a value the state set back to what it rendered last (typed 'abc', then cleared) is
// written again on every patch
const resync = (_: any, v: any) => {
  const p = v.data?.props, el = v.elm
  if (!p || !el || !fieldTags.size || !fieldTags.has(/^[^#.]*/.exec(v.sel)![0])) return
  if ('value' in p && el.value !== String(p.value ?? '')) el.value = p.value ?? ''
  if ('checked' in p && el.checked !== !!p.checked) el.checked = !!p.checked
}
const fieldModule = {create: resync, update: resync}

const sameNs = (a: Scope[] | undefined, b: Scope[]) => (a || []).length === b.length && b.every((s, i) => s.scope === a![i].scope)
/** the element carrying an element's innermost scope (null: the root component's own) */
const scopeRoot = (el: HostElement | null): HostElement | null => {
  for (let e = el; e; e = e.parentNode) if (e.__isolate) return e
  return null
}

export interface HostDriverOptions {
  /** extra snabbdom modules (after Sygnal's own) */
  modules?: any[]
  /** after each patch, with the root element (a renderer repaints, a test counts) */
  onPatch?: (root: HostElement) => void
  /** a patch that threw (default: run()'s onError, phase 'patch', else console.error) */
  onError?: (e: unknown) => void
}

export function makeHostDriver(doc: HostDocument = new HostDocument(), options: HostDriverOptions = {}) {
  // autoFocus and <Transition> schedule with requestAnimationFrame: a host without frames (Node,
  // a worker without one) gets a 16 ms timer
  const g: any = globalThis
  if (typeof g.requestAnimationFrame != 'function') g.requestAnimationFrame = (f: (t: number) => void) => setTimeout(() => f(Date.now()), 16)
  const patch = init([scopeModule, ...defaultModules, fieldModule, ...(options.modules || [])] as any, hostApi(doc) as any)
  return function hostDriver(vnode$: any, name = 'DOM'): HostSource {
    const root = doc.body
    const patched$ = xs.createWithMemory()
    const iso: any = {}
    const report = (e: unknown) => (options.onError || iso.rep || console.error)(e)
    let old: any = {sel: 'root', data: {}, children: [], elm: root, key: undefined}
    let dead = false
    const listener = {
      next: (v: any) => {
        if (dead) return
        try {
          old = patch(old, flat({sel: 'root', data: {}, children: v ? [v] : [], text: undefined, elm: undefined, key: undefined}))
        } catch (e) {
          // as the DOM driver (G-540): a patch that threw stopped half way; no further patches
          dead = true
          return report(e)
        }
        patched$.shamefullySendNext(root)
        options.onPatch?.(root)
      },
      error: report,
      complete: () => {},
    }
    vnode$.addListener(listener)
    patched$.shamefullySendNext(root)
    const src = new HostSource(doc, patched$, [], [], name)
    ;(src as any)._isolateModule = iso
    ;(src as any).dispose = () => {
      vnode$.removeListener(listener)
      // dispose: the app's elements go (unmount hooks run: refs cleared, widgets destroyed)
      try { old = patch(old, {sel: 'root', data: {}, children: [], text: undefined, elm: undefined, key: undefined} as any) } catch (e) { report(e) }
    }
    return src
  }
}

export class HostSource {
  isolateValue: (v: any, scope: string) => any
  isolateSink: (s: any, scope: string) => any
  constructor(readonly doc: HostDocument, private patched$: any, private ns: Scope[], private sels: string[], private name: string) {
    this.isolateValue = makeIsolateValue(ns as any)
    this.isolateSink = makeIsolateSink(ns as any) as any
  }

  select(sel: any): HostSource {
    // a control stringifies to its selector; a component isn't a selector
    if (typeof sel == 'function' && !sel.__sygnalControl) throw new Error(`${this.name}.select() expects a selector string or a control, not a component`)
    return new HostSource(this.doc, this.patched$, this.ns, this.sels.concat(String(sel)), this.name)
  }

  isolateSource(src: HostSource, scope: string): HostSource {
    return new HostSource(src.doc, src.patched$, src.ns.concat(getScopeObj(scope) as Scope), src.sels, src.name)
  }

  /** 'document' / 'body': every event that reaches the root, from any component */
  private get global() { return this.sels[0] === 'document' || this.sels[0] === 'body' }
  private get selector() { return (this.global ? this.sels.slice(1) : this.sels).join(' ') }

  /** whether this source delivers an event as `el` (its current target) */
  accepts(el: HostElement): boolean {
    const sel = this.selector
    if (this.global) return !sel || matches(el, sel)
    const sr = scopeRoot(el)
    if (!sameNs(sr?.__isolate, this.ns)) return false
    return sel ? matches(el, sel, sr ? sr.parentNode : null) : el === (sr || this.doc.body)
  }

  events(type: string, _options?: unknown): any {
    const doc = this.doc
    let d: HostDelegate
    const out = xs.create({
      start: (l: any) => {
        d = Object.assign((e: HostEvent) => {
          for (let el: HostElement | null = e.target; el; el = e.bubbles ? el.parentNode : null) {
            if (this.accepts(el)) { e.currentTarget = el; l.next(e); return }
          }
        }, {type, accepts: (el: HostElement) => !this.global && this.accepts(el), global: this.global})
        doc.delegates.add(d)
      },
      stop: () => { doc.delegates.delete(d) },
    })
    return enrichEventStream(out)
  }

  elements(): any {
    return this.patched$.map((root: HostElement) => {
      const all = [root, ...root.querySelectorAll('*')]
      const sel = this.selector
      return all.filter((el) => this.global ? !sel || matches(el, sel) : this.accepts(el))
    }).remember()
  }
  element(): any {
    return this.elements().filter((a: any[]) => a.length > 0).map((a: any[]) => a[0]).remember()
  }
}
