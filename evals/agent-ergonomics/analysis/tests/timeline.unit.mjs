import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTranscriptLines } from '../lib/parse.mjs'
import { buildTimeline } from '../lib/timeline.mjs'
import { transcript, call, result, user, TRIAL, PASS_TESTS, FAIL_B007, FAIL_ASSERT, FAIL_TRUNC, FAIL_B006, GUARD } from './fixtures.mjs'

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0)

test('parse: usage is summed per message id (last line wins), final report from SubagentHandback', () => {
  const a = call(2, 'Read', { file_path: 'a' }, { msgId: 'm1', usage: { input_tokens: 1, output_tokens: 16, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 } })
  const b = call(3, 'Read', { file_path: 'b' }, { msgId: 'm1', usage: { input_tokens: 1, output_tokens: 300, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 } })
  const h = call(9, 'SubagentHandback', { message: 'All done. The plugin is broken.' }, { msgId: 'm2', usage: { input_tokens: 2, output_tokens: 20, cache_read_input_tokens: 200, cache_creation_input_tokens: 5 } })
  const p = parseTranscriptLines([user(0, 'go'), a.line, b.line, result(4, a.id, 'A'), result(4, b.id, 'B'), h.line, result(10, h.id, 'ok')].map((l) => JSON.stringify(l)))
  assert.equal(p.calls.length, 3)
  assert.equal(p.usage.messages, 2)
  assert.equal(p.usage.output, 320)
  assert.equal(p.usage.cacheRead, 300)
  assert.equal(p.usage.peakContext, 1 + 100 + 10 + 300) // the larger message
  assert.equal(p.finalReport, 'All done. The plugin is broken.')
  assert.equal(p.calls[0].result.text, 'A')
  assert.equal(p.lastTs - p.firstTs, 10000)
})

test('timeline: phases partition the wall time; B-007 episode is tooling-friction', () => {
  const lines = transcript([
    { at: 2, name: 'Skill', input: { skill: 'sygnal-dev' }, resultAt: 2.5, result: 'Launching skill' },
    { at: 6, name: 'Read', input: { file_path: `${TRIAL}/src/App.jsx` }, resultAt: 6.5, result: 'code' },
    { at: 10, name: 'Write', input: { file_path: `${TRIAL}/src/App.jsx`, content: 'x' }, resultAt: 10.2, result: 'ok' },
    { at: 14, name: 'Write', input: { file_path: `${TRIAL}/src/tmp.test.jsx`, content: "import { run } from 'sygnal'" }, resultAt: 14.2, result: 'ok' },
    { at: 15, name: 'Bash', input: { command: `npm --prefix ${TRIAL} test 2>&1 | tail -6` }, resultAt: 17, result: FAIL_B007 },
    { at: 20, name: 'Bash', input: { command: `grep -n run ${TRIAL}/node_modules/sygnal/dist/vite/plugin.mjs` }, resultAt: 21, result: '12: run(' },
    { at: 25, name: 'Edit', input: { file_path: `${TRIAL}/src/tmp.test.jsx`, old_string: 'a', new_string: 'b' }, resultAt: 25.2, result: 'ok' },
    { at: 26, name: 'Bash', input: { command: `npm --prefix ${TRIAL} test 2>&1 | tail -6` }, resultAt: 28, result: PASS_TESTS },
    { at: 30, name: 'SubagentHandback', input: { message: 'done; the sygnal/vite plugin rewrites run( and gives __sygnal is not defined' }, resultAt: 30.5, result: 'delivered' },
    { at: 32, text: 'Report sent.' },
  ])
  const p = parseTranscriptLines(lines)
  const tl = buildTimeline(p, { arm: 'sygnal', reportIds: ['B-007'] })
  assert.equal(tl.wallSeconds, 32)
  assert.ok(Math.abs(sum(tl.phases) - 32) < 0.2, `phases sum ${sum(tl.phases)}`)
  assert.equal(tl.attributedShare, 1)
  // prompt -> first call is orient; the interval after the Skill result is learn (skill-load)
  assert.equal(tl.learn['skill-load'], 4) // 0.5 s running the Skill + 3.5 s reading it
  // failure at 17 -> green at 28: 11 s of friction (the rerun that turns green included)
  assert.equal(tl.friction['B-007'], 11)
  assert.equal(tl.phases['tooling-friction'], 11)
  assert.equal(tl.episodes.length, 1)
  assert.deepEqual(tl.episodes[0].friction, ['B-007'])
  assert.equal(tl.episodes[0].seconds, 11)
  assert.equal(tl.episodes[0].iterations, 1)
  assert.equal(tl.iterations, 2)
  assert.equal(tl.editRounds, 2)
  assert.equal(tl.phases.report, 4) // writing the handback (2) + delivering it (0.5) + the closing text (1.5)
  assert.equal(tl.phases['test-authoring'], 4) // the later test fix is inside the B-007 span
})

