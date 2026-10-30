import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'
import { serverFunctions } from './lib/vite-server-functions.ts'

export default defineConfig({
  plugins: [sygnal(), serverFunctions()],
  test: { include: ['test/**/*.test.{ts,tsx}'], environment: 'jsdom', globalSetup: ['test/fn-dev-server.ts'] },
})
