/**
 * sygnal-check [paths...] [--json] [--strict] [--a11y=warn|error] [--fix] [--controls] [--keep-classes] [--graph] [--fail-on=warn|error|never] [--verbose] [--config <file> | --no-config]
 * sygnal-check explain <code> [--json] | explain --all [--json]
 * sygnal-check mcp            (MCP server on stdio; see src/mcp.js and bin/sygnal-check.js)
 * sygnal-check lsp            (language server on stdio; see src/lsp/server.js and bin/sygnal-check.js)
 */
import fs from 'node:fs'
import path from 'node:path'
import { checkFiles, maxSeverity, sortDiagnostics } from './index.js'
import { resolveOptions } from './config.js'
import { formatDiagnostics } from './format.js'
import { SEVERITY_RANK } from './diagnostic.js'
import { expandInputs } from './files.js'
import { fixFiles } from './fix.js'
import { graphFiles } from './graph.js'
import { formatGraph } from './graphText.js'
import { getExplanation, listExplanations, formatExplanation, suggestCodes } from './explain.js'

const HELP = `Usage: sygnal-check [paths...] [options]
       sygnal-check explain <code> [--json]     explain a diagnostic code (e.g. SYG104)
       sygnal-check explain --all [--json]      the whole error reference
       sygnal-check mcp                         run the MCP server (stdio): check, graph, explain
       sygnal-check lsp                         run the language server (stdio) for editors:
                                                diagnostics, hover, quick fixes

Statically checks Sygnal components for wiring bugs that fail silently at
runtime (intent selectors missing from the view, intent/model mismatches,
EVENTS without a counterpart, bad Collection 'from' fields).

Paths are files, directories or globs (default: the config's paths, else src).

Settings come from the flags, then sygnal-check.config.json (or the
"sygnal-check" key in package.json) in the project root, then the defaults.
The project root is the first directory from here up with either file.

Options:
  --json                 print diagnostics as JSON
  --fail-on=<level>      exit 1 when a diagnostic at this level or above exists:
                         warn (default) | error | never
  --verbose              also print info-level diagnostics in text output
  --include-tests        include *.test.* / *.spec.* files
  --strict               also check canonical forms (SYG501-508, see
                         https://sygnal.js.org/reference/errors#syg501);
                         the a11y lane (SYG701-708) stays at warn
  --a11y=<level>         severity of the a11y lane: warn (default) | error
  --fix                  apply the mechanical canonical-form rewrites in place
                         (implies --strict): 'A | SINK' keys → object form,
                         emit() → { EVENTS: event() }, CHILD.select('Name') →
                         CHILD.select(Name); then report what is left
  --controls             with --fix (implied): also convert single-class intent
                         selectors into controls: DOM.click('.add') on the one
                         <button className="add"> becomes DOM.click(Add) on
                         <Add> from controls({ Add: 'button' }). The class is
                         removed unless CSS (or a string elsewhere) uses it
  --keep-classes         with --controls (implied): keep every converted class
  --graph                print the app graph (components, actions, children,
                         selectors, EVENTS, diagnostics) instead of the
                         diagnostics list; with --json, as InspectGraph JSON
                         (schema/inspect.schema.json, the same shape as the
                         runtime inspect()). Exits 0 unless the files can't be read
  --config <file>        read this JSON config file instead of looking for
                         sygnal-check.config.json / package.json
  --no-config            ignore config files (flags and defaults only)
  -h, --help             show this help

Suppress a finding with a comment on the same line or the line above:
  // sygnal-ignore SYG110
`

/**
 * The flags. strict / a11y / includeTests stay undefined unless given and paths empty, so the
 * config file (or the defaults) decide: see resolveOptions in src/config.js.
 */
export function parseArgs(argv) {
  const opts = { paths: [], json: false, strict: undefined, a11y: undefined, fix: false, controls: false, keepClasses: false, graph: false, failOn: 'warn', verbose: false, includeTests: undefined, config: undefined, noConfig: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') opts.json = true
    else if (a === '--strict') opts.strict = true
    else if (a === '--fix') opts.fix = opts.strict = true
    else if (a === '--controls') opts.controls = opts.fix = opts.strict = true
    else if (a === '--keep-classes') opts.keepClasses = opts.controls = opts.fix = opts.strict = true
    else if (a === '--graph') opts.graph = true
    else if (a === '--verbose' || a === '-v') opts.verbose = true
    else if (a === '--include-tests') opts.includeTests = true
    else if (a === '-h' || a === '--help') opts.help = true
    else if (a.startsWith('--fail-on=')) opts.failOn = a.slice('--fail-on='.length)
    else if (a.startsWith('--a11y=')) opts.a11y = a.slice('--a11y='.length)
    else if (a === '--no-config') opts.noConfig = true
    else if (a === '--config') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('-')) throw new Error('--config needs a file')
      opts.config = argv[++i]
    } else if (a.startsWith('--config=')) {
      opts.config = a.slice('--config='.length)
      if (!opts.config) throw new Error('--config needs a file')
    }
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`)
    else opts.paths.push(a)
  }
  if (!['warn', 'error', 'never'].includes(opts.failOn)) throw new Error(`--fail-on must be warn, error or never (got '${opts.failOn}')`)
  if (opts.a11y !== undefined && !['warn', 'error'].includes(opts.a11y)) throw new Error(`--a11y must be warn or error (got '${opts.a11y}')`)
  if (opts.graph && opts.fix) throw new Error('--graph and --fix cannot be combined')
  if (opts.config !== undefined && opts.noConfig) throw new Error('--config and --no-config cannot be combined')
  return opts
}

const EXPLAIN_HELP = `Usage: sygnal-check explain <code> [--json]
       sygnal-check explain --all [--json]

