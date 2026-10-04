// Builds every benchmark app. `node build.mjs` = production (minified) into dist/;
// `node build.mjs --profile` = unminified + source maps into dist-profile/ (for CPU profiles)
import { build } from 'vite'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import vue from '@vitejs/plugin-vue'
import sygnal from 'sygnal/vite'

const profile = process.argv.includes('--profile')
const only = process.argv.find(a => a.startsWith('--only='))?.slice(7)
const root = resolve(import.meta.dirname)
const outBase = resolve(root, profile ? 'dist-profile' : 'dist')
const SCENARIOS = { sygnal: ['table', 'table-coll', 'counters', 'deep', 'input'], react: ['table', 'counters', 'deep', 'input'], vue: ['table', 'counters', 'deep', 'input'] }
const PLUGINS = { sygnal: () => [sygnal()], react: () => [react()], vue: () => [vue()] }

for (const fw of Object.keys(SCENARIOS)) {
  if (only && only !== fw) continue
  const input = Object.fromEntries(SCENARIOS[fw].map(s => [s, resolve(root, 'apps', fw, `${s}.html`)]))
  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    mode: 'production',
    base: './',
    plugins: PLUGINS[fw](),
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      outDir: resolve(outBase, fw),
      emptyOutDir: true,
      minify: profile ? false : 'esbuild',
      sourcemap: profile,
      rollupOptions: { input },
    },
  })
  console.log(`built ${fw}${profile ? ' (profile)' : ''}`)
}
