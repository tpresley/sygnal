/**
 * The app graph at a git ref, without a checkout (PLAN-10 C-3, D505): `sygnal-check --graph --base <ref>`.
 *
 *   openRef(ref, { cwd }) → BaseTree
 *     Resolves `ref` to a commit and lists its files (`git ls-tree -r`, the whole tree, so imports
 *     outside the scanned paths and Vike's root markers resolve as they did then). Throws a
 *     GitBaseError (the CLI exits 2 with its message) when cwd isn't in a git work tree or the ref
 *     doesn't name a commit.
 *   BaseTree = { ref, commit, top, paths: Set<absPath>, read(abs) → text | null, isFile(abs),
 *                exists(abs), prefetch(absPaths), inside(abs) }
 *     Paths are absolute in cwd's spelling (`top` is the repository root reached from cwd through
 *     `git rev-parse --show-cdup`, so a symlinked cwd such as macOS's /tmp keeps its form and the
 *     base graph's file names match the working tree's). read() takes a file's text from the
 *     commit: prefetch() reads many in one `git cat-file --batch`, a file not prefetched is read
 *     on its own. `exists` / `read` (throwing) serve config.js's `io`.
 *   baseGraph(tree, inputs, settings) → { graph, files, missing }
 *     The graph of the commit: the inputs expanded over the tree (files.js `tree`; tests excluded
 *     unless `includeTests`), read through the tree (model/project.js `tree`).
 *
 * Every git call is execFileSync with an argument array (no shell); a ref that starts with '-' is
 * refused before git sees it.
 */
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { expandInputs } from './files.js'
import { graphFiles } from './graph.js'

export class GitBaseError extends Error {}

const MAX_BUFFER = 1024 * 1024 * 1024

function git(args, { cwd, input, encoding = 'utf8' }) {
  return execFileSync('git', args, { cwd, input: input == null ? undefined : Buffer.from(input, 'utf8'), encoding, maxBuffer: MAX_BUFFER, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
}

const firstLine = (err) => String(err?.stderr || err?.message || err).trim().split('\n')[0]

export function openRef(ref, { cwd = process.cwd() } = {}) {
  cwd = path.resolve(cwd)
  if (typeof ref !== 'string' || !ref || ref.startsWith('-') || /[\0\n]/.test(ref)) throw new GitBaseError(`--base needs a git ref (a branch, tag or commit), got '${ref}'`)
  let cdup
  try {
    cdup = git(['rev-parse', '--show-cdup'], { cwd }).replace(/\n$/, '')
  } catch (err) {
    if (err?.code === 'ENOENT') throw new GitBaseError('--base needs git, which was not found on the PATH')
    throw new GitBaseError(`--base needs a git repository: ${path.relative(process.cwd(), cwd) || '.'} is not in one (${firstLine(err)})`)
  }
  const top = path.resolve(cwd, cdup || '.')
  let commit
  try {
    commit = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: top }).trim()
  } catch (_) { commit = '' }
  if (!/^[0-9a-f]{40,64}$/.test(commit)) throw new GitBaseError(`unknown git ref '${ref}': no commit by that name (try a branch, a tag, a commit or HEAD~1)`)

  const list = git(['ls-tree', '-r', '-z', '--full-tree', '--name-only', commit], { cwd: top })
  const paths = new Set()
  const repoPath = new Map() // abs → the path in the commit ('/'-separated)
  for (const p of list.split('\0')) {
    if (!p) continue
    const abs = path.join(top, ...p.split('/'))
    paths.add(abs)
    repoPath.set(abs, p)
  }
  const texts = new Map()

  /** Reads the files' texts from the commit in one `git cat-file --batch`. */
  function prefetch(absPaths) {
    const want = [...new Set(absPaths)].filter(a => repoPath.has(a) && !texts.has(a))
    if (!want.length) return
    const out = git(['cat-file', '--batch'], { cwd: top, input: want.map(a => `${commit}:${repoPath.get(a)}\n`).join(''), encoding: 'buffer' })
    let at = 0
    for (const abs of want) {
      const nl = out.indexOf(10, at)
      if (nl < 0) break
      const header = out.toString('utf8', at, nl)
      at = nl + 1
      const m = /^\S+ (\S+) (\d+)$/.exec(header)
      if (!m) { texts.set(abs, null); continue } // '<name> missing'
      const size = Number(m[2])
      texts.set(abs, m[1] === 'blob' ? out.toString('utf8', at, at + size) : null)
      at += size + 1
    }
  }

  function read(abs) {
    if (!repoPath.has(abs)) return null
    if (!texts.has(abs)) {
      try { texts.set(abs, git(['cat-file', 'blob', `${commit}:${repoPath.get(abs)}`], { cwd: top })) } catch (_) { texts.set(abs, null) }
    }
    return texts.get(abs)
  }

  const inside = (abs) => { const r = path.relative(top, abs); return !r || (!r.startsWith('..') && !path.isAbsolute(r)) }
  return {
    ref, commit, top, paths, read, prefetch, inside,
    isFile: (abs) => paths.has(abs),
    // config.js io: exists / read (throws like readFileSync when the file isn't in the commit)
    exists: (abs) => paths.has(abs),
    readOrThrow(abs) { const t = read(abs); if (t == null) throw Object.assign(new Error(`not in ${ref}`), { code: 'ENOENT' }); return t },
  }
}

/** The commit's graph: the inputs expanded over the tree, the files read from it (see the header). */
export function baseGraph(tree, inputs, settings) {
  const { files, missing } = expandInputs(inputs, { cwd: settings.cwd, includeTests: settings.includeTests, tree })
  tree.prefetch(files)
  const graph = graphFiles(files, { ...settings, tree, extraDiagnostics: settings.extraDiagnostics })
  return { graph, files, missing }
}

/** The base part of a glob or path (what must be inside the repository). */
export function inputBase(input, cwd) {
  const segs = input.split(path.sep).join('/').split('/')
  const base = []
  for (const s of segs) { if (/[*?{[]/.test(s)) break; base.push(s) }
  return path.resolve(cwd, base.join('/') || '.')
}
