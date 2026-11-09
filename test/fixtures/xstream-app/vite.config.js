// XSTREAM_APP: JSON options; `plugin` for sygnal(), `xstream`: a path to alias xstream to
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sygnal from 'sygnal/vite'

const dir = path.dirname(fileURLToPath(import.meta.url))
const { plugin, xstream } = JSON.parse(process.env.XSTREAM_APP || '{}')

export default {
  plugins: [sygnal(plugin)],
  resolve: { alias: xstream ? [{ find: /^xstream$/, replacement: xstream }] : [] },
  logLevel: 'error',
  build: { minify: false, rollupOptions: { input: path.join(dir, 'src/main.js'), output: { entryFileNames: 'app.mjs' } } },
}
