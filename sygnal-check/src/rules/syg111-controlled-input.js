/**
 * SYG111: an <input>/<textarea>/<select> whose `value` (or a checkbox/radio
 * whose `checked`) is bound to an expression, while the component's own intent
 * has no input/change/keyup/keydown listener on that element (or an ancestor,
 * since those events bubble).
 *
 * Since 1F (D25) `value` and `checked` are fully controlled: every render writes
 * the bound value back into the field. If typing never updates that state (the
 * field is saved on blur or Enter only), any re-render while the user types
 * resets the text.
 *
 * Literal values are controlled too (D25): `<input value="" />` or
 * `<input type="checkbox" checked />` resets what the user typed/clicked on
 * every re-render. Those are reported for text-like fields and checkboxes/radios
 * (1H-8) with a different fix: drop the prop, or move the value into state.
 *
 * Kept quiet whenever it can't be sure: a dynamic selector or event name, a DOM
 * selector handed to a helper, a field that is readOnly/disabled/hidden, or a
 * component whose intent can't be analyzed.
 *
 * A keydown/keyup listener counts unless it is immediately filtered on a key
 * (`.filter(e => e.key === 'Enter')`): that only reacts to one key, so typing
 * still isn't written to state.
 */
import { walk, unwrap, isFunction, jsxName, jsxAttr, jsxAttrExpr, memberName, stringValue } from '../ast.js'
import { sourceAliases, isSourceRef, DOM_SOURCE_METHODS } from '../model/intent.js'
import { evalStrings, classTokens, tokenize, DYN } from '../strings.js'

const FIELDS = new Set(['input', 'textarea', 'select'])
const NOT_TYPED = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'file'])
const TOGGLES = new Set(['checkbox', 'radio'])
const TEXT_EVENTS = new Set(['input', 'change', 'keyup', 'keydown', 'keypress', 'beforeinput'])
const KEY_EVENTS = new Set(['keyup', 'keydown', 'keypress'])
const TRANSPARENT = new Set(['Fragment', 'Portal', 'Transition', 'Suspense', 'ClientOnly', 'Slot', 'React.Fragment'])
const UNKNOWN = '*'

const isLiteral = (e) => !!e && /^(StringLiteral|NumericLiteral|BooleanLiteral|NullLiteral)$/.test(e.type)
const isComponentTag = (name) => !!name && (/^[A-Z]/.test(name) || name.includes('.'))

// ─── intent: which (selector chain, event) pairs are listened to ────────────

/** Selectors of a DOM chain (DOM, DOM.select(a).select(b)); null if not a chain. */
function chainOf(node, sa) {
  node = unwrap(node)
  if (isSourceRef(node, 'DOM', sa)) return []
  if (node?.type === 'CallExpression') {
    const callee = unwrap(node.callee)
    if (callee.type === 'MemberExpression' && memberName(callee) === 'select') {
      const inner = chainOf(callee.object, sa)
      if (inner) return [...inner, selectorText(node.arguments[0])]
    }
  }
  return null
}

function selectorText(arg) {
  const s = stringValue(arg)
  return s == null ? UNKNOWN : s
}

const parentOf = (file, n) => file.parents.get(n)

/** `.events('keydown')` followed directly by `.filter(e => e.key …)` */
function keyFiltered(file, call) {
  const m = parentOf(file, call)
  if (m?.type !== 'MemberExpression' || m.object !== call || memberName(m) !== 'filter') return false
  const c = parentOf(file, m)
  const fn = c?.type === 'CallExpression' ? unwrap(c.arguments[0]) : null
  if (!fn || !isFunction(fn)) return false
  return /\.(key|code|keyCode|which)\b/.test(file.source.slice(fn.start, fn.end))
}

function eventsOfOptions(opts) {
  opts = unwrap(opts)
  if (!opts) return ['input', 'submit']
  if (opts.type !== 'ObjectExpression') return [UNKNOWN]
  for (const p of opts.properties) {
    if (p.type !== 'ObjectProperty') return [UNKNOWN]
    if ((p.key.name || p.key.value) !== 'events') continue
    const v = unwrap(p.value)
    const s = stringValue(v)
    if (s != null) return [s]
    if (v.type === 'ArrayExpression') return v.elements.map(e => stringValue(e) ?? UNKNOWN)
    return [UNKNOWN]
  }
  return ['input', 'submit']
}

