/**
 * The language server's checking core (PLAN-7 L-1, G-657): what runs in the check worker
 * (worker.js), or in-thread when workers are off. It owns one project per workspace folder
 * (its ParseCache and the last good parse of each file) and is the only code that builds on
 * those caches, one call at a time, so builds never interleave on a cache.
 *
 *   createCore() → {
 *     check({ folder, settings, sources })  → { files: [[absPath, LspDiagnostic[]]], texts, logs,
 *                                              substituted, components, index, ms }
 *     index({ folder, settings, sources })  → { index, substituted, ms }   the model only (no rules)
 *     fixAll({ folder, file, sources })     → { edits: [{ uri, range, newText }], diagnostics }
 *     controls({ folder, file, sources })   → [{ title, uri, range, edits }]
 *     drop({ folder })                      forget a removed folder's caches
 *   }
 *
 * check: the config file is resolved from the folder (resolveOptions, cwd = the folder) under
 * the editor settings (only the defined ones are passed: `null` leaves the file in charge), the
 * files expanded from the resulting `paths`, then built and checked like checkFiles() (the same
 * rules, `ignore`, sort) with the folder's cache and `sources` (the open documents). The config
 * file's own findings (SYG900) are added as check() adds them. A folder whose files define no
 * component gives nothing. Info findings are dropped unless `settings.verbose`.
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
 * `index` (PLAN-7 N-1/N-2): the occurrence index of the build (model/positions.js) for
 * definition / references, without the substituted files' occurrences. `index()` builds it alone
 * (the same files, last good substitution and cache, no rules) for a request on a document
 * changed since the last check (navigation.js).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildProject } from '../model/project.js'
import { selectRules } from '../rules/index.js'
import { runRules, sortDiagnostics } from '../run.js'
import { resolveOptions } from '../config.js'
import { expandInputs, toSourceMap } from '../files.js'
import { createParseCache } from '../cache.js'
import { fixFiles } from '../fix.js'
import { controlFixes } from '../fixControls.js'
import { buildIndex } from '../model/positions.js'
import { toLspDiagnostic, sortBySeverity, rangeOf, fixToLsp, textHash } from './convert.js'

const uriOf = (folder, file) => pathToFileURL(path.resolve(folder, file)).href
const isParseError = (d) => d.code === 'SYG900' && /^could not parse file/.test(d.message)

export function createCore() {
  const projects = new Map() // folder → { cache, lastGood: Map<absPath, cache entry> }

  const projectFor = (folder) => {
    let p = projects.get(folder)
    if (!p) projects.set(folder, p = { cache: createParseCache(), lastGood: new Map() })
    return p
  }

  /** checkFiles() with the project kept: the same build, rules, ignore and order (no rules: the model only). */
  function build(files, opts, sources, cache, rules = true) {
    const project = buildProject(files, { cwd: opts.cwd, sources, cache })
    if (!rules) return { project, diags: [] }
    let diags = runRules(project, selectRules({ strict: opts.strict, a11y: opts.a11y }))
    if (opts.ignore?.length) diags = diags.filter(d => !opts.ignore.includes(d.code))
    return { project, diags: sortDiagnostics(diags) }
  }

  /**
   * The folder's files built with `sources`, a file that doesn't parse now replaced by its last
   * good text (`substituted`); with `rules`, checked. null when the folder has no source files.
   */
  function prepare({ folder, settings = {}, sources }, rules) {
    const p = projectFor(folder)
    const { options, config } = resolveOptions({
      cwd: folder, strict: settings.strict, a11y: settings.a11y, ignore: settings.ignore, paths: settings.paths,
    })
    const srcs = toSourceMap(sources, folder)
    const { files } = expandInputs(options.paths, { cwd: folder, includeTests: options.includeTests, sources: srcs })
    if (!files.length) return null

    let { project, diags } = build(files, options, srcs, p.cache, rules)
    // last good findings: files that don't parse now, but did before
    const broken = new Set(project.parseErrors.map(e => e.file))
    for (const f of project.files.values()) if (f?.ast?.errors?.length) broken.add(f.path)
    const substituted = new Map()
    for (const abs of broken) {
      const good = p.lastGood.get(abs)
      if (!good || good.text === (srcs.get(abs) ?? project.files.get(abs)?.source)) continue
      substituted.set(abs, good.text)
      p.cache.store(abs, good) // put the good parse back: the second build re-parses nothing
    }
    if (substituted.size) {
      const parseErrors = diags.filter(d => isParseError(d) && substituted.has(path.resolve(folder, d.file)))
      ;({ project, diags } = build(files, options, new Map([...srcs, ...substituted]), p.cache, rules))
      diags = sortDiagnostics([...diags, ...parseErrors])
    }
    // remember each file's last text that parsed cleanly
    const lastGood = new Map()
    for (const f of project.files.values()) {
      if (!f || f.ast?.errors?.length) continue
      const entry = p.cache.get(f.path)
      if (entry && !entry.error && entry.text === f.source) lastGood.set(f.path, entry)
    }
    p.lastGood = lastGood
    return { project, diags, options, config, srcs, substituted }
  }

  /** The occurrence index (positions.js) of a build; files checked with their last good text are left out. */
  const indexOf = (project, substituted) => buildIndex(project, { exclude: new Set(substituted.keys()) })

  function check({ folder, settings = {}, sources }) {
    const t0 = performance.now()
    const logs = []
    const prep = prepare({ folder, settings, sources }, true)
    if (!prep) return { files: [], texts: [], logs, substituted: [], components: 0, index: null, ms: performance.now() - t0 }
    const { project, options, config, srcs, substituted } = prep
    let { diags } = prep
    const index = indexOf(project, substituted)

    if (!project.components.length) return { files: [], texts: [], logs, substituted: [...substituted.keys()], components: 0, index, ms: performance.now() - t0 }
    // the config file's findings, as check() adds them (withConfigDiagnostics in index.js)
    const configDiags = config.diagnostics.filter(d => !options.ignore?.includes(d.code))
    if (configDiags.length) diags = sortDiagnostics([...configDiags, ...diags])

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
    return { files: out, texts: [...texts], logs, substituted: [...substituted.keys()], components: project.components.length, index, ms: performance.now() - t0 }
  }

  /** The occurrence index of the folder as `sources` has it, without running the rules (navigation on a changed document). */
  function index({ folder, settings = {}, sources }) {
    const t0 = performance.now()
    const prep = prepare({ folder, settings, sources }, false)
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

  function drop({ folder }) {
    projects.delete(folder)
  }

  return { check, index, fixAll, controls, drop }
}
