// PLAN-2 2-R (R2-8): scripts/size-gate.mjs rejects a bad --budget instead of passing
// (Number('abc') is NaN, and `size > NaN` is false). It exits before building anything.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const script = path.resolve('scripts/size-gate.mjs')
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })

describe('R2-8: size-gate --budget validation', () => {
  for (const bad of [['--budget', 'abc'], ['--budget'], ['--budget', '0'], ['--budget', '-5'], ['--budget', 'Infinity']]) {
    it(`exits 2 for ${bad.join(' ')}`, () => {
      const r = run(...bad)
      expect(r.status).toBe(2)
      expect(r.stderr).toMatch(/--budget must be a positive number of bytes/)
    })
  }
})
