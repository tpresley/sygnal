// 3E/R10a, restructured by the llms-context spike (dev-plans/research/llms-context): the agent
// context is a core (llms.txt) plus topic files (llms/<topic>.md) that the core lists; npm ships
// them all, the docs site serves copies, and the skill's references are the same topic files.
// scripts/build-llms.mjs writes every copy (and llms-full.txt); this suite fails when one is stale.
//
// Budgets are bytes, not lines (the old 322-line cap was met by lengthening lines). The core is
// what every agent reads in full, so it has the tight budget; a topic file is read on demand, so
// it only has to stay one comfortable read.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stale, topics } from '../scripts/build-llms.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CORE_BUDGET = 65_100   // bytes of llms.txt (63,963 at the spike; raised from 64,500 for Temper item 9, 2026-10; from 65,000 for the UI sweep round 2: SYG118 + widget form fields)
const TOPIC_BUDGET = 16_000  // bytes per llms/<topic>.md

describe('llms.txt and its topic files', () => {
  const core = readFileSync(resolve(root, 'llms.txt'))

  it('every copy is current (node scripts/build-llms.mjs)', () => {
    expect(stale()).toEqual([])
  })

  it(`the core is at most ${CORE_BUDGET} bytes`, () => {
    expect(core.length).toBeLessThanOrEqual(CORE_BUDGET)
  })

  it('the core lists every topic file, and every listed one exists', () => {
    const files = readdirSync(resolve(root, 'llms')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3))
    expect(topics().sort()).toEqual(files.sort())
    expect(topics().length).toBeGreaterThan(0)
  })

  it(`each topic file is at most ${TOPIC_BUDGET} bytes and says it assumes the core`, () => {
    for (const t of topics()) {
      const text = readFileSync(resolve(root, `llms/${t}.md`), 'utf8')
      expect(Buffer.byteLength(text), t).toBeLessThanOrEqual(TOPIC_BUDGET)
      expect(text, t).toMatch(/^# Sygnal: /)
      expect(text, t).toContain('It assumes the core')
    }
  })

  it('the core points at each topic where its material was (a pointer in the body, not only the index)', () => {
    const body = core.toString('utf8').split('\n## 1. Mental model')[1]
    for (const t of topics()) expect(body, t).toContain(`llms/${t}.md`)
  })

  it('the skill points at each of its references', () => {
    const skill = readFileSync(resolve(root, 'skills/sygnal-dev/SKILL.md'), 'utf8')
    for (const t of topics()) expect(skill, t).toContain(`references/${t}.md`)
  })

  it('npm ships the topic files and llms-full.txt', () => {
    const files = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).files
    for (const f of ['llms.txt', 'llms', 'llms-full.txt']) expect(files).toContain(f)
  })
})
