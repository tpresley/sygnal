/**
 * File discovery (paths, directories, simple globs) and relative import
 * resolution.
 */
import fs from 'node:fs'
import path from 'node:path'

export const SOURCE_EXTENSIONS = ['.jsx', '.tsx', '.js', '.ts', '.mjs', '.mts', '.cjs', '.cts']
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.astro', '.vite', '.next', '.svelte-kit', '.turbo', 'out'])

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
 */
export function expandInputs(inputs, { cwd = process.cwd(), includeTests = false } = {}) {
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
      for (const f of files) if (re.test(f.split(path.sep).join('/'))) out.add(f)
      continue
    }
    const abs = path.resolve(cwd, input)
    let st
    try { st = fs.statSync(abs) } catch { missing.push(input); continue }
    if (st.isDirectory()) {
      const files = []
      walkDir(abs, files, { includeTests })
      files.forEach(f => out.add(f))
    } else {
      out.add(abs)
    }
  }
  return { files: [...out].sort(), missing }
}

/** Resolve a relative import specifier to a source file, or null. */
export function resolveImport(fromFile, spec) {
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
    try { if (fs.statSync(c).isFile() && SOURCE_EXTENSIONS.includes(path.extname(c))) return c } catch { /* next */ }
  }
  return null
}
