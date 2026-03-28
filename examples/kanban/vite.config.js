import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [sygnal()],
  test: {
    include: ['src/**/*.test.{js,jsx}'],
  },
})
