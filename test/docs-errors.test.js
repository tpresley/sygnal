import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { render, readExplanations, TARGET, EXAMPLES } from '../scripts/gen-error-docs.mjs'
import { listCodes } from '../src/extra/diagnostics/codes'

// The docs error reference (docs/src/content/docs/reference/errors.md) is
// generated from sygnal-check/explanations.json. Regenerate it with
// `node scripts/gen-error-docs.mjs` after changing the explanations.
describe('docs error reference', () => {
  const explanations = readExplanations()
  const page = fs.readFileSync(TARGET, 'utf8')

  it('is up to date with sygnal-check/explanations.json', () => {
    expect(page === render(explanations), 'reference/errors.md is out of date: run `node scripts/gen-error-docs.mjs`').toBe(true)
  })

  it('has a #sygNNN anchor heading for every code the docs links point to', () => {
    for (const e of explanations) {
      expect(page).toContain(`\n### ${e.code}\n`)
      expect(e.docsUrl).toBe(`https://sygnal.js.org/reference/errors#${e.code.toLowerCase()}`)
    }
  })

  it('covers every code in the runtime registry', () => {
    const documented = new Set(explanations.map(e => e.code))
    const missing = listCodes().map(c => c.code).filter(c => !documented.has(c))
    expect(missing).toEqual([])
  })

  it('only has examples for known codes', () => {
    const documented = new Set(explanations.map(e => e.code))
    expect(Object.keys(EXAMPLES).filter(c => !documented.has(c))).toEqual([])
  })
})
