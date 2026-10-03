/**
 * SYG115 — unknown DOM event shorthand (warn, G-143).
 *
 * The core's DOM source Proxy (wrapDOMSource in src/component.ts) turns ANY unknown property
 * into an event shorthand: `DOM.<name>(sel)` = `DOM.select(sel).events('<name>')`. A made-up
 * name such as `DOM.key('.x')` or `DOM.enter('.x')` therefore listens for an event the browser
 * never fires, and the action silently never happens.
 *
 * Mechanism: the `sources` hook (called before each component's intent) wraps the DOM source
 * in a second Proxy. Calling a shorthand whose name is not a known DOM event reports SYG115
 * (once per component name and event), then behaves exactly like the core shorthand. Only the
 * call is reported, not the property read, so tools that inspect the source (pretty-printers)
 * don't trigger it. `DOM.select(sel).events(name)` is never checked: it is the explicit form
 * for custom events.
 */
import type {DiagnosticCheck} from '../index'
import {devReport, once, nameOf, suggest} from './shared'

// Standard DOM / UI event names (lower case). In a browser, `on<name>` on an element or the
// window also counts, so newer events are accepted there too.
const KNOWN = new Set((
  'abort afterprint animationcancel animationend animationiteration animationstart auxclick ' +
  'beforeinput beforeprint beforetoggle beforeunload blur cancel canplay canplaythrough change click close ' +
  'compositionend compositionstart compositionupdate contextlost contextmenu contextrestored copy cuechange cut ' +
  'dblclick drag dragend dragenter dragleave dragover dragstart drop durationchange emptied ended error ' +
  'focus focusin focusout formdata fullscreenchange fullscreenerror gotpointercapture hashchange input invalid ' +
  'keydown keypress keyup languagechange load loadeddata loadedmetadata loadstart lostpointercapture message ' +
  'messageerror mousedown mouseenter mouseleave mousemove mouseout mouseover mouseup offline online pagehide ' +
  'pageshow paste pause play playing pointercancel pointerdown pointerenter pointerleave pointermove pointerout ' +
  'pointerover pointerrawupdate pointerup popstate progress ratechange rejectionhandled reset resize scroll ' +
  'scrollend search securitypolicyviolation seeked seeking select selectionchange selectstart slotchange stalled ' +
  'storage submit suspend timeupdate toggle touchcancel touchend touchmove touchstart transitioncancel ' +
  'transitionend transitionrun transitionstart unhandledrejection unload visibilitychange volumechange waiting wheel'
).split(' '))

const isKnown = (name: string): boolean => {
  if (KNOWN.has(name)) return true
  const on = 'on' + name
  const g: any = globalThis
  try {
    return !!((g.HTMLElement && on in g.HTMLElement.prototype) || (g.window && on in g.window) ||
      (g.Document && on in g.Document.prototype))
  } catch (_) { return false }
}

// Names agents reach for that are enriched-stream methods or key names, not events
const KEY_FIX = (sel: string, key?: string) =>
  `Listen for the real event and read the key: DOM.keydown(${sel}).key()` +
  (key ? `.filter(k => k === '${key}')` : '')
const SPECIAL: Record<string, (sel: string) => string> = {
  key: sel => KEY_FIX(sel),
  keys: sel => KEY_FIX(sel),
  enter: sel => KEY_FIX(sel, 'Enter'),
  escape: sel => KEY_FIX(sel, 'Escape'),
  esc: sel => KEY_FIX(sel, 'Escape'),
  value: sel => `Listen for the real event and read the value: DOM.input(${sel}).value()`,
  checked: sel => `Listen for the real event and read the box: DOM.change(${sel}).checked()`,
  data: sel => `Listen for the real event and read the attribute: DOM.click(${sel}).data('name')`,
  doubleclick: sel => `Use DOM.dblclick(${sel})`,
}

const fixFor = (name: string, selector: any): string => {
  const sel = typeof selector === 'string' ? `'${selector}'` : 'sel'
  const special = SPECIAL[name.toLowerCase()]
  if (special) return special(sel)
  const s = suggest(name, KNOWN)
  return (s ? `Did you mean DOM.${s}(${sel})? ` : '') +
    `If '${name}' is a custom event you dispatch yourself, use the explicit form DOM.select(${sel}).events('${name}')`
}

const wrapped = new WeakMap<object, any>()

function checkedDOM(component: any, dom: any): any {
  if (!dom || typeof dom != 'object') return dom
  let proxy = wrapped.get(dom)
  if (proxy) return proxy
  const name = nameOf(component)
  proxy = new Proxy(dom, {
    get(t: any, k: any) {
      const v = t[k]
      if (typeof k != 'string' || k in t || typeof v != 'function' || isKnown(k)) return v
      return function (this: any, selector: any, ...rest: any[]) {
        if (once(`SYG115:${name}:${k}`)) {
          devReport('SYG115', {
            component,
            message: `${name}.intent uses DOM.${k}(${typeof selector == 'string' ? `'${selector}'` : '…'}), but '${k}' is not a DOM event, so it never fires`,
            fix: fixFor(k, selector),
            data: {event: k, selector},
          })
        }
        return v.call(this, selector, ...rest)
      }
    },
  })
  wrapped.set(dom, proxy)
  return proxy
}

export const shorthandCheck: DiagnosticCheck = {
  id: 'shorthand',

  sources(component, sources) {
    if (!sources || typeof Proxy != 'function') return
    const domName = component?.DOMSourceName || 'DOM'
    if (!sources[domName]) return
    return new Proxy(sources, {
      get(t: any, k: any) {
        const v = t[k]
        return k === domName ? checkedDOM(component, v) : v
      },
    })
  },
}
