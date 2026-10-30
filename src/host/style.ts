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

/** hidden by itself or an ancestor: display none, `hidden`, or aria-hidden="true" */
export function isHidden(el: HostElement, rules: readonly HostStyleRule[] = []): boolean {
  for (let e: HostElement | null = el; e && e.localName != 'root'; e = e.parentNode) {
    if (e.getAttribute('aria-hidden') === 'true' || computeStyle(e, rules).display === 'none') return true
  }
  return false
}
