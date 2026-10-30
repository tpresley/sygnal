// Builds the todomvc and stream pages (main thread, worker) into spike/dist. Run with the todomvc
// example's Vite: node examples/todomvc/node_modules/vite/bin/vite.js build --config <this file>
import {fileURLToPath} from 'node:url'
import {resolve} from 'node:path'
import sygnal from '../../../../dist/vite/plugin.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const dist = (f) => resolve(here, '../../../../dist', f)
// one copy of the core for the app, the host kit and the spike (the app resolves 'sygnal' through
// examples/todomvc/node_modules, the spike through these aliases: both land on the root dist/)
const alias = [
  {find: /^sygnal$/, replacement: dist('index.esm.js')},
  {find: /^sygnal\/host$/, replacement: dist('host.esm.js')},
  {find: /^sygnal\/jsx-runtime$/, replacement: dist('jsx-runtime.esm.js')},
  {find: /^sygnal\/jsx-dev-runtime$/, replacement: dist('jsx-dev-runtime.esm.js')},
]

export default {
  root: here,
  base: './',
  resolve: {alias},
  plugins: [sygnal({check: false})],
  worker: {format: 'es', plugins: () => [sygnal({check: false})]},
  build: {
    outDir: resolve(here, 'dist'),
    emptyOutDir: true,
    minify: true,
    rollupOptions: {input: Object.fromEntries(['todomvc/main', 'todomvc/worker', 'stream/main', 'stream/worker'].map((p) => [p.replace('/', '-'), resolve(here, p + '.html')]))},
  },
  logLevel: 'warn',
}
