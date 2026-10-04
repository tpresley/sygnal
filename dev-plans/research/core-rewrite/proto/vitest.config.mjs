// Spike 0-S: the prototype's behaviour tests (not part of npm test: the root config excludes dev-plans/**).
//   npx vitest run --config dev-plans/research/core-rewrite/proto/vitest.config.mjs
// `sygnal` resolves to the built dist/ (npm run build first), as in the benchmark apps.
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../../..')
export default defineConfig({
  root,
  cacheDir: process.env.P46_CACHE_DIR || resolve(root, 'node_modules/.vite-p46'),
  resolve: { alias: [{ find: /^sygnal$/, replacement: resolve(root, 'dist/index.esm.js') }] },
  test: {
    include: ['dev-plans/research/core-rewrite/proto/*.test.js'],
    environment: 'jsdom',
  },
})
