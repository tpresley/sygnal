import { defineConfig } from 'vitest/config'
import sygnal from 'sygnal/vite'

// Unit tests only (the site itself is built by Astro, see astro.config.mjs)
export default defineConfig({
  plugins: [sygnal()],
  test: {
    include: ['src/**/*.test.{js,jsx}'],
  },
})
