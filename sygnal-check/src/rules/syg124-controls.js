/**
 * Controls (PLAN-4 CT-1; model/controls.js):
 *
 *   SYG124 (error)  a component passed where a control or selector is expected:
 *                   DOM.click(TodoItem), DOM.select(Badge).events('click')
 *   SYG125 (error)  a control given .intent / .model / .initialState
 *                   (Add.intent = …, C.Add.model = …, Object.assign(Add, { … }))
 *   SYG126 (info)   a control the component renders but its intent never listens to
 *                   (nor a behavior it uses, through a control option: PLAN-4 GS-1), and its
 *                   model sends no element command to (ELEMENT: { showModal: Dialog }, GS-2)
 *   SYG128 (error)  a key declared again by a controls() call in the same file
 *
 * SYG110 / SYG104 by identifier (a control listened to but not rendered, or
 * rendered only inside a child) are in syg110-selector-in-view.js.
 */
import { walk, unwrap, memberName, propName } from '../ast.js'
import { controlsOf, resolveControl } from '../model/controls.js'
import { assumedListened } from '../model/behaviors.js'
import { loc } from '../ast.js'

const COMPONENT_STATICS = new Set(['intent', 'model', 'initialState'])

function reportComponentArgs(project, report) {
  for (const comp of project.components) {
    for (const sel of comp.intent?.selectors || []) {
      if (!sel.component) continue
      const name = sel.component.name
      report({
        code: 'SYG124',
        component: comp.name,
        file: comp.intent.file,
        node: sel.node,
        message: `DOM.${sel.method}(${name}) is given the component ${name}; a component is not an event target (DOM.${sel.method}() takes a control or a CSS selector)`,
        fix: `handle the event inside ${name} and send it up with PARENT, then read it here with CHILD.select(${name}); or wrap the child in a control this component owns (const { Item } = controls({ Item: 'div' }), <Item><${name} /></Item>, DOM.${sel.method}(Item))`,
        data: { component: name },
      })
    }
  }
}

function reportStatics(project, report) {
  for (const path of project.scanned) {
    const file = project.files.get(path)
    if (!file) continue
    walk(file.ast.program, (stmt) => {
      if (stmt.type !== 'ExpressionStatement') return true
      const ex = unwrap(stmt.expression)
      for (const e of ex.type === 'SequenceExpression' ? ex.expressions.map(unwrap) : [ex]) {
        if (e.type === 'AssignmentExpression' && e.left.type === 'MemberExpression') {
          const prop = memberName(e.left)
          if (COMPONENT_STATICS.has(prop)) check(file, e.left.object, prop, e.left)
        } else if (e.type === 'CallExpression') {
          const c = unwrap(e.callee)
          const src = unwrap(e.arguments[1])
          if (c.type === 'MemberExpression' && unwrap(c.object).type === 'Identifier' && unwrap(c.object).name === 'Object' &&
              memberName(c) === 'assign' && e.arguments[0] && src?.type === 'ObjectExpression') {
            for (const p of src.properties) {
              const k = p.type === 'ObjectProperty' || p.type === 'ObjectMethod' ? propName(p) : null
              if (COMPONENT_STATICS.has(k)) check(file, e.arguments[0], k, p.key)
            }
          }
        }
      }
      return true
    })
  }

  function check(file, target, prop, at) {
    const control = resolveControl(project, file, target)
    if (!control) return
    report({
      code: 'SYG125',
      file,
      node: at,
      message: `${control.key} is a control, and controls are elements, not components: .${prop} on a control is never used`,
      fix: `put .${prop} on the component that renders <${control.key}> and listen with DOM.<event>(${control.key}) in its intent; for something with its own state and actions, write a component instead`,
      data: { control: control.key, prop },
    })
  }
}

function reportUnlistened(project, report) {
  for (const comp of project.components) {
    if (!comp.viewInfo) continue
    // an intent we can't see into (e.g. built elsewhere) may listen: say nothing
    if (comp.staticProps.intent && !comp.intent?.fn) continue
    const listened = listenedControls(project, comp)
    // PLAN-4 GS-2: a control the model sends element commands to is used (a dialog it opens)
    for (const cmd of comp.commands || []) if (cmd.control) listened.add(cmd.control)
    const sinks = [comp.viewInfo, ...project.injectedInto(comp.view)]
    const done = new Set()
    for (const sink of sinks) {
      for (const [control, nodes] of sink.controls) {
        if (listened.has(control) || done.has(control)) continue
        done.add(control)
        report({
          code: 'SYG126',
          component: comp.name,
          file: nodes[0] && fileOf(project, nodes[0], comp),
          node: nodes[0],
          message: `${comp.name} renders control <${control.key}>, but its intent never listens to it`,
          fix: `listen to it in the intent (e.g. DOM.click(${control.key})), or render a plain ${control.element ? `<${control.element}>` : 'element'} if it needs no events`,
          data: { control: control.key },
        })
      }
    }
  }
}

/**
 * Controls a component listens to: its intent's, its behaviors' (an option bound to a control
 * the behavior's intent listens to, PLAN-4 GS-1), and controls passed to a behavior we can't
 * see into (assumed listened: no false positives).
 */
export function listenedControls(project, comp) {
  return new Set([
    ...[...(comp.intent?.selectors || []), ...(comp.behaviorSelectors || [])].flatMap(s => s.controls || []),
    ...assumedListened(project, comp.uses),
  ])
}

/** The FileInfo a JSX node belongs to (the component's own file, a helper's, or a parent's). */
function fileOf(project, node, comp) {
  if (contains(comp.file, node)) return comp.file
  for (const f of project.files.values()) if (f && contains(f, node)) return f
  return comp.file
}

function contains(file, node) {
  let n = node
  while (n) {
    if (n === file.ast.program) return true
    n = file.parents.get(n)
  }
  return false
}

function reportDuplicates(project, report) {
  for (const path of project.scanned) {
    const file = project.files.get(path)
    if (!file) continue
    for (const { control, first } of controlsOf(project, file).duplicates) {
      const same = first.call === control.call
      report({
        code: 'SYG128',
        file,
        node: control.keyNode,
        message: `control key '${control.key}' is already declared ${same ? 'earlier in this controls() call' : 'by another controls() call in this file'} (line ${loc(first.keyNode).line}); both render data-control="${control.key}", so each one's listeners would match the other's elements`,
        fix: same ? `remove the repeated '${control.key}' key` : `rename one of the keys, or declare both controls in one controls() call`,
        data: { control: control.key, firstLine: loc(first.keyNode).line },
      })
    }
  }
}

export default {
  id: 'controls',
  codes: ['SYG124', 'SYG125', 'SYG126', 'SYG128'],
  description: 'Controls: component used as a control, control given component statics, control never listened to, duplicate control key',
  run(project, report) {
    reportComponentArgs(project, report)
    reportStatics(project, report)
    reportUnlistened(project, report)
    reportDuplicates(project, report)
  },
}
