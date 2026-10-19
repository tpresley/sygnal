/**
 * SYG731 (PLAN-6 K-1): a click target that shows an on/off or selected state only through its
 * class. The element a click listener targets has a class that depends on the state
 * (`className={{ done: state.done }}`, `className={state.on ? 'on' : ''}`, `clsx({ ... })`), the
 * click's action flips or sets that same field, and the element has no `aria-pressed`,
 * `aria-checked`, `aria-expanded`, `aria-selected` or `aria-current`: sighted users see the state
 * change, screen-reader users hear nothing.
 *
 * To keep false positives low, the class must follow a field the click's own STATE reducer
 * toggles (`done: !state.done`), or be an equality (`state.filter === 'done'`, `state.selected ===
 * id`) on a field that reducer writes (a selection). A busy class (`{ saving: state.saving }` on a
 * Save button whose reducer sets `saving: true`) is not a toggle. Native controls that carry their
 * own state (checkbox / radio inputs, select, option, details / summary, label) are fine, and so
 * is an element with spread props or a role the checker can't judge.
 *
 * PLAN-11 Q-2: an element that announces the change another way is fine too: its text children or
 * its `aria-label` read a field of the class condition (a Copy button showing 'Copied!'), it has
 * `aria-live`, or a literal `role="status"` / `role="alert"`. The fix suggests `aria-pressed` only
 * for a real toggle (the reducer flips `!field`); for a selection or another value it says how to
 * announce the change.
 */
import { walk, unwrap, propName, memberName, loc } from '../../ast.js'
import { resolveExpr } from '../../model/resolve.js'
import { attr } from './shared.js'
import { eventOf, selectorTargets } from './syg701-click-target.js'

const ARIA_STATE = ['aria-pressed', 'aria-checked', 'aria-expanded', 'aria-selected', 'aria-current']
const NATIVE_STATE = new Set(['input', 'select', 'option', 'details', 'summary', 'label', 'textarea'])
const CLASS_HELPERS = new Set(['classes', 'classNames', 'classnames', 'clsx', 'cx'])
const LIVE_ROLES = new Set(['status', 'alert'])
// names every condition reads, so a shared one says nothing about the field
const GENERIC = new Set(['state', 'context', 'props', 'children', 'undefined'])

const isLiteral = (n) => ['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral'].includes(n?.type) ||
  (n?.type === 'TemplateLiteral' && n.expressions.length === 0)

/** The conditions a class expression switches on: Array<expression>. */
function classConditions(expr) {
  const out = []
  const visit = (e) => {
    e = unwrap(e)
    if (!e) return
    switch (e.type) {
      case 'ObjectExpression':
        for (const p of e.properties) if (p.type === 'ObjectProperty' && !isLiteral(unwrap(p.value))) out.push(unwrap(p.value))
        return
      case 'ConditionalExpression': out.push(unwrap(e.test)); visit(e.consequent); visit(e.alternate); return
      case 'LogicalExpression': if (e.operator === '&&') out.push(unwrap(e.left)); visit(e.right); if (e.operator !== '&&') visit(e.left); return
      case 'TemplateLiteral': e.expressions.forEach(visit); return
      case 'ArrayExpression': e.elements.forEach(visit); return
      case 'BinaryExpression': if (e.operator === '+') { visit(e.left); visit(e.right) } return
      case 'CallExpression': {
        const c = unwrap(e.callee)
        if (c.type === 'Identifier' && CLASS_HELPERS.has(c.name)) e.arguments.forEach(visit)
        else if (c.type === 'MemberExpression' && memberName(c) === 'join') visit(c.object)
        return
      }
      default:
    }
  }
  visit(expr)
  return out
}

