/**
 * SYG724 (PLAN-5 B-1): a `sortable` use whose keyboard path or announcements can't work.
 *
 *   uses = { sort: sortable({ from: 'tasks', item: '.task', handle: '.grip' }) }
 *
 * The keyboard moves start on the handle (the item without a `handle` option), which must be
 * focusable and named; the lift / move / drop announcements are `state.<key>.message`, which
 * must be rendered in a live region. Reported:
 *   - an element matching the handle (or item) selector, in the host's view or a view it renders
 *     (a Collection item, a child), that isn't focusable: not a button / field / link with href /
 *     summary, no tabIndex (or tabIndex -1), not contenteditable;
 *   - such an element (not a <button>: SYG705's job) that is focusable but has no name: no
 *     aria-label / aria-labelledby / title and no content;
 *   - no element in those views with aria-live (not "off") or role status / alert / log, when
 *     every view the host renders could be read.
 * Precision first: a handle / item option that isn't a literal string, a selector beyond
 * tag / .class / #id (or `[attr]`, the default item), elements with spread props and views we
 * can't follow are skipped.
 */
import { stringValue, unwrap, loc } from '../../ast.js'
import { simpleSelector } from './syg701-click-target.js'
import { describe, attr, attrString } from './shared.js'
import { evalStrings, tokenize, classTokens } from '../../strings.js'

const FOCUSABLE = new Set(['button', 'select', 'textarea', 'summary', 'iframe'])
const NAMING = ['aria-label', 'aria-labelledby', 'title', 'ariaLabel', 'ariaLabelledBy']
const LIVE_ROLES = new Set(['status', 'alert', 'log'])

const literal = (opt) => (opt ? stringValue(opt.node) : null)

function tokens(info, names) {
  const a = attr(info, ...names)
  if (!a || a.value == null) return new Set()
  const e = unwrap(a.value)
  const into = { names: new Set(), patterns: [] }
  if (e.type === 'ObjectExpression' || e.type === 'ArrayExpression') tokenize([classTokens([e], { fileInfo: info.file }).join(' ')], into)
  else tokenize(evalStrings(e, { fileInfo: info.file }), into)
  return into.names
}

/** Does an element match `selector`? true / false; null when we can't tell. */
function matcher(selector, attrName) {
  if (selector === `[${attrName}]`) return (info) => !!attr(info, attrName)
  const alts = simpleSelector(selector)
  if (!alts) return null
  return (info) => alts.some(alt => {
    if (alt.tag && alt.tag !== info.tag) return false
    if (alt.classes.length && !alt.classes.every(c => tokens(info, ['className', 'class']).has(c))) return false
    if (alt.ids.length && !alt.ids.every(i => tokens(info, ['id']).has(i))) return false
    return true
  })
}

/** The elements of the host's view and of the views it renders: { elements, complete } */
function reachable(project, comp) {
  const elements = []
  let complete = true
  const seen = new Set()
  const visit = (sink, depth) => {
    if (!sink || seen.has(sink) || depth > 4) return
    seen.add(sink)
    for (const e of sink.elements) elements.push(describe(project, e.file, e.node))
    for (const u of sink.children) {
      if (u.ref) visit(project.viewOf(u.ref), depth + 1)
      else complete = false
      visit(u.injected, depth + 1)
    }
  }
  visit(comp.viewInfo, 0)
  for (const s of project.injectedInto(comp.view)) visit(s, 1)
  return { elements, complete }
}

function focusable(info) {
  if (FOCUSABLE.has(info.tag)) return true
  if (info.tag === 'input') return attrString(attr(info, 'type')) !== 'hidden'
  if (info.tag === 'a') return !!attr(info, 'href')
  if (attr(info, 'contentEditable', 'contenteditable')) return true
  const t = attr(info, 'tabIndex', 'tabindex')
  if (!t) return false
  const s = attrString(t)
  return s == null || Number(s) >= 0
}

