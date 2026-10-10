import { defineConfig } from 'vite'
import { socketTestServer } from './socket-server.js'
// PLAN-6 L-1: the mock inference server's SSE routes at /__p6 (the chat driver's browser tests)
import { mockSseMiddleware } from '../test/helpers/p6-mock-sse.js'
export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'sygnal' },
  plugins: [socketTestServer(), { name: 'p6-mock-sse', configureServer: (server) => { server.middlewares.use(mockSseMiddleware({ prefix: '/__p6' })) } }],
})
