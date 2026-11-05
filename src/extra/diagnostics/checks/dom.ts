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
 * SYG104 noise control (7.3, Sift): no report when the component may draw matching elements
 * itself (the SYG103 words rule below) and the component owning each matched element listens to
 * the same selector (a confirmation every component draws its own of).
 *
 * SYG103 noise control (conditional rendering is normal): a selector whose
 * class/id/tag tokens all appear in the component's view source (or in the
 * words sygnal/vite registered for it: markup drawn by view helpers in its
 * module and its relative imports) is assumed to be conditionally rendered
 * and is not reported. A selector that does not
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
import {keyOfSelector} from './controls'
import {appearsInView} from '../viewWords'

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

onReset(() => {
  pending = []
  tracked = new WeakMap()
  owners = new Map()
  matched = new Set()
})

const unref = (t: any) => { if (t && typeof t.unref === 'function') t.unref(); return t }


// G-144: a fragment-rooted component has several root elements
function rootElementsOf(t: Tracked): Element[] {
  try {
    const im = t.source._isolateModule
    // Sift #4: and the app's Portal anchors (their content is in the scope of the component that
    // renders the Portal; the scope check below sorts it out)
    return im ? [...im.getElements(scopesOf(t.source.namespace)), ...(im.portals || [])] : []
  } catch (_) {
    return []
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

// 7.3 (Sift): the component an element belongs to: the owner of its innermost isolation scope
function ownerOf(t: Tracked, el: Element): any {
  let ns: Scope[] | undefined
  try { ns = t.source._isolateModule.getNamespace(el) } catch (_) { ns = undefined }
  for (let i = (ns || []).length - 1; i >= 0; i--) if (ns![i].type === 'total') return owners.get(keyOf(ns!.slice(0, i + 1)))
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
  const roots = rootElementsOf(t).filter(r => typeof r.querySelectorAll === 'function')
  if (!roots.length) return
  const im = t.source._isolateModule
  const checker = new ScopeChecker(t.source.namespace, im)
  let unmatched = false

  for (const selector of t.selectors) {
    const matchKey = `${t.name}\u0000${selector}`
    if (matched.has(matchKey) || t.crossed.has(selector)) continue
    let all: Element[]
    try {
      all = []
      for (const root of roots) {
        all.push(...Array.prototype.slice.call(root.querySelectorAll(selector)))
        if (root.matches(selector)) all.push(root)
      }
    } catch (_) {
      continue // invalid selector: the DOM driver reports that itself
    }
    const own = all.filter(el => { try { return checker.isDirectlyInScope(el) } catch (_) { return false } })
    if (own.length) { matched.add(matchKey); continue }

    if (all.length) {
      t.crossed.add(selector)
      // 7.3 (Sift): shared markup, not a missed child event: the component can draw matching
      // elements itself (the selector's words are in its view or its helpers' markup) and every
      // matched element's own component listens to the same selector (each one's own confirmation)
      if (appearsInView(component, selector) && all.every(el => tracked.get(ownerOf(t, el))?.selectors.includes(selector))) continue
      if (!once(`SYG104:${t.name}:${selector}`)) continue
      const child = childNameFor(t, all) || 'a child component'
      // CT-1: a control is named by its identifier
      const control = keyOfSelector(selector)
      reportSafely('SYG104', {
        component,
        message: `${control ? `The control ${control}` : `DOM.select('${selector}')`} in ${t.name} matches elements inside ${child} (isolated), so ${t.name} never receives their events`,
        fix: `Handle the event in ${child}${control ? ` (DOM.<event>(${control}) in its intent)` : ''} and send it up with PARENT (read it here with CHILD.select(${child})), or use EVENTS`,
        data: control ? {selector, child, control} : {selector, child},
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

/**
 * inspect (2B, read-only): a component's intent selectors on a real DOM source
 * and whether a sweep has seen them match (true), only match inside a child
 * (crossed), or neither yet. undefined when the component isn't tracked.
 */
export function selectorStatus(component: any): Array<{selector: string; matched: boolean | null; crossed: boolean}> | undefined {
  const t = tracked.get(component)
  return t && t.selectors.map(selector => ({
    selector,
    matched: matched.has(`${t.name}\u0000${selector}`) ? true : t.crossed.has(selector) ? false : null,
    crossed: t.crossed.has(selector),
  }))
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
