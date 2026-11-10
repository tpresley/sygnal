// 3E/R10a, restructured by the llms-context spike (dev-plans/research/llms-context): the agent
// context is a core (llms.txt) plus topic files (llms/<topic>.md) that the core lists; npm ships
// them all, the docs site serves copies, and the skill's references are the same topic files.
// scripts/build-llms.mjs writes every copy (llms-full.txt and the skill too); this suite fails when one is stale.
// The agent-docs spike (dev-plans/research/agent-docs) compacted the core and made the skill a generated copy of it.
//
// Budgets are bytes, not lines (the old 322-line cap was met by lengthening lines). The core is
// what every agent reads in full, so it has the tight budget; a topic file is read on demand, so
// it only has to stay one comfortable read.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stale, topics, skill } from '../scripts/build-llms.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CORE_BUDGET = 22_300   // bytes of llms.txt: the compact core (dev-plans/research/agent-docs, 7.5), 22,173 B with App.drivers; was 66,600 before the compaction moved option lists, traps and long examples to topic files
const TOPIC_BUDGET = 16_000  // bytes per llms/<topic>.md
const SKILL_BUDGET = 23_000  // bytes of skills/sygnal-dev/SKILL.md: generated from llms.txt by scripts/build-llms.mjs (frontmatter + the core), 22,901 B in 7.5; was 56,221 as a hand-kept second copy. It only goes down: a new fact goes in a topic file, or takes the place of another

describe('llms.txt and its topic files', () => {
  const core = readFileSync(resolve(root, 'llms.txt'))

  it('every copy is current (node scripts/build-llms.mjs)', () => {
    expect(stale()).toEqual([])
  })

  it(`the core is at most ${CORE_BUDGET} bytes`, () => {
    expect(core.length).toBeLessThanOrEqual(CORE_BUDGET)
  })

  it(`the skill is at most ${SKILL_BUDGET} bytes`, () => {
    expect(readFileSync(resolve(root, 'skills/sygnal-dev/SKILL.md')).length).toBeLessThanOrEqual(SKILL_BUDGET)
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

  it('the core says when to read each topic, in its "Read before you write" section', () => {
    const index = core.toString('utf8').split('\n## 1. Mental model')[0]
    for (const t of topics()) expect(index, t).toContain(`llms/${t}.md`)
    expect(index).toContain('## Read before you write')
  })

  it('the skill is the core, with the topics as its references', () => {
    expect(readFileSync(resolve(root, 'skills/sygnal-dev/SKILL.md'), 'utf8')).toBe(skill())
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
