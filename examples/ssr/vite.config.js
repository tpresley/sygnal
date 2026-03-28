import { defineConfig } from 'vite'
import sygnal from 'sygnal/vite'

export default defineConfig({
  plugins: [sygnal({ disableHmr: true })],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: 'src/client.js',
      output: {
        entryFileNames: 'client.js',
        format: 'es',
      },
    },
  },
})
