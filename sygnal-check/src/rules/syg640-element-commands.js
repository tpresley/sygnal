/**
 * Element commands (PLAN-4 GS-2), statically: the literal command objects a model sends on the
 * built-in ELEMENT sink (model/elementCommands.js). The runtime reports both codes too (the dev
 * entry); these catch them before the app runs.
 *
 *   SYG641 (error)  the method (the first key) can't be right:
 *                   - a slip of a documented command or of the control's own spec commands (D102):
 *                     { fokus: Email }, { ShowModal: Dialog }, { opne: DueDate } (did you mean);
 *                   - a method that changes the DOM Sygnal renders: { remove: Row }, { setAttribute: … }
 *                     (unless the control's spec declares a command of that name).
 *                   Any other method is left alone: the core runs any method the element has (D133),
 *                   so `play`, `requestSubmit` or a custom element's own method are fine. A slip is
 *                   only reported for a case slip when the target is a custom element (a tag with '-').
 *   SYG640 (warn)   the target is a control (or a static class/id selector) the sending component's
 *                   view never renders, or renders only inside a child component: a command reaches
 *                   only its sender's own elements, so it would be dropped (the runtime's SYG640
 *                   after about 1 s). Silent for a dynamic target, a document/body selector, a
 *                   class or id a dynamic className / id in the view might produce, and a control
 *                   when the view renders a tag the checker can't resolve (it might be the control).
 */
import { NATIVE_COMMAND_NAMES, DOM_MUTATORS, ELEMENT_METHODS } from '../model/elementCommands.js'
import { selectorRequirements, GLOBAL_SELECTORS } from '../selectors.js'
import { findInChildren } from './syg110-selector-in-view.js'
import { editDistance } from '../names.js'

// the runtime's suggestion rule (src/extra/diagnostics/checks/elementCommands.ts closest()):
// a case-insensitive match, or an edit distance under 3
function closest(name, names, caseOnly) {
  let best = null, d = 3
  for (const n of names) {
    if (n === name) return null
    const x = n.toLowerCase() === name.toLowerCase() ? 0 : caseOnly ? 3 : editDistance(name, n)
    if (x < d) { d = x; best = n }
  }
  return best
}

const show = (cmd) => cmd.file.source.slice(cmd.node.start, cmd.node.end).replace(/\s+/g, ' ')

function checkMethod(cmd, comp, report) {
  const { method, control } = cmd
  if (control?.kind === 'widget' && control.events !== undefined) return   // a defineWidget() spec: SYG142 (rules/syg140-widgets.js)
  const specCommands = control ? control.commands : []   // null: a spec whose commands can't be listed
  if (specCommands?.includes(method) || NATIVE_COMMAND_NAMES.includes(method)) return
  const base = { component: comp.name, file: cmd.file, node: cmd.methodNode }
  const where = control ? { control: control.key } : cmd.selector != null ? { selector: cmd.selector } : {}
  if (DOM_MUTATORS.test(method)) {
    if (specCommands === null) return
    report({
      ...base,
      code: 'SYG641',
      message: `ELEMENT ${show(cmd)} in ${comp.name}'s '${cmd.action}': ${method}() changes the DOM that ${comp.name}'s view renders, so the next render undoes it or fails`,
      fix: 'change the state and render the result instead; element commands are for what a view can\'t express (focus, scrolling, dialogs, popovers, media)',
      data: { method, action: cmd.action, ...where },
    })
    return
  }
  if (ELEMENT_METHODS.has(method) || specCommands === null || cmd.dynamic) return
  const custom = !!control?.element?.includes('-')
  const hint = closest(method, [...specCommands, ...NATIVE_COMMAND_NAMES], custom)
  if (!hint) return
  report({
    ...base,
    code: 'SYG641',
    message: `ELEMENT ${show(cmd)} in ${comp.name}'s '${cmd.action}': '${method}' is not an element command (did you mean '${hint}'?)` +
      (specCommands.length ? `; the control ${control.key}'s spec declares: ${specCommands.join(', ')}` : ''),
    fix: `the first key of a command is the method: { ${hint}: ${cmd.file.source.slice(cmd.targetNode.start, cmd.targetNode.end)} }` +
      ` (the documented commands: ${NATIVE_COMMAND_NAMES.join(', ')}${specCommands.length ? `; ${control.key}'s own: ${specCommands.join(', ')}` : ''})`,
    data: { method, action: cmd.action, suggestion: hint, ...where },
  })
}

const has = (sink, kind, name) => kind === 'control' ? sink.controls.has(name) : (kind === 'class' ? sink.classes : sink.ids).names.has(name)
// a dynamic className / id might produce the class; a tag the checker can't resolve (<C /> with C
// a parameter, a package component) might be the control
const maybe = (sink, kind) => kind === 'control'
  ? sink.children.some(u => u.kind === 'tag' && !u.ref)
  : (kind === 'class' ? sink.classes : sink.ids).patterns.length > 0

function checkTarget(project, cmd, comp, report) {
  const view = comp.viewInfo
  if (!view || cmd.dynamic) return
  const sinks = [view, ...project.injectedInto(comp.view)]
  let needs
  if (cmd.control) needs = [{ kind: 'control', name: cmd.control }]
  else {
    if (GLOBAL_SELECTORS.has(cmd.selector.trim())) return
    needs = selectorRequirements(cmd.selector)
  }
  for (const { kind, name } of needs) {
    if (sinks.some(s => has(s, kind, name) || maybe(s, kind))) continue
    const what = kind === 'control' ? `<${name.key}>` : `${kind === 'class' ? '.' : '#'}${name}`
    const target = kind === 'control' ? `control ${what}` : `'${cmd.selector}' (${what})`
    const inChild = findInChildren(project, view, kind, name)
    const data = { method: cmd.method, action: cmd.action, ...(cmd.control ? { control: cmd.control.key } : { selector: cmd.selector }) }
    if (inChild) {
      const where = inChild.via.length > 1 ? ` (rendered by ${inChild.via.join(' > ')})` : ''
      report({
        code: 'SYG640',
        component: comp.name,
        file: cmd.file,
        node: cmd.targetNode,
        message: `ELEMENT ${show(cmd)} in ${comp.name}'s '${cmd.action}' targets ${target}, which is only rendered inside child component <${inChild.child}>${where}; a command reaches only its sender's own elements, so it is dropped`,
        fix: `send the command from <${inChild.child}> (the component that renders ${what}), or render ${what} in ${comp.name}'s own view`,
        data: { ...data, child: inChild.child, path: inChild.via },
      })
    } else {
      report({
        code: 'SYG640',
        component: comp.name,
        file: cmd.file,
        node: cmd.targetNode,
        message: `ELEMENT ${show(cmd)} in ${comp.name}'s '${cmd.action}' targets ${target}, but ${comp.name}'s view never renders ${what}, so the command is dropped`,
        fix: kind === 'control'
          ? `render ${what}${name.element ? ` (a <${name.element}>)` : ''} in ${comp.name}'s view, or target an element it renders`
          : `render the element in ${comp.name}'s view, or fix the selector (a control is safer: controls({ Row: 'li' }))`,
        data,
      })
    }
    return
  }
}

export default {
  id: 'element-commands',
  codes: ['SYG640', 'SYG641'],
  description: 'Element command: unknown or DOM-mutating method, or a target the view never renders',
  run(project, report) {
    for (const comp of project.components) {
      for (const cmd of comp.commands || []) {
        checkMethod(cmd, comp, report)
        checkTarget(project, cmd, comp, report)
      }
    }
  },
}
