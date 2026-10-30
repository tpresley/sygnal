/**
 * The live project (PLAN-10 W-1, D524): one project root built again and again, cheaply, for the
 * hosts that follow a project as it changes: `sygnal-check --graph=html --watch` (cli.js, watch.js,
 * liveServer.js), the language server (lsp/core.js) and, later, the LSP graph request (E-1) and the
 * sygnal/vite route (W-2). They share it so they agree on what "the project now" is.
 *
 *   createLiveProject({ root, incremental? }) → {   (incremental: false, every build a fresh one)
 *     root, cache,
 *     prepare({ settings?, sources?, filter? }) → Prepared
 *     build({ settings?, sources?, filter? }) → Build
 *     watchSet() → { dirs, files }
 *   }
 *
 * It keeps the root's ParseCache (cache.js) and the last good text of each file: a file whose text
 * doesn't parse (a parse failure, or Babel's recovered syntax errors) is built with its last text
 * that parsed, so its components don't vanish while it is half typed; the new text's parse SYG900
 * is reported (`parseErrors`) and the file is listed in `substituted`. Once it parses again it is
 * built as it is. (This was the language server's prepare(), PLAN-7 §6 / D307; moved here unchanged.)
 *
 * prepare(): options from the root's config file under `settings` (only the defined keys:
 * strict, a11y, ignore, paths (relative to the root), includeTests; `config`: false skips the
 * file, a path reads that one; `defaults`: below the config file, as check()'s), the files
 * expanded from `paths` (with `sources`, the unsaved buffers, counted), less those `filter(abs)` rejects (the LSP's nested roots), then the project
 * built with the last good substitution.
 *   Prepared { options, config, srcs, files, missing, project (null without files), parseErrors, substituted: Map,
 *              memo (the root's per-file rule memo: pass it to runRules) }
 * Each build reuses the last one's model for the unchanged files (Project `previous`).
 *
 * build(): prepare() plus the rules and the graph (graph.js buildGraph), as graphFiles() makes it
 * with the config file's findings (`--graph=html` without `--watch` gives the same JSON for the
 * same files). `version` counts the builds whose JSON changed, `changed` says this one did.
 * `diagnostics` is the sorted list the graph was built with (check()'s result for the same files,
 * with the last good substitution): sygnal/vite reports it and serves the graph from one build
 * (PLAN-10 W-2). With `stamps: true`, `stamps` is componentStamps(project) (graph.js, P-2):
 * Map absPath → [{ binding, key }]; else null.
 *   Build { graph (null without files), json, hash, version, changed, diagnostics, stamps, files,
 *           missing, substituted: string[] (absolute), options, ms }
 *
 * watchSet(): what a watcher should follow after the last prepare(): `dirs` (the input
 * directories, or a glob's base, watched recursively) and `files` (single files: inputs named
 * directly, files the project loaded from outside the dirs (imports), the config file read and the
 * two config names in the project-root directory config discovery stops at, existing or not, so
 * adding one is noticed).
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { buildProject } from './model/project.js'
import { selectRules } from './rules/index.js'
import { runRules, sortDiagnostics, createRuleMemo } from './run.js'
import { resolveOptions, CONFIG_FILE } from './config.js'
import { expandInputs, toSourceMap } from './files.js'
import { createParseCache } from './cache.js'
import { buildGraph, componentStamps } from './graph.js'

const isParseError = (d) => d.code === 'SYG900' && /^could not parse file/.test(d.message)
const GLOB_CHARS = /[*?[\]{}]/

/** The directory config discovery stops at from `dir` (config.js discover): the first with either file, else `dir`. */
export function configRoot(dir) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    for (const n of [CONFIG_FILE, 'package.json']) {
      try { if (fs.statSync(path.join(d, n)).isFile()) return d } catch { /* not here */ }
    }
    if (path.dirname(d) === d) return path.resolve(dir)
  }
}

