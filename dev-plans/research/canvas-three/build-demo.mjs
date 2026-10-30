// Bundles src/ for the browser demo (Vite serves src/ file by file, and type-only re-exports break
// there). Run before `npm run dev`; the tests use src/ directly.
import {build} from 'esbuild'
await build({entryPoints: [new URL('./demo-entry.ts', import.meta.url).pathname], bundle: true, format: 'esm', outfile: new URL('./dist/sygnal-demo.js', import.meta.url).pathname, logLevel: 'warning'})
