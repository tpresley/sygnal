// Builds the next core's benchmark apps (benchmarks/audit/apps/next: the sygnal build with the PLAN-4.6
// next core selected, lib/next-core.js) into benchmarks/audit/dist[-profile]/next
//   node build.mjs [--profile]      (run with the benchmarks/ node_modules: see README.md)
import { build } from 'vite'
import { resolve } from 'node:path'
import sygnal from 'sygnal/vite'
const profile = process.argv.includes('--profile')
const root = resolve(import.meta.dirname, '.')
const pages = ['table', 'table-coll', 'counters', 'counters-tags', 'deep', 'input', 'coll-calc', 'switch', 'fetch']
await build({
  root, configFile: false, logLevel: 'warn', mode: 'production', base: './', plugins: [sygnal()],
  // PLAN-4.6 D175: sygnal/vite strips the next core from production builds; this target opts back in
  define: { 'process.env.NODE_ENV': '"production"', __SYGNAL_NEXT_CORE__: 'true' },
  build: { outDir: resolve(root, profile ? 'dist-profile' : 'dist', 'next'), emptyOutDir: true, minify: profile ? false : 'esbuild', sourcemap: profile,
    rollupOptions: { input: Object.fromEntries(pages.map(p => [p, resolve(root, 'apps/next', p + '.html')])) } },
})
console.log('built next')
