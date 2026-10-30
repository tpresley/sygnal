// What the 203 KB guest kernel is made of (esbuild metafile): the bytes QuickJS parses per sandbox.
//   node probes/kernel-size.mjs
import {createRequire} from 'node:module'
import {resolve} from 'node:path'
const here = resolve(import.meta.dirname, '..'), repo = resolve(here, '../../..')
const esbuild = createRequire(resolve(repo, 'package.json'))('esbuild')
const r = await esbuild.build({entryPoints: [resolve(here, 'src/guest-kernel.js')], bundle: true, write: false, metafile: true, format: 'iife', minify: true,
  platform: 'neutral', mainFields: ['module', 'main'], logLevel: 'error', define: {'process.env.NODE_ENV': '"production"'},
  alias: {'sygnal/host': resolve(repo, 'dist/host.esm.js'), sygnal: resolve(repo, 'dist/index.esm.js')}, absWorkingDir: repo, nodePaths: [resolve(repo, 'node_modules')]})
const inputs = Object.values(r.metafile.outputs)[0].inputs
const rows = Object.entries(inputs).map(([k, v]) => [k.replace(/.*node_modules\//, ''), v.bytesInOutput]).sort((a, b) => b[1] - a[1])
for (const [k, b] of rows.slice(0, 12)) console.log(String((b / 1024).toFixed(1)).padStart(7), 'KB', k)
