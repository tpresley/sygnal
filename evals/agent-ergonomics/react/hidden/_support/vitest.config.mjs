// Vitest config for the React-arm hidden acceptance tests.
// score.mjs / verify.mjs copy this file into <trial>/__hidden__/ and run:
//   npx vitest run --config __hidden__/vitest.config.mjs
// It deliberately ignores the trial's own vite.config.js.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: path.resolve(here, '..'),
  plugins: [react()],
  test: {
    include: ['__hidden__/**/*.hidden.{js,jsx}'],
    environment: 'jsdom',
    testTimeout: 10000,
    fileParallelism: false,
  },
})
