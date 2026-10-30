import { defineConfig } from 'vitest/config'
import sygnal from 'sygnal/vite'
import { apiDevServer } from './server/vite.ts'

export default defineConfig({
  plugins: [sygnal(), apiDevServer()],
  root: 'src',
  build: { outDir: '../dist', emptyOutDir: true },
  test: { root: '.', include: ['src/**/*.test.{ts,tsx}'] },
})
