// Builds the extension: dist/extension.js (esbuild, CommonJS, vscode-languageclient bundled) and
// server/sygnal-check (a copy of ../../sygnal-check with its runtime dependency @babel/parser),
// the fallback server (D301). `--production` minifies and drops the source map.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const ext = path.resolve(here, '..')
const checkSrc = path.resolve(ext, '../../sygnal-check')
const production = process.argv.includes('--production')

await esbuild.build({
  entryPoints: [path.join(ext, 'src/extension.ts')],
  outfile: path.join(ext, 'dist/extension.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  minify: production,
  sourcemap: production ? false : 'linked',
  logLevel: 'warning',
})
if (production) fs.rmSync(path.join(ext, 'dist/extension.js.map'), { force: true })

// The bundled server: what sygnal-check publishes ("files" in its package.json) plus LICENSE.
const out = path.join(ext, 'server/sygnal-check')
fs.rmSync(path.join(ext, 'server'), { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })
const skip = (p) => /\.(vtest|test|spec)\.[cm]?js$/.test(p)
const copy = (from, to) => fs.cpSync(from, to, { recursive: true, filter: (src) => !skip(src) })
for (const entry of ['bin', 'src', 'schema', 'explanations.json', 'package.json', 'LICENSE']) {
  copy(path.join(checkSrc, entry), path.join(out, entry))
}

// Its runtime dependencies, resolved from sygnal-check's own install (npm ci --prefix sygnal-check).
const pkg = JSON.parse(fs.readFileSync(path.join(checkSrc, 'package.json'), 'utf8'))
const req = createRequire(path.join(checkSrc, 'package.json'))
// Dependencies a package declares only for its typings (its built code never loads them).
const TYPE_ONLY = { '@babel/parser': ['@babel/types'] }
for (const dep of Object.keys(pkg.dependencies ?? {})) {
  let depDir
  try { depDir = path.dirname(req.resolve(`${dep}/package.json`)) } catch {
    throw new Error(`${dep} is not installed in sygnal-check: run npm ci --prefix sygnal-check`)
  }
  const depPkg = JSON.parse(fs.readFileSync(path.join(depDir, 'package.json'), 'utf8'))
  const nested = Object.keys(depPkg.dependencies ?? {}).filter(d => !(TYPE_ONLY[dep] ?? []).includes(d))
  if (nested.length) throw new Error(`${dep} has dependencies of its own (${nested.join(', ')}): bundle them too`)
  const main = path.join(depDir, depPkg.main ?? 'index.js')
  for (const d of TYPE_ONLY[dep] ?? []) {
    if (fs.readFileSync(main, 'utf8').includes(d)) throw new Error(`${dep} now loads ${d} at run time: bundle it too`)
  }
  const target = path.join(out, 'node_modules', dep)
  fs.cpSync(depDir, target, { recursive: true, filter: (src) => !/(CHANGELOG\.md|\.d\.ts|\.map)$/.test(src) })
}
console.log(`built dist/extension.js${production ? ' (production)' : ''} and server/sygnal-check ${pkg.version}`)
