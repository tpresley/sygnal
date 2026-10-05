/**
 * PLAN-5 W-1: widget diagnostics (dev entry; `defineWidget` in src/extra/widget.ts carries no text).
 *
 * The widget module calls `__SYGNAL_DIAGNOSTICS__.widget(code, widgetTag, owner, extra)`:
 *   140  emit(name) — SYG140 (warn) when `name` is not in the widget's `events`: sygnal-check and
 *        the docs read `events`, so an undeclared name is a typo or a missing declaration
 *   142  each command name at defineWidget(): throws the SYG142 Error for `close` /
 *        `togglePopover` (D190: reserved, the core passes those methods returnValue / force)
 *   143  the widget tag used as a selector (DOM.select(DatePicker), `${DatePicker}`) — SYG143
 *        (warn, once per widget): it matches nothing
 *   144  a host mounted — SYG144 (info, once per widget): a declared event name the host element
 *        also fires natively (`'change'` on an `<input>` host), so the intent sees both
 *   660/661/662  mount / update / unmount threw (`extra` is the error) — SYG660–662 (error)
 * It returns the reported diagnostic (the widget module logs a bare `[Sygnal SYG66x]` otherwise).
 *
 * SYG141 (listening to an event a widget doesn't declare) is static only (sygnal-check): the
 * runtime doesn't see which listener a selector serves. SYG142 for an undeclared command sent to a
 * widget's host is reported by the element command check (checks/elementCommands.ts).
 */
import {devReport, once, nameOf} from './shared'
import {DEV_CODE_SEVERITY, docsUrlFor} from '../codes'

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
      message: `${name} emitted '${x}', which is not one of its declared events (${w.events.length ? w.events.join(', ') : 'it declares none'})`,
      fix: `Add '${x}' to the widget's events (defineWidget({ events: [${[...w.events, x].map((e: string) => `'${e}'`).join(', ')}] })), or emit a declared name`,
      data: {event: x, events: w.events},
    })
  }
  if (code == 142) {
    if (x != 'close' && x != 'togglePopover') return
    const err: any = new Error(`[Sygnal SYG142] ${name}: defineWidget: a command can't be named '${x}': element commands pass ${x}() ` +
      `${x == 'close' ? 'returnValue' : 'force'}, not the options. Rename it (e.g. '${x == 'close' ? 'dismiss' : 'toggle'}'). ${docsUrlFor('SYG142')}`)
    err.code = 'SYG142'
    throw err
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
    if (!x || !once(`SYG144:${idOf(w)}`)) return
    const native = w.events.filter((e: string) => 'on' + e in x)
    if (!native.length) return
    return devReport('SYG144', {
      component: name,
      message: `${name} declares ${native.map((e: string) => `'${e}'`).join(', ')}, which its <${x.localName}> host also fires natively, so a listener gets both the widget's events and the element's`,
      fix: `Name the widget's event differently (e.g. 'pick' for a date picker's change), or read only what both carry`,
      data: {events: native, element: x.localName},
    })
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
