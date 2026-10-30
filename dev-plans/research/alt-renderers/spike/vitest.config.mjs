import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('../../../../src/', import.meta.url))

// The spike runs against src/ (not dist/), so the one core change it needs (processForm) is the
// one under test. todomvc's own files are imported as they are.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: [
      { find: /^sygnal\/jsx-runtime$/, replacement: src + 'jsx-runtime.ts' },
      { find: /^sygnal\/jsx-dev-runtime$/, replacement: src + 'jsx-dev-runtime.ts' },
      { find: /^sygnal$/, replacement: src + 'index.ts' },
    ],
  },
  esbuild: { jsx: 'automatic', jsxImportSource: 'sygnal' },
  test: { include: ['**/*.test.{ts,tsx}'], environment: 'node' },
})
