// Bundles the guest kernel (src/guest-kernel.js + Sygnal's core + sygnal/host) into dist/guest.js,
// the one script every sandbox evaluates before the component. Needs the root build (dist/).
//   node dev-plans/research/sandbox/build-guest.mjs
import {createRequire} from 'node:module'
import {mkdirSync, writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {gzipSync, brotliCompressSync} from 'node:zlib'

const here = import.meta.dirname, repo = resolve(here, '../../..')
const esbuild = createRequire(resolve(repo, 'package.json'))('esbuild')

const built = await esbuild.build({
  entryPoints: [resolve(here, 'src/guest-kernel.js')], bundle: true, write: false, format: 'iife', minify: true,
  platform: 'neutral', mainFields: ['module', 'main'], logLevel: 'error', target: 'es2020',
  define: {'process.env.NODE_ENV': '"production"'},
  alias: {'sygnal/host': resolve(repo, 'dist/host.esm.js'), sygnal: resolve(repo, 'dist/index.esm.js')},
  absWorkingDir: repo, nodePaths: [resolve(repo, 'node_modules')],
})
// xstream's globalthis shim looks for `global` when there is no window
const code = 'var global = globalThis;' + built.outputFiles[0].text
mkdirSync(resolve(here, 'dist'), {recursive: true})
writeFileSync(resolve(here, 'dist/guest.js'), code)
const kb = (n) => (n / 1024).toFixed(1) + ' KB'
console.log(`dist/guest.js: ${kb(code.length)} min, ${kb(gzipSync(code).length)} gzip, ${kb(brotliCompressSync(code).length)} br`)
