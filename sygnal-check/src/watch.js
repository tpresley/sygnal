/**
 * The file watcher of `sygnal-check --graph=html --watch` (PLAN-10 W-1, D524): no dependency
 * (D209), Node >= 18.
 *
 *   createWatcher({ onChange, debounce = 50, maxWait = 1000, poll = false | ms, relevant? }) → {
 *     sync({ dirs, files })   follow these (live.js watchSet()); call again after every build
 *     close()
 *     mode                    'recursive' | 'per-directory' | 'poll'
 *   }
 *
 * - dirs: `fs.watch(dir, { recursive: true })`. Where that is unavailable (Linux before Node 19.1 /
 *   20: ERR_FEATURE_UNAVAILABLE_ON_PLATFORM) one non-recursive `fs.watch` per directory, skipping
 *   IGNORED_DIRS and dot directories, and adding new directories as they appear.
 * - files: their parent directory, non-recursively, filtered to the names followed there, so an
 *   atomic save (write a temp file, rename it over) and a file created later are both seen.
 * - poll (network mounts, some container bind mounts): every `poll` ms, stat what's followed
 *   (walking the dirs: new files count) and report what changed.
 * - Only `relevant(rel)` paths count (relative to the watched directory; default: a source
 *   extension or a config file name, never under node_modules or a dot directory below it).
 * - Debounce: `onChange(paths)` runs `debounce` ms after the last event (an atomic save's two
 *   events, a formatter run or a `git checkout` burst become one call), at the latest `maxWait` ms
 *   after the first, so a continuous stream of writes still updates. onChange runs synchronously
 *   (a build), so events during it only queue the next call.
 */
import fs from 'node:fs'
import path from 'node:path'
import { IGNORED_DIRS, SOURCE_EXTENSIONS } from './files.js'
import { CONFIG_FILE } from './config.js'

const CONFIG_NAMES = new Set([CONFIG_FILE, 'package.json'])
const skipDir = (name) => IGNORED_DIRS.has(name) || name.startsWith('.')

/**
 * Whether `rel` (a path relative to a watched directory) counts: a source file or a config file,
 * not under an ignored or dot directory below the watched one (the project itself may sit in one).
 */
export function isRelevant(rel) {
  const parts = String(rel).split(/[\\/]/)
  const base = parts.pop()
  if (parts.some(p => p && p !== '.' && p !== '..' && skipDir(p))) return false
  return CONFIG_NAMES.has(base) || SOURCE_EXTENSIONS.some(e => base.endsWith(e))
}

