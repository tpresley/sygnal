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
import { checkFiles } from './index.js'
import { parseSource, walk } from './ast.js'

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

/**
 * Fix `files` (absolute paths) in place.
 * @returns {{ fixed: number, files: string[], passes: number }}
 */
export function fixFiles(files, options = {}) {
  let fixed = 0
  const changed = new Set()
  let passes = 0
  for (; passes < MAX_PASSES; passes++) {
    const diags = checkFiles(files, { ...options, strict: true })
    const accepted = []
    let count = 0
    for (const d of diags) {
      if (!d.edits?.length) continue
      const edits = d.edits.filter(e => !accepted.some(a => same(a, e)))
      if (!edits.length) continue // the same rewrite, reported twice (shared model)
      if (edits.some(e => accepted.some(a => a.file === e.file && overlaps(a, e)))) continue
      accepted.push(...edits)
      count++
    }
    if (!count) break
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
      if (after !== before) { fs.writeFileSync(file, after); changed.add(file) }
    }
    fixed += count
  }
  return { fixed, files: [...changed], passes }
}
