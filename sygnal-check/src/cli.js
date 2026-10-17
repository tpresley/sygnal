/**
 * sygnal-check [paths...] [--json] [--strict] [--a11y=warn|error] [--fix] [--controls] [--keep-classes] [--graph[=text|json|html|mermaid]] [--fail-on=warn|error|never] [--verbose] [--config <file> | --no-config]
 *   --graph=html     the app graph as one self-contained page (src/graphView/html.js, PLAN-10 D500, D509):
 *                    <os.tmpdir()>/sygnal-graph-<project>.html, the path on stderr, opened in the default
 *                    browser unless CI is set, stdout is not a TTY or --no-open; --out <file> writes there
 *                    and opens only with --open; --editor sets the page's default editor links
 *   --graph=html --watch  a live page (PLAN-10 W-1, D524): live.js rebuilds on save (watch.js), liveServer.js
 *                    serves it on 127.0.0.1 behind a token; the URL on stdout, opened once (D527 rules)
 *   --graph=mermaid  a Mermaid flowchart on stdout (or --out); --events=false leaves out EVENTS (D504)
 *   --graph[=<format>] --base <ref>  the graph compared with a git ref (PLAN-10 C-3, D505): the base
 *                    graph is built from the commit's files (gitBase.js: git ls-tree / cat-file, no
 *                    checkout; the config file at the ref, tests excluded unless configured; flags
 *                    win as usual), components matched by `key` ('file#name', D521; a renamed file is
 *                    a removal and an addition). Formats (graphView/diff.js):
 *                      json     the diff, not the graph:
 *                               { base: '<ref>', head: 'working tree', commit: '<sha>',
 *                                 added: [key], removed: [key],
 *                                 changed: [{ key, fields: { <field>: { added: [], removed: [] } } }],
 *                                 events: { added: [type], removed: [type] } }
 *                               list fields: actions, sinks ('ACTION:SINK'), stateKeys, calculated,
 *                               stateReads, contextProvides, contextConsumes, eventsEmitted,
 *                               eventsSelected, children, selectors, diagnostics ('CODE message');
 *                               scalar fields kind / entry / route are { base, head }
 *                      text     '+ Name  file', '- Name  file', '~ Name: +action X, -emits Y  file'
 *                      mermaid  the head graph plus the removed components; classes added / removed /
 *                               changed, linkStyle on added / removed edges
 *                      html     the head graph with the diff drawn on it (V-6)
 *                    Exit 2: not in a git repository, an unknown ref, a path outside the repository,
 *                    with --watch. A path missing at the ref is fine (everything in it is added).
 * sygnal-check explain <code> [--json] | explain --all [--json]
 * sygnal-check mcp            (MCP server on stdio; see src/mcp.js and bin/sygnal-check.js)
 * sygnal-check lsp            (language server on stdio; see src/lsp/server.js and bin/sygnal-check.js)
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { checkFiles, maxSeverity, sortDiagnostics } from './index.js'
import { resolveOptions } from './config.js'
import { formatDiagnostics } from './format.js'
import { SEVERITY_RANK } from './diagnostic.js'
import { expandInputs } from './files.js'
import { fixFiles } from './fix.js'
import { graphFiles } from './graph.js'
import { formatGraph } from './graphText.js'
import { graphHtml } from './graphView/html.js'
import { buildModel } from './graphView/model.js'
import { toMermaid } from './graphView/mermaid.js'
import { getExplanation, listExplanations, formatExplanation, suggestCodes } from './explain.js'
import { createLiveProject } from './live.js'
import { createWatcher } from './watch.js'
import { createLiveServer } from './liveServer.js'
import { openRef, baseGraph, inputBase, GitBaseError } from './gitBase.js'
import { graphDiff, formatDiff, diffMermaid } from './graphView/diff.js'

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
  --graph[=<format>]     print the app graph (components, actions, children,
                         selectors, EVENTS, diagnostics) instead of the
                         diagnostics list. Exits 0 unless the files can't be read.
                         Formats: text (the default), json (InspectGraph JSON,
                         schema/inspect.schema.json, the same shape as the runtime
                         inspect(); also --graph --json), html, mermaid
  --graph=html           an interactive page of the graph, one self-contained file
                         (no network): written to the OS temp dir as
                         sygnal-graph-<project>.html, the path printed, and opened
                         in the default browser (not when CI is set or stdout is
                         not a terminal)
  --graph=mermaid        a Mermaid flowchart (flowchart TD) of what renders what,
                         with EVENTS as dotted edges
  --watch                with --graph=html: serve the page on 127.0.0.1 (a random
                         port and a token in the URL, printed and opened once)
                         and update it in place whenever a file is saved;
                         Ctrl-C stops
  --poll[=<ms>]          with --watch: check for changes every <ms> (default 200)
                         instead of file system events (network drives, some
                         container mounts)
  --port <n>             with --watch: listen on this port (default: a free one)
  --out <file>           with --graph: write the output to this file; for html,
                         don't open it unless --open is given
  --open, --no-open      with --graph=html: open the page, or don't
  --editor <name>        with --graph=html: where file links open by default:
                         vscode (default) | cursor | windsurf | idea | none
  --events=false         with --graph=mermaid: leave out the EVENTS edges
  --base <ref>           with --graph: compare the graph with a git ref (a branch,
                         tag or commit; read with git, no checkout): --json prints
                         the diff (added / removed / changed components and EVENTS
                         types), text a summary, mermaid and html the graph with
                         the changes marked. Components are matched by file and
                         name: a renamed file is a removal and an addition
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
  const opts = { paths: [], json: false, strict: undefined, a11y: undefined, fix: false, controls: false, keepClasses: false, graph: false, failOn: 'warn', verbose: false, includeTests: undefined, config: undefined, noConfig: false, help: false, out: undefined, open: undefined, editor: undefined, events: true, watch: false, poll: false, port: undefined, base: undefined }
  let graphFormat = null
  const value = (a, i, name) => {
    if (a.startsWith(name + '=')) {
      const v = a.slice(name.length + 1)
      if (!v) throw new Error(`${name} needs a value`)
      return [v, i]
    }
    if (i + 1 >= argv.length || argv[i + 1].startsWith('-')) throw new Error(`${name} needs a value`)
    return [argv[i + 1], i + 1]
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') opts.json = true
    else if (a === '--strict') opts.strict = true
    else if (a === '--fix') opts.fix = opts.strict = true
    else if (a === '--controls') opts.controls = opts.fix = opts.strict = true
    else if (a === '--keep-classes') opts.keepClasses = opts.controls = opts.fix = opts.strict = true
    else if (a === '--graph') opts.graph = true
    else if (a.startsWith('--graph=')) {
      graphFormat = a.slice('--graph='.length)
      if (!GRAPH_FORMATS.includes(graphFormat)) throw new Error(`--graph must be ${GRAPH_FORMATS.join(', ')} (got '${graphFormat}')`)
      opts.graph = true
    }
    else if (a === '--out' || a.startsWith('--out=')) [opts.out, i] = value(a, i, '--out')
    else if (a === '--open') opts.open = true
    else if (a === '--no-open') opts.open = false
    else if (a === '--editor' || a.startsWith('--editor=')) {
      [opts.editor, i] = value(a, i, '--editor')
      if (!EDITORS.includes(opts.editor)) throw new Error(`--editor must be ${EDITORS.join(', ')} (got '${opts.editor}')`)
    }
    else if (a === '--events=false' || a === '--events=true') opts.events = a === '--events=true'
    else if (a === '--watch') opts.watch = true
    else if (a === '--base' || a.startsWith('--base=')) [opts.base, i] = value(a, i, '--base')
    else if (a === '--poll') opts.poll = true
    else if (a.startsWith('--poll=')) {
      opts.poll = Number(a.slice('--poll='.length))
      if (!Number.isInteger(opts.poll) || opts.poll < 20 || opts.poll > 60000) throw new Error(`--poll must be a number of milliseconds from 20 to 60000 (got '${a.slice('--poll='.length)}')`)
    }
    else if (a === '--port' || a.startsWith('--port=')) {
      let v
      ;[v, i] = value(a, i, '--port')
      opts.port = Number(v)
      if (!/^\d+$/.test(v) || opts.port > 65535) throw new Error(`--port must be a port number from 0 to 65535 (got '${v}')`)
    }
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
  // --graph alone stays text and --graph --json stays JSON; --graph=<format> names one
  if (opts.graph) {
    if (graphFormat && graphFormat !== 'json' && opts.json) throw new Error(`--json cannot be combined with --graph=${graphFormat}`)
    opts.graph = graphFormat ?? (opts.json ? 'json' : 'text')
    opts.json = opts.graph === 'json'
  }
  const graphOnly = (flag, formats, given) => { if (given && !formats.includes(opts.graph)) throw new Error(`${flag} needs ${formats.length > 1 ? '--graph' : '--graph=' + formats[0]}`) }
  graphOnly('--out', GRAPH_FORMATS, opts.out !== undefined)
  graphOnly(opts.open ? '--open' : '--no-open', ['html'], opts.open !== undefined)
  graphOnly('--editor', ['html'], opts.editor !== undefined)
  graphOnly('--events', ['mermaid'], !opts.events)
  // W-1: --watch serves the page; a file:// page can't receive updates, so no --out
  graphOnly('--watch', ['html'], opts.watch)
  graphOnly('--base', GRAPH_FORMATS, opts.base !== undefined)
  if (opts.base !== undefined && opts.watch) throw new Error('--base cannot be combined with --watch')
  if (opts.watch && opts.out !== undefined) throw new Error('--out cannot be combined with --watch (a saved file can\'t be updated: the page is served instead)')
  if (opts.poll !== false && !opts.watch) throw new Error('--poll needs --watch')
  if (opts.port !== undefined && !opts.watch) throw new Error('--port needs --watch')
  if (opts.config !== undefined && opts.noConfig) throw new Error('--config and --no-config cannot be combined')
  return opts
}

const GRAPH_FORMATS = ['text', 'json', 'html', 'mermaid']
const EDITORS = ['vscode', 'cursor', 'windsurf', 'idea', 'none']

/**
 * The project's name for the page title and the temp file (G-802): the nearest package.json at or
 * above the scanned folder (the common directory of `paths`, else cwd), but not above cwd (the
 * project root): its `name`, or its directory's name when it has none. Without one, the scanned
 * folder's name. A scanned folder outside cwd only looks at itself.
 */
