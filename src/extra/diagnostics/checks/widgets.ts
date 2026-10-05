/**
 * PLAN-5 W-1: widget diagnostics (dev entry; `defineWidget` in src/extra/widget.ts carries no text).
 *
 * The widget module calls `__SYGNAL_DIAGNOSTICS__.widget(code, widgetTag, owner, extra)`:
 *   140  dispatch(name) (mount's third parameter) — SYG140 (warn) when `name` is not in the widget's `events`: sygnal-check and
 *        the docs read `events`, so an undeclared name is a typo or a missing declaration
 *   143  the widget tag used as a selector (DOM.select(DatePicker), `${DatePicker}`) — SYG143
 *        (warn, once per widget): it matches nothing
 *   144  a host mounted — SYG144 (info, once per widget): a declared event name the host element
 *        also fires natively (`'change'` on an `<input>` host), so the intent sees both; not
 *        for the first-party Zag parts (`def.$own`: Menu's `select`, D211)
 *   660/661/662  mount / update / unmount threw (`extra` is the error) — SYG660–662 (error)
 *   669  fromZag (G-410): its render returned Sygnal components / widget tags / special JSX
 *        (`extra`: their tags, e.g. ['<Badge>', '<Transition>']) — SYG669 (warn, once per widget)
 * It returns the reported diagnostic (the widget module logs a bare `[Sygnal SYG66x]` otherwise).
 *
 * SYG141 (listening to an event a widget doesn't declare) is static only (sygnal-check): the
 * runtime doesn't see which listener a selector serves. SYG142 for an undeclared command sent to a
 * widget's host is reported by the element command check (checks/elementCommands.ts).
 */
import {devReport, once, unsee, nameOf} from './shared'
import {DEV_CODE_SEVERITY} from '../codes'

/** a widget's name for messages: `name` from its definition, else its host tag */
export const widgetName = (w: any): string => w?.def?.name ? `widget ${w.def.name}` : `widget <${w?.def?.tag || 'div'}>`

const ids = new WeakMap<object, number>()
let next = 0
const idOf = (w: any): number => {
  let id = ids.get(w)
  if (id === undefined) ids.set(w, id = ++next)
  return id
}

const PHASE: Record<number, string> = {660: 'mount', 661: 'update', 662: 'unmount'}

export function reportWidget(code: number, w: any, owner?: any, x?: any): any {
  const name = widgetName(w), component = owner ? nameOf(owner) : name
  if (code == 140) {
    if (w.events.includes(x) || !once(`SYG140:${idOf(w)}:${x}`)) return
    return devReport('SYG140', {
      component,
      message: `${name} dispatched '${x}', which is not one of its declared events (${w.events.length ? w.events.join(', ') : 'it declares none'})`,
      fix: `Add '${x}' to the widget's events (defineWidget({ events: [${[...w.events, x].map((e: string) => `'${e}'`).join(', ')}] })), or dispatch a declared name`,
      data: {event: x, events: w.events},
    })
  }
  if (code == 143) {
    if (!once(`SYG143:${idOf(w)}`)) return
    return devReport('SYG143', {
      component: name,
      message: `${name} was used as a selector (DOM.select(${w.def.name || 'Widget'}) or in a template string); a widget tag matches nothing`,
      fix: `Give the widget a className and select that (<${w.def.name || 'Widget'} className="due" />, DOM.select('.due')), or make it a control: controls({ Due: ${w.def.name || 'Widget'} })`,
    })
  }
  if (code == 144) {
    // D211: not for Sygnal's own parts (Menu's `select` is its documented event)
    if (!x || w.def.$own || !once(`SYG144:${idOf(w)}`)) return
    const native = w.events.filter((e: string) => 'on' + e in x)
    if (!native.length) return
    return devReport('SYG144', {
      component: name,
      message: `${name} declares ${native.map((e: string) => `'${e}'`).join(', ')}, which its <${x.localName}> host also fires natively, so a listener gets both the widget's events and the element's`,
      fix: `Name the widget's event differently (e.g. 'pick' for a date picker's change), or read only what both carry`,
      data: {events: native, element: x.localName},
    })
  }
  if (code == 669) {
    // G-470: once per widget tag, counted only when reported (not with diagnostics off)
    const k = `SYG669:${idOf(w)}`
    if (!once(k)) return
    const d = devReport('SYG669', {
      component: name,
      message: `${name}'s fromZag render returned ${x.join(', ')}; the adapter patches its render outside the component tree, so they don't run there (a component isn't instantiated, a widget doesn't mount, special JSX renders as an unknown element)`,
      fix: `Render plain elements in the fromZag render (with Zag's prop getters spread on them), pass data in through the widget's props, and put components, widgets and special JSX around the widget tag in the view`,
      data: {found: x},
    })
    if (!d) unsee(k)
    return d
  }
  const phase = PHASE[code]
  if (!phase) return
  const sev = DEV_CODE_SEVERITY[`SYG${code}`]
  const d = devReport(`SYG${code}`, {
    component,
    message: `${name}'s ${phase}() threw: ${x?.message ?? x}` + (code < 662 ? `; ${owner ? `${nameOf(owner)}'s onError fallback renders in its place` : 'it is not mounted'}` : ''),
    fix: code < 662 ? `Fix the widget's ${phase}(), or give ${owner ? nameOf(owner) : 'the component'} an .onError for a custom fallback` : `Fix the widget's unmount()`,
    data: {phase, error: x},
    severity: sev,
  })
  // the error with its stack (the text is printed by report() in 'warn' mode, collected otherwise)
  if (d) console.error(x)
  return d
}

/** Publish the widget hook on the core bridge. Returns an uninstall function. */
export function installWidgetHooks(): () => void {
  const c = (globalThis as any).__SYGNAL_DIAGNOSTICS__
  if (!c) return () => {}
  c.widget = reportWidget
  return () => { if (c.widget === reportWidget) c.widget = undefined }
}
