/**
 * Rule runner shared by check() and graph(): runs the rules over a built
 * project, applies `// sygnal-ignore` comments, dedupes, and turns rule
 * crashes / parse errors into SYG900.
 */
import { makeDiagnostic } from './diagnostic.js'
import { loc, endLoc } from './ast.js'
import { lineStarts, locateEdit } from './edits.js'

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
 * `report({ fixes })` → the diagnostic's `fixes` (PLAN-7 C-4, edits.js): each edit gets its
 * line/column range and a path relative to cwd. A fix with an edit in a file the project
 * didn't load is dropped. A rule's legacy `edits` (strict --fix rewrites) become one
 * `fixAll` fix.
 */
function locatedFixes(project, r, starts) {
  const list = [...(r.fixes || [])]
  if (r.edits?.length && !list.some(f => f.fixAll)) list.push({ title: `Apply the ${r.code} rewrite`, kind: 'quickfix', preferred: true, fixAll: true, edits: r.edits })
  const out = []
  for (const f of list) {
    if (!f?.edits?.length) continue
    const edits = []
    for (const e of f.edits) {
      const abs = typeof e.file === 'string' ? e.file : e.file?.path
      const source = abs && project.files.get(abs)?.source
      if (source == null) { edits.length = 0; break }
      if (!starts.has(abs)) starts.set(abs, lineStarts(source))
      edits.push(locateEdit(starts.get(abs), project.relPath(abs), e))
    }
    if (!edits.length) continue
    out.push({ title: f.title, kind: f.kind || 'quickfix', ...(f.preferred ? { preferred: true } : {}), ...(f.fixAll ? { fixAll: true } : {}), edits })
  }
  return out.length ? out : undefined
}

/** The raw edits (absolute paths, offsets) of a report's `fixAll` fix: `diagnostic.edits`, kept for --fix's old API. */
function rawFixAllEdits(r) {
  const f = (r.fixes || []).find(x => x?.fixAll)
  const edits = f ? f.edits : r.edits
  return edits?.length ? edits.map(e => ({ file: typeof e.file === 'string' ? e.file : e.file.path, start: e.start, end: e.end, text: e.text })) : null
}

/**
 * Run rules over an already-built project. `parseErrors: false` leaves out the parse errors'
 * SYG900 (the language server runs the rules in two calls and adds them once).
 */
export function runRules(project, rules, { parseErrors = true } = {}) {
  const out = []
  const seen = new Set()
  const starts = new Map() // absPath → line starts, for the fixes' positions
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
        fixes: locatedFixes(project, r, starts),
      })
      // the --fix rewrite's raw edits (absolute paths), as before C-4; non-enumerable so JSON output is unchanged
      const raw = rawFixAllEdits(r)
      if (raw) Object.defineProperty(d, 'edits', { value: raw })
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
  for (const e of parseErrors ? project.parseErrors : []) {
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

