// ARM=sygnal|react APP_DIR=<materialized app> VARIANT=<change id> npx vitest run --config <this file>
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const here = import.meta.dirname
const root = resolve(here, '../../../../..')
const arm = process.env.ARM ?? 'sygnal'
const app = resolve(process.env.APP_DIR ?? resolve(here, '../apps', arm))
const importSource = arm === 'sygnal' ? 'sygnal' : 'react'

export default defineConfig({
  root,
  esbuild: { jsx: 'automatic', jsxImportSource: importSource, jsxDev: false },
  oxc: { jsx: { runtime: 'automatic', importSource, development: false } },
  resolve: {
    alias: [
      { find: '@app', replacement: app },
      { find: '@mount', replacement: resolve(here, arm === 'sygnal' ? 'mount-sygnal.js' : 'mount-react.jsx') },
      // the materialized apps live outside the repo
      { find: /^(react|react-dom)($|\/.*)/, replacement: resolve(root, 'node_modules/$1$2') },
      { find: /^sygnal$/, replacement: resolve(root, 'dist/index.esm.js') },
      { find: /^sygnal\/jsx-runtime$/, replacement: resolve(root, 'dist/jsx-runtime.esm.js') },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['dev-plans/research/thesis/review-this-change/checks/*.test.js'],
    exclude: [],
    testTimeout: 5000,
  },
})
