// Which sygnal-check the extension runs (PLAN-7 V-1, D301), and whether a folder uses Sygnal.
// Plain Node: no `vscode` import, so the unit tests run without VS Code.
import * as fs from 'node:fs'
import * as path from 'node:path'

/** The first sygnal-check version with `sygnal-check lsp`. */
export const MIN_LSP_VERSION = '0.4.0'
/** The first sygnal-check with completions, go to definition / references, code lens and rename (PLAN-7 Phase 4). */
export const FEATURES_VERSION = '0.5.0'

export interface CheckCopy {
  /** The package directory (holds package.json, bin/, src/). */
  dir: string
  version: string
  /** `bin/sygnal-check.js` */
  bin: string
  /** Whether this copy has the language server. */
  capable: boolean
}

export interface ServerChoice {
  source: 'workspace' | 'bundled'
  dir: string
  version: string
  bin: string
  /** For `bundled`: why the workspace's copy wasn't used. */
  reason?: 'none' | 'too-old' | 'untrusted'
  /** The workspace folder the copy was found from (workspace), or the old copy found (too-old). */
  folder?: string
  /** For `too-old`: the workspace copy that can't run the server. */
  old?: CheckCopy
}

/** Compares two `x.y.z` versions (pre-release tags compare below the release). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(-.+)?/.exec(String(v).trim())
    return m ? { n: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? '' } : null
  }
  const pa = parse(a), pb = parse(b)
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0
  for (let i = 0; i < 3; i++) if (pa.n[i] !== pb.n[i]) return pa.n[i] - pb.n[i]
  if (pa.pre === pb.pre) return 0
  return pa.pre ? -1 : 1
}

function readJson(file: string): any {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return undefined }
}

/**
 * Reads a sygnal-check package directory. `capable` is true for a version ≥ 0.4.0, or for any copy
 * that has `src/lsp/server.js` (the repository's checker is 0.3.0 until the 0.4.0 release).
 */
export function readCheckCopy(dir: string): CheckCopy | undefined {
  const pkg = readJson(path.join(dir, 'package.json'))
  if (!pkg || pkg.name !== 'sygnal-check') return undefined
  const version = typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['sygnal-check'] ?? 'bin/sygnal-check.js'
  const bin = path.join(dir, binRel)
  if (!fs.existsSync(bin)) return undefined
  const capable = compareVersions(version, MIN_LSP_VERSION) >= 0 || fs.existsSync(path.join(dir, 'src', 'lsp', 'server.js'))
  return { dir, version, bin, capable }
}

/**
 * The sygnal-check a workspace folder resolves, the way Node resolves a package from the folder:
 * `node_modules/sygnal-check` in the folder, then in each parent directory.
 */
export function findWorkspaceCheck(folder: string): CheckCopy | undefined {
  let dir = path.resolve(folder)
  for (;;) {
    if (path.basename(dir) !== 'node_modules') {
      const copy = readCheckCopy(path.join(dir, 'node_modules', 'sygnal-check'))
      if (copy) return copy
    }
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/**
 * Picks the server: the first folder whose own sygnal-check can run it, else the bundled copy.
 * One server serves every folder of the window (it checks each folder as its own project).
 */
export function chooseServer(folders: string[], bundledDir: string, opts: { trusted?: boolean } = {}): ServerChoice {
  const bundled = readCheckCopy(bundledDir)
  if (!bundled) throw new Error(`The bundled sygnal-check is missing from ${bundledDir}`)
  const fallback = (reason: ServerChoice['reason'], extra: Partial<ServerChoice> = {}): ServerChoice =>
    ({ source: 'bundled', dir: bundled.dir, version: bundled.version, bin: bundled.bin, reason, ...extra })
  if (opts.trusted === false) return fallback('untrusted')
  let old: { copy: CheckCopy; folder: string } | undefined
  for (const folder of folders) {
    const copy = findWorkspaceCheck(folder)
    if (!copy) continue
    if (copy.capable) return { source: 'workspace', dir: copy.dir, version: copy.version, bin: copy.bin, folder }
    old ??= { copy, folder }
  }
  return old ? fallback('too-old', { old: old.copy, folder: old.folder }) : fallback('none')
}

/** Whether a package.json object uses Sygnal: a dependency on sygnal / sygnal-check, or the config key. */
export function usesSygnal(pkg: any): boolean {
  if (!pkg || typeof pkg !== 'object') return false
  if (pkg.name === 'sygnal' || pkg.name === 'sygnal-check') return true
  if ('sygnal-check' in pkg && typeof pkg['sygnal-check'] === 'object') return true
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = pkg[key]
    if (deps && typeof deps === 'object' && ('sygnal' in deps || 'sygnal-check' in deps)) return true
  }
  return false
}

/** Whether a package.json file uses Sygnal (false when it can't be read). */
export function packageFileUsesSygnal(file: string): boolean {
  return usesSygnal(readJson(file))
}

/**
 * Whether the chosen copy is the workspace's own and predates the editor features (completions,
 * definition / references, code lens, rename): it still runs, for its findings (D301), and the
 * extension suggests an upgrade once. A copy with `src/lsp/completion.js` has them whatever its
 * version says (the repository's checker before a release).
 */
export function lacksEditorFeatures(c: ServerChoice): boolean {
  return c.source === 'workspace' && compareVersions(c.version, FEATURES_VERSION) < 0 && !fs.existsSync(path.join(c.dir, 'src', 'lsp', 'completion.js'))
}

/** The status bar tooltip for a choice. */
export function describeChoice(c: ServerChoice): string {
  if (c.source === 'workspace') return `sygnal-check ${c.version} from the workspace (${c.dir})`
  const why = c.reason === 'too-old'
    ? `the workspace's sygnal-check ${c.old?.version} has no language server (needs ${MIN_LSP_VERSION}+)`
    : c.reason === 'untrusted'
      ? 'the workspace is not trusted'
      : 'no sygnal-check in the workspace'
  return `sygnal-check ${c.version} bundled with the extension (${why})`
}