Prints the code's title, severity, an explanation, the fix and the docs URL.
`

export function explainMain(argv, { stdout, stderr }) {
  const json = argv.includes('--json')
  const all = argv.includes('--all')
  const rest = argv.filter(a => a !== '--json' && a !== '--all')
  if (rest.includes('-h') || rest.includes('--help')) { stdout.write(EXPLAIN_HELP); return 0 }
  const bad = rest.find(a => a.startsWith('-'))
  if (bad) { stderr.write(`sygnal-check explain: unknown option ${bad}\n\n${EXPLAIN_HELP}`); return 2 }
  if (all) {
    const list = listExplanations()
    stdout.write((json ? JSON.stringify(list, null, 2) : list.map(formatExplanation).join('\n\n')) + '\n')
    return 0
  }
  if (rest.length !== 1) { stderr.write(`sygnal-check explain: expected one code\n\n${EXPLAIN_HELP}`); return 2 }
  const e = getExplanation(rest[0])
  if (!e) {
    const near = suggestCodes(rest[0])
    stderr.write(`sygnal-check explain: unknown code '${rest[0]}'` + (near.length ? ` (known codes in that range: ${near.join(', ')}…)` : '') + `. List them all with: sygnal-check explain --all\n`)
    return 2
  }
  stdout.write((json ? JSON.stringify(e, null, 2) : formatExplanation(e)) + '\n')
  return 0
}

/** Returns the process exit code. */
export function main(argv, { stdout = process.stdout, stderr = process.stderr, cwd = process.cwd() } = {}) {
  if (argv[0] === 'explain') return explainMain(argv.slice(1), { stdout, stderr })
  if (argv[0] === 'mcp') { stderr.write('sygnal-check: the MCP server runs from the binary: sygnal-check mcp (see runMcpServer in src/mcp.js)\n'); return 2 }
  let opts
  try {
    opts = parseArgs(argv)
  } catch (err) {
    stderr.write(`sygnal-check: ${err.message}\n\n${HELP}`)
    return 2
  }
  if (opts.help) { stdout.write(HELP); return 0 }
  if (opts.config !== undefined && !fs.existsSync(path.resolve(cwd, opts.config))) {
    stderr.write(`sygnal-check: config file not found: ${opts.config}\n`)
    return 2
  }

  // flags > config file > defaults; the config's findings (SYG900) are reported with the rest
  const { options: settings, config } = resolveOptions({
    cwd,
    config: opts.noConfig ? false : opts.config,
    strict: opts.strict,
    a11y: opts.a11y,
    includeTests: opts.includeTests,
  })
  const ignore = settings.ignore
  const configDiags = ignore.length ? config.diagnostics.filter(d => !ignore.includes(d.code)) : config.diagnostics
  // paths on the command line are relative to the cwd; the config's are already absolute
  const paths = opts.paths.length ? opts.paths : settings.paths
  const shown = (p) => path.isAbsolute(p) ? (path.relative(cwd, p) || '.') : p

  const { files, missing } = expandInputs(paths, { cwd, includeTests: settings.includeTests })
  for (const m of missing) stderr.write(`sygnal-check: no such file or directory: ${shown(m)}\n`)
  if (files.length === 0) {
    for (const d of configDiags) stderr.write(`sygnal-check: ${d.file}:${d.line}:${d.column} ${d.message}\n`)
    stderr.write(`sygnal-check: no source files found in ${paths.map(shown).join(', ')}\n`)
    return 2
  }

  if (opts.graph) {
    const g = graphFiles(files, { cwd, strict: settings.strict, a11y: settings.a11y, ignore, includeTests: settings.includeTests, extraDiagnostics: config.diagnostics })
    stdout.write((opts.json ? JSON.stringify(g, null, 2) : formatGraph(g, { verbose: opts.verbose })) + '\n')
    return 0
  }

  let fixDiags = []
  if (opts.fix) {
    const r = fixFiles(files, { cwd, controls: opts.controls, keepClasses: opts.keepClasses })
    const n = r.files.length
    stderr.write(`sygnal-check: fixed ${r.fixed} issue${r.fixed === 1 ? '' : 's'}${opts.controls ? '' : ` in ${n} file${n === 1 ? '' : 's'}`}\n`)
    if (opts.controls) stderr.write(`sygnal-check: converted ${r.controls} selector${r.controls === 1 ? '' : 's'} to controls in ${r.controlFiles} file${r.controlFiles === 1 ? '' : 's'}\n`)
    fixDiags = r.diagnostics // SYG900 "fix skipped" (a rewrite that would not parse was rolled back)
  }
  const diags = sortDiagnostics([...configDiags, ...fixDiags, ...checkFiles(files, { cwd, strict: settings.strict, a11y: settings.a11y, ignore })])
  if (opts.json) stdout.write(JSON.stringify(diags, null, 2) + '\n')
  else stdout.write(formatDiagnostics(diags, { verbose: opts.verbose }) + '\n')

  if (opts.failOn === 'never') return 0
  const max = maxSeverity(diags)
  return max != null && SEVERITY_RANK[max] >= SEVERITY_RANK[opts.failOn] ? 1 : 0
}
