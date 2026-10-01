/**
 * SYG506 (C7): a parent reads child PARENT output with the component
 * function, `CHILD.select(TaskCard)`, not its name as a string
 * (`CHILD.select('TaskCard')` breaks under minification).
 *
 * --fix: replaces the string with the identifier when a binding with that
 * name (an import or a local component) is in scope at the call.
 */
import { walk, unwrap, memberName, stringValue } from '../../ast.js'
import { findBinding } from '../../scope.js'
import { sourceAliases, isSourceRef } from '../../model/intent.js'
import { IDENT } from './shared.js'

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
        const resolvable = !!b && ['import', 'function', 'var', 'class'].includes(b.kind)
        report({
          code: 'SYG506',
          component: comp.name,
          file,
          node: arg,
          message: `CHILD.select('${name}') matches the child by its name as a string, which breaks when the code is minified`,
          fix: valid
            ? `pass the component function: \`CHILD.select(${name})\`${resolvable ? '' : ` (import ${name} first)`}`
            : 'pass the child component function to CHILD.select()',
          data: { name },
          edits: resolvable ? [{ file: file.path, start: arg.start, end: arg.end, text: name }] : undefined,
        })
        return true
      })
    }
  },
}
