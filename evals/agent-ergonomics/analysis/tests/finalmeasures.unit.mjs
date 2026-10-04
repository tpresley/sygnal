// PLAN-4 4-E measures (analysis/lib/finalmeasures.mjs) and their compare.mjs metrics.
// Run: node --test evals/agent-ergonomics/analysis/tests/*.unit.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { testWindowSeconds, a11yFinalCount, usedActionLog } from '../lib/finalmeasures.mjs'
import { rowsFromAnalysis, matchedCompare, METRICS } from '../lib/matched.mjs'

test('testWindowSeconds: from the first test write to the end; null without a test write', () => {
  const t0 = Date.parse('2026-10-04T10:00:00Z')
  const writes = [{ ts: t0 + 30_000 }, { ts: t0 + 12_340 }, { ts: t0 + 50_000 }]
  assert.equal(testWindowSeconds(writes, t0 + 60_000), 47.7)
  assert.equal(testWindowSeconds([], t0), null)
  assert.equal(testWindowSeconds(undefined, t0), null)
  assert.equal(testWindowSeconds([{ ts: NaN }], t0), null)
  assert.equal(testWindowSeconds([{ ts: t0 }], undefined), null)
  assert.equal(testWindowSeconds([{ ts: t0 + 5000 }], t0), 0, 'never negative')
})

test('a11yFinalCount: SYG7xx findings only; null when sygnal-check did not run', () => {
  const check = { diagnostics: [{ code: 'SYG701' }, { code: 'SYG104' }, { code: 'SYG702' }, { code: 'SYG7' }, { code: 'SYG7010' }] }
  assert.equal(a11yFinalCount(check), 2)
  assert.equal(a11yFinalCount({ diagnostics: [] }), 0)
  assert.equal(a11yFinalCount({ diagnostics: [], error: 'no src dir' }), null)
  assert.equal(a11yFinalCount(undefined), null)
})

test('usedActionLog: t.actions / inspect() / explain() on t or a renderComponent handle only', () => {
  assert.equal(usedActionLog('console.log(t.actions.map(a => a.type))'), true)
  assert.equal(usedActionLog('const g = t.inspect()'), true)
  assert.equal(usedActionLog('t.explain(s => s.count === 5)'), true)
  assert.equal(usedActionLog('const app = renderComponent(App)\nconsole.log(app.actions)'), true)
  assert.equal(usedActionLog('let r = await renderComponent(App, { dom: "real" }); r.inspect()'), true)
  assert.equal(usedActionLog('const history = { actions: [] }; history.actions.push(x)'), false, 'not a test handle')
  assert.equal(usedActionLog('export default { cat.actions }'.replace('cat', 'xt')), false, 'xt.actions is not t.actions')
  assert.equal(usedActionLog('foo.t.actions'), false)
  assert.equal(usedActionLog('npm test'), false)
  assert.equal(usedActionLog(undefined), false)
})

test('compare metrics: test time, Testing Library use and SYG7xx come from analysis records', () => {
  for (const m of ['testAuthoring', 'testWindow', 'testLearn', 'usedTestingLibrary', 'a11yFinal', 'usedActionLog']) assert.equal(METRICS[m].from, 'analysis', m)
  const trial = (arm, task, o) => ({ arm, task, trialNo: 1, scored: { pass: true }, wallSeconds: 60, phases: { learn: 2, 'test-authoring': 9 }, ...o })
  const base = { trials: [
    trial('sygnal', '10-signup-wizard', { testWindow: 30, learnSeconds: { 'testing-utility': 4 }, testApproach: ['renderComponent'], a11yFinal: 1 }),
    trial('sygnal', '29-accessible-signup', { phases: { learn: 1 }, testWindow: null, learnSeconds: {}, testApproach: [], a11yFinal: 0 }),
  ] }
  const next = { trials: [
    trial('sygnal', '10-signup-wizard', { phases: { 'test-authoring': 5 }, testWindow: 20, learnSeconds: { 'testing-utility': 1 }, testApproach: ['renderComponent', 'testing-library'], a11yFinal: 0 }),
    trial('sygnal', '29-accessible-signup', { testWindow: 10, testApproach: ['testing-library'] }),
  ] }
  const rows = rowsFromAnalysis(base)
  assert.deepEqual(
    rows.map(({ testAuthoring, testWindow, testLearn, usedTestingLibrary, a11yFinal }) => ({ testAuthoring, testWindow, testLearn, usedTestingLibrary, a11yFinal })),
    [
      { testAuthoring: 9, testWindow: 30, testLearn: 4, usedTestingLibrary: 0, a11yFinal: 1 },
      { testAuthoring: 0, testWindow: null, testLearn: 0, usedTestingLibrary: 0, a11yFinal: 0 },
    ],
  )
  const c = matchedCompare({ run: 'a', rows }, { run: 'b', rows: rowsFromAnalysis(next) })
  const g = c.groups[0]
  assert.deepEqual(g.matched.testAuthoring, { base: 4.5, next: 7, delta: 2.5, ratio: 7 / 4.5, cells: 2 })
  // testWindow: task 29 has no base value, so only task 10 is averaged on both sides.
  assert.deepEqual(g.matched.testWindow, { base: 30, next: 20, delta: -10, ratio: 20 / 30, cells: 1 })
  assert.equal(g.matched.usedTestingLibrary.next, 1)
  assert.equal(g.matched.testLearn.cells, 1, 'a trial without learnSeconds has no testLearn')
  assert.equal(g.matched.a11yFinal.cells, 1)
})