export function projectName(cwd, paths = []) {
  const root = path.resolve(cwd)
  const dirOf = (p) => { const abs = path.resolve(root, p); try { return fs.statSync(abs).isDirectory() ? abs : path.dirname(abs) } catch (_) { return abs } }
  let start = root
  if (paths.length) {
    const dirs = paths.map(dirOf)
    start = dirs.reduce((a, b) => { while (a !== path.dirname(a) && !(b === a || b.startsWith(a + path.sep))) a = path.dirname(a); return a })
  }
  const inside = start === root || start.startsWith(root + path.sep)
  for (let dir = start; ; dir = path.dirname(dir)) {
    let pkg = null
    try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) } catch (_) { /* none here */ }
    if (pkg) return typeof pkg.name === 'string' && pkg.name ? pkg.name : path.basename(dir) || 'app'
    if (!inside || dir === root || path.dirname(dir) === dir) break
  }
  return path.basename(start) || 'app'
}

/** `@scope/my app` → `scope-my-app`: safe in a file name on every OS. */
export const fileSafe = (name) => name.replace(/^@/, '').replace(/[^\w.-]+/g, '-').replace(/^[-.]+|-+$/g, '') || 'app'

/** Opens a file in the OS's default app; never throws, never waits. */
export function openInBrowser(file, { platform = process.platform } = {}) {
  const [cmd, args] = platform === 'darwin' ? ['open', [file]] : platform === 'win32' ? ['cmd', ['/c', 'start', '""', file]] : ['xdg-open', [file]]
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true })
    child.on('error', () => { /* no opener: the path is printed */ })
    child.unref()
  } catch (_) { /* the path is printed */ }
}

