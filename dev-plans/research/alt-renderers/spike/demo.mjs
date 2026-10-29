// Bundles demo-entry.tsx against ../../../../src (esbuild, already a root devDependency) and runs it.
//   node dev-plans/research/alt-renderers/spike/demo.mjs [todomvc|tasks|counter] [--script "keys"]
import {build} from 'esbuild'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {spawnSync} from 'node:child_process'

const here = fileURLToPath(new URL('.', import.meta.url))
const src = fileURLToPath(new URL('../../../../src/', import.meta.url))
const out = here + '.out/demo.mjs'
await build({
  entryPoints: [here + 'demo-entry.tsx'], bundle: true, platform: 'node', format: 'esm', outfile: out,
  jsx: 'automatic', jsxImportSource: 'sygnal', logLevel: 'warning',
  alias: {'sygnal/jsx-runtime': src + 'jsx-runtime.ts', 'sygnal/jsx-dev-runtime': src + 'jsx-dev-runtime.ts', sygnal: src + 'index.ts'},
  banner: {js: "import {createRequire} from 'module'; const require = createRequire(import.meta.url);"},
})
const r = spawnSync(process.execPath, [out, ...process.argv.slice(2)], {stdio: 'inherit'})
process.exit(r.status ?? 0)
