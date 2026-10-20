/**
 * SYG302 (PLAN-13 X-1, info): `import xs from 'xstream'`. xstream is CommonJS with an
 * `exports.default`; under Node ESM and Vite 8 a default import in a `"type": "module"` package
 * gets the module object, so `xs.create` / `xs.merge` are undefined (a driver fails when it
 * starts). Sygnal re-exports the resolved default: `import { xs } from 'sygnal'`.
 *
 * --fix (only when the default import is the declaration's one specifier): the declaration
 * becomes `import { xs } from 'sygnal'` (`{ xs as name }` for another local name), or, when the
 * file already has `import { … } from 'sygnal'`, goes and `xs` joins that one. Type-only imports
 * are skipped.
 */
/** the edits that replace declaration `s` (the default import `spec`) with sygnal's xs */
function edits(file, s, spec) {
  const body = file.ast.program.body
  const own = body.find(x => x.type === 'ImportDeclaration' && x.source.value === 'sygnal' && x.importKind !== 'type' &&
    x.specifiers.some(sp => sp.type === 'ImportSpecifier'))
  if (!own) return [{ file: file.path, start: s.start, end: s.end, text: `import { ${spec} } from 'sygnal'` }]
  const specs = own.specifiers.filter(sp => sp.type === 'ImportSpecifier')
  const nl = file.source.slice(s.end).match(/^\r?\n/)
  const end = s.end + (nl ? nl[0].length : 0)
  return [
    { file: file.path, start: s.start, end, text: '' },
    { file: file.path, start: specs[specs.length - 1].end, end: specs[specs.length - 1].end, text: `, ${spec}` },
  ]
}

export default {
  id: 'xstream-default-import',
  codes: ['SYG302'],
  description: "Default import from 'xstream'",
  run(project, report) {
    for (const p of project.scanned) {
      const file = project.files.get(p)
      if (!file?.ast) continue
      for (const s of file.ast.program.body) {
        if (s.type !== 'ImportDeclaration' || s.source.value !== 'xstream' || s.importKind === 'type') continue
        const def = s.specifiers.find(sp => sp.type === 'ImportDefaultSpecifier')
        if (!def) continue
        const name = def.local.name
        const spec = name === 'xs' ? 'xs' : `xs as ${name}`
        const text = `import { ${spec} } from 'sygnal'`
        report({
          code: 'SYG302',
          severity: 'info',
          component: 'module',
          file,
          node: s,
          message: `a default import from 'xstream' (${name}) is the module object, not xs, under Node ESM and Vite 8 in a "type": "module" package, so ${name}.create, ${name}.merge and the other factories are undefined there`,
          fix: `${text}: Sygnal re-exports xstream's xs with the CommonJS default resolved`,
          data: { local: name },
          fixes: s.specifiers.length === 1
            ? [{ title: `Use ${text}`, kind: 'quickfix', preferred: true, fixAll: true, edits: edits(file, s, spec) }]
            : undefined,
        })
      }
    }
  },
}