export function createLiveProject({ root, cache = createParseCache(), incremental = true } = {}) {
  root = path.resolve(root || process.cwd())
  let lastGood = new Map() // absPath → cache entry of its last text that parsed cleanly
  let last = null // the last Prepared
  let lastSettings = {}
  let current = { json: null, hash: null, version: 0 }
  // incremental builds (native-tooling round 2): the last build, reused by the next one for the
  // unchanged files (Project `previous`), and the per-file rules' memo (run.js createRuleMemo)
  let lastProject = null
  const memo = createRuleMemo()

  function prepare({ settings = {}, sources, filter } = {}) {
    const { options, config } = resolveOptions({
      cwd: root, strict: settings.strict, a11y: settings.a11y, ignore: settings.ignore, paths: settings.paths,
      includeTests: settings.includeTests, config: settings.config, defaults: settings.defaults,
    })
    lastSettings = settings
    const srcs = toSourceMap(sources, root)
    const expanded = expandInputs(options.paths, { cwd: root, includeTests: options.includeTests, sources: srcs })
    const files = filter ? expanded.files.filter(filter) : expanded.files
    const out = { options, config, srcs, files, missing: expanded.missing, project: null, parseErrors: [], substituted: new Map(), memo: incremental ? memo : null }
    last = out
    if (!files.length) return out

    const buildWith = (s, previous) => buildProject(files, { cwd: options.cwd, sources: s, cache, replyKeys: options.replyKeys, previous })
    let project = buildWith(srcs, incremental ? lastProject : null)
    // last good: files that don't parse now, but did before
    const broken = new Set(project.parseErrors.map(e => e.file))
    for (const f of project.files.values()) if (f?.ast?.errors?.length) broken.add(f.path)
    const substituted = new Map()
    for (const abs of broken) {
      const good = lastGood.get(abs)
      if (!good || good.text === (srcs.get(abs) ?? project.files.get(abs)?.source)) continue
      substituted.set(abs, good.text)
      cache.store(abs, good) // put the good parse back: the second build re-parses nothing
    }
    let parseErrors = []
    if (substituted.size) {
      // (runRules with no rules: only the parse errors' SYG900)
      parseErrors = runRules(project, [])
        .filter(d => !options.ignore?.includes(d.code) && isParseError(d) && substituted.has(path.resolve(root, d.file)))
      project = buildWith(new Map([...srcs, ...substituted]), incremental ? project : null)
    }
    lastProject = project
    // remember each file's last text that parsed cleanly
    const good = new Map()
    for (const f of project.files.values()) {
      if (!f || f.ast?.errors?.length) continue
      const entry = cache.get(f.path)
      if (entry && !entry.error && entry.text === f.source) good.set(f.path, entry)
    }
    lastGood = good
    Object.assign(out, { project, parseErrors, substituted })
    return out
  }

  function build(args = {}) {
    const t0 = performance.now()
    const prep = prepare(args)
    const { project, options, config } = prep
    let graph = null, diagnostics = [...config.diagnostics], stamps = null
    if (project) {
      let diags = runRules(project, selectRules({ strict: options.strict, a11y: options.a11y }), { memo: incremental ? memo : null })
      diags = [...config.diagnostics, ...diags, ...prep.parseErrors]
      if (options.ignore?.length) diags = diags.filter(d => !options.ignore.includes(d.code))
      diagnostics = sortDiagnostics(diags)
      graph = buildGraph(project, diagnostics)
      if (args.stamps) stamps = componentStamps(project)
    } else if (options.ignore?.length) diagnostics = diagnostics.filter(d => !options.ignore.includes(d.code))
    const json = JSON.stringify(graph)
    const changed = json !== current.json
    if (changed) current = { json, hash: crypto.createHash('sha1').update(json).digest('hex'), version: current.version + 1 }
    return {
      graph, json, hash: current.hash, version: current.version, changed, diagnostics, stamps,
      files: prep.files, missing: prep.missing, substituted: [...prep.substituted.keys()], options, ms: performance.now() - t0,
    }
  }

  function watchSet() {
    const dirs = new Set(), files = new Set()
    if (!last) return { dirs: [], files: [] }
    for (const p of last.options.paths) {
      const abs = path.resolve(root, p)
      if (GLOB_CHARS.test(p)) {
        const base = []
        for (const s of abs.split(path.sep)) { if (GLOB_CHARS.test(s)) break; base.push(s) }
        dirs.add(base.join(path.sep) || path.sep)
        continue
      }
      let st = null
      try { st = fs.statSync(abs) } catch { /* missing: watch where it would appear */ }
      if (st?.isDirectory()) dirs.add(abs)
      else files.add(abs)
    }
    for (const abs of last.project?.files.keys() || []) files.add(abs)
    if (last.config.file) files.add(last.config.file)
    if (lastSettings.config !== false) {
      const dir = configRoot(root)
      files.add(path.join(dir, CONFIG_FILE))
      files.add(path.join(dir, 'package.json'))
    }
    // a directory inside another is covered by it
    const sorted = [...dirs].sort((a, b) => a.length - b.length)
    const top = []
    for (const d of sorted) if (!top.some(t => d === t || d.startsWith(t.endsWith(path.sep) ? t : t + path.sep))) top.push(d)
    const config = new Set([CONFIG_FILE, 'package.json'])
    const under = (f) => top.some(t => f.startsWith(t.endsWith(path.sep) ? t : t + path.sep))
    return { dirs: top, files: [...files].filter(f => config.has(path.basename(f)) || !under(f)).sort() }
  }

  return { root, cache, prepare, build, watchSet }
}
