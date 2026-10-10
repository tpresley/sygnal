/**
 * The language server's checking core (PLAN-7 L-1, G-657): what runs in the check worker
 * (worker.js), or in-thread when workers are off. It owns one project per workspace folder
 * (its ParseCache and the last good parse of each file) and is the only code that builds on
 * those caches, one call at a time, so builds never interleave on a cache.
 *
 *   createCore() → {
 *     check({ folder, settings, sources })  → { files: [[absPath, LspDiagnostic[]]], texts, logs,
 *                                              substituted, components, ms }
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

  /** checkFiles() with the project kept: the same build, rules, ignore and order. */
  function build(files, opts, sources, cache) {
    const project = buildProject(files, { cwd: opts.cwd, sources, cache })
    let diags = runRules(project, selectRules({ strict: opts.strict, a11y: opts.a11y }))
    if (opts.ignore?.length) diags = diags.filter(d => !opts.ignore.includes(d.code))
    return { project, diags: sortDiagnostics(diags) }
  }

  function check({ folder, settings = {}, sources }) {
    const t0 = performance.now()
    const p = projectFor(folder)
    const logs = []
    const { options, config } = resolveOptions({
      cwd: folder, strict: settings.strict, a11y: settings.a11y, ignore: settings.ignore, paths: settings.paths,
    })
    const srcs = toSourceMap(sources, folder)
    const { files } = expandInputs(options.paths, { cwd: folder, includeTests: options.includeTests, sources: srcs })
    if (!files.length) return { files: [], texts: [], logs, substituted: [], components: 0, ms: performance.now() - t0 }

    let { project, diags } = build(files, options, srcs, p.cache)
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
      ;({ project, diags } = build(files, options, new Map([...srcs, ...substituted]), p.cache))
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

    if (!project.components.length) return { files: [], texts: [], logs, substituted: [...substituted.keys()], components: 0, ms: performance.now() - t0 }
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
    return { files: out, texts: [...texts], logs, substituted: [...substituted.keys()], components: project.components.length, ms: performance.now() - t0 }
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

  return { check, fixAll, controls, drop }
}
