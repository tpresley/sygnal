/*
 * 'sygnal/host' (research: dev-plans/research/alt-renderers): the renderer kit. A Sygnal app
 * renders into a host tree (a DOM subset, no browser), through the same core, snabbdom diff and
 * modules as the DOM driver; a renderer target paints that tree its own way and dispatches
 * DOM-shaped events into it. 'sygnal/terminal' and 'sygnal/agent-ui' are built on it; so can a
 * third party's target.
 *
 *   const doc = new HostDocument()
 *   run(App, { DOM: makeHostDriver(doc, { onPatch: paint }) })
 *   // paint: read doc.body; input: el.dispatchEvent(new HostEvent('click'))
 *
 * Separate entry: './index' becomes the external 'sygnal' (one core per app, 0 B in its bundle).
 */
import {createElement} from './index'
import {fieldTags} from './host/driver'

export {HostDocument, HostElement, HostText, HostNode, HostEvent, hostApi, nodeId} from './host/dom'
export {makeHostDriver, HostSource} from './host/driver'
export {matches, querySelectorAll} from './host/selector'
export {computeStyle, isHidden} from './host/style'
export type {HostStyle, HostStyleRule} from './host/style'
export type {HostListener, HostDelegate} from './host/dom'
export type {HostDriverOptions} from './host/driver'
export type {UserAgentOptions, KeyInit} from './host/actions'
export {activate, doubleClick, pressKey, typeText, fill, chooseOption, submit, isFocusable, isInteractive, isTextField, focusableElements, moveFocus, labelTarget, optionValue} from './host/actions'

/**
 * Form-field tags of a target's own vocabulary (`textinput`, `toggle`, …), beyond input, textarea
 * and select. The JSX pragma then never reuses their vnodes by identity (so a value the state
 * sets back to what it rendered last is written again), and the host driver re-syncs their
 * `value` / `checked` on each patch, as the DOM driver does for <input>. Call it before the
 * first render.
 */
export function registerFieldTags(...tags: string[]): void {
  const t = (createElement as any).$t
  for (const tag of tags) {
    fieldTags.add(tag)
    // the pragma's tag bits (src/pragma): 1 a field, 8 a hyphenated (custom element) tag
    if (t) t[tag] = 1 | (/-/.test(tag) ? 8 : 0)
  }
}
