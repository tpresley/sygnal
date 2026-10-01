import test from 'node:test'
import assert from 'node:assert/strict'
import { lineDiff, canonicalForms, driverCatchWorkaround } from '../lib/code.mjs'
import { sections, grepLineNumbers, toRanges, skillReadsOfCall, sectionsHit } from '../lib/skill.mjs'
import { selfReportedIssues } from '../lib/selfreport.mjs'
import { deltaItems, bucketOf } from '../lib/aggregate.mjs'
import { diffAnalyses } from '../compare.mjs'

test('lineDiff', () => {
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nb\nc'), { added: 0, removed: 0 })
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nX\nc\nd'), { added: 2, removed: 1 })
  assert.deepEqual(lineDiff('', 'a\nb'), { added: 2, removed: 0 })
  assert.deepEqual(lineDiff('a\nb', ''), { added: 0, removed: 2 })
})

test('canonicalForms counts non-canonical forms', () => {
  const src = `
function TaskItem({ state }) { return <div/> }
TaskItem.intent = ({ DOM }) => ({ PIN: DOM.click('.pin') })
TaskItem.model = {
  'PIN | PARENT': (state) => state.id,
  SAVE: { STATE: s => s, EVENTS: s => ({ type: 'SAVED', data: 1 }) },
  GO: emit('GO', s => 1),
  GO2: { EVENTS: event('GO2') },
}
function Row(props, state, context) { return null }
Row.model = {}
App.intent = ({ CHILD }) => ({ A: CHILD.select('TaskItem'), B: CHILD.select(TaskItem) })
`
  const f = canonicalForms(src)
  assert.equal(f.shorthandKeys, 1)
  assert.equal(f.rawEventsObjects, 1)
  assert.equal(f.emitCalls, 1)
  assert.equal(f.eventCalls, 1)
  assert.equal(f.childSelectString, 1)
  assert.equal(f.childSelectFn, 1)
  assert.equal(f.positionalView, 1)
})

test('driverCatchWorkaround', () => {
  assert.ok(driverCatchWorkaround("export default driverFromAsync(async (q) => { try { return await f() } catch (e) { return { ok: false } } })"))
  assert.ok(!driverCatchWorkaround('export default driverFromAsync(async (q) => f(q))'))
  assert.ok(!driverCatchWorkaround('try { x() } catch (e) {}'))
})

const MD = '# Title\n\nintro\n\n## One\n\na\nb\n\n### One.A\n\nc\n\n## Two\n\nd\n'

test('skill sections and ranges', () => {
  const s = sections(MD)
  assert.deepEqual(s.map((x) => [x.heading, x.start, x.ownEnd]), [['Title', 1, 4], ['One', 5, 9], ['One.A', 10, 13], ['Two', 14, 17]])
  assert.deepEqual(grepLineNumbers('5:## One\n6-\n7-a\n--\n14:## Two'), [5, 6, 7, 14])
  assert.deepEqual(toRanges([7, 5, 6, 14]), [[5, 7], [14, 14]])
  const file = { text: MD, lines: MD.split('\n').length, bytes: MD.length, sections: s }
  assert.deepEqual(sectionsHit(file, [[6, 7]]), ['One'])
  const skill = { files: { 'references/component-patterns.md': file, 'SKILL.md': file } }
  const r1 = skillReadsOfCall({ name: 'Bash', input: { command: 'sed -n 10,13p /u/.claude/skills/sygnal-dev/references/component-patterns.md' }, result: { text: 'c' } }, skill)
  assert.deepEqual(r1[0].ranges, [[10, 13]])
  const r2 = skillReadsOfCall({ name: 'Read', input: { file_path: '/u/.claude/skills/sygnal-dev/references/component-patterns.md', offset: 14, limit: 3 } , result: { text: 'd' } }, skill)
  assert.deepEqual(r2[0].ranges, [[14, 16]])
  const r3 = skillReadsOfCall({ name: 'Bash', input: { command: 'grep -n -A1 "One" /u/.claude/skills/sygnal-dev/references/component-patterns.md' }, result: { text: '5:## One\n6-' } }, skill)
  assert.deepEqual(r3[0].ranges, [[5, 6]])
  const r4 = skillReadsOfCall({ name: 'Skill', input: { skill: 'sygnal-dev' }, result: { text: 'Launching' } }, skill)
  assert.equal(r4[0].file, 'SKILL.md')
})

test('selfReportedIssues keeps framework complaints, drops change descriptions', () => {
  const rep = `Every task row now has a Pin button.

- **TaskItem.jsx**: adds the button.

**Sygnal problem I hit:** the \`sygnal/vite\` plugin rewrites any bare \`run(\` call in transformed files, including test files. Importing it under another name avoids the problem.`
  const out = selfReportedIssues(rep)
  assert.equal(out.length, 1)
  assert.match(out[0], /plugin rewrites/)
})

test('deltaItems partitions the Sygnal-React wall delta', () => {
  const mk = (arm, task, wall, phases, friction = {}, learn = {}) => ({ arm, task, wallSeconds: wall, phases, frictionSeconds: friction, learnSeconds: learn })
  const recs = [
    mk('sygnal', '01-a', 30, { orient: 5, learn: 5, implement: 5, 'tooling-friction': 15 }, { 'B-007': 15 }, { 'skill-load': 5 }),
    mk('sygnal', '01-a', 20, { orient: 5, learn: 5, implement: 10 }, {}, { 'skill-load': 5 }),
    mk('react', '01-a', 15, { orient: 5, implement: 10 }),
    mk('sygnal', '06-only', 100, { orient: 100 }),
  ]
  const d = deltaItems(recs)
  assert.deepEqual(d.tasks, ['01-a'])
  assert.equal(d.wallDelta, 10)
  const total = d.items.reduce((a, x) => a + x.delta, 0)
  assert.ok(Math.abs(total - d.wallDelta) < 0.01)
  assert.equal(d.items.find((x) => x.item === 'friction:B-007').delta, 7.5)
  assert.equal(bucketOf('friction:B-007'), 'self-testing: framework/tooling defects')
  assert.equal(bucketOf('learn:skill-load'), 'learning: skill')
  assert.equal(bucketOf('phase:test-authoring'), 'self-testing: writing tests')
})

test('compare: an analysis diffed with itself has no changes', () => {
  const stats = { wall: { mean: 10 }, peakContext: { mean: 5 }, pass: 1, scored: 1, phases: { orient: 3 } }
  const a = { meta: { run: 'x' }, aggregates: { overall: { sygnal: stats }, delta: { wallDelta: 4, items: [{ item: 'phase:orient', delta: 2 }] }, catalog: [{ id: 'B-007', frictionSecondsPerSygnalTrial: 3, sygnal: '1/1' }], canonical: { forms: { shorthandKeys: { trials: 1 } } } } }
  const d = diffAnalyses(a, a)
  assert.equal(d.headline.sygnal.wall.change, 0)
  assert.equal(d.items['phase:orient'].change, 0)
  assert.equal(d.catalog['B-007'].change, 0)
})
