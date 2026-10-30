/**
 * --fix: apply the mechanical rewrites that rules attach to their diagnostics as `fixAll`
 * fixes (PLAN-7 C-4: `diagnostic.fixes`, edits.js; the same edits an editor offers):
 *
 *   SYG504  'A | SINK': v               → A: { SINK: v }        (no other 'A' entry)
 *   SYG505  A: emit('T', fn)            → A: { EVENTS: event('T', fn) }
 *           { ...emit('T', fn) }        → { EVENTS: event('T', fn) }
 *           EVENTS: s => ({ type: 'T', data: x }) → EVENTS: event('T', s => x)
 *   SYG506  CHILD.select('Name')        → CHILD.select(Name)     (Name bound to a component
 *           function/class or import; not component() results)
 *   SYG509  Date.now() / Math.random() / crypto.randomUUID() in a handler → now() / random() / uuid()
 *           from its 4th argument (props), the parameter list completed (model/clockReads.js)
 *   SYG612  X.storeCalculatedInState = …, X.DOMSourceName = 'DOM', … (removed statics) → deleted
 *
 * A fix adds `event` to the existing `import { … } from 'sygnal'` when it needs it, and removes
 * an `emit` import it leaves unused. Each fix's edits are applied together or not at all; a fix
 * whose edits overlap an accepted one (or touch it, for an insertion) waits for the next pass
 * (the files are re-checked after every pass, up to MAX_PASSES). An `emit` import that several
 * fixes leave unused together is removed after the pass. Running it again on the result changes
 * nothing.
 *
 * With `controls: true` (CLI --controls) it then converts single-class intent selectors to
 * controls (fixControls.js; `keepClasses` keeps every class on the element) and returns how many
 * controls it made as `controls`.
 *
 * With `sources` (an editor's buffers, PLAN-7 C-1) the files are read from there and nothing is
 * written (unless `write: true`): the result adds `texts` (absPath → the fixed text, for each
 * changed file) and `edits` (one edit per changed file, against its text before the fix).
 */
import fs from 'node:fs'
import path from 'node:path'
import { checkFiles } from './index.js'
import { parseSource, walk } from './ast.js'
import { makeDiagnostic } from './diagnostic.js'
import { convertControls } from './fixControls.js'
import { toSourceMap } from './files.js'
import { applyEdits, diffEdit, lineStarts, locateEdit } from './edits.js'

const MAX_PASSES = 5

// two edits of different fixes conflict when they overlap, or when one is an insertion at the
// edge of the other's range (an import's `, event` right after a specifier another fix replaces)
const overlaps = (a, b) => (a.start < b.end && b.start < a.end) ||
  (a.start === a.end && (a.start === b.start || a.start === b.end)) ||
  (b.start === b.end && (b.start === a.start || b.start === a.end))
const same = (a, b) => a.file === b.file && a.start === b.start && a.end === b.end && a.text === b.text

/** Remove `emit` from `import { … } from 'sygnal'` when nothing else uses it. */
export function removeUnusedEmitImport(source, path) {
  let ast
  try { ast = parseSource(source, path) } catch { return source }
  for (const imp of ast.program.body) {
    if (imp.type !== 'ImportDeclaration' || imp.source.value !== 'sygnal') continue
    const specs = imp.specifiers
    const i = specs.findIndex(s => s.type === 'ImportSpecifier' && (s.imported.name || s.imported.value) === 'emit')
    if (i < 0) continue
    const local = specs[i].local.name
    let uses = 0
    walk(ast.program, (n) => {
      if (n === imp) return false
      if ((n.type === 'Identifier' || n.type === 'JSXIdentifier') && n.name === local) uses++
      return true
    })
    if (uses) continue
    if (specs.length === 1) {
      // `import { emit } from 'sygnal'` alone: drop the whole declaration (and its line break)
      let end = imp.end
      while (source[end] === ' ' || source[end] === '\t') end++
      if (source[end] === '\r') end++
      if (source[end] === '\n') end++
      return source.slice(0, imp.start) + source.slice(end)
    }
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
 * Fix `files` (absolute paths): in place, or in memory with `sources`.
 *
 * Backstop: every rewritten file is re-parsed; when the result has syntax
 * errors the original did not have, that file's edits are rolled back, the
 * file is left out of later passes, and a SYG900 "fix skipped" diagnostic is
 * returned in `diagnostics`.
 * @returns {{ fixed: number, files: string[], passes: number, diagnostics: Diagnostic[],
 *   controls?: number, controlFiles?: number, texts?: Map<string, string>, edits?: Edit[] }}
 */
export function fixFiles(files, options = {}) {
  let fixed = 0
  const changed = new Set()
  const skipped = new Set()
  const diagnostics = []
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd()
  const base = toSourceMap(options.sources, cwd)
  const write = options.write ?? !base.size
  const texts = new Map() // absPath → the current (fixed) text
  const originals = new Map() // absPath → its text before the first change
  const read = (f) => texts.has(f) ? texts.get(f) : base.has(f) ? base.get(f) : fs.readFileSync(f, 'utf8')
  // what the checks read: the caller's sources plus what was fixed so far (just the disk when
  // writing without sources, as before C-4)
  const overlay = () => (base.size || (!write && texts.size)) ? new Map([...base, ...texts]) : undefined
  const update = (file, before, after) => {
    if (!originals.has(file)) originals.set(file, before)
    texts.set(file, after)
    if (write) fs.writeFileSync(file, after)
    changed.add(file)
  }
  let passes = 0
  for (; passes < MAX_PASSES; passes++) {
    const diags = checkFiles(files, { ...options, strict: true, sources: overlay() })
    const accepted = []
    const owners = []
    for (const d of diags) {
      const fix = d.fixes?.find(f => f.fixAll)
      if (!fix) continue
      const all = fix.edits.map(e => ({ file: path.resolve(cwd, e.file), start: e.start, end: e.end, text: e.text }))
      if (all.some(e => skipped.has(e.file))) continue
      const edits = all.filter(e => !accepted.some(a => same(a, e)))
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
      const before = read(file)
      let after = applyEdits(before, edits)
      // an emit import several fixes together left unused (a fix alone removes it itself)
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
      update(file, before, after)
    }
    fixed += owners.filter(edits => !edits.some(e => skipped.has(e.file))).length
  }
  let result = { fixed, files: [...changed], passes, diagnostics }
  if (options.controls) {
    // --controls (PLAN-4 CT-1): single-class selectors → controls (fixControls.js)
    const c = convertControls(files.filter(f => !skipped.has(f)), { cwd, keepClasses: options.keepClasses, sources: overlay(), write: false })
    for (const [file, after] of c.texts) update(file, read(file), after)
    for (const f of c.skipped) {
      diagnostics.push(makeDiagnostic('SYG900', {
        message: 'controls conversion skipped: the rewrite of this file would not parse, so the file was left unchanged',
        fix: 'convert the selectors by hand (and please report this with the file that triggers it)',
        file: path.relative(cwd, f) || f,
        line: 1,
        column: 1,
      }))
    }
    result = { fixed, files: [...changed], passes, diagnostics, controls: c.controls, controlFiles: c.files.length }
  }
  if (write) return result
  const edits = []
  const out = new Map()
  for (const [file, before] of originals) {
    const after = texts.get(file)
    if (after === before) continue
    out.set(file, after)
    edits.push(locateEdit(lineStarts(before), path.relative(cwd, file) || file, diffEdit(before, after)))
  }
  return { ...result, texts: out, edits }
}
