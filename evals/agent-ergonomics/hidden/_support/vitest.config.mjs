// Vitest config for the Sygnal-arm hidden acceptance tests.
// score.mjs / verify.mjs copy this file into <trial>/__hidden__/ and run:
//   npx vitest run --config __hidden__/vitest.config.mjs
// It deliberately ignores the trial's own vite.config.js so that whatever the
// agent did to its config cannot change how acceptance tests run.
import { defineConfig } from 'vitest/config'
import sygnal from 'sygnal/vite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: path.resolve(here, '..'),
  plugins: [sygnal({ disableHmr: true })],
  test: {
    include: ['__hidden__/**/*.hidden.{js,jsx}'],
    environment: 'jsdom',
    testTimeout: 10000,
    fileParallelism: false,
  },
})
