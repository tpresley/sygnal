/**
 * sygnal-check programmatic API.
 *
 *   import { check } from 'sygnal-check'
 *   const diagnostics = check(['src'], { cwd: process.cwd() })
 *
 * check(inputs, options) → Diagnostic[]
 *   inputs   file paths, directories, or globs (string or string[])
 *   options  {
 *     cwd?:          base for relative inputs (default process.cwd())
 *     strict?:       also run strict-mode rules (none yet — workstream 2A)
 *     rules?:        explicit rule list (defaults to the registry)
 *     includeTests?: include *.test.* / *.spec.* files found through directories or globs
 *     ignore?:       codes to drop entirely, e.g. ['SYG105']
 *   }
 *
 * checkFiles(files, options) → Diagnostic[]
 *   the same for an already expanded list of absolute file paths (expandInputs)
 *
 * Diagnostic = the runtime Diagnostic shape (code, severity, component,
 * message, fix, docsUrl, text, data?) + file, line, column.
 */
import path from 'node:path'
import { expandInputs } from './files.js'
import { buildProject } from './model/project.js'
import { selectRules } from './rules/index.js'
import { makeDiagnostic, SEVERITY_RANK } from './diagnostic.js'
import { loc } from './ast.js'

export { CODES, listCodes, getCodeInfo, docsUrlFor } from './codes.js'
export { coreRules, strictRules } from './rules/index.js'
export { buildProject, Project } from './model/project.js'
export { makeDiagnostic, formatText } from './diagnostic.js'
export { formatDiagnostics } from './format.js'

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
      out.push(makeDiagnostic(r.code, {
        ...r,
        file: project.relPath(file.path),
        line,
        column,
      }))
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

export function check(inputs = ['src'], options = {}) {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd()
  const list = Array.isArray(inputs) ? inputs : [inputs]
  const { files } = expandInputs(list, { cwd, includeTests: options.includeTests })
  return checkFiles(files, { ...options, cwd })
}

/** check() for an already expanded list of absolute file paths (see expandInputs). */
export function checkFiles(files, options = {}) {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd()
  const project = buildProject(files, { cwd })
  const rules = options.rules || selectRules({ strict: options.strict })
  let diags = runRules(project, rules)
  if (options.ignore?.length) diags = diags.filter(d => !options.ignore.includes(d.code))
  return sortDiagnostics(diags)
}

/** Highest severity present (or null). */
export function maxSeverity(diags) {
  let max = null
  for (const d of diags) if (max == null || SEVERITY_RANK[d.severity] > SEVERITY_RANK[max]) max = d.severity
  return max
}
