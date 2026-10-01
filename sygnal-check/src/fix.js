/**
 * --fix: apply the mechanical canonical-form rewrites that strict rules
 * attach to their diagnostics (`diagnostic.edits`, non-enumerable):
 *
 *   SYG504  'A | SINK': v               → A: { SINK: v }        (no other 'A' entry)
 *   SYG505  A: emit('T', fn)            → A: { EVENTS: event('T', fn) }
 *           { ...emit('T', fn) }        → { EVENTS: event('T', fn) }
 *           EVENTS: s => ({ type: 'T', data: x }) → EVENTS: event('T', s => x)
 *   SYG506  CHILD.select('Name')        → CHILD.select(Name)     (Name in scope)
 *
 * `event` is added to the existing `import { … } from 'sygnal'` when needed,
 * and an `emit` import left unused by the rewrite is removed. Each
 * diagnostic's edits are applied together or not at all; overlapping edits
 * wait for the next pass (the files are re-checked after every pass, up to
 * MAX_PASSES). Running it again on the result changes nothing.
 */
import fs from 'node:fs'
import path from 'node:path'
import { checkFiles } from './index.js'
import { parseSource, walk } from './ast.js'
import { makeDiagnostic } from './diagnostic.js'

const MAX_PASSES = 5

const overlaps = (a, b) => (a.start < b.end && b.start < a.end) || (a.start === b.start && a.end === b.end && a.start === a.end)
const same = (a, b) => a.file === b.file && a.start === b.start && a.end === b.end && a.text === b.text

function applyEdits(source, edits) {
  let out = source
  for (const e of [...edits].sort((a, b) => b.start - a.start || b.end - a.end)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end)
  }
  return out
}

/** Remove `emit` from `import { … } from 'sygnal'` when nothing else uses it. */
export function removeUnusedEmitImport(source, path) {
  let ast
  try { ast = parseSource(source, path) } catch { return source }
  for (const imp of ast.program.body) {
    if (imp.type !== 'ImportDeclaration' || imp.source.value !== 'sygnal') continue
    const specs = imp.specifiers
    const i = specs.findIndex(s => s.type === 'ImportSpecifier' && (s.imported.name || s.imported.value) === 'emit')
    if (i < 0 || specs.length < 2) continue
    const local = specs[i].local.name
    let uses = 0
    walk(ast.program, (n) => {
      if (n === imp) return false
      if ((n.type === 'Identifier' || n.type === 'JSXIdentifier') && n.name === local) uses++
      return true
    })
    if (uses) continue
    const start = i > 0 ? specs[i - 1].end : specs[i].start
    const end = i > 0 ? specs[i].end : specs[i + 1].start
    return source.slice(0, start) + source.slice(end)
  }
  return source
}

/** Number of syntax errors in `source` (Infinity when the parser gives up). */
function syntaxErrors(source, file) {
  try { return parseSource(source, file).errors?.length || 0 } catch { return Infinity }
}

/**
 * Fix `files` (absolute paths) in place.
 *
 * Backstop: every rewritten file is re-parsed; when the result has syntax
 * errors the original did not have, that file's edits are rolled back, the
 * file is left out of later passes, and a SYG900 "fix skipped" diagnostic is
 * returned in `diagnostics`.
 * @returns {{ fixed: number, files: string[], passes: number, diagnostics: Diagnostic[] }}
 */
export function fixFiles(files, options = {}) {
  let fixed = 0
  const changed = new Set()
  const skipped = new Set()
  const diagnostics = []
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd()
  let passes = 0
  for (; passes < MAX_PASSES; passes++) {
    const diags = checkFiles(files, { ...options, strict: true })
    const accepted = []
    const owners = []
    for (const d of diags) {
      if (!d.edits?.length) continue
      if (d.edits.some(e => skipped.has(e.file))) continue
      const edits = d.edits.filter(e => !accepted.some(a => same(a, e)))
      if (!edits.length) continue // the same rewrite, reported twice (shared model)
      if (edits.some(e => accepted.some(a => a.file === e.file && overlaps(a, e)))) continue
      accepted.push(...edits)
      owners.push(edits)
    }
    if (!owners.length) break
    const byFile = new Map()
    for (const e of accepted) {
      if (!byFile.has(e.file)) byFile.set(e.file, [])
      byFile.get(e.file).push(e)
    }
    for (const [file, edits] of byFile) {
      const before = fs.readFileSync(file, 'utf8')
      let after = applyEdits(before, edits)
      const replacedEmit = edits.some(e => /\bemit\s*\(/.test(before.slice(e.start, e.end)))
      if (replacedEmit) after = removeUnusedEmitImport(after, file)
      if (after === before) continue
      if (syntaxErrors(after, file) > syntaxErrors(before, file)) {
        skipped.add(file)
        diagnostics.push(makeDiagnostic('SYG900', {
          message: 'fix skipped: the --fix rewrite of this file would not parse, so the file was left unchanged',
          fix: 'apply the suggested rewrites by hand (and please report this with the file that triggers it)',
          file: path.relative(cwd, file) || file,
          line: 1,
          column: 1,
        }))
        continue
      }
      fs.writeFileSync(file, after)
      changed.add(file)
    }
    fixed += owners.filter(edits => !edits.some(e => skipped.has(e.file))).length
  }
  return { fixed, files: [...changed], passes, diagnostics }
}
