import { defineConfig } from 'vite'

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'sygnal',
  },
  test: {
    include: ['src/**/*.test.{js,jsx}'],
  },
})
