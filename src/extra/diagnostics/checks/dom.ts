/**
 * SYG104 — isolation boundary: an intent selector matches nothing in the
 *          component's own scope, but matches elements inside a child
 *          component / Collection item (warn).
 * SYG103 — an intent selector has never matched a rendered element (info,
 *          escalated to warn after >= 3 renders AND 2 s of render-idle time
 *          without a match).
 *
 * Mechanism:
 *   1. MainDOMSource.select() calls the onSelector hook with the source it was
 *      called on. Its namespace = the component's isolation scopes + any
 *      earlier select() selectors. Selectors are queued as "pending".
 *   2. onIntent (right after the intent function ran, still inside the
 *      component's constructor) claims the pending selectors whose isolation
 *      scopes equal the component's DOM source scopes, and records
 *      scopes -> component name (used to name the child for SYG104).
 *   3. onRender schedules a sweep after `settleMs` (onRender sees the vnode
 *      before the DOM patch; nested components patch a few ms later). The
 *      sweep finds the component's root element through the DOM driver's
 *      IsolateModule and runs each selector with querySelectorAll, splitting
 *      the matches with the DOM driver's own ScopeChecker (the same test the
 *      EventDelegator uses to deliver events) into "in scope" and "inside a
 *      total-isolation boundary" (child component).
 *   4. "Ever matched" is tracked per component NAME + selector, so a selector
 *      that matches in one Collection item is fine for all of them.
 *
 * SYG103 noise control (conditional rendering is normal): a selector whose
 * class/id/tag tokens all appear in the component's view source is assumed
 * to be conditionally rendered and is not reported. A selector that does not
 * appear in the view (typo, or an element rendered elsewhere) is reported as
 * info on the first sweep, and escalated per the rule above.
 *
 * Only real DOM sources (with an IsolateModule) are checked; renderComponent's
 * mock DOM never calls onSelector.
 */
import type {DiagnosticCheck} from '../index'
import {ScopeChecker} from '../../../cycle/dom/ScopeChecker'
import type {Scope} from '../../../cycle/dom/isolate'
import {reportSafely, once, onReset, timing, nameOf} from './shared'

interface Tracked {
  name: string
  source: any
  selectors: string[]
  renders: number
  settleTimer?: any
  idleTimer?: any
  /** selectors already explained by SYG104 */
  crossed: Set<string>
  disposed?: boolean
}

const scopesOf = (ns: Scope[]): Scope[] => ns.filter(s => s.type !== 'selector')
const keyOf = (scopes: Scope[]): string => scopes.map(s => `${s.type[0]}:${s.scope}`).join('/')

let pending: Array<{key: string; selector: string}> = []
let tracked = new WeakMap<object, Tracked>()
/** isolation-scope key -> the component instance that owns it (latest wins) */
let owners = new Map<string, any>()
const ownerKeys = new WeakMap<object, string>()
let matched = new Set<string>()
let viewTokens = new WeakMap<object, string>()

onReset(() => {
  pending = []
  tracked = new WeakMap()
  owners = new Map()
  matched = new Set()
})

const unref = (t: any) => { if (t && typeof t.unref === 'function') t.unref(); return t }

function viewSource(component: any): string {
  const view = component && component.view
  if (typeof view !== 'function') return ''
  let src = viewTokens.get(view)
  if (src === undefined) {
    try { src = Function.prototype.toString.call(view) } catch (_) { src = '' }
    viewTokens.set(view, src as string)
  }
  return src as string
}

/** class / id / tag tokens of a selector: '.a .b-c > #d' -> ['a', 'b-c', 'd'] */
const tokensOf = (selector: string): string[] =>
  (selector.replace(/\[[^\]]*\]|:[\w-]+(\([^)]*\))?/g, ' ').match(/[A-Za-z_][\w-]*/g) || [])

function appearsInView(component: any, selector: string): boolean {
  const src = viewSource(component)
  if (!src) return false
  const tokens = tokensOf(selector)
  if (!tokens.length) return false
  return tokens.every(t => new RegExp(`(^|[^\\w-])${t.replace(/[-]/g, '\\-')}($|[^\\w-])`).test(src))
}

function rootElementOf(t: Tracked): Element | undefined {
  try {
    const im = t.source._isolateModule
    return im && im.getElement(scopesOf(t.source.namespace))
  } catch (_) {
    return undefined
  }
}

