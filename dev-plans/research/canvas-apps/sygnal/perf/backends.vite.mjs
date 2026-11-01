import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { alias } from '../vitest.config.mjs'

// the backend comparison page (perf/backends.ts), built on its own: dist-backends/
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: { alias },
  esbuild: { jsx: 'automatic', jsxImportSource: 'sygnal' },
  build: { outDir: '../dist-backends', emptyOutDir: true, target: 'es2022', rollupOptions: { input: fileURLToPath(new URL('./backends.html', import.meta.url)) } },
})
