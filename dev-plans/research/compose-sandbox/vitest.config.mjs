// The spike's tests: jsdom (renderComponent's dom: 'real' patches into it), and `sygnal` aliased to
// the repo's build (dist/), the one copy the sandbox spike's files and these tests share.
import {defineConfig} from 'vitest/config'
import {resolve} from 'node:path'

const repo = resolve(import.meta.dirname, '../../..')
export const shared = {
  resolve: {alias: [{find: /^sygnal$/, replacement: resolve(repo, 'dist/index.esm.js')}]},
}
// sygnal-check and the sandbox spike's QuickJS glue run as plain Node modules (not through Vite)
const deps = {server: {deps: {external: [/sygnal-check/, /research\/sandbox\//]}}}
export {deps}
export default defineConfig({
  ...shared,
  test: {...deps, environment: 'jsdom', setupFiles: ['test/setup.js'], include: ['test/*.test.js'], testTimeout: 20000, hookTimeout: 20000, fileParallelism: false},
})
