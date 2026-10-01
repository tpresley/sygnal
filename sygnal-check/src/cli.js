/**
 * sygnal-check [paths...] [--json] [--strict] [--fix] [--graph] [--fail-on=warn|error|never] [--verbose]
 */
import { checkFiles, maxSeverity } from './index.js'
import { formatDiagnostics } from './format.js'
import { SEVERITY_RANK } from './diagnostic.js'
import { expandInputs } from './files.js'
import { fixFiles } from './fix.js'
import { graphFiles } from './graph.js'
import { formatGraph } from './graphText.js'

const HELP = `Usage: sygnal-check [paths...] [options]

Statically checks Sygnal components for wiring bugs that fail silently at
runtime (intent selectors missing from the view, intent/model mismatches,
EVENTS without a counterpart, bad Collection 'from' fields).

Paths are files, directories or globs (default: src).

Options:
  --json                 print diagnostics as JSON
  --fail-on=<level>      exit 1 when a diagnostic at this level or above exists:
                         warn (default) | error | never
  --verbose              also print info-level diagnostics in text output
  --include-tests        include *.test.* / *.spec.* files
  --strict               also check canonical forms (SYG501-507, see
                         https://sygnal.js.org/reference/errors#syg501)
  --fix                  apply the mechanical canonical-form rewrites in place
                         (implies --strict): 'A | SINK' keys → object form,
                         emit() → { EVENTS: event() }, CHILD.select('Name') →
                         CHILD.select(Name); then report what is left
  --graph                print the app graph (components, actions, children,
                         selectors, EVENTS, diagnostics) instead of the
                         diagnostics list; with --json, as InspectGraph JSON
                         (schema/inspect.schema.json, the same shape as the
                         runtime inspect()). Exits 0 unless the files can't be read
  -h, --help             show this help

Suppress a finding with a comment on the same line or the line above:
  // sygnal-ignore SYG110
`

export function parseArgs(argv) {
  const opts = { paths: [], json: false, strict: false, fix: false, graph: false, failOn: 'warn', verbose: false, includeTests: false, help: false }
  for (const a of argv) {
    if (a === '--json') opts.json = true
    else if (a === '--strict') opts.strict = true
    else if (a === '--fix') opts.fix = opts.strict = true
    else if (a === '--graph') opts.graph = true
    else if (a === '--verbose' || a === '-v') opts.verbose = true
    else if (a === '--include-tests') opts.includeTests = true
    else if (a === '-h' || a === '--help') opts.help = true
    else if (a.startsWith('--fail-on=')) opts.failOn = a.slice('--fail-on='.length)
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`)
    else opts.paths.push(a)
  }
  if (!['warn', 'error', 'never'].includes(opts.failOn)) throw new Error(`--fail-on must be warn, error or never (got '${opts.failOn}')`)
  if (opts.graph && opts.fix) throw new Error('--graph and --fix cannot be combined')
  if (opts.paths.length === 0) opts.paths = ['src']
  return opts
}

/** Returns the process exit code. */
export function main(argv, { stdout = process.stdout, stderr = process.stderr, cwd = process.cwd() } = {}) {
  let opts
  try {
    opts = parseArgs(argv)
  } catch (err) {
    stderr.write(`sygnal-check: ${err.message}\n\n${HELP}`)
    return 2
  }
  if (opts.help) { stdout.write(HELP); return 0 }

  const { files, missing } = expandInputs(opts.paths, { cwd, includeTests: opts.includeTests })
  for (const m of missing) stderr.write(`sygnal-check: no such file or directory: ${m}\n`)
  if (files.length === 0) {
    stderr.write(`sygnal-check: no source files found in ${opts.paths.join(', ')}\n`)
    return 2
  }

  if (opts.graph) {
    const g = graphFiles(files, { cwd, strict: opts.strict, includeTests: opts.includeTests })
    stdout.write((opts.json ? JSON.stringify(g, null, 2) : formatGraph(g, { verbose: opts.verbose })) + '\n')
    return 0
  }

  if (opts.fix) {
    const r = fixFiles(files, { cwd })
    stderr.write(`sygnal-check: fixed ${r.fixed} issue${r.fixed === 1 ? '' : 's'} in ${r.files.length} file${r.files.length === 1 ? '' : 's'}\n`)
  }
  const diags = checkFiles(files, { cwd, strict: opts.strict })
  if (opts.json) stdout.write(JSON.stringify(diags, null, 2) + '\n')
  else stdout.write(formatDiagnostics(diags, { verbose: opts.verbose }) + '\n')

  if (opts.failOn === 'never') return 0
  const max = maxSeverity(diags)
  return max != null && SEVERITY_RANK[max] >= SEVERITY_RANK[opts.failOn] ? 1 : 0
}
