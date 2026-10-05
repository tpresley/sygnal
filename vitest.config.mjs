import { configDefaults, defineConfig } from 'vitest/config'

// The library's own tests (test/**). Everything else that may contain
// *.test.* files is excluded:
// - examples/**: each example's tests run with the example's own Vite/Vitest
//   config, plugins and toolchain (`npm run test:examples`, part of
//   `npm test`); this config has no sygnal() plugin, so example JSX would
//   compile to React.createElement here (G-021).
// - create-sygnal-app/**: template starter tests, run only in a scaffolded app.
// - sygnal-check/**, browser-tests/**, evals/**, docs/**: separate packages
//   with their own test runners.
// - .claude/**: agent worktrees (full repo copies) would otherwise be collected.
// - dev-plans/**: throwaway research experiments, each with its own package.json
//   and dependencies (run with `npm --prefix dev-plans/research/<dir> test`).
export default defineConfig({
  test: {
    // PLAN-4.6 R1-R4: SYGNAL_CORE=next runs the suites on the next core (test/setup-core.js)
    setupFiles: ['test/setup-core.js'],
    exclude: [
      ...configDefaults.exclude,
      'examples/**',
      'create-sygnal-app/**',
      'sygnal-check/**',
      'browser-tests/**',
      'evals/**',
      'docs/**',
      '.claude/**',
      'dev-plans/**',
    ],
  },
})
