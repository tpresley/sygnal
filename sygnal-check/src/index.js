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
 *     strict?:       also run the strict-mode (canonical form, SYG5xx) rules
 *     a11y?:         'warn' (default) | 'error': the a11y lane's (SYG7xx) severity; it stays
 *                    'warn' under strict (D144)
 *     rules?:        explicit rule list (defaults to the registry)
 *     includeTests?: include *.test.* / *.spec.* files found through directories or globs
 *     ignore?:       codes to drop entirely, e.g. ['SYG105']
 *     sources?:      in-memory file contents, Map<path, text> or { [path]: text } (an editor's
 *                    unsaved buffers; relative paths resolve against cwd). A file is read from
 *                    here before the disk, and import resolution sees these paths, so a new,
 *                    unsaved file resolves. A source-only file is checked when it is named in
 *                    inputs, or lies under a directory input / matches a glob and passes the
 *                    same filters as the walk (PLAN-7 C-1). fixFiles() with sources fixes in memory
 *   }
 *
 * checkFiles(files, options) → Diagnostic[]
 *   the same for an already expanded list of absolute file paths (expandInputs); a
 *   source-only path in the list is checked
 *
 * Diagnostic = the runtime Diagnostic shape (code, severity, component,
 * message, fix, docsUrl, text, data?) + file, line, column, endLine, endColumn,
 * related? and fixes? (PLAN-7 C-2, C-4; see README "JSON output").
 */
import path from 'node:path'
import { expandInputs } from './files.js'
import { buildProject } from './model/project.js'
import { selectRules } from './rules/index.js'
import { SEVERITY_RANK } from './diagnostic.js'
import { runRules, sortDiagnostics } from './run.js'

export { CODES, listCodes, getCodeInfo, docsUrlFor } from './codes.js'
export { coreRules, strictRules, a11yRules } from './rules/index.js'
export { buildProject, Project } from './model/project.js'
export { makeDiagnostic, formatText } from './diagnostic.js'
export { formatDiagnostics } from './format.js'
export { fixFiles } from './fix.js'
export { controlFixes } from './fixControls.js'
export { applyEdits } from './edits.js'
export { runRules, sortDiagnostics }
export { graph, graphFiles, buildGraph } from './graph.js'
export { validate as validateSchema } from './schema.js'
export { EXPLANATIONS } from './explanations.js'
export { getExplanation, listExplanations, formatExplanation } from './explain.js'

export function check(inputs = ['src'], options = {}) {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd()
  const list = Array.isArray(inputs) ? inputs : [inputs]
  const { files } = expandInputs(list, { cwd, includeTests: options.includeTests, sources: options.sources })
  return checkFiles(files, { ...options, cwd })
}

/** check() for an already expanded list of absolute file paths (see expandInputs). */
export function checkFiles(files, options = {}) {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd()
  const project = buildProject(files, { cwd, sources: options.sources })
  const rules = options.rules || selectRules({ strict: options.strict, a11y: options.a11y })
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
