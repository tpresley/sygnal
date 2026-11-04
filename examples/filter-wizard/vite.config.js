import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [sygnal()],
  test: {
    include: ['src/**/*.test.{js,jsx}'],
    // the tests render into a real DOM (dom: 'real'): links, the leave dialog, focus
    environment: 'jsdom',
  },
})
