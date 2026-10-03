// PLAN-4 1-E wiring-class measures (lib/wiring.mjs, wiring.mjs, the matched metrics).
// Run: node --test evals/agent-ergonomics/analysis/tests/*.unit.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { diagnosticCodes, wiringHits, finalWiringCodes, wiringFailure, wiringStats, WIRING_CODES } from '../lib/wiring.mjs'
import { rowsFromAnalysis, matchedCompare, METRICS } from '../lib/matched.mjs'
import { wiringReport, renderWiring } from '../wiring.mjs'

const bash = (command, text) => ({ name: 'Bash', input: { command }, result: { text } })

test('diagnosticCodes: runtime and checker formats, wiring codes only', () => {
  const out = [
    'stderr | src/App.test.jsx',
    '[Sygnal SYG104] TodoList: DOM.click(Remove) listens to control <Remove>, but ... https://sygnal.js.org/reference/errors#syg104',
    '[Sygnal SYG110] App: DOM.click(Ghost) ...',
    '[Sygnal SYG111] App: controlled field ...',
    'src/App.jsx:17:16 SYG104 App: DOM.click(Remove) ...',
    'src/App.jsx:18:16 SYG124 [error] App: DOM.click(TaskItem) is given the component TaskItem',
    'src/App.jsx:6:7 SYG702 [error] App: control <Draft> (a <input>) has no label',
  ].join('\n')
  assert.deepEqual(diagnosticCodes(out), { SYG104: 2, SYG110: 1, SYG124: 1 })
  // Mentions in prose (the skill, an explanation) are not emitted diagnostics.
  assert.deepEqual(diagnosticCodes('A parent never hears it (SYG104); a selector the view never renders is SYG110.'), {})
  assert.deepEqual(diagnosticCodes(null), {})
  assert.deepEqual(WIRING_CODES, ['SYG104', 'SYG110', 'SYG124'])
})

test('wiringHits: Bash results only, not reads or explain', () => {
  const calls = [
    bash('npm test', '[Sygnal SYG104] List: ...\n[Sygnal SYG104] List: ...'),
    bash('npx --no-install sygnal-check --strict', 'src/List.jsx:3:1 SYG110 List: ...'),
    bash('npx --no-install sygnal-check explain SYG104', '[Sygnal SYG104] example output in the explanation'),
    bash('npm run build', 'built in 1s'),
    { name: 'Read', input: { file_path: 'SKILL.md' }, result: { text: 'src/x.jsx:1:1 SYG104 example' } },
    { name: 'Bash', input: { command: 'npm test' }, result: null },
  ]
  assert.deepEqual(wiringHits(calls), { calls: 2, byCode: { SYG104: 2, SYG110: 1, SYG124: 0 } })
  assert.deepEqual(wiringHits([]), { calls: 0, byCode: { SYG104: 0, SYG110: 0, SYG124: 0 } })
})

test('finalWiringCodes and wiringFailure', () => {
  const check = { diagnostics: [{ code: 'SYG110', severity: 'info' }, { code: 'SYG104', severity: 'warn' }, { code: 'SYG104', severity: 'warn' }, { code: 'SYG702', severity: 'error' }, { code: 'SYG124', severity: 'error' }] }
  assert.deepEqual(finalWiringCodes(check), ['SYG104', 'SYG124'])
  assert.deepEqual(finalWiringCodes(null), [])
  assert.deepEqual(wiringFailure(null), { failure: null, source: null })
  assert.deepEqual(wiringFailure({ pass: true }, ['SYG104']), { failure: false, source: null })
  assert.deepEqual(wiringFailure({ pass: false, failureCategory: 'isolation' }), { failure: true, source: 'category' })
  assert.deepEqual(wiringFailure({ pass: false, failureCategory: 'wiring' }), { failure: true, source: 'category' })
  // A category wins over the final code (a human classified it).
  assert.deepEqual(wiringFailure({ pass: false, failureCategory: 'other' }, ['SYG110']), { failure: false, source: 'category' })
  // Unclassified: the final code decides.
  assert.deepEqual(wiringFailure({ pass: false, failureCategory: null }, ['SYG110']), { failure: true, source: 'final-code' })
  assert.deepEqual(wiringFailure({ pass: false }, []), { failure: false, source: null })
  const s = wiringStats({ calls: [bash('npm test', '[Sygnal SYG110] x')], scored: { pass: false }, check })
  assert.deepEqual(s, { hitCalls: 1, hitsByCode: { SYG104: 0, SYG110: 1, SYG124: 0 }, finalCodes: ['SYG104', 'SYG124'], failure: true, failureSource: 'final-code', finalChecked: true })
  assert.equal(wiringStats({ calls: [], scored: null, check: { error: 'no src dir', diagnostics: [] } }).finalChecked, false)
})

