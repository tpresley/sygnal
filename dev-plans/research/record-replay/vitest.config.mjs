import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../../../dist/', import.meta.url))

// The record/replay spike runs against the built package (npm run build at the repo root).
// The examples' own .jsx / .tsx files are imported as they are (their package.json links
// sygnal with file:../..; aliased here so the examples need no install), compiled with sygnal's
// automatic JSX runtime.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: [
      { find: /^sygnal\/jsx-runtime$/, replacement: dist + 'jsx-runtime.esm.js' },
      { find: /^sygnal\/jsx-dev-runtime$/, replacement: dist + 'jsx-dev-runtime.esm.js' },
      { find: /^sygnal\/devtools$/, replacement: dist + 'devtools.esm.js' },
      { find: /^sygnal$/, replacement: dist + 'index.esm.js' },
    ],
  },
  esbuild: { jsx: 'automatic', jsxImportSource: 'sygnal' },
  test: { include: ['**/*.test.{js,jsx,ts,tsx}'], environment: 'jsdom', testTimeout: 30000 },
})
