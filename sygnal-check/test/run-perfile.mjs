// The suite again with SYGNAL_CHECK_PERFILE=1 (run.js): every runRules() goes through the per-file
// split of incremental checking, so each rule test also checks that a `perFile` rule's per-file
// runs add up to its whole run (a rule marked perFile that reads other files' findings fails here).
// `npm test` runs it after the plain run; extra arguments go to vitest.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const vitest = path.join(root, 'node_modules', 'vitest', 'vitest.mjs')
// (SYGNAL_CHECK_LATENCY cleared: the latency gates time the plain run)
const env = { ...process.env, SYGNAL_CHECK_PERFILE: '1', SYGNAL_CHECK_LATENCY: '' }
const r = spawnSync(process.execPath, [vitest, 'run', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit', env })
process.exit(r.status ?? 1)
