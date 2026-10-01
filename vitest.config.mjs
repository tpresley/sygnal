import { configDefaults, defineConfig } from 'vitest/config'

// The library's own tests (test/**). Everything else that may contain
// *.test.* files is excluded:
// - examples/**: each example's tests run with the example's own Vite/Vitest
//   config and toolchain (`npm run test:examples`, part of `npm test`). This
//   runner (Vitest 4.0 on Vite 7) doesn't apply the sygnal() plugin's JSX
//   settings, which target Vite 8, so example JSX would compile to
//   React.createElement here (G-021).
// - create-sygnal-app/**: template starter tests, run only in a scaffolded app.
// - sygnal-check/**, browser-tests/**, evals/**, docs/**: separate packages
//   with their own test runners.
export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      'examples/**',
      'create-sygnal-app/**',
      'sygnal-check/**',
      'browser-tests/**',
      'evals/**',
      'docs/**',
    ],
  },
})
