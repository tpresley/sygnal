// test/sandbox-build.test.js builds this app (root Vite): sygnal/vite resolves
// 'sygnal/sandbox/kernel?raw' to the kernel built from the installed packages, and Vite bundles
// sygnal/sandbox's default worker (new Worker(new URL(...))) with QuickJS and its .wasm
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sygnal from '../../../dist/vite/plugin.mjs'

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist')
export default {
  plugins: [sygnal()],
  resolve: { alias: [{ find: /^sygnal\/sandbox$/, replacement: dist + '/sandbox.esm.js' }, { find: /^sygnal$/, replacement: dist + '/index.esm.js' }] },
  build: { minify: false, target: 'es2022' },
  worker: { format: 'es' },
  logLevel: 'error',
}
