// The same guest kernel bundled by Rollup (as an app build is) instead of esbuild: how much of the
// main bundle esbuild keeps that Rollup's tree-shaking drops.   node probes/kernel-rollup.mjs
import {createRequire} from 'node:module'
import {resolve} from 'node:path'
import {gzipSync} from 'node:zlib'
const here = resolve(import.meta.dirname, '..'), repo = resolve(here, '../../..')
const req = createRequire(resolve(repo, 'package.json'))
const {rollup} = req('rollup')
const {nodeResolve} = req('@rollup/plugin-node-resolve')
const commonjs = req('@rollup/plugin-commonjs')
const terser = req('@rollup/plugin-terser')
const alias = {name: 'alias', resolveId: (id) => id === 'sygnal' ? resolve(repo, 'dist/index.esm.js') : id === 'sygnal/host' ? resolve(repo, 'dist/host.esm.js') : null}
const b = await rollup({input: resolve(here, 'src/guest-kernel.js'), plugins: [alias, nodeResolve({rootDir: repo, modulePaths: [resolve(repo, 'node_modules')]}), commonjs(), terser()], onwarn: () => {}})
const {output} = await b.generate({format: 'iife', name: 'K'})
const code = output[0].code
console.log(`rollup + terser: ${(code.length / 1024).toFixed(1)} KB min, ${(gzipSync(code).length / 1024).toFixed(1)} KB gzip`)
const mods = Object.entries(output[0].modules).map(([k, v]) => [k.replace(/.*node_modules\//, '').replace(repo + '/', ''), v.renderedLength]).sort((a, b) => b[1] - a[1])
for (const [k, n] of mods.slice(0, 6)) console.log(String((n / 1024).toFixed(1)).padStart(7), 'KB (pre-minify)', k)
