// CV-0: every example's own test suite with compiled views. For each examples/<name> with a vite
// config and tests, writes a wrapper config next to it that loads the example's config and adds
// sygnal({ compile: true })'s compile plugin in front of the example's own plugins (so its other
// options stay), runs its vitest, and removes the wrapper.
//   node dev-plans/research/compile-wasm/test-examples-compiled.mjs [name ...]
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const repo = path.resolve(import.meta.dirname, '../../..')
const only = process.argv.slice(2)
const results = []
for (const name of fs.readdirSync(path.join(repo, 'examples')).sort()) {
  if (only.length && !only.includes(name)) continue
  const dir = path.join(repo, 'examples', name)
  const cfg = ['vite.config.js', 'vite.config.mjs', 'vite.config.ts', 'vitest.config.js', 'vitest.config.mjs', 'vitest.config.ts'].find(f => fs.existsSync(path.join(dir, f)))
  if (!cfg || !fs.existsSync(path.join(dir, 'node_modules', 'vitest'))) { results.push([name, 'skipped (no config or not installed)']); continue }
  // compile needs Vite 8: an example on an older Vite would pass without compiling anything
  const vite = JSON.parse(fs.readFileSync(path.join(dir, 'node_modules', 'vite', 'package.json'), 'utf8')).version
  if (parseInt(vite) < 8) { results.push([name, `skipped (Vite ${vite})`]); continue }
  const wrapper = path.join(dir, '.cv-vitest.config.mjs')
  fs.writeFileSync(wrapper, `import base from './${cfg}'
import sygnal from 'sygnal/vite'
const c = typeof base == 'function' ? await base({ command: 'serve', mode: 'test' }) : base
const [compile] = sygnal({ compile: true })
export default { ...c, plugins: [compile, ...(c.plugins || [])] }
`)
  try {
    const r = spawnSync('npx', ['vitest', 'run', '--config', wrapper], { cwd: dir, encoding: 'utf8', env: { ...process.env, CI: '1' } })
    const out = (r.stdout || '') + (r.stderr || '')
    const tests = out.match(/Tests\s+(.*)/)?.[1]?.trim() ?? (r.status ? 'failed to run' : 'no tests')
    results.push([name, `${r.status ? 'FAIL' : 'ok'}  ${tests}`])
    if (r.status) fs.writeFileSync(path.join(process.env.CW_OUT || '/tmp', `cv-${name}.log`), out)
  } finally { fs.rmSync(wrapper, { force: true }) }
}
for (const [n, r] of results) console.log(n.padEnd(26), r)
process.exit(results.some(r => r[1].startsWith('FAIL')) ? 1 : 0)
