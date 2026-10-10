/**
 * sygnal-check programmatic API.
 *
 *   import { check } from 'sygnal-check'
 *   const diagnostics = check(['src'], { cwd: process.cwd() })
 *
 * check(inputs, options) → Diagnostic[]
 *   inputs   file paths, directories, or globs (string or string[]); default: the config's
 *            `paths`, else ['src']
 *   options  {
 *     cwd?:          base for relative inputs (default process.cwd()); also where the config
 *                    file is looked for
 *     config?:       false: don't read a config file; a path: read that file; default: find
 *                    sygnal-check.config.json / package.json "sygnal-check" (src/config.js)
 *     defaults?:     fallbacks for strict / a11y / ignore / paths / includeTests below the
 *                    config file (explicit options > config file > defaults > built-in)
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
 *                    same filters as the walk (PLAN-7 C-1). Not for fixFiles() yet: it writes to disk
 *     cache?:        a ParseCache (createParseCache()) kept across checks: a file whose text is
 *                    unchanged isn't parsed again, a cached parse failure reports the same SYG900;
 *                    a check drops the entries the previous check didn't use (PLAN-7 C-3; also for
 *                    buildProject(), graph(), graphFiles())
 *   }
 *
 * checkFiles(files, options) → Diagnostic[]
 *   the same for an already expanded list of absolute file paths (expandInputs); a
 *   source-only path in the list is checked; it reads no config file (resolve one
 *   first with resolveOptions())
 *
 * loadConfig(cwd, { file? }) → { config, file, diagnostics }
 * resolveOptions(options) → { options, config }   (see src/config.js)
 *
 * Diagnostic = the runtime Diagnostic shape (code, severity, component,
 * message, fix, docsUrl, text, data?) + file, line, column.
 */
import path from 'node:path'
import { expandInputs } from './files.js'
import { buildProject } from './model/project.js'
import { selectRules } from './rules/index.js'
import { SEVERITY_RANK } from './diagnostic.js'
import { runRules, sortDiagnostics } from './run.js'
import { resolveOptions } from './config.js'

export { CODES, listCodes, getCodeInfo, docsUrlFor } from './codes.js'
export { coreRules, strictRules, a11yRules } from './rules/index.js'
export { buildProject, Project } from './model/project.js'
export { ParseCache, createParseCache } from './cache.js'
export { makeDiagnostic, formatText } from './diagnostic.js'
export { formatDiagnostics } from './format.js'
export { fixFiles } from './fix.js'
export { runRules, sortDiagnostics }
export { graph, graphFiles, buildGraph } from './graph.js'
export { validate as validateSchema } from './schema.js'
export { EXPLANATIONS } from './explanations.js'
export { getExplanation, listExplanations, formatExplanation } from './explain.js'
export { loadConfig, resolveOptions, CONFIG_FILE, CONFIG_KEYS, DEFAULTS as CONFIG_DEFAULTS } from './config.js'

export function check(inputs, options = {}) {
  const { options: opts, config } = resolveOptions(options)
  const list = inputs == null ? opts.paths : Array.isArray(inputs) ? inputs : [inputs]
  const { files } = expandInputs(list, { cwd: opts.cwd, includeTests: opts.includeTests, sources: opts.sources })
  return withConfigDiagnostics(checkFiles(files, opts), config.diagnostics, opts.ignore)
}

/** The config file's findings (SYG900) added to a run's diagnostics, `ignore` applied. */
export function withConfigDiagnostics(diags, configDiags, ignore) {
  const extra = ignore?.length ? configDiags.filter(d => !ignore.includes(d.code)) : configDiags
  return extra.length ? sortDiagnostics([...extra, ...diags]) : diags
}

/** check() for an already expanded list of absolute file paths (see expandInputs). */
export function checkFiles(files, options = {}) {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd()
  const project = buildProject(files, { cwd, sources: options.sources, cache: options.cache })
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
