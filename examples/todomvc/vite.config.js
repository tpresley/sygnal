import { defineConfig } from 'vite';


// https://vitejs.dev/config/

export default defineConfig({
   esbuild: {
     jsxFactory: `jsx`,
     jsxInject: `import { jsx } from 'sygnal/jsx'`,
   },
   build: {
    outDir: './dist',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    force: true
  },
   base: ""
});
