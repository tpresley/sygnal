/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [sygnal({ vitestSetup: false })],
  build: {
    outDir: './dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
  base: '',
  test: {
    include: ['**/*.test.{ts,tsx}'],
    // processForm() reads the submitted <form> with FormData, which needs a DOM
    environment: 'jsdom',
    setupFiles: ['./test-setup.ts'],
  },
})
