import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'
import { resolve } from 'node:path'

// The sygnal/vite plugin: JSX, dev diagnostics, and (P-2b) the HMR self-accept it appends to
// src/elements.js because that module calls defineElement() at the top level.
// P2_PLAIN_ESBUILD=1 uses plain esbuild JSX instead (no plugin, so no HMR accept: hmr.mjs
// then expects a full reload and is skipped).
const here = new URL('.', import.meta.url).pathname
const plain = process.env.P2_PLAIN_ESBUILD === '1'
export default defineConfig({
  root: here,
  plugins: plain ? [] : [sygnal()],
  esbuild: plain ? { jsx: 'automatic', jsxImportSource: 'sygnal' } : undefined,
  build: { rollupOptions: { input: { react: resolve(here, 'index.html'), plain: resolve(here, 'plain.html') } } },
  logLevel: 'warn',
})
