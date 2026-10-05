/**
 * SYG506 (C7; removed in 6.0, D163): a parent reads child PARENT output with the component
 * function, `CHILD.select(TaskCard)`, not its name as a string
 * (`CHILD.select('TaskCard')` breaks under minification).
 *
 * --fix: replaces the string with the identifier when a binding with that
 * name is in scope at the call and is a component: a function or class
 * declaration, a function / arrow / class expression assigned to a const, or
 * an import (assumed to be a component; namespace imports excluded). Other
 * bindings (`const Thing = 'thing'`) and `component(...)` factory results are
 * reported without an auto-fix.
 */
import { walk, unwrap, memberName, stringValue } from '../../ast.js'
import { findBinding } from '../../scope.js'
import { sourceAliases, isSourceRef } from '../../model/intent.js'
import { IDENT } from './shared.js'

/**
 * 'component' when binding `b` can stand in for the string, 'factory' for a
 * `const X = component(...)` result, otherwise null.
 */
function bindingKind(b) {
  if (!b) return null
  if (b.kind === 'function' || b.kind === 'class') return 'component'
  if (b.kind === 'import') return b.imported === '*' ? null : 'component'
  if (b.kind === 'var' && b.declKind === 'const') {
    const init = unwrap(b.init)
    if (!init) return null
    if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression' || init.type === 'ClassExpression') return 'component'
    if (init.type === 'CallExpression') {
      const c = unwrap(init.callee)
      const callee = c?.type === 'Identifier' ? c.name : c?.type === 'MemberExpression' ? memberName(c) : null
      if (callee === 'component') return 'factory'
    }
  }
  return null
}

export default {
  id: 'strict-child-select-string',
  codes: ['SYG506'],
  description: 'CHILD.select() with a string component name',
  strict: true,
  run(project, report) {
    const done = new Set()
    for (const comp of project.components) {
      const intent = comp.intent
      const fn = intent?.fn
      if (!fn || done.has(fn)) continue
      done.add(fn)
      const file = intent.file
      const sa = sourceAliases(fn)
      walk(fn.body, (n) => {
        if (n.type !== 'CallExpression') return true
        const callee = unwrap(n.callee)
        if (callee.type !== 'MemberExpression' || memberName(callee) !== 'select') return true
        if (!isSourceRef(callee.object, 'CHILD', sa)) return true
        const arg = n.arguments[0]
        const name = stringValue(arg)
        if (name == null) return true
        const valid = IDENT.test(name)
        const b = valid ? findBinding(file, name, n) : null
        const kind = bindingKind(b)
        const resolvable = kind === 'component'
        const hint = resolvable ? ''
          : kind === 'factory' ? ` (${name} is created by a component() call, so --fix does not rewrite it; check that the child reports under that function before switching)`
            : b ? ` (the ${name} in scope here is not a component function, so --fix leaves it alone)`
              : ` (import ${name} first)`
        report({
          code: 'SYG506',
          component: comp.name,
          file,
          node: arg,
          message: `CHILD.select('${name}') matches the child by its name as a string, which Sygnal 6.0 removed (children are matched by their component function)`,
          fix: valid
            ? `pass the component function: \`CHILD.select(${name})\`${hint}`
            : 'pass the child component function to CHILD.select()',
          data: { name },
          edits: resolvable ? [{ file: file.path, start: arg.start, end: arg.end, text: name }] : undefined,
        })
        return true
      })
    }
  },
}
