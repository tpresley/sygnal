import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { alias } from './vitest.config.mjs'

// The browser demo: index.html → app/main.tsx, against src/ (as the tests; src/cycle/dom/index.ts
// re-exports its types with `export type`, so Vite's per-file transform serves it)
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // three is an optional peer of sygnal, so src/ can't resolve it from the repo root: use this folder's copy
  resolve: { alias, dedupe: ['three'] },
  esbuild: { jsx: 'automatic', jsxImportSource: 'sygnal' },
  server: { fs: { allow: [fileURLToPath(new URL('../../../', import.meta.url))] } },
})
