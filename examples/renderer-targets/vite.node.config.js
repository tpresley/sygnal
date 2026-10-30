// The two Node entries (the terminal app and the MCP server), built with the same JSX setup as
// the web app (Sygnal is bundled in: the file: link is a symlink, which Vite inlines).
import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [sygnal()],
  build: {
    ssr: true,
    outDir: 'dist-node',
    emptyOutDir: true,
    rollupOptions: {
      input: { terminal: 'src/terminal.jsx', mcp: 'src/mcp.jsx' },
      output: { entryFileNames: '[name].js' },
    },
  },
})