function childNameFor(t: Tracked, elements: Element[]): string | undefined {
  const im = t.source._isolateModule
  const depth = scopesOf(t.source.namespace).length
  for (const el of elements) {
    let ns: Scope[] | undefined
    try { ns = im.getNamespace(el) } catch (_) { ns = undefined }
    if (!ns) continue
    for (let i = depth; i < ns.length; i++) {
      if (ns[i].type !== 'total') continue
      const owner = owners.get(keyOf(ns.slice(0, i + 1)))
      if (owner) return nameOf(owner)
      break
    }
  }
  return undefined
}

function report103(component: any, t: Tracked, selector: string, severity: 'info' | 'warn'): void {
  if (!once(`SYG103:${severity}:${t.name}:${selector}`)) return
  reportSafely('SYG103', {
    component,
    severity,
    message: `DOM.select('${selector}') in ${t.name} has not matched any element ${t.name} rendered` +
      (severity === 'warn' ? ` (after ${t.renders} renders)` : ''),
    fix: `Check the selector against the view's className/id. If the element is rendered by a child component, handle the event inside that child`,
    data: {selector, renders: t.renders},
  })
}

function sweep(component: any, t: Tracked, escalate: boolean): void {
  if (t.disposed) return
  const root = rootElementOf(t)
  if (!root || typeof root.querySelectorAll !== 'function') return
  const im = t.source._isolateModule
  const checker = new ScopeChecker(t.source.namespace, im)
  let unmatched = false

  for (const selector of t.selectors) {
    const matchKey = `${t.name}\u0000${selector}`
    if (matched.has(matchKey) || t.crossed.has(selector)) continue
    let all: Element[]
    try {
      all = Array.prototype.slice.call(root.querySelectorAll(selector))
      if (root.matches(selector)) all.push(root)
    } catch (_) {
      continue // invalid selector: the DOM driver reports that itself
    }
    const own = all.filter(el => { try { return checker.isDirectlyInScope(el) } catch (_) { return false } })
    if (own.length) { matched.add(matchKey); continue }

    if (all.length) {
      t.crossed.add(selector)
      if (!once(`SYG104:${t.name}:${selector}`)) continue
      const child = childNameFor(t, all) || 'a child component'
      reportSafely('SYG104', {
        component,
        message: `DOM.select('${selector}') in ${t.name} matches elements inside ${child} (isolated). Parents can't see DOM events inside child components`,
        fix: `Handle the event in ${child} and send it up with PARENT (read it here with CHILD.select(${child})), or use EVENTS`,
        data: {selector, child},
      })
      continue
    }

    if (appearsInView(component, selector)) continue
    unmatched = true
    if (escalate && t.renders >= timing.minRenders) report103(component, t, selector, 'warn')
    else report103(component, t, selector, 'info')
  }

  if (unmatched && !escalate) {
    clearTimeout(t.idleTimer)
    t.idleTimer = unref(setTimeout(() => { t.idleTimer = undefined; sweep(component, t, true) }, timing.idleMs))
  }
}

export const domCheck: DiagnosticCheck = {
  id: 'dom',

  onSelector(source, selector) {
    const ns: Scope[] | undefined = source && source.namespace
    if (!Array.isArray(ns) || typeof selector !== 'string' || !selector) return
    const prefix = ns.filter(s => s.type === 'selector').map(s => s.scope).join(' ')
    pending.push({key: keyOf(scopesOf(ns)), selector: prefix ? `${prefix} ${selector}` : selector})
    if (pending.length > 1000) pending.shift()
  },

  onIntent(component) {
    const claimed = pending
    pending = []
    const source = component && component.sources && component.sources[component.DOMSourceName || 'DOM']
    if (!source || !source._isolateModule || !Array.isArray(source.namespace)) return
    const key = keyOf(scopesOf(source.namespace))
    const name = nameOf(component)
    owners.set(key, component)
    ownerKeys.set(component, key)
    const selectors = [...new Set(claimed.filter(p => p.key === key).map(p => p.selector))]
    if (selectors.length) tracked.set(component, {name, source, selectors, renders: 0, crossed: new Set()})
  },

  onRender(component) {
    const t = tracked.get(component)
    if (!t || t.disposed) return
    t.renders++
    clearTimeout(t.idleTimer)
    t.idleTimer = undefined
    if (t.settleTimer) return
    t.settleTimer = unref(setTimeout(() => {
      t.settleTimer = undefined
      sweep(component, t, false)
    }, timing.settleMs))
  },

  onDispose(component) {
    const key = ownerKeys.get(component)
    if (key !== undefined && owners.get(key) === component) owners.delete(key)
    const t = tracked.get(component)
    if (!t) return
    t.disposed = true
    clearTimeout(t.settleTimer)
    clearTimeout(t.idleTimer)
    tracked.delete(component)
  },
}