/** @returns {Array<{ chain: string[], event: string }>} */
export function intentListeners(file, fn) {
  const sa = sourceAliases(fn)
  const out = []
  walk(fn.body, (n) => {
    if (n.type !== 'CallExpression') return true
    const callee = unwrap(n.callee)
    // processForm(DOM.select('form'), { events })
    if (callee.type === 'Identifier' && callee.name === 'processForm') {
      const chain = chainOf(n.arguments[0], sa)
      if (chain && chain.length) for (const event of eventsOfOptions(n.arguments[1])) out.push({ chain, event })
      return true
    }
    if (callee.type !== 'MemberExpression') return true
    const method = memberName(callee)
    const chain = chainOf(callee.object, sa)
    if (!chain || !method) return true
    if (method === 'events' && chain.length) {
      const ev = stringValue(n.arguments[0]) ?? UNKNOWN
      out.push({ chain, event: KEY_EVENTS.has(ev) && keyFiltered(file, n) ? ev + ':key' : ev })
    } else if (method === 'select') {
      // a select chain used as a value (passed to a helper, stored): unknown listener
      const p = parentOf(file, n)
      const chained = p?.type === 'MemberExpression' && p.object === n
      const formArg = p?.type === 'CallExpression' && unwrap(p.callee)?.name === 'processForm'
      if (!chained && !formArg) out.push({ chain: chainOf(n, sa), event: UNKNOWN })
    } else if (chain.length === 0 && !DOM_SOURCE_METHODS.has(method) && n.arguments[0]) {
      // DOM.input('.x') shorthand
      out.push({ chain: [selectorText(n.arguments[0])], event: KEY_EVENTS.has(method) && keyFiltered(file, n) ? method + ':key' : method })
    }
    return true
  })
  return out
}

// ─── selector matching against a JSX element and its ancestors ──────────────

function lastCompounds(selector) {
  return selector.split(',').map(part => {
    const stripped = part.replace(/\[[^\]]*\]/g, '').replace(/::?[\w-]+(\([^)]*\))?/g, '').trim()
    const pieces = stripped.split(/[\s>+~]+/).filter(Boolean)
    const last = pieces[pieces.length - 1] || ''
    return {
      tag: (/^[a-zA-Z][\w-]*/.exec(last) || [])[0]?.toLowerCase() || null,
      classes: [...last.matchAll(/\.([\w-]+)/g)].map(m => m[1]),
      ids: [...last.matchAll(/#([\w-]+)/g)].map(m => m[1]),
    }
  })
}

const has = (set, name) => set.names.has(name) || set.patterns.some(p => p.re.test(name))

function compoundMatches(c, el) {
  if (c.tag && c.tag !== el.tag) return false
  return c.classes.every(x => has(el.classes, x)) && c.ids.every(x => has(el.ids, x))
}

/** Could a listener on `chain` receive events from `el` (inside `ancestors`)? */
function listens(chain, el, ancestors) {
  if (chain.includes(UNKNOWN)) return true
  // The last selector of the chain decides which element the listener sits on;
  // events from `el` reach it when it is `el` or an ancestor of `el`.
  const sel = chain[chain.length - 1]
  if (!sel.trim()) return true
  const compounds = lastCompounds(sel)
  return [el, ...ancestors].some(x => compounds.some(c => compoundMatches(c, x)))
}

// ─── view: controlled fields in the component's own scope ───────────────────

function elementInfo(file, opening) {
  const classes = { names: new Set(), patterns: [] }
  const ids = { names: new Set(), patterns: [] }
  const anyDyn = (set) => { if (!set.patterns.length) set.patterns.push({ source: '*', re: /^.*$/ }) }
  for (const a of opening.attributes) {
    if (a.type === 'JSXSpreadAttribute') { anyDyn(classes); anyDyn(ids); continue }
    const name = jsxName(a.name)
    const v = unwrap(jsxAttrExpr(a))
    if (name === 'className' || name === 'class') {
      if (!v) continue
      if (v.type === 'ObjectExpression' || v.type === 'ArrayExpression') tokenize([classTokens([v], { fileInfo: file }).join(' ')], classes)
      else tokenize(evalStrings(v, { fileInfo: file }), classes)
    } else if (name === 'id' && v) {
      tokenize(evalStrings(v, { fileInfo: file }), ids)
    }
  }
  return { tag: jsxName(opening.name).toLowerCase(), classes, ids }
}

function attrIsOn(opening, ...names) {
  for (const n of names) {
    const a = jsxAttr(opening, n)
    if (!a) continue
    const v = unwrap(jsxAttrExpr(a))
    if (!v) return true // bare attribute
    if (v.type === 'BooleanLiteral' && v.value === false) continue
    return true // true, or dynamic: assume it may be on
  }
  return false
}

