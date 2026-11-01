import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('../../../../src/', import.meta.url))

// As the canvas-three spike: the app and lib/canvas run against src/ (no build needed)
export const alias = [
  { find: /^sygnal\/jsx-runtime$/, replacement: src + 'jsx-runtime.ts' },
  { find: /^sygnal\/jsx-dev-runtime$/, replacement: src + 'jsx-dev-runtime.ts' },
  { find: /^sygnal\/worker\/page$/, replacement: src + 'worker-page.ts' },
  { find: /^sygnal\/worker$/, replacement: src + 'worker.ts' },
  { find: /^sygnal\/host$/, replacement: src + 'host.ts' },
  { find: /^sygnal$/, replacement: src + 'index.ts' },
]

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: { alias },
  esbuild: { jsx: 'automatic', jsxImportSource: 'sygnal' },
  test: { include: ['test/**/*.test.{ts,tsx}'], environment: 'node' },
})
