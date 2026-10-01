/**
 * Drift guard: every code sygnal-check uses must exist in the runtime
 * registry (src/extra/diagnostics/codes.ts in the sygnal repo) with the
 * same title. Read as text so the package has no runtime dependency on
 * sygnal.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CODES } from '../src/codes.js'
import { coreRules, strictRules } from '../src/rules/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const registryPath = path.resolve(here, '../../src/extra/diagnostics/codes.ts')

function readRuntimeTitles() {
  const src = fs.readFileSync(registryPath, 'utf8')
  const block = /export const CODE_TITLES[^=]*=\s*\{([\s\S]*?)\n\}/.exec(src)
  if (!block) throw new Error('CODE_TITLES not found in ' + registryPath)
  const titles = {}
  const re = /^\s*(SYG\d{3})\s*:\s*(['"])((?:\\.|(?!\2).)*)\2\s*,?\s*$/gm
  let m
  while ((m = re.exec(block[1]))) titles[m[1]] = m[3].replace(/\\(.)/g, '$1')
  return titles
}

describe('code table', () => {
  const runtime = readRuntimeTitles()

  it('parses the runtime registry', () => {
    expect(Object.keys(runtime).length).toBeGreaterThan(5)
  })

  for (const [code, info] of Object.entries(CODES)) {
    it(`${code} exists in the runtime registry with the same title`, () => {
      expect(runtime[code], `${code} missing from src/extra/diagnostics/codes.ts`).toBeDefined()
      expect(info.title).toBe(runtime[code])
    })
  }

  it('every code a rule declares is in the package table', () => {
    for (const rule of [...coreRules, ...strictRules]) {
      for (const code of rule.codes) expect(CODES[code], `${rule.id} uses ${code}`).toBeDefined()
    }
  })
})
