// test/api-plugin.test.js builds this app (root Vite) and greps the client bundle
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sygnal from '../../../dist/vite/plugin.mjs'

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist')
export default {
  plugins: [sygnal({ api: { contracts: ['src/contract.js'], functions: true } })],
  resolve: { alias: [{ find: /^sygnal\/api$/, replacement: dist + '/api.esm.js' }, { find: /^sygnal$/, replacement: dist + '/index.esm.js' }] },
  build: { minify: false },
  logLevel: 'error',
}
