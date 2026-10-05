/**
 * Widgets (PLAN-5 W-1; model/widgets.js), statically:
 *
 *   SYG140 (warn)   mount() calls its dispatch parameter with a literal name that the definition's
 *                   literal `events` doesn't list: dispatch('chnage', d) with events: ['change']
 *   SYG141 (warn)   the intent listens for an event that the widget it targets doesn't declare,
 *                   that no element fires natively, and that is a near-typo of a declared one:
 *                   DOM.select('.due').events('pikc'), where every element the view renders with
 *                   class `due` is a widget host; or a widget control: DOM.select(Due).events('pikc')
 *   SYG142          an ELEMENT command whose method the targeted widget doesn't declare and its host
 *                   element doesn't have: an error for a near-typo of a declared command
 *                   ({ opne: '.due' }), info otherwise (a library may add the method to the host)
 *   SYG143 (warn)   the widget tag itself used as a selector or command target:
 *                   DOM.select(DatePicker), ELEMENT: { open: DatePicker } (it matches nothing)
 *   SYG144 (info)   a declared event name that elements fire natively (`'change'`): a listener
 *                   gets both the widget's event and the native one bubbling from inside the host
 *
 * 1-R (G-366): a widget whose host is a custom element (a hyphenated tag) is skipped by SYG141
 * and SYG142: the element may fire the event or have the method itself. An undeclared event that
 * isn't a near-typo is not reported (a library such as Choices.js fires its own events on the
 * host). D200: `close` / `togglePopover` are ordinary command names (no longer reserved).
 *
 * The runtime reports SYG140, SYG142, SYG143 and SYG144 too (the dev entry); SYG141 is static
 * only. A selector is resolved to widgets through the static `className` / `class` / `id` of the
 * elements the component's own view renders: when any element with the class or id has a dynamic
 * one, or is not a widget host, or a widget's events aren't a literal list, nothing is reported.
 */
import { walk, unwrap, isFunction, propName, memberName, stringValue, jsxName, jsxAttrExpr } from '../ast.js'
import { widgetsInFile, NATIVE_EVENTS } from '../model/widgets.js'
import { NATIVE_COMMAND_NAMES, DOM_MUTATORS, ELEMENT_METHODS } from '../model/elementCommands.js'
import { selectorRequirements, GLOBAL_SELECTORS } from '../selectors.js'
import { editDistance } from '../names.js'

const nameOf = (w) => w.name ? `widget ${w.name}` : `widget <${w.element || '?'}>`
const quote = (xs) => xs.map(x => `'${x}'`).join(', ')
/** a custom element host (or an unknown one): it may fire any event or have any method itself */
const custom = (w) => !w.element || w.element.includes('-')

function closest(name, names) {
  let best = null, d = 3
  for (const n of names) {
    const x = n.toLowerCase() === name.toLowerCase() ? 0 : editDistance(name, n)
    if (x < d) { d = x; best = n }
  }
  return best
}

/** The definition's property node by key */
const defProp = (w, key) => w.def?.properties.find(p => p.type !== 'SpreadElement' && propName(p) === key) || null

function checkDefinition(w, report) {
  const file = w.file
  if (!w.events) return
  // SYG144: declared names elements fire natively
  const evProp = unwrap(defProp(w, 'events')?.value)
  for (const e of evProp?.elements || []) {
    const name = stringValue(e)
    if (name == null || !NATIVE_EVENTS.has(name)) continue
    report({
      code: 'SYG144',
      severity: 'info',
      file,
      node: e,
      message: `${nameOf(w)} declares '${name}', which elements fire natively: a listener on the host also gets the native '${name}' events (from the host or bubbling from inside it)`,
      fix: `name the widget's event differently (e.g. 'pick' for a date picker's change), or read only what both events carry`,
      data: { event: name },
    })
  }
  // SYG140: dispatch('x') in mount with a literal name not in events
  const mount = defProp(w, 'mount')
  const fn = mount && (mount.type === 'ObjectMethod' ? mount : unwrap(mount.value))
  // (any name: `dispatch` in the docs; `emit` in older code)
  const emitParam = fn && (isFunction(fn) || fn.type === 'ObjectMethod') ? fn.params[2] : null
  if (emitParam?.type !== 'Identifier') return
  walk(fn.body, (n) => {
    if (n.type !== 'CallExpression') return true
    const c = unwrap(n.callee)
    if (c?.type !== 'Identifier' || c.name !== emitParam.name) return true
    const name = n.arguments.length ? stringValue(n.arguments[0]) : null
    if (name == null || w.events.includes(name)) return true
    const hint = closest(name, w.events)
    report({
      code: 'SYG140',
      file,
      node: n.arguments[0],
      message: `${nameOf(w)}'s mount() dispatches '${name}', which is not one of its declared events (${w.events.length ? quote(w.events) : 'it declares none'})` + (hint ? ` (did you mean '${hint}'?)` : ''),
      fix: hint ? `${emitParam.name}('${hint}', …)` : `add '${name}' to the widget's events: events: [${quote([...w.events, name])}]`,
      data: { event: name, events: w.events },
    })
    return true
  })
}

