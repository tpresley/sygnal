import { defineConfig } from 'vitest/config'
import sygnal from 'sygnal/vite'

// Vitest only (Astro builds with astro.config.mjs). The sygnal plugin adds
// the runtime checks renderComponent reports; Astro's Vite compiles JSX with
// esbuild, so point that at Sygnal too (as the sygnal/astro integration does).
export default defineConfig({
  plugins: [sygnal()],
  esbuild: { jsx: 'automatic', jsxImportSource: 'sygnal' },
})
