import { defineConfig } from 'vitest/config'
import sygnal from 'sygnal/vite'

// Unit tests only (the site itself is built by Astro, see astro.config.mjs)
export default defineConfig({
  plugins: [sygnal()],
  // This example runs on Astro's Vite 7, where the sygnal() plugin's JSX
  // settings (Vite 8 `oxc`) don't apply; configure esbuild the way the
  // sygnal/astro integration does, so the tests need no React shim.
  esbuild: { jsx: 'automatic', jsxImportSource: 'sygnal' },
  test: {
    include: ['src/**/*.test.{js,jsx}'],
  },
})