/** The static class tokens and id of a JSX element; dynamic: a class or id the checker can't read */
function staticNames(opening) {
  const out = { classes: [], id: null, dynamic: false }
  for (const a of opening.attributes) {
    if (a.type !== 'JSXAttribute') { out.dynamic = true; continue }
    const k = a.name.type === 'JSXIdentifier' ? a.name.name : null
    if (k !== 'className' && k !== 'class' && k !== 'id') continue
    const v = a.value?.type === 'StringLiteral' ? a.value.value : stringValue(jsxAttrExpr(a))
    if (v == null) { out.dynamic = true; continue }
    if (k === 'id') out.id = v
    else out.classes.push(...v.split(/\s+/).filter(Boolean))
  }
  return out
}

/**
 * The widgets a selector targets in a view sink: every element with the selector's last class or
 * id must be a widget host whose names are all static; null when unknown or not only widgets.
 */
function widgetsFor(sink, selector) {
  if (selector == null || GLOBAL_SELECTORS.has(selector.trim())) return null
  const reqs = selectorRequirements(selector)
  if (!reqs.length) return null
  const { kind, name } = reqs[reqs.length - 1]
  const hit = []
  for (const el of sink.elements) {
    const opening = el.node?.openingElement
    if (!opening) continue
    const n = staticNames(opening)
    const has = kind === 'class' ? n.classes.includes(name) : n.id === name
    // a dynamic className / id on a plain element might be the target too
    if (n.dynamic && !el.widget) return null
    if (!has) continue
    if (!el.widget) return null
    hit.push(el.widget)
  }
  return hit.length ? hit : null
}

/** The event each intent selector listens for: `DOM.select(x).events('e')`, or `DOM.e(x)` */
function selectorEvents(intent) {
  const byNode = new Map()
  walk(intent.fn.body, (n) => {
    if (n.type !== 'CallExpression') return true
    const c = unwrap(n.callee)
    if (c?.type !== 'MemberExpression' || memberName(c) !== 'events') return true
    const inner = unwrap(c.object)
    if (inner?.type !== 'CallExpression') return true
    const ic = unwrap(inner.callee)
    if (ic?.type !== 'MemberExpression' || memberName(ic) !== 'select' || !inner.arguments[0]) return true
    const name = n.arguments.length ? stringValue(n.arguments[0]) : null
    if (name != null) byNode.set(inner.arguments[0], name)
    return true
  })
  return byNode
}

