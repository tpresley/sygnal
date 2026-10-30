/**
 * SYG427, statically: a component imported from a module that doesn't export it. The import is
 * `undefined` under Vitest (the tests run on), and the browser fails to link the module, so a tag
 * on a branch no test renders, or a `CHILD.select(Child)` that never emits, hides it until then.
 * The dev entry reports `CHILD.select()` of a non-function at run time with the same code.
 *
 * Reported for an imported name used as a component: a JSX tag, the argument of
 * `CHILD.select(...)`, or a Collection / VirtualCollection `of={...}`. Only relative imports of
 * modules sygnal-check can parse. Silent when the module has an `export * from` (its names can't
 * be listed) or is CommonJS (`module.exports`, `exports.x`). The finding is filed under the
 * component that holds the use (the file's name outside one); the fix names the module's other
 * export when it has one (a named import of a default export, or the reverse).
 */
import path from 'node:path'
import { walk, unwrap, memberName, jsxAttr, jsxAttrExpr } from '../ast.js'

/** the names a module exports ('default' included), or null when they can't be listed */
function exportsOf(file) {
  const names = new Set()
  let esm = false
  for (const s of file.ast.program.body) {
    if (s.type === 'ExportDefaultDeclaration') { esm = true; names.add('default') }
    else if (s.type === 'ExportAllDeclaration') {
      esm = true
      if (!s.exported) return null
      names.add(s.exported.name ?? s.exported.value)
    } else if (s.type === 'ExportNamedDeclaration') {
      esm = true
      const d = s.declaration
      if (d?.id?.name) names.add(d.id.name)
      // (a destructuring default's identifiers count too: at worst a missing name goes unreported)
      for (const v of d?.declarations || []) walk(v.id, (n) => { if (n.type === 'Identifier') names.add(n.name); return true })
      for (const sp of s.specifiers || []) names.add(sp.exported.name ?? sp.exported.value)
    }
  }
  if (esm) return names
  // no ESM export at all: CommonJS can't be listed
  let cjs = false
  walk(file.ast.program, (n) => {
    if (n.type === 'MemberExpression') {
      const o = unwrap(n.object)
      if (o.type === 'Identifier' && (o.name === 'exports' || (o.name === 'module' && memberName(n) === 'exports'))) cjs = true
    }
    return !cjs
  })
  return cjs ? null : names
}

/** local name → the import it binds: { source, imported, node } (relative value imports only) */
function relativeImports(file) {
  const out = new Map()
  for (const s of file.ast.program.body) {
    if (s.type !== 'ImportDeclaration' || s.importKind === 'type' || !s.source.value.startsWith('.')) continue
    for (const sp of s.specifiers) {
      if (sp.importKind === 'type') continue
      if (sp.type === 'ImportSpecifier') out.set(sp.local.name, { source: s.source.value, imported: sp.imported.name ?? sp.imported.value, node: sp })
      else if (sp.type === 'ImportDefaultSpecifier') out.set(sp.local.name, { source: s.source.value, imported: 'default', node: sp })
    }
  }
  return out
}

const within = (outer, n) => !!outer && n.start >= outer.start && n.end <= outer.end

/**
 * The name the finding is filed under: the component whose view or statics (intent, ...) hold
 * the use, as every other finding in the file is; else the file's name
 */
function ownerOf(file, node) {
  const comp = (file.components || []).find(c => c.file === file &&
    (within(c.view, node) || Object.values(c.staticProps || {}).some(v => within(v, node))))
  return comp?.name ?? path.basename(file.path)
}

/** what fixes the import: the module may export the component another way */
function fixFor(imp, local, names) {
  const src = imp.source
  if (imp.imported !== 'default' && names.has('default') && !names.has(local)) return `'${src}' exports a default: \`import ${local} from '${src}'\``
  if (imp.imported === 'default' && names.has(local)) return `'${src}' exports it by name: \`import { ${local} } from '${src}'\``
  if (imp.imported === 'default') return `add \`export default\` to the component in '${src}', or import it by name`
  return `export it from '${src}' with \`export function ${imp.imported}\`, or fix the name`
}

const isChildSource = (n) => {
  n = unwrap(n)
  return (n.type === 'Identifier' && n.name === 'CHILD') || (n.type === 'MemberExpression' && memberName(n) === 'CHILD')
}

export default {
  id: 'missing-export',
  codes: ['SYG427'],
  description: 'A component imported from a module that does not export it',
  perFile: true, // run.js createRuleMemo: one file at a time, from the file and its imports
  run(project, report) {
    for (const p of project.scanned) {
      const file = project.files.get(p)
      if (!file?.ast) continue
      const imports = relativeImports(file)
      if (!imports.size) continue
      // the first use of each imported name as a component: how it is used, where
      const used = new Map()
      const use = (id, how) => { if (id?.type === 'Identifier' && imports.has(id.name) && !used.has(id.name)) used.set(id.name, { node: id, how }) }
      walk(file.ast.program, (n) => {
        if (n.type === 'JSXOpeningElement' && n.name.type === 'JSXIdentifier' && /^[A-Z]/.test(n.name.name)) {
          if (imports.has(n.name.name) && !used.has(n.name.name)) used.set(n.name.name, { node: n.name, how: 'tag' })
          const of = jsxAttr(n, 'of')
          if (of) use(unwrap(jsxAttrExpr(of)), 'of')
        } else if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && memberName(n.callee) === 'select' && isChildSource(n.callee.object)) {
          use(unwrap(n.arguments[0]), 'select')
        }
        return true
      })
      for (const [local, { node, how }] of used) {
        const imp = imports.get(local)
        const target = project.loadImport(file, imp.source)
        if (!target?.ast) continue
        const names = exportsOf(target)
        if (!names || names.has(imp.imported)) continue
        const what = imp.imported === 'default' ? 'default export' : `export named '${imp.imported}'`
        const effect = how === 'select' ? `CHILD.select(${local}) never emits` : how === 'of' ? `the Collection renders no items` : `<${local} /> renders nothing`
        report({
          code: 'SYG427',
          component: ownerOf(file, node),
          file,
          node,
          related: [{ node: imp.node, message: `imported here from '${imp.source}'` }],
          message: `${local} is imported from '${imp.source}', which has no ${what}: under Vitest the import is undefined and ${effect}; the browser fails to load the module`,
          fix: fixFor(imp, local, names),
          data: { name: local, imported: imp.imported, source: imp.source, usedAs: how },
        })
      }
    }
  },
}
