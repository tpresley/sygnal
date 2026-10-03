/**
 * SYG106 — a prop passed by the parent is silently overwritten (warn; error in
 * strict mode, G-007 part 2).
 *
 * The view is called with { ...props, state, children, slots, context, peers, uid },
 * so a parent prop with one of those names never reaches the child. (Tracker
 * G-007 item 2.) `state` is special: Sygnal reads it as the child's state
 * lens (a state field name or a { get, set } object), so it is only reported
 * when the value can't be a lens.
 *
 * Mechanism: onRender reads the component's current (sanitized) props.
 * Reported once per component name and prop.
 */
import type {DiagnosticCheck} from '../index'
import {report, once, nameOf} from './shared'
import {isStrictEnabled} from './strict'

// PLAN-4 GS-9: uid (the view's uid(name?) function)
const RESERVED = ['children', 'slots', 'context', 'peers', 'uid']

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

    if ('state' in props) {
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
