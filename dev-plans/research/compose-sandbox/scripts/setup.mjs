// What `npm test` needs before vitest runs, installed or built only when missing:
// the root build (dist/), the sandbox spike's packages (QuickJS, pinned there) and its guest
// kernel (dist/guest.js), and sygnal-check's parser (the pre-mount check).
import {existsSync} from 'node:fs'
import {resolve} from 'node:path'
import {execSync} from 'node:child_process'

const here = resolve(import.meta.dirname, '..'), repo = resolve(here, '../../..'), sandbox = resolve(here, '../sandbox')
const run = (cmd) => { console.log('[setup] ' + cmd); execSync(cmd, {stdio: 'inherit', cwd: repo}) }
if (!existsSync(resolve(repo, 'node_modules/vitest'))) run('npm ci')
if (!existsSync(resolve(repo, 'dist/index.esm.js'))) run('npm run build')
if (!existsSync(resolve(sandbox, 'node_modules/quickjs-emscripten-core'))) run('npm ci --prefix dev-plans/research/sandbox')
if (!existsSync(resolve(sandbox, 'dist/guest.js'))) run('node dev-plans/research/sandbox/build-guest.mjs')
if (!existsSync(resolve(repo, 'sygnal-check/node_modules/@babel/parser'))) run('npm ci --prefix sygnal-check')