/** Whether recursive fs.watch works here (it throws on Linux before Node 19.1). */
export function recursiveWatchWorks(dir) {
  try { fs.watch(dir, { recursive: true }).close(); return true } catch (err) {
    if (err?.code === 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') return false
    throw err
  }
}

export function createWatcher({ onChange, debounce = 50, maxWait = 1000, poll = false, relevant = isRelevant, forcePerDirectory = false } = {}) {
  let closed = false
  let timer = null, first = 0
  let pending = new Set()
  let mode = poll ? 'poll' : null

  function fire() {
    timer = null
    first = 0
    const paths = [...pending]
    pending = new Set()
    if (!closed && paths.length) onChange(paths)
  }
  function event(abs) {
    if (closed || !abs) return
    pending.add(abs)
    const now = Date.now()
    if (!first) first = now
    clearTimeout(timer)
    timer = setTimeout(fire, Math.max(0, Math.min(debounce, first + maxWait - now)))
  }

  // ── event watchers ── key → { close }, re-synced on every sync()
  const watchers = new Map()
  const watch = (key, dir, opts, fn) => {
    if (watchers.has(key)) return true
    let w
    try { w = fs.watch(dir, opts, fn) } catch (err) {
      if (err?.code === 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') throw err
      return false // gone, or not readable: the next sync tries again
    }
    w.on('error', () => { try { w.close() } catch { /* closed */ } watchers.delete(key) })
    watchers.set(key, w)
    return true
  }
  const recursive = (dir) => watch('r:' + dir, dir, { recursive: true }, (_t, name) => {
    if (name && relevant(String(name))) event(path.join(dir, String(name)))
  })
  const tree = (root, dir = root) => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    watch('d:' + dir, dir, {}, (type, name) => {
      if (!name) return
      const abs = path.join(dir, String(name))
      if (type === 'rename') { try { if (fs.statSync(abs).isDirectory() && !skipDir(path.basename(abs))) { tree(root, abs); return } } catch { /* removed */ } }
      if (relevant(String(name))) event(abs)
    })
    for (const e of entries) if (e.isDirectory() && !skipDir(e.name)) tree(root, path.join(dir, e.name))
  }
  // single files: their directory, filtered by name
  const fileDirs = new Map() // dir → Set<basename>
  const fileDir = (dir) => watch('f:' + dir, dir, {}, (_t, name) => {
    const names = fileDirs.get(dir)
    if (name && names?.has(String(name))) event(path.join(dir, String(name)))
  })

  // ── polling ──
  let snapshot = null // abs → 'mtime:size'
  let pollTimer = null
  let followed = { dirs: [], files: [] }
  function scan() {
    const out = new Map()
    const stat = (abs) => { try { const st = fs.statSync(abs); if (st.isFile()) out.set(abs, st.mtimeMs + ':' + st.size) } catch { /* missing */ } }
    const walk = (dir) => {
      let entries
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        const abs = path.join(dir, e.name)
        if (e.isDirectory()) { if (!skipDir(e.name)) walk(abs) } else if (relevant(e.name)) stat(abs)
      }
    }
    followed.dirs.forEach(walk)
    followed.files.forEach(stat)
    return out
  }
  function tick() {
    if (closed) return
    const next = scan()
    if (snapshot) {
      for (const [abs, v] of next) if (snapshot.get(abs) !== v) event(abs)
      for (const abs of snapshot.keys()) if (!next.has(abs)) event(abs)
    }
    snapshot = next
  }

  function sync({ dirs = [], files = [] } = {}) {
    if (closed) return
    followed = { dirs: [...dirs], files: [...files] }
    if (mode === 'poll') {
      if (!pollTimer) { snapshot = scan(); pollTimer = setInterval(tick, typeof poll === 'number' && poll > 0 ? poll : 200); pollTimer.unref?.() }
      else snapshot = scan() // followed set changed: start from what is there now
      return
    }
    if (!mode) mode = forcePerDirectory ? 'per-directory' : 'recursive'
    const wanted = new Set()
    for (const d of dirs) {
      if (mode === 'recursive') {
        try { if (recursive(d)) wanted.add('r:' + d) } catch (err) {
          if (err?.code !== 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') throw err
          mode = 'per-directory'
          for (const [k, w] of watchers) if (k.startsWith('r:')) { w.close(); watchers.delete(k) }
          return sync({ dirs, files })
        }
      } else {
        tree(d)
        for (const k of watchers.keys()) if (k.startsWith('d:') && (k.slice(2) === d || k.slice(2).startsWith(d + path.sep))) wanted.add(k)
      }
    }
    fileDirs.clear()
    for (const f of files) {
      const dir = path.dirname(f)
      if (!fileDirs.has(dir)) fileDirs.set(dir, new Set())
      fileDirs.get(dir).add(path.basename(f))
    }
    for (const dir of fileDirs.keys()) if (fileDir(dir)) wanted.add('f:' + dir)
    for (const [k, w] of watchers) if (!wanted.has(k)) { w.close(); watchers.delete(k) }
  }

  function close() {
    closed = true
    clearTimeout(timer)
    clearInterval(pollTimer)
    for (const w of watchers.values()) { try { w.close() } catch { /* closed */ } }
    watchers.clear()
  }

  return { sync, close, get mode() { return mode }, get size() { return mode === 'poll' ? (snapshot?.size ?? 0) : watchers.size } }
}
