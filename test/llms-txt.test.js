// 3E/R10a: llms.txt ships in the npm package (repo root) and on the docs site
// (docs/public/llms.txt). The two copies must be byte-identical, and the file stays
// within its 250-line budget.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('llms.txt', () => {
  const pkg = readFileSync(resolve(root, 'llms.txt'))
  const site = readFileSync(resolve(root, 'docs/public/llms.txt'))

  it('docs/public/llms.txt is byte-identical to llms.txt (copy it after editing)', () => {
    expect(site.equals(pkg)).toBe(true)
  })

  it('is at most 250 lines', () => {
    expect(pkg.toString('utf8').replace(/\n$/, '').split('\n').length).toBeLessThanOrEqual(250)
  })
})
