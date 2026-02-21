import { defineConfig } from 'vite';

// https://vitejs.dev/config/

export default defineConfig({
  root: 'src',
  base: '',
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true
  },
  server: {
    port: 5173
  },
  esbuild: {
    jsxFactory: `jsx`,
    jsxInject: `import { jsx } from 'sygnal/jsx'`,
  }
});
