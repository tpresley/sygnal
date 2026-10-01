import { defineConfig } from 'vitest/config'
import sygnal from 'sygnal/vite'

// Unit tests only. The playground app itself (vite.config.js) compiles the
// editor's code with @babel/standalone at runtime, so it doesn't use the plugin.
export default defineConfig({
  plugins: [sygnal()],
  test: {
    include: ['src/**/*.test.{js,jsx}'],
  },
})
