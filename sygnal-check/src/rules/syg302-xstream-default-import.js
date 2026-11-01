/**
 * SYG302 (PLAN-13 X-1, info): `import xs from 'xstream'`. xstream is CommonJS with an
 * `exports.default`; under Node ESM and Vite 8 a default import in a `"type": "module"` package
 * gets the module object, so `xs.create` / `xs.merge` are undefined (a driver fails when it
 * starts). Sygnal re-exports the resolved default: `import { xs } from 'sygnal'`.
 *
 * The extras (`import dropRepeats from 'xstream/extra/dropRepeats'`) are the same CommonJS shape,
 * so `dropRepeats()` is "not a function" there (Temper feedback, 2026-10). Sygnal exports ESM
 * ports of eight of them (src/extra/xstreamExtras.ts, src/extra/flatten.ts): those get the same fix; another extra is
 * reported without one.
 *
 * --fix (only when the default import is the declaration's one specifier): the declaration
 * becomes `import { xs } from 'sygnal'` (`{ xs as name }` for another local name), or, when the
 * file already has `import { … } from 'sygnal'`, goes and the name joins that one. Type-only
 * imports are skipped.
 */
/** the xstream extras 'sygnal' exports (src/index.ts) */
const SYGNAL_EXTRAS = ['concat', 'debounce', 'throttle', 'delay', 'dropRepeats', 'sampleCombine', 'flattenConcurrently', 'flattenSequentially']
const EXTRA = /^xstream\/extra\/([\w-]+?)(?:\.js)?$/

/** the edits that replace declaration `s` (the default import) with sygnal's `spec` */
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
  description: "Default import from 'xstream' or 'xstream/extra/*'",
  perFile: true, // run.js createRuleMemo: one file at a time, from the file and its imports
  run(project, report) {
    for (const p of project.scanned) {
      const file = project.files.get(p)
      if (!file?.ast) continue
      for (const s of file.ast.program.body) {
        if (s.type !== 'ImportDeclaration' || s.importKind === 'type') continue
        const from = s.source.value
        const extra = typeof from === 'string' ? from.match(EXTRA)?.[1] : undefined
        if (from !== 'xstream' && !extra) continue
        const def = s.specifiers.find(sp => sp.type === 'ImportDefaultSpecifier')
        if (!def) continue
        const name = def.local.name
        const exported = extra ? (SYGNAL_EXTRAS.includes(extra) ? extra : undefined) : 'xs'
        const spec = exported && (name === exported ? exported : `${exported} as ${name}`)
        const text = spec && `import { ${spec} } from 'sygnal'`
        report({
          code: 'SYG302',
          severity: 'info',
          component: 'module',
          file,
          node: s,
          message: extra
            ? `a default import from '${from}' (${name}) is the module object, not the operator, under Node ESM and Vite 8 in a "type": "module" package, so ${name}() is not a function there`
            : `a default import from 'xstream' (${name}) is the module object, not xs, under Node ESM and Vite 8 in a "type": "module" package, so ${name}.create, ${name}.merge and the other factories are undefined there`,
          fix: !text
            ? `'sygnal' doesn't re-export ${extra}: resolve the CommonJS default yourself, \`import ${name}Module from '${from}'\` then \`const ${name} = ${name}Module.default ?? ${name}Module\``
            : extra
              ? `${text}: Sygnal exports an ESM ${exported} that behaves the same`
              : `${text}: Sygnal re-exports xstream's xs with the CommonJS default resolved`,
          data: { local: name, ...(extra ? { extra } : {}) },
          fixes: text && s.specifiers.length === 1
            ? [{ title: `Use ${text}`, kind: 'quickfix', preferred: true, fixAll: true, edits: edits(file, s, spec) }]
            : undefined,
        })
      }
    }
  },
}
