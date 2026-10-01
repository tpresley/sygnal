import { defineConfig } from 'vitest/config'

// Test files use the `.vtest.js` suffix on purpose. The repo root runs
// `vitest run` with no config, and its default include pattern
// (**/*.{test,spec}.?(c|m)[jt]s?(x)) would otherwise pick these files up
// without this package's dependencies (@babel/parser) installed.
export default defineConfig({
  test: {
    include: ['test/**/*.vtest.js'],
  },
})
