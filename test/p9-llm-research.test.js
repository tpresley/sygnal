// PLAN-9 B-3: compose.llm() reproduces the research's request (exact system prompt and schema on
// the research catalogs) and its numbers on qwen3:8b's recorded answers (no network):
// base 11/11, a1 dashboard 15/15, a2 params 20/20, 0 invalid.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { llm, systemPrompt, layoutSchema } from '../src/extra/ai/compose/llm.ts'
import { researchSets, str, want, names } from './p9-llm-helpers.js'

const R = new URL('../dev-plans/research/ai-compose/llm/', import.meta.url)
const research = await import(new URL('llm-composer.mjs', R))
const { BASE, EXT } = await import(new URL('evals/cases.mjs', R))
const { toCatalog } = await import(new URL('evals/a2.mjs', R))
const { OPS } = await import(new URL('../params-edits/evals/catalogs.mjs', R))
const { fromResearch } = await import('./p9-llm-helpers.js')
const sets = await researchSets()
const answers = Object.fromEntries(JSON.parse(readFileSync(new URL('frontier/qwen3-8b-answers.json', R), 'utf8')).answers.map((a) => [a.id, a.output]))

describe('the research request, exactly', () => {
  for (const [name, rc] of [['base', BASE], ['ext (enum + text params, section)', EXT], ['a2 OPS (enum params)', toCatalog(OPS)]]) {
    it(`${name}: the same system prompt and schema as llm-composer.mjs (tree+plan and tree)`, () => {
      const cat = fromResearch(rc)
      expect(systemPrompt(cat, {})).toBe(research.systemPrompt(rc, 'tree+plan'))
      expect(layoutSchema(cat, {})).toEqual(research.layoutSchema(rc, 'tree+plan'))
      expect(systemPrompt(cat, {}, { plan: false })).toBe(research.systemPrompt(rc, 'tree'))
      expect(layoutSchema(cat, {}, { plan: false })).toEqual(research.layoutSchema(rc, 'tree'))
    })
  }
})

describe("qwen3:8b's recorded answers through reply()", () => {
  for (const { set, cases } of sets) {
    it(`${set}: every case exact, none invalid`, () => {
      const b = llm()
      let exact = 0, invalid = 0
      const misses = []
      for (const k of cases) {
        const { pending } = b.start({ catalog: k.catalog, state: {}, prompt: k.prompt, previous: null, names })
        const r = b.reply({ catalog: k.catalog, state: {}, pending, reply: { text: answers[k.id] } })
        if (r.error) { invalid++; continue }
        const got = r.layout ? str(k.catalog, r.layout) : ''
        if (got === want(k.catalog, k.want)) exact++
        else misses.push(`${k.id}: ${got} ≠ ${want(k.catalog, k.want)}`)
      }
      expect(misses).toEqual([])
      expect(invalid).toBe(0)
      expect(exact).toBe(cases.length)
    })
  }
})