/** --graph=html: writes the page, prints where, and opens it when that's wanted and possible. */
function writeGraphPage(g, opts, { cwd, stderr, stdout, env, isTTY, openFile, tmpdir, base }) {
  const name = projectName(cwd, opts.paths)
  const html = graphHtml(g, {
    title: name,
    subtitle: `static graph · ${opts.paths.length ? opts.paths.join(' ') : 'configured paths'}${base ? ` · compared with ${base.ref}` : ''} · ${new Date().toLocaleString()}`,
    root: path.resolve(cwd),
    editor: opts.editor,
    ...(base ? { base } : {}),
  })
  const file = opts.out !== undefined ? path.resolve(cwd, opts.out) : path.join(tmpdir, `sygnal-graph-${fileSafe(name)}.html`)
  try {
    fs.writeFileSync(file, html)
  } catch (err) {
    stderr.write(`sygnal-check: can't write ${file}: ${err.message}\n`)
    return 2
  }
  const n = g.components.length
  stderr.write(`sygnal-check: wrote ${file} (${Math.max(1, Math.round(html.length / 1024))} KB, ${n} component${n === 1 ? '' : 's'})\n`)
  // D500: --out doesn't open unless --open; nothing opens under CI or without a terminal
  const wanted = opts.open ?? opts.out === undefined
  const why = env.CI ? 'CI is set' : !(isTTY ?? stdout.isTTY) ? 'stdout is not a terminal' : null
  if (wanted && !why) openFile(file)
  else if (opts.open && why) stderr.write(`sygnal-check: not opening it: ${why}\n`)
  return 0
}