test('timeline: unknown failure is debug; truncated output later revealed as B-006 is re-labelled', () => {
  const lines = transcript([
    { at: 2, name: 'Bash', input: { command: 'npm test 2>&1 | tail -3' }, resultAt: 4, result: FAIL_ASSERT },
    { at: 8, name: 'Edit', input: { file_path: `${TRIAL}/src/App.jsx` }, resultAt: 8.5, result: 'ok' },
    { at: 10, name: 'Bash', input: { command: 'npm test' }, resultAt: 12, result: PASS_TESTS },
    { at: 14, name: 'Bash', input: { command: 'npm test 2>&1 | tail -3' }, resultAt: 16, result: FAIL_TRUNC },
    { at: 18, name: 'Bash', input: { command: 'npm test 2>&1 | head -30' }, resultAt: 20, result: FAIL_B006 },
    { at: 24, name: 'Bash', input: { command: 'npm test' }, resultAt: 26, result: PASS_TESTS },
  ])
  const tl = buildTimeline(parseTranscriptLines(lines), { arm: 'sygnal' })
  assert.equal(tl.episodes.length, 2)
  assert.equal(tl.episodes[0].cause, 'agent-mistake')
  assert.equal(tl.phases.debug, 8) // 4 -> 12
  assert.equal(tl.episodes[1].cause, 'known-defect')
  assert.equal(tl.friction['B-006'], 10) // 16 -> 26, including the 4 s first charged as debug
  assert.ok(Math.abs(sum(tl.phases) - 26) < 0.2)
})

test('timeline: after a defect is worked around, an assertion failure starts a new debug episode', () => {
  const lines = transcript([
    { at: 2, name: 'Bash', input: { command: 'npm test' }, resultAt: 4, result: FAIL_B007 },
    { at: 6, name: 'Bash', input: { command: 'npm test' }, resultAt: 8, result: FAIL_ASSERT },
    { at: 10, name: 'Bash', input: { command: 'npm test' }, resultAt: 12, result: PASS_TESTS },
  ])
  const tl = buildTimeline(parseTranscriptLines(lines), { arm: 'sygnal' })
  assert.equal(tl.episodes.length, 2)
  assert.deepEqual(tl.episodes[0].friction, ['B-007'])
  assert.equal(tl.episodes[1].cause, 'agent-mistake')
  assert.equal(tl.friction['B-007'], 4)
  assert.equal(tl.phases.debug, 4)
})

test('timeline: refused commands are HARNESS-GUARD friction, count as iterations, not episodes', () => {
  const lines = transcript([
    { at: 2, name: 'Bash', input: { command: `cd ${TRIAL} && cat > src/App.jsx <<'EOF'\nx\nEOF\nnpm test` }, resultAt: 3, result: GUARD, isError: true },
    { at: 5, name: 'Write', input: { file_path: `${TRIAL}/src/App.jsx` }, resultAt: 5.1, result: 'ok' },
    { at: 6, name: 'Bash', input: { command: 'npm test' }, resultAt: 8, result: PASS_TESTS },
  ])
  const tl = buildTimeline(parseTranscriptLines(lines), { arm: 'react' })
  assert.equal(tl.friction['HARNESS-GUARD'], 1) // 2 -> 3 (the first interval is orient)
  assert.equal(tl.episodes.length, 0)
  assert.equal(tl.iterations, 2)
  assert.equal(tl.effectiveIterations, 1)
  assert.equal(tl.failures[0].cause, 'harness')
})

test('timeline: a parallel passing build does not close a failing test episode', () => {
  const t = call(2, 'Bash', { command: 'npm test' }, { msgId: 'm' })
  const b = call(2.1, 'Bash', { command: 'npm run build' }, { msgId: 'm' })
  const fix = call(6, 'Edit', { file_path: `${TRIAL}/src/A.jsx` })
  const again = call(8, 'Bash', { command: 'npm test' })
  const lines = [user(0, 'go'), t.line, b.line, result(4, t.id, FAIL_ASSERT), result(5, b.id, 'built in 40ms'), fix.line, result(6.2, fix.id, 'ok'), again.line, result(10, again.id, PASS_TESTS)]
  const tl = buildTimeline(parseTranscriptLines(lines), { arm: 'react' })
  assert.equal(tl.episodes.length, 1)
  assert.equal(tl.episodes[0].seconds, 6)
})
