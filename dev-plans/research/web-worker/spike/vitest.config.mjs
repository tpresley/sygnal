import {defineConfig} from 'vitest/config'
import {fileURLToPath} from 'node:url'

const src = fileURLToPath(new URL('../../../../src/', import.meta.url))

// The worker target and the bridge in one jsdom process, against src/ (no build needed)
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: [
      {find: /^sygnal\/jsx-runtime$/, replacement: src + 'jsx-runtime.ts'},
      {find: /^sygnal\/jsx-dev-runtime$/, replacement: src + 'jsx-dev-runtime.ts'},
      {find: /^sygnal\/host$/, replacement: src + 'host.ts'},
      {find: /^sygnal$/, replacement: src + 'index.ts'},
    ],
  },
  esbuild: {jsx: 'automatic', jsxImportSource: 'sygnal'},
  test: {include: ['**/*.test.{ts,tsx}'], exclude: ['**/dist/**', '**/node_modules/**'], environment: 'jsdom'},
})