/**
 * --graph=html --watch (PLAN-10 W-1, D524): builds the project (live.js), serves the page and its
 * update stream (liveServer.js) and rebuilds on every save (watch.js); only a changed graph is sent.
 * Prints the URL on stdout and opens it once (the --graph=html rules, D527). Settles with
 * { url, server, watcher, rebuild(), close(), closed: Promise<exit code> }, or { code } when it
 * can't start. SIGINT / SIGTERM (on `signals`) close it.
 */
export async function watchGraph(opts, { cwd, stdout, stderr, env = {}, isTTY, openFile = openInBrowser, signals = process, debounce = 50 }) {
  const live = createLiveProject({ root: cwd })
  // flags > config file > defaults, resolved again on every build (a config file change applies)
  const settings = {
    strict: opts.strict, a11y: opts.a11y, includeTests: opts.includeTests,
    config: opts.noConfig ? false : opts.config, paths: opts.paths.length ? opts.paths : undefined,
  }
  const shown = (p) => path.isAbsolute(p) ? (path.relative(cwd, p) || '.') : p
  const first = live.build({ settings })
  for (const m of first.missing) stderr.write(`sygnal-check: no such file or directory: ${shown(m)}\n`)
  if (!first.graph) {
    stderr.write(`sygnal-check: no source files found in ${first.options.paths.map(shown).join(', ')}\n`)
    return { code: 2 }
  }
  const name = projectName(cwd, opts.paths)
  const subtitle = `live · ${opts.paths.length ? opts.paths.join(' ') : 'configured paths'}`
  let server
  try {
    server = await createLiveServer({
      port: opts.port ?? 0,
      page: (cur) => graphHtml(JSON.parse(cur.json), { title: name, subtitle, root: path.resolve(cwd), editor: opts.editor, live: { events: '/events', version: cur.version } }),
    })
  } catch (err) {
    stderr.write(`sygnal-check: can't listen on 127.0.0.1${opts.port ? ':' + opts.port : ''}: ${err.message}\n`)
    return { code: 2 }
  }
  server.publish(first)
  const count = (g) => { const n = g.components.length; return `${n} component${n === 1 ? '' : 's'}` }
  const lastGood = (r) => r.substituted.length ? ` (${r.substituted.map(shown).join(', ')}: doesn't parse, its last good version is shown)` : ''

  function rebuild(paths = []) {
    let r
    try { r = live.build({ settings }) } catch (err) {
      stderr.write(`sygnal-check: rebuild failed: ${err?.stack || err}\n`)
      return null
    }
    watcher.sync(live.watchSet())
    if (!r.graph) { stderr.write(`sygnal-check: no source files found now; the page keeps the last graph\n`); return r }
    if (r.changed) {
      server.publish(r)
      stderr.write(`sygnal-check: updated (${count(r.graph)}, ${Math.round(r.ms)} ms${paths.length ? ', ' + paths.map(shown).join(' ') : ''})${lastGood(r)}\n`)
    }
    return r
  }
  const watcher = createWatcher({ poll: opts.poll, debounce, onChange: rebuild })
  watcher.sync(live.watchSet())

  stdout.write(server.url + '\n')
  stderr.write(`sygnal-check: serving the live graph of ${count(first.graph)} on 127.0.0.1:${server.port} (${watcher.mode}${watcher.mode === 'poll' ? ` every ${typeof opts.poll === 'number' ? opts.poll : 200} ms` : ''}); Ctrl-C stops${lastGood(first)}\n`)
  // D527: open it once; never under CI or without a terminal
  const why = env.CI ? 'CI is set' : !(isTTY ?? stdout.isTTY) ? 'stdout is not a terminal' : null
  if (opts.open !== false && !why) openFile(server.url)
  else if (opts.open && why) stderr.write(`sygnal-check: not opening it: ${why}\n`)

  let done
  const closed = new Promise((resolve) => { done = resolve })
  let closing = null
  function close() {
    if (closing) return closed
    signals?.off?.('SIGINT', close)
    signals?.off?.('SIGTERM', close)
    watcher.close()
    // the streams end (the page says "disconnected"); a hung socket can't keep the process up
    const hard = setTimeout(() => done(0), 500)
    hard.unref?.()
    closing = server.close().then(() => { clearTimeout(hard); done(0) })
    return closed
  }
  signals?.on?.('SIGINT', close)
  signals?.on?.('SIGTERM', close)
  return { url: server.url, server, watcher, live, rebuild, close, closed }
}