/** 'yes' | 'no' | 'unknown': an accessible name from attributes or content */
function named(project, info) {
  for (const n of NAMING) {
    const a = attr(info, n)
    if (a) return attrString(a) === '' ? 'no' : 'yes'
  }
  let state = 'no'
  for (const c of info.el.children) {
    if (c.type === 'JSXText') { if (c.value.trim()) return 'yes'; continue }
    if (c.type === 'JSXExpressionContainer' && unwrap(c.expression).type === 'JSXEmptyExpression') continue
    if (c.type === 'JSXElement') {
      const ci = describe(project, info.file, c)
      // an icon (<i>, <svg>) with no name of its own names nothing
      if ((ci.tag === 'i' || ci.tag === 'svg') && !ci.spread && !NAMING.some(n => attr(ci, n))) continue
    }
    state = 'unknown'
  }
  return state
}

const isLive = (info) => {
  const live = attr(info, 'aria-live', 'ariaLive')
  if (live) return attrString(live) !== 'off'
  const role = attr(info, 'role')
  if (!role) return false
  const r = attrString(role)
  return r == null || LIVE_ROLES.has(r)
}

export default {
  id: 'a11y-sortable',
  codes: ['SYG724'],
  description: 'sortable handle not focusable or unnamed, or no live region for its announcements (SYG724)',
  run(project, report) {
    for (const comp of project.components) {
      for (const e of comp.uses?.entries || []) {
        if (!e.def?.firstParty || e.def.name !== 'sortable' || !e.optionsKnown || !comp.viewInfo) continue
        const attrName = e.options.has('attr') ? literal(e.options.get('attr')) : 'data-id'
        if (!attrName) continue
        const handleOpt = e.options.get('handle'), itemOpt = e.options.get('item')
        const target = handleOpt ? literal(handleOpt) : itemOpt ? literal(itemOpt) : `[${attrName}]`
        const { elements, complete } = reachable(project, comp)
        const node = (handleOpt || itemOpt)?.node || e.node
        const file = (handleOpt || itemOpt)?.file || e.file
        const match = target && matcher(target, attrName)
        if (match) {
          const done = new Set()
          for (const info of elements) {
            if (!info.tag || info.spread || !match(info)) continue
            const why = !focusable(info) ? 'focus' : info.tag !== 'button' && named(project, info) === 'no' ? 'name' : null
            if (!why || done.has(why)) continue
            done.add(why)
            const what = `<${info.tag}> (${project.relPath(info.file.path)}:${loc(info.opening).line})`
            report({
              code: 'SYG724', component: comp.name, file, node,
              message: why === 'focus'
                ? `sortable '${e.key}': its ${handleOpt ? 'handle' : 'item'} '${target}' is a ${what} that can't take keyboard focus, so keyboard users can't pick an item up`
                : `sortable '${e.key}': its ${handleOpt ? 'handle' : 'item'} '${target}' is a focusable ${what} with no accessible name, so a screen reader announces nothing useful when it is focused`,
              fix: why === 'focus'
                ? `render the handle as a <button type="button" aria-label={\`Reorder \${title}\`}>, or give the element tabIndex={0} and an aria-label`
                : `name it: aria-label={\`Reorder \${title}\`} (and aria-describedby={context.${e.key}.helpId} for the instructions)`,
              data: { key: e.key, problem: why, element: info.tag },
            })
          }
        }
        if (complete && !elements.some(i => i.spread || i.kind === 'component') && !elements.some(isLive)) {
          report({
            code: 'SYG724', component: comp.name, file: e.file, node: e.node,
            message: `sortable '${e.key}': ${comp.name} renders no live region (aria-live, or role="status" / "alert" / "log"), so the pick-up, move and drop announcements in state.${e.key}.message never reach screen-reader users`,
            fix: `render the message in a live region: <p role="status" aria-live="assertive">{state.${e.key}.message}</p>`,
            data: { key: e.key, problem: 'live-region' },
          })
        }
      }
    }
  },
}
