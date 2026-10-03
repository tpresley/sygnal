import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'

// One classic (IIFE) script at dist/main.js, which index.html loads the way
// js-framework-benchmark serves every framework: /frameworks/<type>/<name>/index.html.
export default defineConfig({
  plugins: [sygnal()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      input: 'src/index.jsx',
      output: { format: 'iife', entryFileNames: 'main.js' },
    },
  },
})
