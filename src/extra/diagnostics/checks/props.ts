/**
 * SYG106 — a prop passed by the parent is silently overwritten (warn; error in
 * strict mode, G-007 part 2).
 *
 * The view is called with { ...props, state, children, slots, context, uid },
 * so a parent prop with one of those names never reaches the child. (Tracker
 * G-007 item 2.) `state` is special: Sygnal reads it as the child's state
 * lens (a state field name or a { get, set } object), so it is only reported
 * when the value can't be a lens.
 *
 * A Switchable page is exempt from the `state` part: it gets the Switchable's props, and their
 * `state` is the host's binding (PLAN-13 F-3's per-page map is not a lens, and isn't the page's).
 *
 * Mechanism: onRender reads the component's current (sanitized) props.
 * Reported once per component name and prop.
 */
import type {DiagnosticCheck} from '../index'
import {report, once, nameOf} from './shared'
import {isStrictEnabled} from './strict'

// PLAN-4 GS-9: uid (the view's uid(name?) function)
// (R5: 6.0 passes no `peers`, D164: a prop of that name reaches the view)
const RESERVED = ['children', 'slots', 'context', 'uid']

export const propsCheck: DiagnosticCheck = {
  id: 'props',

  onRender(component) {
    const props = component && component.currentProps
    if (!props || typeof props !== 'object') return
    const name = nameOf(component)
    const severity = isStrictEnabled() ? 'error' : 'warn'

    for (const key of RESERVED) {
      if (!(key in props) || !once(`SYG106:${name}:${key}`)) continue
      report('SYG106', {
        component,
        severity,
        message: `The prop '${key}' passed to ${name} is overwritten: '${key}' is a reserved view argument, so the child never sees the parent's value`,
        fix: `Rename the prop (for example '${key}Value'), in the parent and in ${name}`,
        data: {prop: key},
      })
    }

    // PLAN-13 F-3 follow-up: a Switchable page gets the Switchable's props, whose `state` is the
    // host's binding (a per-page map too), consumed by the host: not a prop meant for the page
    if ('state' in props && component.__next?.kind !== 'page') {
      const value = props.state
      const isLens = typeof value === 'string' || (value && typeof value === 'object' && typeof value.get === 'function')
      if (!isLens && value !== undefined && once(`SYG106:${name}:state`)) {
        report('SYG106', {
          component,
          severity,
          message: `The prop 'state' passed to ${name} is not data: Sygnal reads it as the child's state lens (a state field name or a { get, set } object), and the view's 'state' argument is the child's own state`,
          fix: `To give ${name} a slice of the parent state use state="fieldName"; to pass data, use another prop name (for example 'item')`,
          data: {prop: 'state', valueType: typeof value},
        })
      }
    }
  },
}
