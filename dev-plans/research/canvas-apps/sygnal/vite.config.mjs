import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { alias } from './vitest.config.mjs'

// The app: index.html → app/main.tsx, against src/ (as the tests). `?shapes=10000` starts with a
// stress document, `?impl=today` runs the hand-written canvas (app/today/), `?bench=backends` the
// backend comparison page (perf/backends.ts).
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: { alias },
  esbuild: { jsx: 'automatic', jsxImportSource: 'sygnal' },
  server: { fs: { allow: [fileURLToPath(new URL('../../../../', import.meta.url))] } },
  build: { outDir: 'dist', target: 'es2022' },
})