/** Field names a condition reads ({ fields, equality }): state.done → done; done (destructured) → done. */
function conditionFields(conds) {
  const fields = new Set()
  let equality = false
  for (const c of conds) {
    walk(c, (n) => {
      if (n.type === 'BinaryExpression' && ['===', '==', '!==', '!='].includes(n.operator)) equality = true
      if ((n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') && !n.computed) {
        const name = memberName(n)
        if (name) fields.add(name)
      }
      if (n.type === 'Identifier') fields.add(n.name)
      return true
    })
  }
  return { fields, equality }
}

/** The STATE reducer node of a model entry (a function, possibly resolved), or null. */
function stateReducer(project, comp, action) {
  const e = comp.model?.entries.find(x => x.action === action)
  if (!e) return null
  const prop = e.file.parents.get(e.node)
  if (prop?.type !== 'ObjectProperty' && prop?.type !== 'ObjectMethod') return null
  let v = prop.type === 'ObjectMethod' ? prop : unwrap(prop.value)
  let file = e.file
  if (v?.type === 'ObjectExpression') {
    const s = v.properties.find(p => (p.type === 'ObjectProperty' || p.type === 'ObjectMethod') && propName(p) === 'STATE')
    if (!s) return null
    v = s.type === 'ObjectMethod' ? s : unwrap(s.value)
  }
  const r = resolveExpr(project, file, v)
  return r?.node ? r.node : null
}

/**
 * Does the reducer toggle (`!x.field`) or, for an equality, write (`field: …`) one of the fields?
 * → { field, toggle } (toggle: a `!field` flip), or null.
 */
function reducerFlips(reducer, fields, equality) {
  let hit = null
  walk(reducer, (n) => {
    if (hit) return false
    if (n.type === 'UnaryExpression' && n.operator === '!') {
      const a = unwrap(n.argument)
      const name = a?.type === 'MemberExpression' && !a.computed ? memberName(a) : a?.type === 'Identifier' ? a.name : null
      if (name && fields.has(name)) hit = { field: name, toggle: true }
    }
    if (equality && n.type === 'ObjectProperty') {
      const k = propName(n)
      if (k && fields.has(k) && k !== 'state') hit = { field: k, toggle: false }
    }
    return true
  })
  return hit
}

/** The expressions among an element's children (JSX expression containers, nested elements' too). */
function childExpressions(el) {
  const out = []
  const visit = (kids) => {
    for (const k of kids || []) {
      if (k.type === 'JSXExpressionContainer' && k.expression?.type !== 'JSXEmptyExpression') out.push(k.expression)
      else if (k.type === 'JSXElement' || k.type === 'JSXFragment') visit(k.children)
    }
  }
  visit(el?.children)
  return out
}

/**
 * Q-2: does the element announce the change another way? Its text children or aria-label read a
 * field of the class condition, it has aria-live, or a literal role="status" / "alert".
 */
function announced(t, fields) {
  if (attr(t, 'aria-live')) return true
  const role = attr(t, 'role')
  if (role?.value?.type === 'StringLiteral' && LIVE_ROLES.has(role.value.value.trim())) return true
  const exprs = childExpressions(t.el)
  const label = attr(t, 'aria-label')
  if (label?.value && label.value.type !== 'StringLiteral') exprs.push(label.value)
  if (!exprs.length) return false
  const read = conditionFields(exprs).fields
  for (const f of read) if (!GENERIC.has(f) && fields.has(f)) return true
  return false
}

/** The intent action whose stream contains a selector node. */
function actionOf(intent, selNode) {
  for (const a of intent.actions) {
    const p = intent.file.parents.get(a.node)
    const v = p?.type === 'ObjectProperty' ? p.value : null
    if (v && selNode.start >= v.start && selNode.end <= v.end) return a.name
  }
  return null
}

export default {
  id: 'a11y-toggle-state',
  codes: ['SYG731'],
  description: 'Click target whose class toggles with state but has no ARIA state attribute',
  run(project, report) {
    for (const comp of project.components) {
      const intent = comp.intent
      if (!intent?.fn || !comp.viewInfo || !comp.model?.known) continue
      const reported = new Set()
      for (const sel of intent.selectors) {
        if (sel.global || sel.component || sel.dynamic || sel.selector == null) continue
        if (eventOf(intent.file, sel) !== 'click') continue
        const action = actionOf(intent, sel.node)
        const reducer = action && stateReducer(project, comp, action)
        if (!reducer) continue
        const targets = selectorTargets(project, comp, sel)
        for (const t of targets || []) {
          if (reported.has(t.el) || t.spread || !t.tag || NATIVE_STATE.has(t.tag)) continue
          if (ARIA_STATE.some(a => attr(t, a))) continue
          const role = attr(t, 'role')
          if (role && role.value?.type !== 'StringLiteral') continue
          const cls = attr(t, 'className', 'class')
          if (!cls || cls.value == null) continue
          const conds = classConditions(cls.value)
          if (!conds.length) continue
          const { fields, equality } = conditionFields(conds)
          const flip = reducerFlips(reducer, fields, equality)
          if (!flip) continue
          if (announced(t, fields)) continue
          const { field, toggle } = flip
          reported.add(t.el)
          const c0 = conds[0]
          let cond = t.file.source.slice(c0.start, c0.end)
          if (cond.length > 50) cond = '<the class condition>'
          report({
            code: 'SYG731',
            component: comp.name,
            file: t.file, node: cls.node, anchor: t.opening, // C-2: the className attribute that carries the state
            message: `<${t.tag}> (line ${loc(t.opening).line}) is clicked to change '${field}' ('${action}') and shows it only through its class: screen-reader users don't hear whether it is on`,
            fix: t.tag === 'a'
              ? `mark the current one: aria-current={${cond} ? 'page' : undefined}`
              : toggle
                ? `expose the state with the class's condition: aria-pressed={${cond}} (aria-expanded for a disclosure, aria-checked with role="switch"), or use a native <input type="checkbox">`
                : `announce the change: for a selection, aria-selected={${cond}} in a tablist or listbox or aria-current elsewhere; ` +
                  `otherwise let the text or aria-label follow the same condition (a Copy button that says 'Copied!'), or add aria-live="polite" / role="status"; ` +
                  `aria-pressed={${cond}} only if it really is an on/off toggle`,
            data: { element: t.tag, field, action, toggle },
          })
        }
      }
    }
  },
}
