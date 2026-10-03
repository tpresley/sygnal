import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [sygnal()],
  test: {
    environment: 'jsdom',
    passWithNoTests: true,
  },
})
