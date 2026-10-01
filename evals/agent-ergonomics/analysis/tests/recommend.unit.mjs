// Recommendation preconditions (PLAN-2 F6) and headless transcript parsing.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  docsContext, loadTrackers, testingSection, apiFactCoverage, documentsChildProps, teachesCanonicalModel,
  driverExampleShowsErrors, recordsHaveUsage, allHeadless, headings,
} from '../lib/preconditions.mjs'
import { recommendationSet, recommendations } from '../lib/recommend.mjs'
import { sections } from '../lib/skill.mjs'
import { parseTranscriptLines } from '../lib/parse.mjs'
import { headlessTranscript } from '../../tests/fixtures-headless.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const skillOf = (text) => ({ dir: '/s', files: { 'SKILL.md': { text, lines: text.split('\n').length, bytes: text.length, sections: sections(text) } } })

const OLD_SKILL = `# Sygnal Dev
## Components
\`\`\`js
App.model = { 'SAVE | EVENTS': (s) => ({ type: 'SAVED', data: s }) }
\`\`\`
## Drivers
driverFromAsync(fn) — throw on !response.ok
`
const NEW_SKILL = fs.readFileSync(path.join(REPO, 'skills', 'sygnal-dev', 'SKILL.md'), 'utf8')
const LLMS = fs.readFileSync(path.join(REPO, 'llms.txt'), 'utf8')

test('preconditions on a PLAN-1-era skill: nothing is done', () => {
  const ctx = docsContext({ skill: skillOf(OLD_SKILL), llmsText: '# Sygnal\n## API\n' })
  assert.deepEqual(testingSection(ctx), { skill: null, llms: null })
  assert.equal(apiFactCoverage(ctx).filter((f) => f.inSkill).length, 0)
  assert.equal(documentsChildProps(ctx), false)
  assert.equal(teachesCanonicalModel(ctx), false)
  assert.equal(driverExampleShowsErrors(ctx), false)
})

test('preconditions on the current repo skill and llms.txt: all done', () => {
  const ctx = docsContext({ skill: skillOf(NEW_SKILL), llmsText: LLMS })
  const t = testingSection(ctx)
  assert.match(t.skill, /Testing/)
  assert.match(t.llms, /Testing/)
  const cov = apiFactCoverage(ctx)
  assert.deepEqual(cov.filter((f) => !f.inSkill).map((f) => f.key), [], 'every PLAN-1 API fact is in SKILL.md')
  assert.deepEqual(cov.filter((f) => !f.inLlms).map((f) => f.key), [], 'and in llms.txt')
  assert.equal(documentsChildProps(ctx), true)
  assert.equal(teachesCanonicalModel(ctx), true, 'the shorthand only appears in the canonical-forms table')
  assert.equal(driverExampleShowsErrors(ctx), true)
})

test('headings skips fenced code; trackers merge with the later file winning', () => {
  assert.deepEqual(headings('# A\n```\n# not\n```\n## B'), ['A', 'B'])
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trk-'))
  const a = path.join(dir, 'a.md')
  const b = path.join(dir, 'b.md')
  fs.writeFileSync(a, '| B-005 | x | y | Open |\n| G-003 | x | y | ✅ fixed |\n')
  fs.writeFileSync(b, '| B-005 | x | y | ✅ 1-C |\n')
  const t = loadTrackers([a, b, path.join(dir, 'missing.md')])
  assert.equal(t['B-005'].status, 'fixed')
  assert.equal(t['G-003'].status, 'fixed')
})

test('records: usage and method detection', () => {
  assert.equal(recordsHaveUsage([{ usage: { tokens: null } }]), false)
  assert.equal(recordsHaveUsage([{ usage: { tokens: 5 } }]), true)
  assert.equal(allHeadless([{ method: 'headless' }, { method: 'headless' }]), true)
  assert.equal(allHeadless([{ method: 'headless' }, { method: 'subagent' }]), false)
  assert.equal(allHeadless([{}]), false)
})

// ---- recommendationSet over a small synthetic aggregate

function rec(arm, task, extra = {}) {
  return { arm, task, trial: `${arm}-${task.slice(0, 2)}-t1`, phases: { learn: 1 }, wroteTest: true, testApproach: ['renderComponent'], catalog: { result: [], report: [], workaround: [] }, ...extra }
}
function agg({ catalog = [], learn = {}, readers = 0, testAuthoring = 3, sh = 0 } = {}) {
  return {
    delta: { items: [{ item: 'phase:test-authoring', delta: testAuthoring }, { item: 'friction:HARNESS-GUARD', delta: 3 }] },
    catalog,
    failures: { signatures: [] },
    overall: { sygnal: { learn }, react: { wall: { mean: 40 } } },
    overallShared: { sygnal: { failedRuns: { mean: 0.1 }, peakContext: { mean: 70000 } }, react: { failedRuns: { mean: 0 }, peakContext: { mean: 60000 } } },
    skill: { library: { sygnal: { sygnal: { files: { 'dist/index.esm.js': readers } } } }, libraryReaders: { sygnal: readers, react: 0 }, sections: [] },
    byTask: { '08-extract-rating': { sygnal: { wall: { mean: 80 }, phases: { learn: 2 } }, react: { wall: { mean: 39 } } } },
    canonical: { trials: 2, forms: { shorthandKeys: { trials: sh, total: sh }, rawEventsObjects: { trials: 0, total: 0 }, childSelectFn: { trials: 1 }, childSelectString: { trials: 0 } }, sygnalCheck: {} },
  }
}
const GUARD_ROW = { id: 'HARNESS-GUARD', sygnal: '2/2', react: '1/1', inResults: 3, frictionSecondsPerSygnalTrial: 9, frictionSecondsPerReactTrial: 7, status: 'untracked' }
const B005_ROW = { id: 'B-005', sygnal: '1/2', react: '—', trials: ['sygnal-05-t1'], workarounds: 1, inReports: 1, frictionSecondsTotal: 0, status: 'open' }
const ids = (xs) => xs.map((x) => x.id).sort()

