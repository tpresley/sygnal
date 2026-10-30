import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('../../../../src/', import.meta.url))
const here = fileURLToPath(new URL('.', import.meta.url))

// nativeHost.js and the Sygnal components, run in jsdom with react-native stubbed onto react-dom
export default defineConfig({
  root: here,
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: here + 'test/react-native-stub.jsx' },
      { find: /^sygnal\/jsx-runtime$/, replacement: src + 'jsx-runtime.ts' },
      { find: /^sygnal\/jsx-dev-runtime$/, replacement: src + 'jsx-dev-runtime.ts' },
      { find: /^sygnal\/host$/, replacement: src + 'host.ts' },
      { find: /^sygnal$/, replacement: src + 'index.ts' },
    ],
  },
  esbuild: { jsx: 'automatic' },
  test: { include: ['test/**/*.test.{js,jsx}'], environment: 'jsdom' },
})
