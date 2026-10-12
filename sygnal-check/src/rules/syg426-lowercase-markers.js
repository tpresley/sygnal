/**
 * SYG426, statically (PLAN-9, D471): a lowercase marker tag, deprecated in 6.3.0 and removed in
 * the next major. Always on (not only under --strict). The dev entry reports the same code at run
 * time for <collection> / <switchable>.
 *
 *   <collection …>  <switchable …>        work with no import today (the hosts register on import
 *                                         of 'sygnal')
 *   <clientonly …>                        works with no import (its handler is in the core)
 *   <portal …>  <transition …>  <suspense …>   taken for the marker only when the capitalized
 *                                         component is used somewhere else in the app (G-751)
 *
 * A plain <slot> is an HTML element (G-480: never the <Slot> marker), so it isn't reported.
 *
 * --fix: renames the tag (opening and closing) to the component and makes it available: adds it
 * to the file's `import { … } from 'sygnal'` ('sygnal/vike' for ClientOnly), or adds that import
 * after the file's last import. No fix when the component's name is bound to something else in
 * the file, or the module is only imported as a type / without named specifiers and a new
 * declaration can't be placed.
 */
import { walk } from '../ast.js'
import { findBinding } from '../scope.js'

/** tag → [component, module] */
export const LOWERCASE_MARKERS = {
  collection: ['Collection', 'sygnal'],
  switchable: ['Switchable', 'sygnal'],
  portal: ['Portal', 'sygnal'],
  transition: ['Transition', 'sygnal'],
  suspense: ['Suspense', 'sygnal'],
  clientonly: ['ClientOnly', 'sygnal/vike'],
}

/**
 * The edits that make `name` (exported by `mod`) usable at `at`: [] when it is already imported
 * from there, null when the name is bound to something else.
 */
function ensureImport(file, name, mod, at) {
  const b = findBinding(file, name, at)
  if (b) return b.kind === 'import' && b.source === mod && b.imported === name ? [] : null
  const body = file.ast.program.body
  const imp = body.find(s => s.type === 'ImportDeclaration' && s.source.value === mod && s.importKind !== 'type' &&
    s.specifiers.some(sp => sp.type === 'ImportSpecifier'))
  if (imp) {
    const specs = imp.specifiers.filter(sp => sp.type === 'ImportSpecifier')
    return [{ file: file.path, start: specs[specs.length - 1].end, end: specs[specs.length - 1].end, text: `, ${name}` }]
  }
  const imports = body.filter(s => s.type === 'ImportDeclaration')
  const last = imports[imports.length - 1]
  if (last) return [{ file: file.path, start: last.end, end: last.end, text: `\nimport { ${name} } from '${mod}'` }]
  // no import in the file: before its first statement (after a leading comment)
  const first = body[0]
  const start = first ? first.start : file.source.length
  return [{ file: file.path, start, end: start, text: `import { ${name} } from '${mod}'\n` }]
}

export default {
  id: 'lowercase-markers',
  codes: ['SYG426'],
  description: 'A lowercase marker tag (deprecated in 6.3.0)',
  run(project, report) {
    for (const p of project.scanned) {
      const file = project.files.get(p)
      if (!file?.ast) continue
      walk(file.ast.program, (n) => {
        if (n.type !== 'JSXElement') return true
        const open = n.openingElement
        const tag = open?.name?.type === 'JSXIdentifier' ? open.name.name : null
        if (!tag || !Object.hasOwn(LOWERCASE_MARKERS, tag)) return true
        const [name, mod] = LOWERCASE_MARKERS[tag]
        const imp = ensureImport(file, name, mod, n)
        const edits = imp && [
          { file: file.path, start: open.name.start, end: open.name.end, text: name },
          ...(n.closingElement ? [{ file: file.path, start: n.closingElement.name.start, end: n.closingElement.name.end, text: name }] : []),
          ...imp,
        ]
        const comp = (file.components || []).find(c => c.view && c.file === file && n.start >= c.view.start && n.end <= c.view.end)
        report({
          code: 'SYG426',
          component: comp?.name || 'module',
          file,
          node: open.name,
          message: `the lowercase <${tag}> tag is deprecated since Sygnal 6.3.0 and will be removed in the next major (it will then render an unknown <${tag}> element)`,
          fix: `import { ${name} } from '${mod}' and write <${name} …>`,
          data: { tag, component: name, module: mod },
          fixes: edits && [{ title: `Use <${name}> (imported from '${mod}')`, kind: 'quickfix', preferred: true, fixAll: true, edits }],
        })
        return true
      })
    }
  },
}
