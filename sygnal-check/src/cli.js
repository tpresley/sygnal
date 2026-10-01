/**
 * sygnal-check [paths...] [--json] [--strict] [--fix] [--graph] [--fail-on=warn|error|never] [--verbose]
 * sygnal-check explain <code> [--json] | explain --all [--json]
 * sygnal-check mcp            (MCP server on stdio; see src/mcp.js and bin/sygnal-check.js)
 */
import { checkFiles, maxSeverity, sortDiagnostics } from './index.js'
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

  let fixDiags = []
  if (opts.fix) {
    const r = fixFiles(files, { cwd })
    stderr.write(`sygnal-check: fixed ${r.fixed} issue${r.fixed === 1 ? '' : 's'} in ${r.files.length} file${r.files.length === 1 ? '' : 's'}\n`)
    fixDiags = r.diagnostics // SYG900 "fix skipped" (a rewrite that would not parse was rolled back)
  }
  const diags = sortDiagnostics([...fixDiags, ...checkFiles(files, { cwd, strict: opts.strict })])
  if (opts.json) stdout.write(JSON.stringify(diags, null, 2) + '\n')
  else stdout.write(formatDiagnostics(diags, { verbose: opts.verbose }) + '\n')

  if (opts.failOn === 'never') return 0
  const max = maxSeverity(diags)
  return max != null && SEVERITY_RANK[max] >= SEVERITY_RANK[opts.failOn] ? 1 : 0
}
