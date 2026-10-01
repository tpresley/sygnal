import { defineConfig } from 'vitest/config'
import sygnal from 'sygnal/vite'

// Vitest only (Astro builds with astro.config.mjs). The sygnal plugin sets
// up JSX for Sygnal (also on Astro's Vite 7) and adds the runtime checks
// renderComponent reports.
export default defineConfig({
  plugins: [sygnal()],
})
