/**
 * SYG701: a click listener (`DOM.click(x)`, `DOM.select(x).events('click')`)
 * whose target, in the component's own view, is a non-interactive element
 * (div, span, li, p, img, …) without role + tabIndex: mouse users can click
 * it, keyboard users can't reach it. A control declared as one of those tags
 * (`controls({ Card: 'div' })`) counts the same way.
 *
 * SYG704: the same for an <a> without href (not focusable, not a link).
 *
 * Only these cases are reported:
 *   - the selector is a control, or a simple selector whose last compound is
 *     tag / .class / #id only (no attribute selectors, pseudo-classes);
 *   - the matched element's tag is in NON_INTERACTIVE (or is <a> without href);
 *   - it has no spread props, and not both role and tabIndex;
 *   - it contains nothing keyboard users could reach instead (a button, a
 *     link, a form field, an element with tabIndex), and nothing we can't see
 *     (a child component, props.children, a helper call). A click on such a
 *     descendant bubbles to the listener, so the action is still reachable.
 */
import { unwrap, memberName, stringValue, loc } from '../../ast.js'
import { evalStrings, tokenize, classTokens } from '../../strings.js'
import { describe, attr, hasInteractiveOrUnknownContent } from './shared.js'

export const NON_INTERACTIVE = new Set([
  'div', 'span', 'li', 'p', 'img', 'ul', 'ol', 'dl', 'dt', 'dd', 'section', 'article', 'header', 'footer',
  'main', 'nav', 'aside', 'figure', 'figcaption', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'b',
  'i', 'small', 'table', 'tr', 'td', 'th', 'tbody', 'thead', 'tfoot', 'pre', 'code', 'blockquote', 'svg',
])

/** The DOM event a selector is listened for: DOM.click(x) → 'click'; DOM.select(x).events('click') → 'click'. */
function eventOf(file, sel) {
  if (sel.method !== 'select') return sel.method
  const call = file.parents.get(sel.node)
  const member = call && file.parents.get(call)
  if (member?.type !== 'MemberExpression' || unwrap(member.object) !== call || memberName(member) !== 'events') return null
  const outer = file.parents.get(member)
  if (outer?.type !== 'CallExpression') return null
  return stringValue(outer.arguments[0])
}

/**
 * Parse a selector into alternatives { tag, classes, ids } (the last compound
 * of each comma-separated part). null when any part is beyond tag/.class/#id.
 */
