/**
 * Project roots (G-666): which Sygnal project a file of the workspace belongs to, so a workspace
 * folder holding several apps (a monorepo, the Sygnal repository with its examples) checks each
 * app with its own config and `paths`.
 *
 *   isSygnalDir(dir)                 → boolean   a Sygnal project root (the rule below)
 *   createRoots() → {
 *     isRoot(dir)                    isSygnalDir, cached per directory
 *     rootOf(abs, folder)            the file's project root inside workspace folder `folder`
 *     hasNested(folder)              whether a Sygnal project root sits below `folder` (bounded scan)
 *     clear()                        forget the cache (a config or package.json changed)
 *   }
 *   ownedBy(root, isRoot = isSygnalDir) → (abs) → boolean
 *                                    whether `root` is the nearest root of a file under it (core.js
 *                                    drops the files of nested roots from a root's check)
 *   looksLikeSygnal(text)            imports from sygnal, or sets component statics (G-665)
 *   inIgnoredDir(rel)                a relative path through node_modules, dist, a dot directory ...
 *
 * The rule: a file's project root is the nearest ancestor directory, up to and including the
 * workspace folder, that contains `sygnal-check.config.json`, or a `package.json` that depends on
 * `sygnal` or `sygnal-check` (dependencies, devDependencies, peerDependencies) or has a
 * `"sygnal-check"` key. Directories inside node_modules and the other ignored directories
 * (files.js IGNORED_DIRS, dot directories) never qualify. When none does, the root is the
 * workspace folder itself (the fallback: a plain folder works as before G-666).
 *
 * The cache maps a directory to its verdict; the server clears it on a watched config or
 * package.json change and on every didOpen (clients without file watching still see a config
 * added since).
 */
import fs from 'node:fs'
import path from 'node:path'
import { CONFIG_FILE, PACKAGE_KEY } from '../config.js'
import { IGNORED_DIRS } from '../files.js'

const DEP_KEYS = ['dependencies', 'devDependencies', 'peerDependencies']
const NAMES = ['sygnal', 'sygnal-check']
// the bounded scan of hasNested(): how deep below the folder, and how many directories at most
const SCAN_DEPTH = 4
const SCAN_DIRS = 4000

const isFile = (f) => { try { return fs.statSync(f).isFile() } catch { return false } }
const within = (abs, dir) => abs === dir || abs.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep)

/** Whether `dir` is a Sygnal project root (see the header). */
export function isSygnalDir(dir) {
  if (isFile(path.join(dir, CONFIG_FILE))) return true
  let pkg
  try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) } catch { return false }
  if (!pkg || typeof pkg !== 'object') return false
  if (PACKAGE_KEY in pkg) return true
  return DEP_KEYS.some(k => pkg[k] && typeof pkg[k] === 'object' && NAMES.some(n => n in pkg[k]))
}

/** A relative path ('a/node_modules/b') whose directories include an ignored or dot directory. */
export function inIgnoredDir(rel) {
  return rel.split(/[\\/]/).some(d => d && d !== '.' && d !== '..' && (IGNORED_DIRS.has(d) || d.startsWith('.')))
}

export function createRoots() {
  const cache = new Map() // dir → boolean

  function isRoot(dir) {
    let v = cache.get(dir)
    if (v === undefined) cache.set(dir, v = isSygnalDir(dir))
    return v
  }

  /** The project root of `abs` (a file) inside workspace folder `folder`; `folder` when none qualifies. */
  function rootOf(abs, folder) {
    if (!within(abs, folder)) return null
    let dir = path.dirname(abs)
    while (within(dir, folder)) {
      if (!inIgnoredDir(path.relative(folder, dir)) && isRoot(dir)) return dir
      if (dir === folder) break
      const up = path.dirname(dir)
      if (up === dir) break
      dir = up
    }
    return folder
  }

  /**
   * Whether a Sygnal project root sits below `folder` (breadth first, SCAN_DEPTH levels, at most
   * SCAN_DIRS directories, ignored and dot directories skipped; stops at the first one).
   */
  function hasNested(folder) {
    let level = [folder]
    let seen = 0
    for (let depth = 0; depth < SCAN_DEPTH && level.length; depth++) {
      const next = []
      for (const dir of level) {
        let entries
        try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
        for (const e of entries) {
          if (!e.isDirectory() || e.name.startsWith('.') || IGNORED_DIRS.has(e.name)) continue
          const sub = path.join(dir, e.name)
          if (isRoot(sub)) return true
          if (++seen >= SCAN_DIRS) return false
          next.push(sub)
        }
      }
      level = next
    }
    return false
  }

  return { isRoot, rootOf, hasNested, clear: () => cache.clear() }
}

/**
 * `(abs) → boolean`: whether `root` is the nearest project root of file `abs` (under `root`): no
 * directory between them is a root. Verdicts are cached for the life of the returned function.
 */
export function ownedBy(root, isRoot = isSygnalDir) {
  const verdicts = new Map() // dir → whether a root sits at or between it and `root` (exclusive)
  const nestedAt = (dir) => {
    if (dir === root || !within(dir, root)) return false
    let v = verdicts.get(dir)
    if (v === undefined) {
      v = (!inIgnoredDir(path.relative(root, dir)) && isRoot(dir)) || nestedAt(path.dirname(dir))
      verdicts.set(dir, v)
    }
    return v
  }
  return (abs) => !nestedAt(path.dirname(abs))
}

const SYGNAL_IMPORT = /\bfrom\s*['"]sygnal(?:\/[^'"]*)?['"]|\brequire\(\s*['"]sygnal(?:\/[^'"]*)?['"]\s*\)|\bimport\(\s*['"]sygnal(?:\/[^'"]*)?['"]\s*\)/
const COMPONENT_STATIC = /\b[A-Z][\w$]*\.(?:intent|model|initialState|context|onError)\s*=(?!=)/

/** Whether a source text looks like Sygnal code: it imports from sygnal, or sets component statics. */
export function looksLikeSygnal(text) {
  return typeof text === 'string' && (SYGNAL_IMPORT.test(text) || COMPONENT_STATIC.test(text))
}
