import { defineConfig } from 'vite'

export default defineConfig({
  esbuild: {
    jsxFactory: 'createElement',
    jsxFragment: 'Fragment',
    jsxInject: `import { createElement, Fragment } from 'sygnal'`,
  },
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