export function simpleSelector(selector) {
  if (/[[\]:*\\]/.test(selector)) return null
  const out = []
  for (const part of selector.split(',')) {
    const compounds = part.trim().split(/\s*[\s>+~]\s*/).filter(Boolean)
    const last = compounds[compounds.length - 1]
    if (!last) return null
    const m = /^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/.exec(last)
    if (!m || (!m[1] && !m[2])) return null
    const classes = []
    const ids = []
    for (const t of m[2].match(/[.#][\w-]+/g) || []) (t[0] === '.' ? classes : ids).push(t.slice(1))
    out.push({ tag: m[1] ? m[1].toLowerCase() : null, classes, ids })
  }
  return out
}

function staticTokens(file, info, name) {
  const a = attr(info, ...name)
  if (!a || a.value == null) return new Set()
  const e = unwrap(a.value)
  const into = { names: new Set(), patterns: [] }
  if (e.type === 'ObjectExpression' || e.type === 'ArrayExpression') tokenize([classTokens([e], { fileInfo: file }).join(' ')], into)
  else tokenize(evalStrings(e, { fileInfo: file }), into)
  return into.names
}

function matches(info, alt) {
  if (alt.tag && alt.tag !== info.tag) return false
  if (alt.classes.length) {
    const cls = staticTokens(info.file, info, ['className', 'class'])
    if (!alt.classes.every(c => cls.has(c))) return false
  }
  if (alt.ids.length) {
    const ids = staticTokens(info.file, info, ['id'])
    if (!alt.ids.every(i => ids.has(i))) return false
  }
  return true
}

/** 'SYG701' | 'SYG704' | null for an element that is the click target. */
function problem(project, info) {
  if (info.spread || !info.tag) return null
  if (attr(info, 'role') && attr(info, 'tabIndex', 'tabindex')) return null
  if (attr(info, 'contentEditable', 'contenteditable')) return null
  let code = null
  if (info.tag === 'a') code = attr(info, 'href') ? null : 'SYG704'
  else if (NON_INTERACTIVE.has(info.tag)) code = 'SYG701'
  if (!code) return null
  if (hasInteractiveOrUnknownContent(project, info.file, info.el)) return null
  return code
}

function selectorText(sel) {
  if (sel.control) return sel.control.key
  return `'${sel.selector}'`
}

export default {
  id: 'a11y-click-target',
  codes: ['SYG701', 'SYG704'],
  description: 'Click listener on a non-interactive element (SYG701) or on an <a> without href (SYG704)',
  run(project, report) {
    for (const comp of project.components) {
      const intent = comp.intent
      if (!intent?.fn || !comp.viewInfo) continue
      const sinks = [comp.viewInfo, ...project.injectedInto(comp.view)]
      for (const sel of intent.selectors) {
        if (sel.global || sel.component || sel.dynamic || sel.selector == null) continue
        if (eventOf(intent.file, sel) !== 'click') continue
        let targets = []
        if (sel.control) {
          if (sel.controls.length !== 1) continue
          for (const sink of sinks) {
            for (const opening of sink.controls.get(sel.control) || []) {
              const file = fileOfOpening(project, opening, comp)
              const el = file?.parents.get(opening)
              if (el) targets.push(describe(project, file, el))
            }
          }
        } else {
          if (sel.controls?.length) continue
          const alts = simpleSelector(sel.selector)
          if (!alts) continue
          for (const sink of sinks) {
            for (const e of sink.elements) {
              const info = describe(project, e.file, e.node)
              if (alts.some(a => matches(info, a))) targets.push(info)
            }
            for (const openings of sink.controls.values()) {
              for (const opening of openings) {
                const file = fileOfOpening(project, opening, comp)
                const el = file?.parents.get(opening)
                if (!el) continue
                const info = describe(project, file, el)
                if (alts.some(a => matches(info, a))) targets.push(info)
              }
            }
          }
        }
        targets = [...new Set(targets)]
        const bad = targets.map(t => ({ t, code: problem(project, t) })).filter(x => x.code)
        const seen = new Set()
        for (const { t, code } of bad) {
          if (seen.has(code)) continue
          seen.add(code)
          const where = `line ${loc(t.opening).line}`
          const what = t.kind === 'control' ? `control <${t.name}> (a <${t.tag}>)` : `<${t.tag}>`
          const shown = selectorText(sel)
          if (code === 'SYG701') {
            report({
              code, component: comp.name, file: intent.file, node: sel.node,
              message: `DOM.${sel.method === 'select' ? `select(${shown}).events('click')` : `click(${shown})`} listens on a ${what} (${where}) with no role and tabIndex, so keyboard and screen-reader users can't trigger it`,
              fix: t.kind === 'control'
                ? `declare the control as a button (controls({ ${t.name}: 'button' })), or render it with role="button" tabIndex={0} and also handle DOM.keydown(${t.name}) for Enter and Space`
                : `render a <button> (type="button") instead, or add role="button" tabIndex={0} and also handle DOM.keydown(${shown}) for Enter and Space`,
              data: { element: t.tag, line: loc(t.opening).line },
            })
          } else {
            report({
              code, component: comp.name, file: intent.file, node: sel.node,
              message: `click listener on an <a> without href (${where}): it isn't focusable and is announced as plain text, so keyboard users can't trigger it`,
              fix: 'render a <button type="button"> for an action (style it as a link if needed), or give the <a> a real href if it navigates',
              data: { element: 'a', line: loc(t.opening).line },
            })
          }
        }
      }
    }
  },
}

function fileOfOpening(project, opening, comp) {
  if (contains(comp.file, opening)) return comp.file
  for (const f of project.files.values()) if (f && contains(f, opening)) return f
  return null
}

function contains(file, node) {
  let n = node
  while (n) {
    if (n === file.ast.program) return true
    n = file.parents.get(n)
  }
  return false
}
