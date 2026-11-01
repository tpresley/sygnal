/**
 * sygnal/host: a renderer's stylesheet. A target that can't read CSS (a terminal, an agent's
 * snapshot) still needs the part of an app's CSS that changes what is shown: todomvc hides `.edit`
 * unless its item is `.editing`. Rules are [selector, style] pairs, applied in order; an inline
 * `style={{ display: 'none' }}` and the `hidden` attribute win, as in the browser.
 */
import type {HostElement} from './dom'
import {matches} from './selector'

export interface HostStyle {
  /** 'none' hides the element and its subtree; renderers define what the others mean */
  display?: string
  [key: string]: any
}
export type HostStyleRule = [selector: string, style: HostStyle]

/** the element's style: matching rules in order, then its inline style; `hidden` → display none */
export function computeStyle(el: HostElement, rules: readonly HostStyleRule[] = []): HostStyle {
  const out: HostStyle = {}
  for (const [sel, st] of rules) if (matches(el, sel)) Object.assign(out, st)
  for (const k in el.style) if (el.style[k] != null && el.style[k] !== '') out[k] = el.style[k]
  if (el.hasAttribute('hidden')) out.display = 'none'
  return out
}

/**
 * Not rendered, as a browser's user-agent sheet has it: a closed <dialog>, a [popover] that isn't
 * showing, the content of a closed <details> other than its <summary>
 */
export function closedByHost(e: HostElement): boolean {
  if (e.localName == 'dialog' && !e.open) return true
  if (e.hasAttribute('popover') && !e.popoverOpen) return true
  const p = e.parentNode
  return !!p && p.localName == 'details' && !p.open && !(e.localName == 'summary' && p.children.find(c => c.localName == 'summary') === e)
}

/** hidden by itself or an ancestor: display none, `hidden`, aria-hidden="true", or closed (closedByHost) */
export function isHidden(el: HostElement, rules: readonly HostStyleRule[] = []): boolean {
  for (let e: HostElement | null = el; e && e.localName != 'root'; e = e.parentNode) {
    if (e.getAttribute('aria-hidden') === 'true' || closedByHost(e) || computeStyle(e, rules).display === 'none') return true
  }
  return false
}

/** inert: an [inert] ancestor, or outside the topmost open modal dialog */
export function isInert(el: HostElement): boolean {
  const m = el.ownerDocument.topModal
  if (m && !m.contains(el)) return true
  for (let e: HostElement | null = el; e; e = e.parentNode) if (e.hasAttribute('inert')) return true
  return false
}
