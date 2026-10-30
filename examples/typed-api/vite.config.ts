import { defineConfig } from 'vitest/config'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [
    sygnal({
      api: {
        // dev: /api/* goes to this module's default export (a production server mounts it too)
        handler: 'server/handler.ts',
        // the client gets the contract's routes and its hash, made at build time: no zod in the bundle
        contracts: ['src/contract.ts'],
        // function-first: src/**/*.server.ts become client stubs (server/handler.ts mounts them)
        functions: true,
      },
    }),
  ],
  test: { include: ['src/**/*.test.{ts,tsx}'] },
})
