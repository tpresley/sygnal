/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [sygnal()],
  // the app runs in a module worker: its JSX goes through the same plugin
  worker: { format: 'es', plugins: () => [sygnal({ check: false })] },
  build: { outDir: './dist', emptyOutDir: true },
  // (fs.allow: the test compares the app's files with examples/todomvc's)
  server: { port: 5174, fs: { allow: ['.', '../todomvc'] } },
  base: '',
  test: {
    include: ['**/*.test.{ts,tsx}'],
    // the bridge applies the worker's ops to a real (jsdom) DOM
    environment: 'jsdom',
  },
})
