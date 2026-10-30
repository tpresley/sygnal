// The host-side compile step for a component's source: JSX → __h/__frag calls, ESM → CommonJS
// (`require('sygnal')` is the kernel's whitelisted namespace). Trusted code over untrusted input:
// esbuild only parses and prints. A browser host would use the docs' live compiler or a worker.
import {createRequire} from 'node:module'
import {resolve} from 'node:path'

const esbuild = createRequire(resolve(import.meta.dirname, '../../../../package.json'))('esbuild')

export function compile(source) {
  return esbuild.transformSync(source, {loader: 'jsx', format: 'cjs', jsxFactory: '__h', jsxFragment: '__frag', target: 'es2020'}).code
}
