// Bundles the guest kernel (src/guest-kernel.js + Sygnal's core + sygnal/host) into dist/guest.js,
// the one script every sandbox evaluates before the component. Needs the root build (dist/).
// Rollup, as an app build would: esbuild kept 203 KB of it, Rollup 156 KB (probes/kernel-rollup.mjs),
// and QuickJS spends nearly all of a sandbox's boot parsing it (probes/kernel-parse.mjs).
//   node dev-plans/research/sandbox/build-guest.mjs
import {createRequire} from 'node:module'
import {mkdirSync, writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {gzipSync, brotliCompressSync} from 'node:zlib'

const here = import.meta.dirname, repo = resolve(here, '../../..')
const req = createRequire(resolve(repo, 'package.json'))
const {rollup} = req('rollup')
const {nodeResolve} = req('@rollup/plugin-node-resolve')
const commonjs = req('@rollup/plugin-commonjs')
const terser = req('@rollup/plugin-terser')

// one core: the kernel's 'sygnal' and sygnal/host's own 'sygnal' import are the same file
const alias = {name: 'alias', resolveId: (id) => id === 'sygnal' ? resolve(repo, 'dist/index.esm.js') : id === 'sygnal/host' ? resolve(repo, 'dist/host.esm.js') : null}
const env = {name: 'env', transform: (code) => code.includes('process.env.NODE_ENV') ? code.replaceAll('process.env.NODE_ENV', '"production"') : null}
const bundle = await rollup({input: resolve(here, 'src/guest-kernel.js'), plugins: [alias, env, nodeResolve({rootDir: repo, modulePaths: [resolve(repo, 'node_modules')]}), commonjs(), terser({ecma: 2020})], onwarn: () => {}})
const {output} = await bundle.generate({format: 'iife', name: '__kernel'})
// xstream's globalthis shim looks for `global` when there is no window
const code = 'var global = globalThis;' + output[0].code
mkdirSync(resolve(here, 'dist'), {recursive: true})
writeFileSync(resolve(here, 'dist/guest.js'), code)
const kb = (n) => (n / 1024).toFixed(1) + ' KB'
console.log(`dist/guest.js: ${kb(code.length)} min, ${kb(gzipSync(code).length)} gzip, ${kb(brotliCompressSync(code).length)} br`)
