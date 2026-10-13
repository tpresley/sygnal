import { defineConfig, searchForWorkspaceRoot } from 'vite'
import sygnal from 'sygnal/vite'
import { providersPlugin } from './server/providers.js'

export default defineConfig({
  plugins: [
    sygnal(),
    // dev only: the Kindo and TypeSafe proxies, which hold the keys, and the provider status
    !process.env.VITEST && providersPlugin(),
  ],
  // section 10 shows the source of the examples/mcp-kindo-agents MCP App
  server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), '../mcp-kindo-agents'] } },
})
