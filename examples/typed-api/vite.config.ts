import { defineConfig } from 'vitest/config'
import sygnal from 'sygnal/vite'
import { apiDevServer } from './server/vite.ts'

export default defineConfig({
  plugins: [sygnal(), apiDevServer()],
  test: { include: ['src/**/*.test.{ts,tsx}'] },
})
