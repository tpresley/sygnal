/**
 * The language server's checking core (PLAN-7 L-1, G-657): what runs in the check worker
 * (worker.js), or in-thread when workers are off. It owns one project per project root (its
 * ParseCache and the last good parse of each file) and is the only code that builds on those
 * caches, one call at a time, so builds never interleave on a cache. A payload's `folder` is
 * that project root (roots.js, G-666): the workspace folder itself only for its fallback root.
 *
 *   createCore() → {
 *     check({ folder, settings, sources, graph? }, { part?, wanted?, defer? })
 *                                           → { files: [[absPath, LspDiagnostic[]]], texts, logs,
 *                                              substituted, components, index, completion, ms,
 *                                              paths, noFiles, outside, graph? }
 *     index({ folder, settings, sources })  → { index, substituted, ms }   the model only (no rules)
 *     fixAll({ folder, file, sources })     → { edits: [{ uri, range, newText }], diagnostics }
 *     controls({ folder, file, sources })   → [{ title, uri, range, edits }]
 *     rename({ folder, settings, sources, file, line, column, newName? }) → Plan | null
 *                                           (model/rename.js, on the folder as `sources` has it)
 *     drop({ folder })                      forget a removed root's caches
 *   }
 *
 * check: the config file is resolved from the root (resolveOptions, cwd = the root) under the
 * editor settings (only the defined ones are passed: `null` leaves the file in charge), the
 * files expanded from the resulting `paths` (relative to the root), less the files of nested
 * project roots (roots.js ownedBy: each file is checked by its nearest root only), then built and
 * checked like checkFiles() (the same rules, `ignore`, sort) with the root's cache and `sources`
 * (the open documents). The config file's own findings (SYG900) are added as check() adds them.
 * A root whose files define no component gives nothing. Info findings are dropped unless
 * `settings.verbose`.
 *
 * What the server tells the user about (G-665): `paths` (the resolved paths, relative to the
 * root), `noFiles` (they match no source file), `outside` (the open documents that look like
 * Sygnal source but aren't checked: outside `paths`, not a test file left out by `includeTests`,
 * a config file or under an ignored directory).
 *
 * Last good findings (PLAN-7 §6, D307): a file whose text doesn't parse (a parse failure, or
 * Babel's recovered syntax errors) is checked with its last text that parsed, so its findings
 * and every other file's stay what they were; the parse SYG900 for the new text is added. Once
 * it parses again it is checked as it is. `substituted` lists such files: their findings'
 * ranges and fixes refer to the older text. `texts` fingerprints ([[absPath, textHash]]) the text
 * each file with findings (or a fix edit) was checked with, so the main thread can tell whether
 * a fix still applies to the document as it is now.
 *
 * A crashed rule's SYG900 (no file) goes to `logs`, not into a document.
 *
 * `graph` (PLAN-10 E-1): with `payload.graph` the result also has the app graph (InspectGraph,
 * graph.js buildGraph) of the build, with every finding of the check (info included, before the
 * editor's `verbose` filter): the same JSON `sygnal-check --graph --json` and live.js build() give
 * for the root's files; null when the root has no source files. Without it, no graph is built.
 *
 * `index` (PLAN-7 N-1/N-2): the occurrence index of the build (model/positions.js) for
 * definition / references, without the substituted files' occurrences. `index()` builds it alone
 * (the same files, last good substitution and cache, no rules) for a request on a document
 * changed since the last check (navigation.js). The index also carries `flow` (flow.js): each
 * model entry's sinks, EVENTS, next() and reply names and the SYG101/SYG102 verdicts, for code
 * lens (codelens.js).
 *
 * Parts (P4 perf): `check(payload, { part, wanted?, defer? })` hands the index and the completion
 * index over separately from the result (the worker posts each part as a message of the same
 * call; checker.js), so neither waits for the other's work:
 *   - early: `part({ index, substituted, ms })` as soon as the model is built and indexed, before
 *     the rules run, when `wanted()` says a request waits on this check (navigation.js; always
 *     without `defer`). Navigation and code lens answer from it at once.
 *   - late (with `defer`): `defer(fn)` registers work for after the result is sent; it calls
 *     `part({ index?, substituted?, completion })`: the index when it didn't go early, and always
 *     the completion index, so a check's diagnostics are published without waiting for either.
 *     (On an exception: `index: null` if it was still owed, `completion: null`, `error`.)
 *   The result then has no `index`, and with `defer` no `completion` and `late: true`. Without
 *   `part`, both are in the result as before.
 * The flow's SYG101/SYG102 verdicts are the check's own: those two rules run first, per component
 * (flow.js tapVerdicts), then the other rules; the diagnostics are the same as one runRules()
 * over all of them. `index()` runs the two for the flow alone (≈ 0.4 ms on the 20k project).
 * `completion` is the completion index of the checked project (completionIndex.js; null without
 * components): the main thread answers textDocument/completion from it (completion.js, N-2).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { selectRules } from '../rules/index.js'
import { runRules, sortDiagnostics } from '../run.js'
import { toSourceMap, isSourceFile } from '../files.js'
import { ownedBy, inIgnoredDir, looksLikeSygnal } from './roots.js'
import { createLiveProject } from '../live.js'
import { fixFiles } from '../fix.js'
import { controlFixes } from '../fixControls.js'
import { buildIndex } from '../model/positions.js'
import { planRename } from '../model/rename.js'
import { buildGraph } from '../graph.js'
import { completionIndex } from './completionIndex.js'
import { buildFlow, tapVerdicts } from './flow.js'
import { toLspDiagnostic, sortBySeverity, rangeOf, fixToLsp, textHash } from './convert.js'

const uriOf = (folder, file) => pathToFileURL(path.resolve(folder, file)).href

/** Open documents of `root` that look like Sygnal source and aren't among `files` (G-665). */
function outsideOf(root, srcs, files, owned, includeTests) {
  const out = []
  if (!srcs.size) return out
  const set = new Set(files)
  for (const [abs, text] of srcs) {
    if (set.has(abs)) continue
    const rel = path.relative(root, abs)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || inIgnoredDir(path.dirname(rel))) continue
    if (!isSourceFile(abs, { includeTests }) || !owned(abs) || !looksLikeSygnal(text)) continue
    out.push(abs)
  }
  return out
}

