import { defineConfig } from 'vite'
import { socketTestServer } from './socket-server.js'
export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'sygnal' },
  plugins: [socketTestServer()],
})
