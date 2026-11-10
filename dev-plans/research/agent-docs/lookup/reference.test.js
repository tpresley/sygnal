// The agent reference (scripts/build-reference.mjs, dev-plans/research/agent-docs): generated from
// the types, the agent context and the checker's explanations into dist/reference.{json,md}.
// Fails when the build is stale or an answer stops being one short read.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { outputs, textOf, ANSWER_BUDGET, SINK_REQUESTS } from '../scripts/build-reference.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const files = outputs()
const ref = files[0].ref
const cand = (rel) => readFileSync(resolve(root, 'dev-plans/research/agent-docs/candidates', rel))

// The compact candidates with the lookup line. These only go down.
const COMPACT_LOOKUP_BUDGET = 21_750
const COMPACT_GREP_BUDGET = 21_780
const SKILL_OVERHEAD = 720

describe('the agent reference', () => {
  it('dist/reference.json and dist/reference.md are current (npm run build)', () => {
    for (const f of files) expect(readFileSync(f.file, 'utf8') === f.text, f.file).toBe(true)
  })

  it(`every answer fits ${ANSWER_BUDGET} bytes and says something`, () => {
    for (const [key, e] of Object.entries(ref.entries)) {
      const text = textOf(e)
      expect(Buffer.byteLength(text), key).toBeLessThanOrEqual(ANSWER_BUDGET + 8)
      expect(text.length, key).toBeGreaterThan(key.length)
    }
  })

  it('has an entry for every export of the main entry', () => {
    const dts = readFileSync(resolve(root, 'dist/index.d.ts'), 'utf8')
    const names = [...dts.matchAll(/^export \{([^}]*)\}/gm)].flatMap((m) => m[1].split(',').map((n) => n.trim().replace(/^type /, '').split(' as ').pop())).filter(Boolean)
    expect(names.length).toBeGreaterThan(400)
    // Re-exports of xstream and snabbdom are not Sygnal's to document.
    const own = names.filter((n) => !['VNode', 'VNodeData', 'MemoryStream', 'Stream', 'h', 'debounce', 'throttle', 'delay', 'dropRepeats', 'sampleCombine', 'flattenConcurrently', 'flattenSequentially', 'concat', 'xs', 'default'].includes(n))
    const missing = own.filter((n) => !ref.entries[n] && !ref.aliases[n])
    expect(missing).toEqual([])
  })

  it('answers each kind of name an agent has in hand', () => {
    for (const key of ['makeFetchDriver', 'FetchRequest', 'Collection', 'Component.resources', 'Component.intent', 'FormOptions.show', 'DOM', 'STATE', 'HTTP', 'EFFECT', 'PARENT', 'sygnal/ui', 'SYG643']) {
      expect(ref.entries[key] ?? ref.entries[ref.aliases[key]], key).toBeTruthy()
    }
    expect(ref.statics).toContain('resources')
    expect(ref.aliases['DOM.click']).toBe('DOM')
  })

  it('the common symbols have options and a usage example', () => {
    const http = ref.entries.HTTP
    expect(http.options.join(' ')).toMatch(/\blatest\b/)
    for (const key of ['makeFetchDriver', 'renderComponent', 'Collection', 'form', 'Component.resources']) expect(ref.entries[key].example, key).toBeTruthy()
  })

  it('a sink points at a request type that exists', () => {
    for (const [sink, type] of Object.entries(SINK_REQUESTS)) expect(ref.entries[type] ?? ref.aliases[type], `${sink} → ${type}`).toBeTruthy()
  })

  it('every file it says to read exists', () => {
    const topics = new Set(Object.values(ref.entries).map((e) => e.topic).filter(Boolean))
    for (const t of topics) expect(existsSync(resolve(root, t)), t).toBe(true)
  })

  it('carries no planning references', () => {
    expect(files[1].text).not.toMatch(/\bPLAN-\d/)
  })

  it('the Markdown form has one heading per answer and alias', () => {
    const headings = [...files[1].text.matchAll(/^## (.+)$/gm)].map((m) => m[1])
    expect(new Set(headings).size).toBe(headings.length)
    expect(headings.length).toBe(Object.keys(ref.entries).length + Object.keys(ref.aliases).length)
    expect(files[1].text).toContain(`## HTTP\n\n${textOf(ref.entries.HTTP)}\n`)
  })

  it('the compact candidates stay inside their budgets', () => {
    expect(cand('compact-lookup/llms.txt').length).toBeLessThanOrEqual(COMPACT_LOOKUP_BUDGET)
    expect(cand('compact-grep/llms.txt').length).toBeLessThanOrEqual(COMPACT_GREP_BUDGET)
    expect(cand('compact-lookup-skill/SKILL.md').length).toBeLessThanOrEqual(COMPACT_LOOKUP_BUDGET + SKILL_OVERHEAD)
    expect(cand('compact-grep-skill/SKILL.md').length).toBeLessThanOrEqual(COMPACT_GREP_BUDGET + SKILL_OVERHEAD)
  })
})