export function createCore() {
  const projects = new Map() // folder → its live project (../live.js: the ParseCache and the last good parse of each file)

  const projectFor = (folder) => {
    let p = projects.get(folder)
    if (!p) projects.set(folder, p = createLiveProject({ root: folder }))
    return p
  }

  /**
   * The folder's files built with `sources` (the model: no rules), a file that doesn't parse now
   * replaced by its last good text (`substituted`, with `parseErrors`: the new texts' parse SYG900s,
   * as runRules() makes them, without the ignored codes): live.js prepare(). null when the root has
   * no source files. `info` (an object, optional) gets `paths` (relative to the root), `noFiles` and
   * `outside`.
   */
  function prepare({ folder, settings = {}, sources }, info) {
    // G-666: a nested project root's files are its own, never this root's
    const owned = ownedBy(folder)
    const prep = projectFor(folder).prepare({
      settings: { strict: settings.strict, a11y: settings.a11y, ignore: settings.ignore, paths: settings.paths },
      sources,
      filter: owned,
    })
    const { options, srcs, files } = prep
    if (info) {
      info.paths = options.paths.map(x => path.relative(folder, path.resolve(folder, x)) || '.')
      info.noFiles = !files.length
      info.outside = outsideOf(folder, srcs, files, owned, options.includeTests)
    }
    if (!files.length) return null
    const { project, parseErrors, config, substituted } = prep
    return { project, parseErrors, options, config, srcs, substituted }
  }

  /**
   * The occurrence index (positions.js) of a build; files checked with their last good text are
   * left out. `flow` (flow.js): what each action does and what triggers it, for code lens;
   * `verdicts`: the check's SYG101/SYG102 reports (tapVerdicts), else buildFlow runs those rules.
   */
  const indexOf = (project, substituted, verdicts) => ({ ...buildIndex(project, { exclude: new Set(substituted.keys()) }), flow: buildFlow(project, verdicts) })

  function check({ folder, settings = {}, sources, graph: wantGraph = false }, { part, wanted, defer } = {}) {
    const t0 = performance.now()
    const logs = []
    const info = {}
    const prep = prepare({ folder, settings, sources }, info)
    const seen = { paths: info.paths, noFiles: info.noFiles, outside: info.outside }
    const noGraph = wantGraph ? { graph: null } : {}
    if (!prep) return { files: [], texts: [], logs, substituted: [], components: 0, index: null, completion: null, ms: performance.now() - t0, ...seen, ...noGraph }
    const { project, options, config, srcs, substituted } = prep
    const substitutedList = [...substituted.keys()]
    const hasComponents = project.components.length > 0

    // SYG101 / SYG102 first (their reports are the flow's verdicts), then the other rules
    const selected = selectRules({ strict: options.strict, a11y: options.a11y })
    const { rules, verdicts } = tapVerdicts(selected)
    const first = rules.filter((r, i) => r !== selected[i]) // the tapped two
    let diags = runRules(project, first, { parseErrors: false })
    const indexNow = () => indexOf(project, substituted, verdicts)
    const completionNow = () => hasComponents ? completionIndex(project, { substituted: new Set(substituted.keys()) }) : null
    // where the index and the completion index go (see "Parts" above)
    const early = !!part && (!defer || wanted?.() !== false)
    let index
    if (early) part({ index: indexNow(), substituted: substitutedList, ms: performance.now() - t0 })
    else if (!part) index = indexNow()
    const late = !!(part && defer)
    if (late) {
      defer(() => {
        const out = {}
        try {
          if (!early) Object.assign(out, { index: indexNow(), substituted: substitutedList })
          out.completion = completionNow()
        } catch (err) {
          // never leave a request waiting for this index: an empty one, and the error
          if (!early && out.index === undefined) Object.assign(out, { index: null, substituted: substitutedList })
          out.completion ??= null
          out.error = err?.stack || String(err)
        }
        part(out)
      })
    }
    // the result: with the index unless it went as a part, with the completion index unless late
    const result = (res) => late ? { ...res, ...seen, late: true } : { ...res, ...seen, ...(part ? {} : { index }), completion: completionNow() }

    // every finding: the rules (those after SYG101 / SYG102), the new texts' parse errors, and the
    // config file's findings, as check() adds them (withConfigDiagnostics in index.js)
    const allDiags = () => {
      diags.push(...runRules(project, rules.filter(r => !first.includes(r))))
      if (options.ignore?.length) diags = diags.filter(d => !options.ignore.includes(d.code))
      diags = sortDiagnostics(prep.parseErrors.length ? [...diags, ...prep.parseErrors] : diags)
      const configDiags = config.diagnostics.filter(d => !options.ignore?.includes(d.code))
      if (configDiags.length) diags = sortDiagnostics([...configDiags, ...diags])
    }
    if (!hasComponents) {
      // (the graph of a root without components: the same findings the CLI's graph has)
      if (wantGraph) allDiags()
      return result({ files: [], texts: [], logs, substituted: substitutedList, components: 0, ms: performance.now() - t0, ...(wantGraph ? { graph: buildGraph(project, diags) } : {}) })
    }
    allDiags()
    const graph = wantGraph ? { graph: buildGraph(project, diags) } : {}

    const byFile = new Map()
    const textOf = (abs) => {
      const f = project.files.get(abs)
      if (f) return f.source
      if (srcs.has(abs)) return srcs.get(abs)
      try { return fs.readFileSync(abs, 'utf8') } catch { return '' }
    }
    for (const d of diags) {
      if (!d.file) {
        logs.push({ level: 'error', message: `${d.code} ${d.message}${d.data?.stack ? '\n' + d.data.stack : ''}` })
        continue
      }
      if (d.severity === 'info' && !settings.verbose) continue
      const abs = path.resolve(folder, d.file)
      if (!byFile.has(abs)) byFile.set(abs, [])
      byFile.get(abs).push(toLspDiagnostic(d, { folder, textOf, file: project.files.get(abs) || null }))
    }
    const out = [...byFile].map(([abs, list]) => [abs, sortBySeverity(list)])
    const texts = new Map()
    const note = (abs) => { if (!texts.has(abs)) texts.set(abs, textHash(substituted.get(abs) ?? textOf(abs))) }
    for (const [abs, list] of out) {
      note(abs)
      for (const d of list) for (const f of d.data.fixes || []) for (const e of f.edits) note(fileURLToPath(e.uri))
    }
    return result({ files: out, texts: [...texts], logs, substituted: substitutedList, components: project.components.length, ms: performance.now() - t0, ...graph })
  }

  /** The occurrence index of the folder as `sources` has it, without running the rules (navigation on a changed document). */
  function index({ folder, settings = {}, sources }) {
    const t0 = performance.now()
    const prep = prepare({ folder, settings, sources })
    if (!prep) return { index: null, substituted: [], ms: performance.now() - t0 }
    return { index: indexOf(prep.project, prep.substituted), substituted: [...prep.substituted.keys()], ms: performance.now() - t0 }
  }

  /** source.fixAll.sygnal: what `--fix` does for one file (strict, in memory), as one edit per changed file. */
  function fixAll({ folder, file, sources }) {
    const r = fixFiles([file], { cwd: folder, sources: toSourceMap(sources, folder), write: false })
    return {
      edits: (r.edits || []).map(e => ({ uri: uriOf(folder, e.file), range: rangeOf(e), newText: e.text })),
      diagnostics: r.diagnostics.map(d => d.message),
    }
  }

  /** The --controls conversions in one file, one refactor per class (controlFixes). */
  function controls({ folder, file, sources }) {
    return controlFixes([file], { cwd: folder, sources: toSourceMap(sources, folder) }).map(c => ({
      title: c.title,
      uri: uriOf(folder, c.file),
      range: rangeOf(c),
      edits: fixToLsp(c, folder).edits,
    }))
  }

  /** prepareRename / rename (PLAN-7 P4-5): the plan of model/rename.js, built on `sources` as they are. */
  function rename({ folder, settings = {}, sources, file, line, column, newName = null }) {
    const prep = prepare({ folder, settings, sources })
    return prep ? planRename(prep, { folder, file, line, column, newName }) : null
  }

  function drop({ folder }) {
    projects.delete(folder)
  }

  return { check, index, fixAll, controls, rename, drop }
}