/**
 * --base <ref> (PLAN-10 C-3): the graph of the ref's commit, with the settings the flags and the
 * ref's own config file give (an explicit --config file not in the commit is read from the disk).
 * Throws GitBaseError for the CLI's exit-2 cases.
 */
function buildBase(opts, headPaths, { cwd, stderr, shown }) {
  const tree = openRef(opts.base, { cwd })
  const explicit = typeof opts.config === 'string' ? path.resolve(cwd, opts.config) : null
  const io = explicit && !tree.exists(explicit) ? undefined : { exists: tree.exists, read: tree.readOrThrow }
  const { options: settings, config } = resolveOptions({
    cwd, config: opts.noConfig ? false : opts.config, strict: opts.strict, a11y: opts.a11y, includeTests: opts.includeTests, io,
  })
  const paths = opts.paths.length ? opts.paths : settings.paths
  for (const p of new Set([...headPaths, ...paths])) {
    if (!tree.inside(inputBase(p, cwd))) throw new GitBaseError(`--base: ${shown(p)} is outside the git repository (${tree.top})`)
  }
  const r = baseGraph(tree, paths, {
    cwd, strict: settings.strict, a11y: settings.a11y, ignore: settings.ignore, includeTests: settings.includeTests,
    extraDiagnostics: config.diagnostics,
  })
  for (const m of r.missing) stderr.write(`sygnal-check: ${shown(m)} is not in ${opts.base}: everything there counts as added\n`)
  return { ref: opts.base, commit: tree.commit, graph: r.graph }
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

/**
 * Returns the process exit code (with --watch, a Promise of it, settled when the server stops). For tests, `env` (CI), `isTTY` (else stdout.isTTY), `openFile` (the
 * --graph=html opener) and `tmpdir` stand in for the process's.
 */
export function main(argv, { stdout = process.stdout, stderr = process.stderr, cwd = process.cwd(), env = process.env, isTTY, openFile = openInBrowser, tmpdir = os.tmpdir() } = {}) {
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
  if (opts.watch) return watchGraph(opts, { cwd, stdout, stderr, env, isTTY, openFile }).then(h => h.closed ?? h.code)

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
    let base = null
    if (opts.base !== undefined) {
      try {
        base = buildBase(opts, paths, { cwd, stderr, shown })
      } catch (err) {
        if (!(err instanceof GitBaseError)) throw err
        stderr.write(`sygnal-check: ${err.message}\n`)
        return 2
      }
    }
    if (opts.graph === 'html') return writeGraphPage(g, opts, { cwd, stderr, stdout, env, isTTY, openFile, tmpdir, base })
    const meta = base && { base: base.ref, head: 'working tree', commit: base.commit }
    const text = base
      ? opts.graph === 'json' ? JSON.stringify(graphDiff(base.graph, g, meta), null, 2) + '\n'
        : opts.graph === 'mermaid' ? diffMermaid({ buildModel, toMermaid }, base.graph, g, { ...meta, events: opts.events })
          : formatDiff(graphDiff(base.graph, g, meta)) + '\n'
      : opts.graph === 'json' ? JSON.stringify(g, null, 2) + '\n'
        : opts.graph === 'mermaid' ? toMermaid(buildModel(g), { events: opts.events })
          : formatGraph(g, { verbose: opts.verbose }) + '\n'
    if (opts.out === undefined) { stdout.write(text); return 0 }
    const file = path.resolve(cwd, opts.out)
    try {
      fs.writeFileSync(file, text)
    } catch (err) {
      stderr.write(`sygnal-check: can't write ${file}: ${err.message}\n`)
      return 2
    }
    stderr.write(`sygnal-check: wrote ${file}\n`)
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
