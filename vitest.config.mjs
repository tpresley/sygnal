import { configDefaults, defineConfig } from 'vitest/config'

// The library's own tests. The examples' tests run separately, each with the
// example's own Vite/Vitest config and toolchain (`npm run test:examples`,
// part of `npm test`): this runner (Vitest 4.0 on Vite 7) doesn't apply the
// sygnal() plugin's JSX settings, which target Vite 8, so example JSX would
// compile to React.createElement here (G-021).
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'examples/**'],
  },
})
