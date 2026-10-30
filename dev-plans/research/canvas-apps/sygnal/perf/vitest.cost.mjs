import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { alias } from '../vitest.config.mjs'
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  resolve: { alias },
  esbuild: { jsx: 'automatic', jsxImportSource: 'sygnal' },
  test: { include: ['perf/**/*.cost.ts'], environment: 'node' },
})
