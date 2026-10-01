/**
 * Rule runner shared by check() and graph(): runs the rules over a built
 * project, applies `// sygnal-ignore` comments, dedupes, and turns rule
 * crashes / parse errors into SYG900.
 */
import { makeDiagnostic } from './diagnostic.js'
import { loc } from './ast.js'

function isSuppressed(file, line, code) {
  for (const l of [line, line - 1]) {
    const s = file.suppressions.get(l)
    if (s === '*' || (s && s.has(code))) return true
  }
  return false
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
      const key = `${r.code}|${file.path}|${line}|${column}|${r.message}`
      if (seen.has(key)) return
      seen.add(key)
      const d = makeDiagnostic(r.code, {
        ...r,
        file: project.relPath(file.path),
        line,
        column,
      })
      // --fix rewrites (strict rules); non-enumerable so JSON output is unchanged
      if (r.edits?.length) Object.defineProperty(d, 'edits', { value: r.edits })
      out.push(d)
    }
    try {
      rule.run(project, report)
    } catch (err) {
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
    }))
  }
  return out
}

export function sortDiagnostics(list) {
  return list.sort((a, b) =>
    (a.file || '').localeCompare(b.file || '') || a.line - b.line || a.column - b.column || a.code.localeCompare(b.code))
}