const trial = (task, trialNo, pass, wiring, phases = { learn: 10, implement: 50 }, failureCategory = null) => ({
  arm: 'sygnal', task, trial: `sygnal-${task.slice(0, 2)}-t${trialNo}`, trialNo, scored: { pass, failureCategory }, wallSeconds: 100, phases, wiring,
})
const W = (hitCalls, finalCodes, failure, failureSource = null) => ({ hitCalls, hitsByCode: { SYG104: hitCalls, SYG110: 0, SYG124: 0 }, finalCodes, failure, failureSource, finalChecked: true })

test('matched metrics: learn, wiringHits, wiringFinal, wiringFailure from an analysis', () => {
  const a = { meta: { run: 'p4-ct1-a' }, trials: [trial('07-fix-remove-button', 1, true, W(2, [], false)), trial('07-fix-remove-button', 2, false, W(0, ['SYG104'], true, 'final-code'), { learn: 20 })] }
  const b = { meta: { run: 'p4-ct1-b' }, trials: [trial('07-fix-remove-button', 1, true, W(0, [], false), { learn: 12 }), trial('07-fix-remove-button', 2, true, W(0, [], false), { learn: 14 })] }
  const rows = rowsFromAnalysis(a)
  assert.equal(rows[0].learn, 10)
  assert.equal(rows[1].wiringFinal, 1)
  assert.equal(rows[1].wiringFailure, 1)
  const c = matchedCompare({ run: 'p4-ct1-a', rows }, { run: 'p4-ct1-b', rows: rowsFromAnalysis(b) })
  const m = c.groups[0].matched
  assert.equal(m.learn.base, 15)
  assert.equal(m.learn.next, 13)
  assert.equal(m.wiringHits.base, 1)
  assert.equal(m.wiringHits.next, 0)
  assert.equal(m.wiringFailure.base, 0.5)
  assert.equal(m.wiringFailure.next, 0)
  assert.equal(m.wiringFinal.delta, -0.5)
  for (const k of ['learn', 'wiringHits', 'wiringFinal', 'wiringFailure']) assert.ok(METRICS[k], k)
  // A React row (no wiring record) has no wiring metrics.
  const r = rowsFromAnalysis({ trials: [{ arm: 'react', task: '07-fix-remove-button', phases: { learn: 3 } }] })[0]
  assert.equal(r.wiringHits, null)
  assert.equal(r.wiringFailure, null)
  assert.equal(r.learn, 3)
})

test('wiringReport / renderWiring: summary, rows and classify commands', () => {
  const a = {
    meta: { run: 'p4-ct1-a' },
    trials: [
      trial('07-fix-remove-button', 1, true, W(2, [], false)),
      trial('07-fix-remove-button', 2, false, W(0, ['SYG104'], true, 'final-code')),
      trial('12-selection-panel', 1, false, W(0, [], false, 'category'), undefined, 'other'),
      trial('12-selection-panel', 2, true, W(0, [], false)),
      { arm: 'react', task: '12-selection-panel', trial: 'react-12-t1', trialNo: 1, scored: { pass: false } },
    ],
  }
  const r = wiringReport(a)
  assert.deepEqual(r.summary, { trials: 4, scored: 4, withHits: 1, hitCalls: 2, hitsByCode: { SYG104: 2, SYG110: 0, SYG124: 0 }, finalChecked: 4, finalWithCodes: 1, failed: 2, wiringFailures: 1, bySource: { category: 0, 'final-code': 1 }, unclassified: 1 })
  assert.deepEqual(r.rows.map((x) => x.trial), ['sygnal-07-t1', 'sygnal-07-t2', 'sygnal-12-t1'])
  const md = renderWiring(r)
  assert.match(md, /Wiring failures: 1\/4 \(25%\)/)
  assert.match(md, /score\.mjs --classify --run p4-ct1-a --task 07 --arm sygnal --trial 2 --category wiring/)
  assert.doesNotMatch(md, /--task 12 --arm sygnal --trial 1 --category/)
  assert.equal(wiringReport(a, { tasks: (n) => n === 12 }).summary.trials, 2)
  assert.match(renderWiring(wiringReport({ meta: { run: 'x' }, trials: [] })), /No analyzed Sygnal trials/)
})
