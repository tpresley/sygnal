/**
 * SYG730 (PLAN-6 K-1): an action reachable only by hovering. The intent action's stream comes
 * only from `mouseenter` / `mouseover` (or `pointerenter` / `pointerover`) listeners, and nothing
 * else triggers it (no other DOM event in the same stream, no next(), no reply action, no
 * connection or timer, no behavior): keyboard and touch users can't reach what it shows or does.
 * An agent declaration doesn't count as a path: it serves agents, not keyboard users.
 *
 * Precision: only an intent action whose stream expression the checker can see in full: DOM
 * listeners (with literal event names), xstream operators and callbacks. A stream that uses a
 * local variable, another source or a helper is skipped; so is an action whose model entry
 * changes no state (a prefetch or an analytics call on hover is not an interaction).
 */
import { walk, unwrap } from '../../ast.js'
import { findBinding } from '../../scope.js'
import { eventOf } from './syg701-click-target.js'

const HOVER = new Set(['mouseenter', 'mouseover', 'pointerenter', 'pointerover'])
const XSTREAM = /^xstream(\/|$)/

/** The value expression of an intent action (the property its key belongs to). */
function actionValue(file, keyNode) {
  const p = file.parents.get(keyNode)
  return p?.type === 'ObjectProperty' ? unwrap(p.value) : null
}

/** Does `expr` use only the intent's DOM source, xstream imports, its own callbacks and globals? */
function selfContained(intent, expr) {
  const file = intent.file
  const fn = intent.fn
  let ok = true
  walk(expr, (n) => {
    if (!ok) return false
    if (n.type !== 'Identifier') return true
    const p = file.parents.get(n)
    if (p && ((p.type === 'MemberExpression' || p.type === 'OptionalMemberExpression') && p.property === n && !p.computed)) return true
    if (p && p.type === 'ObjectProperty' && p.key === n && !p.computed && !p.shorthand) return true
    const b = findBinding(file, n.name, n)
    if (!b) return true // a global (Math, console)
    if (b.kind === 'import') { if (!XSTREAM.test(b.source)) ok = false; return true }
    if ((b.kind === 'param' || b.kind === 'pattern') && b.node === fn) {
      // only the DOM source (a destructured DOM, or sources.DOM)
      if (n.name !== 'DOM' && !(p?.type === 'MemberExpression' && p.object === n && p.property?.name === 'DOM')) ok = false
      return true
    }
    // a binding declared inside the expression (a callback's parameter or local)
    const at = b.node
    if (at && at.start >= expr.start && at.end <= expr.end) return true
    ok = false
    return true
  })
  return ok
}

function stateChanging(comp, action) {
  const entry = comp.model?.entries.find(e => e.action === action)
  if (!entry) return false
  return entry.sinks.includes('STATE')
}

export default {
  id: 'a11y-hover-only',
  codes: ['SYG730'],
  description: 'Action reachable only by hovering (mouseenter / mouseover)',
  run(project, report) {
    for (const comp of project.components) {
      const intent = comp.intent
      if (!intent?.fn || !comp.model?.known) continue
      if (comp.uses && (!comp.uses.known || comp.uses.entries.some(e => !e.def || e.def.dynamic))) continue
      const other = new Set([
        ...comp.model.nextTargets.map(t => t.name),
        ...comp.model.replyTargets.map(t => t.name),
        ...(comp.connections?.targets || []).map(t => t.name),
        ...(comp.uses?.entries || []).flatMap(e => [...e.def.nextTargets, ...e.def.replyTargets]),
      ])
      if (comp.model.dynamicNext.length || comp.model.replyDynamic.length || comp.connections?.dynamic.length) continue
      for (const a of intent.actions) {
        if (other.has(a.name) || !stateChanging(comp, a.name)) continue
        const value = actionValue(intent.file, a.node)
        if (!value) continue
        const sels = intent.selectors.filter(s => s.node.start >= value.start && s.node.end <= value.end)
        if (!sels.length) continue
        const events = sels.map(s => eventOf(intent.file, s))
        if (!events.every(e => e && HOVER.has(e))) continue
        if (!selfContained(intent, value)) continue
        const sel = sels[0]
        const shown = sel.control ? sel.control.key : sel.selector != null ? `'${sel.selector}'` : 'its target'
        report({
          code: 'SYG730',
          component: comp.name,
          file: intent.file, node: sel.node,
          message: `'${a.name}' is triggered only by ${[...new Set(events)].join(' / ')} on ${shown}: keyboard and touch users can't reach it (nothing else in the intent or the model sends '${a.name}')`,
          fix: `also trigger it from focus or a click: ${a.name}: xs.merge(DOM.${events[0]}(${shown}), DOM.focusin(${shown})) (and close it on focusout / Escape as on mouseleave); for a tooltip use tooltip() from sygnal/ui`,
          data: { action: a.name, events: [...new Set(events)] },
        })
      }
    }
  },
}

