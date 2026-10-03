// Production build of the browser-tests/perf scenario apps (Sygnal, React 19, Vue 3.5).
// The sources live in browser-tests/perf/apps; React and Vue come from this
// package's devDependencies (aliased, because browser-tests has no React or Vue),
// Sygnal from browser-tests' own `sygnal` link (the repo's dist/).
//
//   npm --prefix benchmarks run build:perf           → browser-tests/perf/dist
//   npm --prefix benchmarks run build:perf:profile   → browser-tests/perf/dist-profile (unminified)
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const apps = here('../browser-tests/perf/apps/')
const profile = !!process.env.PERF_PROFILE

export default defineConfig({
  root: apps,
  base: './',
  logLevel: 'warn',
  plugins: [vue()],
  // Sygnal JSX by default; react.jsx switches with a /** @jsxImportSource react */ pragma.
  esbuild: { jsx: 'automatic', jsxImportSource: 'sygnal' },
  resolve: {
    alias: {
      'react-dom': here('./node_modules/react-dom'),
      react: here('./node_modules/react'),
      vue: here('./node_modules/vue/dist/vue.runtime.esm-bundler.js'),
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    __VUE_OPTIONS_API__: 'false',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
  build: {
    outDir: here(profile ? '../browser-tests/perf/dist-profile' : '../browser-tests/perf/dist'),
    emptyOutDir: true,
    minify: !profile,
    sourcemap: profile,
    modulePreload: false,
    rollupOptions: {
      input: {
        'sygnal-collection': apps + 'sygnal-collection.html',
        'sygnal-map': apps + 'sygnal-map.html',
        react: apps + 'react.html',
        vue: apps + 'vue.html',
      },
    },
  },
})
