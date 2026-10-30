import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// The browser demo: index.html → app/main.tsx. Sygnal is src/ bundled once by build-demo.mjs
// (core and JSX runtime in one module)
const demo = fileURLToPath(new URL('./dist/sygnal-demo.js', import.meta.url))

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: { alias: [{ find: /^sygnal(\/jsx-runtime|\/jsx-dev-runtime)?$/, replacement: demo }] },
  esbuild: { jsx: 'automatic', jsxImportSource: 'sygnal' },
})