/** The bound value/checked attribute of a controlled field, or null. */
function controlledAttr(opening) {
  const tag = jsxName(opening.name)
  if (!FIELDS.has(tag)) return null
  if (attrIsOn(opening, 'readOnly', 'readonly', 'disabled')) return null
  let kind = null
  if (tag === 'input') {
    const t = jsxAttr(opening, 'type')
    const tv = t ? unwrap(jsxAttrExpr(t)) : null
    const type = t ? stringValue(tv) : 'text'
    if (type == null) return null // dynamic type
    if (NOT_TYPED.has(type.toLowerCase())) return null
    kind = TOGGLES.has(type.toLowerCase()) ? 'toggle' : 'text'
  } else {
    kind = tag === 'select' ? 'toggle' : 'text'
  }
  const attr = jsxAttr(opening, tag === 'input' && kind === 'toggle' ? 'checked' : 'value')
  if (!attr) return null
  const prop = jsxName(attr.name)
  const v = unwrap(jsxAttrExpr(attr))
  // a literal (value="", value={0}, checked, checked={false}) is controlled too (1H-8);
  // null leaves the field alone at runtime, and a select's literal value is left out
  let literal
  if (!v) {
    if (prop !== 'checked') return null
    literal = 'checked' // bare attribute
  } else if (v.type === 'NullLiteral') {
    return null
  } else if (attr.value?.type === 'StringLiteral' || isLiteral(v)) {
    if (tag === 'select') return null
    literal = `${prop}=${v.type === 'StringLiteral' ? JSON.stringify(v.value) : `{${v.value}}`}`
  }
  return { attr, kind, prop, literal }
}

function controlledFields(file, view) {
  const out = []
  const visit = (root, ancestors) => {
    walk(root, (n) => {
      if (n.type !== 'JSXElement') return true
      const opening = n.openingElement
      const name = jsxName(opening.name)
      if (isComponentTag(name) && !TRANSPARENT.has(name)) return false // child scope (incl. Collection)
      if (/^(collection|switchable)$/.test(name)) return false
      let inner = ancestors
      if (!isComponentTag(name)) {
        const info = elementInfo(file, opening)
        const c = controlledAttr(opening)
        if (c) out.push({ ...c, el: info, ancestors, opening })
        inner = [info, ...ancestors]
      }
      for (const a of opening.attributes) visit(a, ancestors)
      for (const ch of n.children) visit(ch, inner)
      return false
    })
  }
  visit(view.body, [])
  return out
}

function describe(f) {
  const cls = [...f.el.classes.names][0]
  const id = [...f.el.ids.names][0]
  return `<${f.el.tag}${id ? ` id="${id}"` : cls ? ` className="${cls}"` : ''}>`
}

function selectorFor(f) {
  const id = [...f.el.ids.names][0]
  if (id) return `#${id}`
  const cls = [...f.el.classes.names][0]
  return cls ? `.${cls}` : f.el.tag
}

export default {
  id: 'controlled-input',
  codes: ['SYG111'],
  description: 'Controlled input (value/checked bound to state) with no input/change listener',
  run(project, report) {
    for (const comp of project.components) {
      if (!comp.view || !isFunction(comp.view)) continue
      let listeners = []
      if (comp.staticProps.intent) {
        // can't see the intent: stay quiet
        if (!comp.intent || !comp.intent.fn) continue
        listeners = intentListeners(comp.intent.file, comp.intent.fn)
      }
      for (const f of controlledFields(comp.file, comp.view)) {
        const relevant = (ev) => ev === UNKNOWN || TEXT_EVENTS.has(ev) || (f.kind === 'toggle' && ev === 'click')
        if (listeners.some(l => relevant(l.event) && listens(l.chain, f.el, f.ancestors))) continue
        const what = describe(f)
        const sel = selectorFor(f)
        if (f.literal) {
          const on = f.kind === 'text' ? `'input' (e.g. DOM.input('${sel}').value())` : `'change' (e.g. DOM.change('${sel}'))`
          report({
            code: 'SYG111',
            component: comp.name,
            file: comp.file,
            node: f.attr,
            message: `${what} has a literal ${f.literal}, and ${comp.name}'s intent has no input/change listener on it. ` +
              `Sygnal controls ${f.prop} even when it is a literal, so every re-render ${f.kind === 'text' ? 'resets the typed text' : 'resets the field'} to it`,
            fix: `drop the ${f.prop} prop to leave the field uncontrolled, or move the ${f.prop} into state and update it on ${on}`,
            data: { element: f.el.tag, prop: f.prop, selector: sel, literal: true },
          })
          continue
        }
        report({
          code: 'SYG111',
          component: comp.name,
          file: comp.file,
          node: f.attr,
          message: `${what} has ${f.prop}={…} bound to state, but ${comp.name}'s intent has no input/change listener on it. ` +
            `Sygnal writes the bound ${f.prop} back on every render, so a re-render while the user ${f.kind === 'text' ? 'types resets the typed text' : 'changes it resets the field'}`,
          fix: f.kind === 'text'
            ? `update the state on 'input' (e.g. DOM.input('${sel}').value()), or make the field uncontrolled: drop the ${f.prop} prop and read the value on blur/submit`
            : `update the state on 'change' (e.g. DOM.change('${sel}')), or make the field uncontrolled: drop the ${f.prop} prop and read it on submit`,
          data: { element: f.el.tag, prop: f.prop, selector: sel },
        })
      }
    }
  },
}
