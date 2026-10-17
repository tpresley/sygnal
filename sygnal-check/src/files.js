/**
 * File discovery (paths, directories, simple globs) and relative import
 * resolution. Both also see in-memory sources (an editor's unsaved buffers,
 * PLAN-7 C-1): see toSourceMap().
 */
import fs from 'node:fs'
import path from 'node:path'

export const SOURCE_EXTENSIONS = ['.jsx', '.tsx', '.js', '.ts', '.mjs', '.mts', '.cjs', '.cts']
export const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.astro', '.vite', '.next', '.svelte-kit', '.turbo', 'out'])

export function isSourceFile(file, { includeTests = false } = {}) {
  if (!SOURCE_EXTENSIONS.includes(path.extname(file))) return false
  if (/\.d\.[cm]?ts$/.test(file)) return false
  if (/\.config\.[cm]?[jt]s$/.test(path.basename(file))) return false
  if (!includeTests && /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)) return false
  return true
}

function walkDir(dir, out, opts) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.isDirectory()) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!IGNORED_DIRS.has(e.name)) walkDir(full, out, opts)
    } else if (e.isFile() && isSourceFile(full, opts)) {
      out.push(full)
    }
  }
}

const GLOB_CHARS = /[*?{[]/

const EMPTY_SOURCES = new Map()

/**
 * Normalize the `sources` option (Map<path, text> or { [path]: text }) into a
 * Map keyed by absolute, normalized paths; relative keys resolve against cwd.
 * Returns a shared empty Map when there are none.
 */
export function toSourceMap(sources, cwd = process.cwd()) {
  if (!sources) return EMPTY_SOURCES
  const entries = sources instanceof Map ? [...sources] : Object.entries(sources)
  if (!entries.length) return EMPTY_SOURCES
  const map = new Map()
  for (const [k, text] of entries) if (typeof text === 'string') map.set(path.resolve(cwd, k), text)
  return map
}

/**
 * Source-only files (in `sources`, not necessarily on disk) under `dir` that
 * the directory walk would have picked: a source file, no dot or ignored
 * directory on the way.
 */
function sourcesUnder(dir, sources, opts) {
  const out = []
  for (const file of sources.keys()) {
    const rel = path.relative(dir, file)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue
    const dirs = rel.split(path.sep).slice(0, -1)
    if (dirs.some(d => d.startsWith('.') || IGNORED_DIRS.has(d))) continue
    if (isSourceFile(file, opts)) out.push(file)
  }
  return out
}

/** Convert a glob (supports **, *, ?, {a,b}) to a RegExp over '/'-separated paths. */
export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?' } else re += '.*'
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '{') {
      const end = glob.indexOf('}', i)
      if (end === -1) { re += '\\{'; continue }
      re += '(?:' + glob.slice(i + 1, end).split(',').map(s => s.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|') + ')'
      i = end
    } else if ('.+^$()|[]\\'.includes(c)) re += '\\' + c
    else re += c
  }
  return new RegExp('^' + re + '$')
}

/**
 * Expand a list of paths / directories / globs into absolute file paths.
 * Directories are walked recursively (node_modules, dist etc. skipped).
 * Test files (*.test.* / *.spec.*) found through a directory or a glob are
 * included only with includeTests; a file named explicitly always is.
 *
 * With `sources` (toSourceMap), files that exist only in memory count as
 * well: one named explicitly is never missing, and one under a directory
 * input (or matching a glob) is added when it passes the walk's filters.
 *
 * With `tree` ({ paths: Set<absPath> }, PLAN-10 C-3: the files of a git
 * commit) the disk is never read: the walk, the globs and the explicit paths
 * see only the tree's files (a path is a directory when files are under it).
 */
export function expandInputs(inputs, { cwd = process.cwd(), includeTests = false, sources, tree } = {}) {
  if (tree) return expandTree(inputs, { cwd, includeTests, tree })
  const srcs = toSourceMap(sources, cwd)
  const out = new Set()
  const missing = []
  for (const input of inputs) {
    if (GLOB_CHARS.test(input)) {
      const norm = input.split(path.sep).join('/')
      const segs = norm.split('/')
      const baseSegs = []
      for (const s of segs) { if (GLOB_CHARS.test(s)) break; baseSegs.push(s) }
      const base = path.resolve(cwd, baseSegs.join('/') || '.')
      const re = globToRegExp(path.resolve(cwd, norm).split(path.sep).join('/'))
      const files = []
      walkDir(base, files, { includeTests })
      files.push(...sourcesUnder(base, srcs, { includeTests }))
      for (const f of files) if (re.test(f.split(path.sep).join('/'))) out.add(f)
      continue
    }
    const abs = path.resolve(cwd, input)
    if (srcs.has(abs)) { out.add(abs); continue }
    let st
    try { st = fs.statSync(abs) } catch { missing.push(input); continue }
    if (st.isDirectory()) {
      const files = []
      walkDir(abs, files, { includeTests })
      files.push(...sourcesUnder(abs, srcs, { includeTests }))
      files.forEach(f => out.add(f))
    } else {
      out.add(abs)
    }
  }
  return { files: [...out].sort(), missing }
}

/** expandInputs over a virtual tree's file list (no disk). */
function expandTree(inputs, { cwd, includeTests, tree }) {
  const all = tree.paths // a Set (or Map) of absolute paths: has() and keys()
  const out = new Set()
  const missing = []
  for (const input of inputs) {
    if (GLOB_CHARS.test(input)) {
      const norm = input.split(path.sep).join('/')
      const segs = norm.split('/')
      const baseSegs = []
      for (const s of segs) { if (GLOB_CHARS.test(s)) break; baseSegs.push(s) }
      const base = path.resolve(cwd, baseSegs.join('/') || '.')
      const re = globToRegExp(path.resolve(cwd, norm).split(path.sep).join('/'))
      for (const f of sourcesUnder(base, all, { includeTests })) if (re.test(f.split(path.sep).join('/'))) out.add(f)
      continue
    }
    const abs = path.resolve(cwd, input)
    if (all.has(abs)) { out.add(abs); continue }
    const under = sourcesUnder(abs, all, { includeTests })
    if (under.length) under.forEach(f => out.add(f))
    else if (![...all.keys()].some(f => f.startsWith(abs + path.sep))) missing.push(input)
  }
  return { files: [...out].sort(), missing }
}

export function diskIsFile(p) {
  try { return fs.statSync(p).isFile() } catch { return false }
}

/**
 * Resolve a relative import specifier to a source file, or null.
 * `isFile(absPath)` decides whether a candidate exists (default: the disk);
 * Project passes one that sees its in-memory sources first.
 */
export function resolveImport(fromFile, spec, { isFile = diskIsFile } = {}) {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null
  const base = path.resolve(path.dirname(fromFile), spec)
  const candidates = [base]
  // './X.js' may refer to './X.ts' (TS ESM convention)
  const ext = path.extname(base)
  if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    const stem = base.slice(0, -ext.length)
    candidates.push(stem + '.ts', stem + '.tsx', stem + '.mts')
  }
  for (const e of SOURCE_EXTENSIONS) candidates.push(base + e)
  for (const e of SOURCE_EXTENSIONS) candidates.push(path.join(base, 'index' + e))
  for (const c of candidates) {
    if (SOURCE_EXTENSIONS.includes(path.extname(c)) && isFile(c)) return c
  }
  return null
}