test('old docs + subagent trials: the PLAN-1 recommendations are all active and "new"', () => {
  const records = [rec('sygnal', '05-driver-quote', { method: 'subagent' }), rec('react', '05-driver-quote', { method: 'subagent' })]
  const ctx = docsContext({ skill: skillOf(OLD_SKILL), llmsText: '', tracker: { 'B-005': { status: 'open' } } })
  const { active, suppressed } = recommendationSet(agg({ catalog: [GUARD_ROW, B005_ROW], learn: { drivers: 2, 'parent-child-props': 1 }, readers: 2, sh: 1 }), records, ctx.skill, ctx)
  assert.deepEqual(ids(active), ['B-005', 'G-003', 'api-facts', 'canonical-forms', 'harness-guard', 'harness-usage', 'testing-section'])
  assert.ok(active.filter((r) => r.id !== 'harness-usage').every((r) => r.status === 'new'))
  assert.deepEqual(suppressed, [])
  assert.match(active.find((r) => r.id === 'api-facts').change, /CHILD\.select/)
})

test('current docs + headless trials with usage: done items are suppressed or rewritten', () => {
  const records = [
    rec('sygnal', '05-driver-quote', { method: 'headless', usage: { tokens: 1e6, costUsd: 0.5 } }),
    rec('react', '05-driver-quote', { method: 'headless', usage: { tokens: 8e5, costUsd: 0.4 } }),
  ]
  const ctx = docsContext({ skill: skillOf(NEW_SKILL), llmsText: LLMS, tracker: { 'B-005': { status: 'fixed' }, 'G-003': { status: 'fixed' } } })
  const { active, suppressed } = recommendationSet(agg({ catalog: [B005_ROW], learn: { drivers: 0.2, 'parent-child-props': 0.6 }, readers: 0, testAuthoring: 0.5 }), records, ctx.skill, ctx)
  // Testing section exists and the delta is small; API facts, G-003, harness guard and usage are done.
  assert.deepEqual(ids(suppressed), ['G-003', 'api-facts', 'harness-guard', 'harness-usage', 'testing-section'])
  for (const s of suppressed) assert.match(s.reason, /^done:/)
  // B-005 is fixed and the skill shows errors(), but a trial still coded around it: rewritten, not dropped.
  assert.deepEqual(ids(active), ['B-005'])
  assert.equal(active[0].status, 'rewritten')
  assert.match(active[0].title, /fixed and documented/)
})

test('a fixed tracker item whose signature still appears is rewritten as a release check', () => {
  const row = { id: 'B-007', sygnal: '1/2', react: '—', inResults: 1, inReports: 0, workarounds: 0, frictionSecondsTotal: 20, frictionSecondsPerAffected: 20, frictionSecondsPerSygnalTrial: 10, status: 'fixed' }
  const ctx = docsContext({ skill: skillOf(NEW_SKILL), llmsText: LLMS, tracker: { 'B-007': { status: 'fixed' } } })
  const { active } = recommendationSet(agg({ catalog: [row], testAuthoring: 0 }), [rec('sygnal', '01-clear-completed', { method: 'headless' })], ctx.skill, ctx)
  const r = active.find((x) => x.id === 'B-007')
  assert.equal(r.status, 'rewritten')
  assert.match(r.title, /marked fixed, but it still showed up/)
})

test('the testing recommendation is rewritten (not suppressed) while test authoring still costs more', () => {
  const ctx = docsContext({ skill: skillOf(NEW_SKILL), llmsText: LLMS })
  const { active } = recommendationSet(agg({ testAuthoring: 5 }), [rec('sygnal', '01-clear-completed'), rec('react', '01-clear-completed')], ctx.skill, ctx)
  const r = active.find((x) => x.id === 'testing-section')
  assert.equal(r.status, 'rewritten')
  assert.match(r.title, /exists, but test authoring still costs/)
  assert.ok(Array.isArray(recommendations(agg(), [], ctx.skill, ctx)), 'PLAN-1 API still returns the active list')
})

test('parse: a headless transcript yields the usage block, the final text, and starts at init', () => {
  const p = parseTranscriptLines(headlessTranscript().split('\n'))
  assert.equal(p.headless.costUsd, 0.4567)
  assert.equal(p.headless.tokens, 48912)
  assert.equal(p.headless.model, 'claude-opus-5-5')
  assert.equal(p.finalReport, 'Done.')
  assert.equal(p.firstTs, Date.parse('2026-10-01T12:00:00Z'))
  assert.equal(p.calls.length, 3)
  assert.equal(p.calls[0].result.stdout, '')
})
