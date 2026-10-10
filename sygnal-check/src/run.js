/**
 * Rule runner shared by check() and graph(): runs the rules over a built
 * project, applies `// sygnal-ignore` comments, dedupes, and turns rule
 * crashes / parse errors into SYG900.
 */
import { makeDiagnostic } from './diagnostic.js'
import { loc, endLoc } from './ast.js'

function isSuppressed(file, line, code) {
  for (const l of [line, line - 1]) {
    const s = file.suppressions.get(l)
    if (s === '*' || (s && s.has(code))) return true
  }
  return false
}

/**
 * `report({ related })` → the diagnostic's `related` (PLAN-7 C-2): the other side of a pair or
 * cross-file finding, located like the finding itself. An entry's `file` (a FileInfo) defaults
 * to the finding's; entries without a node or a file are dropped.
 */
function relatedLocations(project, related, file) {
  const out = []
  for (const r of related || []) {
    const f = r?.file || file
    if (!r?.node || !f?.path) continue
    out.push({ file: project.relPath(f.path), ...loc(r.node), ...endLoc(r.node), message: r.message })
  }
  return out.length ? out : undefined
}

/**
 * Run rules over an already-built project.
 */
export function runRules(project, rules) {
  const out = []
  const seen = new Set()
  for (const rule of rules) {
    const report = (r) => {
      let file = r.file
      let node = r.node
      if (!file || !project.scanned.has(file.path)) return
      const { line, column } = loc(node)
      if (isSuppressed(file, line, r.code)) return
      // PLAN-7 C-2: a rule that narrowed its node below the line it used to report on passes
      // the old node as `anchor`, so `// sygnal-ignore` comments written for it still match
      if (r.anchor && isSuppressed(file, loc(r.anchor).line, r.code)) return
      const key = `${r.code}|${file.path}|${line}|${column}|${r.message}`
      if (seen.has(key)) return
      seen.add(key)
      const d = makeDiagnostic(r.code, {
        ...r,
        file: project.relPath(file.path),
        line,
        column,
        ...endLoc(r.endNode || node),
        related: relatedLocations(project, r.related, file),
      })
      // --fix rewrites (strict rules); non-enumerable so JSON output is unchanged
      if (r.edits?.length) Object.defineProperty(d, 'edits', { value: r.edits })
      out.push(d)
    }
    try {
      rule.run(project, report)
    } catch (err) {
      // A crashed rule has no file and no node: no range (no endLine/endColumn), line/column 0.
      // An editor logs it rather than placing it in a document (PLAN-7 C-2, spike 0-S1)
      out.push(makeDiagnostic('SYG900', {
        message: `sygnal-check rule '${rule.id}' threw: ${err?.message}`,
        fix: 'please report this with the file that triggers it',
        file: '',
        line: 0,
        column: 0,
        data: { stack: err?.stack },
      }))
    }
  }
  for (const e of project.parseErrors) {
    out.push(makeDiagnostic('SYG900', {
      message: `could not parse file: ${e.message}`,
      fix: 'fix the syntax error (sygnal-check skipped this file)',
      file: project.relPath(e.file),
      line: e.line,
      column: e.column,
      // the parser's position, one character (exclusive end)
      endLine: e.line,
      endColumn: e.column + 1,
    }))
  }
  return out
}

export function sortDiagnostics(list) {
  return list.sort((a, b) =>
    (a.file || '').localeCompare(b.file || '') || a.line - b.line || a.column - b.column || a.code.localeCompare(b.code))
}

