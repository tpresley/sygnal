// Typecheck acceptance step of the TypeScript tasks (18-21), identical in both
// arms: the hidden suite fails unless the project type-checks.
//
// It runs the trial's own TypeScript (`tsc`, as `npm run typecheck` does)
// against a config written next to this file. That config extends the trial's
// tsconfig.json (so the JSX setup stays the agent's) but pins `strict` and
// `noEmit` and covers all of src/, so loosening the trial's config does not
// switch the check off.
import { it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

it('typecheck: tsc --noEmit passes (strict)', () => {
  const require = createRequire(path.join(root, 'package.json'))
  const tsc = require.resolve('typescript/bin/tsc')
  const config = path.join(here, 'tsconfig.typecheck.json')
  fs.writeFileSync(
    config,
    JSON.stringify({
      extends: '../tsconfig.json',
      compilerOptions: { strict: true, noEmit: true },
      include: ['../src'],
    })
  )
  const res = spawnSync(process.execPath, [tsc, '-p', config], { cwd: root, encoding: 'utf8' })
  const errors = `${res.stdout || ''}${res.stderr || ''}`.trim().split('\n').filter((l) => /error TS\d+/.test(l))
  expect(errors.slice(0, 5).join('\n'), 'tsc reported errors').toBe('')
  expect(res.status, `tsc exited with ${res.status}:\n${res.stdout}${res.stderr}`).toBe(0)
}, 120000)