function checkListeners(project, comp, report) {
  const intent = comp.intent, view = comp.viewInfo
  if (!intent?.fn || !intent.selectors.length) return
  const events = selectorEvents(intent)
  for (const sel of intent.selectors) {
    if (sel.widgetTag) {
      report({
        code: 'SYG143',
        component: comp.name,
        file: sel.file || intent.file,
        node: sel.node,
        message: `DOM.${sel.method}(${sel.widgetTag.name || 'Widget'}) is given the ${nameOf(sel.widgetTag)} tag itself, which is not a selector: it matches nothing`,
        fix: `give the widget a className and select that (<${sel.widgetTag.name || 'Widget'} className="due" />, DOM.select('.due')), or make it a control: controls({ Due: ${sel.widgetTag.name || 'Widget'} })`,
        data: { widget: sel.widgetTag.name },
      })
      continue
    }
    if (sel.global || sel.dynamic || sel.behavior) continue
    const event = sel.method === 'select' ? events.get(sel.node) : sel.method
    if (event == null || NATIVE_EVENTS.has(event)) continue
    let widgets
    if (sel.control) widgets = sel.control.kind === 'widget' && sel.controls.length === 1 ? [sel.control] : null
    else widgets = view ? widgetsFor(view, sel.selector) : null
    if (!widgets || widgets.some(w => !w.events || custom(w)) || widgets.some(w => w.events.includes(event))) continue
    const declared = [...new Set(widgets.flatMap(w => w.events))]
    const hint = closest(event, declared)
    if (!hint) continue
    const what = sel.control ? `the widget control ${sel.control.key}` : `'${sel.selector}' (${widgets.map(nameOf).join(', ')})`
    report({
      code: 'SYG141',
      component: comp.name,
      file: sel.file || intent.file,
      node: sel.node,
      message: `${comp.name}'s intent listens for '${event}' on ${what}, which doesn't declare that event (it declares ${quote(declared)}): did you mean '${hint}'?`,
      fix: `listen for '${hint}'`,
      data: { event, events: declared, ...(sel.control ? { control: sel.control.key } : { selector: sel.selector }) },
    })
  }
}

const isMethodOf = (tag, method) => NATIVE_COMMAND_NAMES.includes(method) || ELEMENT_METHODS.has(method) || DOM_MUTATORS.test(method) ||
  (tag === 'dialog' && /^(show|showModal|close|requestClose)$/.test(method))

function checkCommands(comp, report) {
  for (const cmd of comp.commands || []) {
    if (cmd.widgetTag) {
      report({
        code: 'SYG143',
        component: comp.name,
        file: cmd.file,
        node: cmd.targetNode,
        message: `ELEMENT { ${cmd.method}: ${cmd.widgetTag.name || 'Widget'} } in ${comp.name}'s '${cmd.action}' targets the ${nameOf(cmd.widgetTag)} tag itself, which is not a selector: the command is dropped`,
        fix: `target the widget's className ({ ${cmd.method}: '.due' }) or a control made from it`,
        data: { widget: cmd.widgetTag.name, method: cmd.method },
      })
      continue
    }
    if (cmd.dynamic) continue
    let widgets
    if (cmd.control) widgets = cmd.control.kind === 'widget' ? [cmd.control] : null
    else widgets = comp.viewInfo ? widgetsFor(comp.viewInfo, cmd.selector) : null
    if (!widgets || widgets.some(w => !w.commands || custom(w))) continue
    const missing = widgets.filter(w => !w.commands.includes(cmd.method) && !isMethodOf(w.element, cmd.method))
    if (!missing.length) continue
    const declared = [...new Set(missing.flatMap(w => w.commands))]
    const hint = closest(cmd.method, declared)
    const what = cmd.control ? `the widget control ${cmd.control.key}` : `'${cmd.selector}' (${missing.map(nameOf).join(', ')})`
    report({
      code: 'SYG142',
      ...(hint ? {} : { severity: 'info' }),
      component: comp.name,
      file: cmd.file,
      node: cmd.methodNode,
      message: `ELEMENT command '${cmd.method}' in ${comp.name}'s '${cmd.action}' targets ${what}, which declares no '${cmd.method}' command` +
        (hint ? ` (did you mean '${hint}'?)` : '') + (declared.length ? `; it declares: ${declared.join(', ')}` : '; it declares none') +
        (hint ? '' : ` (fine if the library adds ${cmd.method}() to the host element)`),
      fix: hint ? `send { ${hint}: … }` : `add '${cmd.method}' to the widget's commands, or send one it declares`,
      data: { method: cmd.method, action: cmd.action, commands: declared },
    })
  }
}

export default {
  id: 'widgets',
  codes: ['SYG140', 'SYG141', 'SYG142', 'SYG143', 'SYG144'],
  description: 'Widgets: undeclared dispatch / listener / command, the tag as a selector, native event names',
  run(project, report) {
    for (const path of project.scanned) {
      const file = project.files.get(path)
      if (file) for (const w of widgetsInFile(file)) checkDefinition(w, report)
    }
    for (const comp of project.components) {
      checkListeners(project, comp, report)
      checkCommands(comp, report)
    }
  },
}
