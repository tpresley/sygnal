import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// An MCP App is one HTML resource: the host loads it into a sandboxed iframe with no other files,
// so the build inlines the scripts and styles into dist/index.html (served by server/server.js).
export default defineConfig({
  plugins: [sygnal(), viteSingleFile()],
})
