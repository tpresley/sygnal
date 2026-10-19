/** Resolve the installed library from the source file, never from the checker's own package.
 * Read manifests directly: exported package.json and built entry points are not required, so
 * workspace links and a local source checkout work before their first build. The cache belongs
 * to one Project, so a dependency install/change is observed by the next editor check.
 */
import fs from 'node:fs'
import path from 'node:path'

const UNKNOWN = Object.freeze({ version: null, major: null, sinkState: null, defaultSinkState: null })
const parse = (pkg, manifest) => {
  if (pkg?.name !== 'sygnal' || typeof pkg.version !== 'string') return null
  const m = /^(0|[1-9]\d*)\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/.exec(pkg.version)
  if (!m) return UNKNOWN
  const major = Number(m[1])
  return { version: pkg.version, major, manifest, sinkState: major >= 7, defaultSinkState: major >= 7 ? 'after' : 'before' }
}

export function sygnalVersion(file, { tree, sources } = {}) {
  const read = p => {
    try {
      const text = sources?.get(p) ?? (tree ? tree.read(p) : fs.readFileSync(p, 'utf8'))
      return JSON.parse(text)
    } catch { return null }
  }
  for (let dir = path.dirname(path.resolve(file)); ; dir = path.dirname(dir)) {
    // Node's nearest installed package wins; this also follows npm/pnpm/workspace symlinks.
    const installed = path.join(dir, 'node_modules/sygnal/package.json')
    const dep = parse(read(installed), installed)
    if (dep) return dep
    const own = path.join(dir, 'package.json')
    const self = parse(read(own), own)
    if (self) return self
    if (path.dirname(dir) === dir) return UNKNOWN
  }
}
